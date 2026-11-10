import { useEffect, useRef, useState } from "react";
import { useStore } from "../store.js";
import type { MessageItem, AgentStep } from "../../../shared/snapshot.js";
import { closeOpenMarkdown, type MessageView } from "../view-model.js";
import { Md } from "./Markdown.js";
import { RunStatus } from "./RunStatus.js";
import { AgentLog, AgentChanges } from "./AgentWork.js";
import { loadSteps } from "../agent-data.js";
import { CardHistory } from "./CardHistory.js";
import { Icon } from "./Icon.js";
import { Menu, type MenuItem } from "./Menu.js";
import { authorLabel, clip, fullTime, timeLabel } from "../format.js";
import { NOTE_TYPE, draggedItem, endDrag } from "../drag.js";
import { removeFromThread, setItemSwitch, toMessage } from "../context-ops.js";
import { BEHAVIOUR as B } from "../../../shared/behaviour.js";
import { RichEditor } from "./RichEditor.js";

/** Why a card is waiting, as the server says it; a full slot frees when one of those finishes. */
function queueTitle(detail: string | undefined, reason: string | undefined): string {
  if (!detail) return "Waiting to start";
  return reason === "capacity" ? `${detail}; starts when one finishes` : detail;
}

const isTyping = (t: EventTarget | null) =>
  !!(t as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable], .menu, .popover, .dialog");

/** Move keyboard focus to the next or previous message in the conversation. */
function focusSibling(from: HTMLElement, dir: 1 | -1) {
  const all = [...document.querySelectorAll<HTMLElement>(".convo [data-msg]")];
  const i = all.indexOf(from);
  const next = all[i + dir];
  if (next) { next.focus(); next.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
}

/**
 * One piece of the context, in one block like every other entry, and plain messages carry no
 * header at all. A header appears only when there is something to say — not sent, an agent or
 * template wrote it, you edited what a model or agent wrote, time has passed, it's running.
 * Every card is edited in place, and keeps every text it has had (its history).
 * Its buttons are grouped by what they affect: rewrite it, steer the model, just your view,
 * trace where it came from. They show on hover or focus (quietly always on the latest reply),
 * and a focused message takes single keys: E R P X F T, and J / K to move.
 */
export function Message({ mv, isLatest, next, showTime, expanded, setExpanded, inReview }: {
  mv: MessageView; isLatest: boolean; next: MessageItem | undefined; showTime: boolean;
  expanded: boolean; setExpanded: (open: boolean) => void; inReview?: boolean;
}) {
  const run = useStore(s => s.run);
  const thread = useStore(s => s.thread);
  const toast = useStore(s => s.toast);
  const setUi = useStore(s => s.setUi);
  const [editText, setEditText] = useState<string | null>(null);
  const [pinText, setPinText] = useState<string | null>(null);
  const [steps, setSteps] = useState<AgentStep[] | null>(null);
  const [showSteps, setShowSteps] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [noteDrop, setNoteDrop] = useState<string | null>(null);
  const [keeping, setKeeping] = useState(false);

  // Editing or pinning opens a form under the message; bring all of it (buttons and help line
  // included) into view, so on the last message it doesn't run under the message box.
  const formRef = useRef<HTMLDivElement>(null);
  const formOpen = editText !== null || pinText !== null;
  useEffect(() => {
    if (!formOpen) return;
    const id = requestAnimationFrame(() => formRef.current?.scrollIntoView({ block: "nearest" }));
    return () => cancelAnimationFrame(id);
  }, [formOpen]);

  const { item, affordances: can, liveText, liveSteps } = mv;
  const isWriting = item.status === "writing";
  const isQueued = isWriting && item.run?.status === "queued";
  const isUser = item.role === "user";
  const isAgent = item.role === "agent";
  const isUnfinished = item.status === "cut_off" || item.status === "failed";
  const isEmpty = !isWriting && !item.content.trim();
  const msgRun = item.run;
  const notSent = item.excluded || item.context === "excluded";
  // A card with nothing in it (one that failed before writing anything) isn't sent either.
  const nothingSent = item.context === "empty";
  const lengthCut = item.status === "done" && msgRun?.finish === "length" && !item.edited;
  // Under your message, the model's reply to it — what "save and get a new reply" writes again.
  const replyBelow = isUser && next && next.role === "assistant" && next.status !== "writing" ? next : null;

  // An agent's steps, read from Claude Code's own output once it has ended.
  const stepsRun = isAgent && msgRun && !isWriting && msgRun.has_transcript ? msgRun.id : null;
  useEffect(() => {
    if (!stepsRun) return;
    let live = true;
    void loadSteps(stepsRun).then(s => { if (live && s) setSteps(s); });
    return () => { live = false; };
  }, [stepsRun]);

  const toggleExcluded = () => run("set_message_flags", { message_id: item.id, excluded: !item.excluded });
  const fold = () => run("set_message_flags", { message_id: item.id, folded: true });
  const regenerate = () => run("regenerate", { message_id: item.id });
  const openPrompt = () => msgRun && setUi({ mode: { kind: "inspector", tab: "run", runId: msgRun.id } });
  const openPin = () => setPinText(item.content);

  const canToggleContext = !isEmpty && item.context !== "summarized" && can.canExclude;
  const verbs = {
    e: can.canEdit ? () => setEditText(item.content) : null,
    r: can.canRegenerate ? regenerate : null,
    p: !isEmpty && can.canPin ? openPin : null,
    x: canToggleContext ? toggleExcluded : null,
    f: can.canFold ? fold : null,
    t: can.canViewPrompt && msgRun ? openPrompt : null,
  };

  const keyProps = {
    "data-msg": item.id,
    tabIndex: -1,
    onMouseDown: (e: React.MouseEvent<HTMLElement>) => {
      if ((e.target as HTMLElement).closest("button, a, input, textarea, select, label")) return;
      e.currentTarget.focus({ preventScroll: true });
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === "j" || e.key === "ArrowDown") { e.preventDefault(); focusSibling(e.currentTarget, 1); return; }
      if (k === "k" || e.key === "ArrowUp") { e.preventDefault(); focusSibling(e.currentTarget, -1); return; }
      if (e.key === "Escape") { e.currentTarget.blur(); return; }
      const fn = verbs[k as keyof typeof verbs];
      if (fn) { e.preventDefault(); void fn(); }
    },
  };

  // ── Collapsed to one line: folded (your view only), or not sent (shown dim until opened) ──
  if (item.folded || (notSent && !expanded)) {
    const open = () => {
      if (item.folded) void run("set_message_flags", { message_id: item.id, folded: false });
      if (notSent) setExpanded(true);
    };
    return (
      <div className={`msg msg-row msg-${item.role} ${notSent ? "is-notsent" : ""}`} {...keyProps}>
        <span className="msg-row-author">{authorLabel(item)}</span>
        <button className="msg-row-btn" onClick={open}
          title={notSent ? "Not sent to the model. Click to read it." : "Folded in your view — still sent. Click to unfold."}>
          <span className="msg-row-preview">{clip(item.content, 150) || "(empty)"}</span>
          <span className="msg-row-state">{notSent ? "Not sent" : "Folded"}</span>
          <span className="msg-row-hint"><Icon name="expand" /> {item.folded ? "Unfold" : "Show"}</span>
        </button>
        {notSent && can.canExclude && (
          <button className="act act-include" onClick={toggleExcluded} title={`${B["set_message_flags:included"].tip} (X)`}>Include</button>
        )}
      </div>
    );
  }

  const del = async () => {
    if (await run("delete_message", { message_id: item.id })) toast("Message deleted");
  };
  // Edits are made in place, on any card; the text it had stays in its history. Saving yours can
  // also write the reply under it again — or, at the end of the thread, ask for one — in one step.
  const save = async (thenReply: boolean) => {
    const text = editText ?? "";
    if (!text.trim()) { setEditText(null); return; }
    if (text === item.content && !thenReply) { setEditText(null); return; }
    if (text === item.content) {
      const ok = replyBelow ? await run("regenerate", { message_id: replyBelow.id }) : await run("request_reply", { message_id: item.id });
      if (ok) setEditText(null);
      return;
    }
    const ok = await run("edit_message", { message_id: item.id, content: text, then: thenReply ? "reply" : null });
    if (ok) setEditText(null);
  };
  const branch = async () => {
    const r = await run("branch_thread", { message_id: item.id });
    if (r) {
      toast("Branched — this is its own thread now, with its own context.");
      void useStore.getState().openThread(r.thread_id);
    }
  };
  // One click, one item: the buttons wait for the first save.
  const savePin = async () => {
    if (keeping) return;
    if (pinText?.trim() && thread) {
      setKeeping(true);
      const ok = await run("pin_directive", { thread_id: thread.thread.id, text: pinText.trim(), source_message_id: item.id });
      setKeeping(false);
      if (!ok) return;
      toast("Pinned — it's sent with every reply in this thread.");
    }
    setPinText(null);
  };
  // Reference text worth reusing: a library item, named from its first line, and used here too.
  const saveToLibrary = async () => {
    const ws = useStore.getState().ws;
    const text = pinText?.trim();
    if (!text || !thread || !ws || keeping) return;
    const name = text.split("\n")[0].replace(/^[#>*\-\s]+/, "").slice(0, 40).trim() || "From the conversation";
    setKeeping(true);
    const r = await run("create_note", { workspace_id: ws.workspace.id, name, content: text, load_into_thread_id: thread.thread.id });
    setKeeping(false);
    if (!r) return;
    toast(`Saved to the library as “${name}” — and sent with every reply here.`);
    setPinText(null);
  };

  // ── Rarer verbs ──────────────────────────────────────────────────────────
  const more: MenuItem[] = [];
  more.push({ label: "Send a library item with it…", icon: "paperclip", hint: B["place_item:with_message"].tip, onSelect: () => setUi({ mode: { kind: "notePicker", target: "attach", messageId: item.id } }) });
  if (next) more.push({ label: "Insert a message below…", icon: "insert", hint: B.insert_message.tip, onSelect: () => setUi({ mode: { kind: "insertAfter", messageId: item.id } }) });
  more.push({ label: "Branch from here", hint: B.branch_thread.tip, onSelect: branch });
  if (!isWriting && item.context !== "summarized" && !isEmpty) more.push({ label: "Summarize…", icon: "summary", hint: "Then pick the other cards to include", onSelect: () => setUi({ mode: { kind: "selection", picked: [item.id] } }) });
  if (can.canDelete) {
    more.push({ separator: true });
    more.push({ label: "Delete message", icon: "trash", danger: true, hint: B.delete_message.tip, onSelect: del });
  }

  // ── Header: only when it carries news ───────────────────────────────────
  const author = isAgent ? "Agent" : item.author_kind === "template" ? "Template" : null;
  const writingControls = isWriting && ((can.canExclude && !notSent && item.context !== "summarized") || (msgRun && can.canCancel));
  const hasHeader = !!author || showTime || notSent || nothingSent || item.edited || !!writingControls;
  const when = fullTime(item.created_at);

  const rewrite = [
    can.canEdit && (
      <button key="e" className="act" onClick={() => setEditText(item.content)} title={`${B.edit_message.tip} (E)`}><Icon name="edit" /> Edit</button>
    ),
    isAgent && can.canFollowUp && (
      <button key="fu" className="act act-agent" onClick={() => setUi({ composer: { mode: "agent", continueMessageId: item.id } })}
        title={`Give this agent another task. ${B.agent_follow_up.tip}.`}>
        <Icon name="agent" /> Follow up
      </button>
    ),
    can.canRegenerate && !isUnfinished && (
      <button key="g" className="act" onClick={regenerate}
        title={isAgent ? `${B["regenerate:agent"].tip} (R)` : `${B.regenerate.tip}. Messages below stay (R)`}>
        <Icon name="regenerate" /> Regenerate
      </button>
    ),
  ].filter(Boolean);
  const steer = [
    !isEmpty && can.canPin && (
      <button key="p" className="act" onClick={openPin} title={`Pin part of it: ${B.pin_directive.tip.toLowerCase()} (P)`}><Icon name="pin" /> Pin</button>
    ),
    canToggleContext && (
      <button key="x" className="act" onClick={toggleExcluded} aria-pressed={item.excluded}
        title={item.excluded ? `${B["set_message_flags:included"].tip} (X)` : `${B.set_message_flags.tip} (X)`}>
        <Icon name={item.excluded ? "eye" : "eyeOff"} /> {item.excluded ? "Include" : "Exclude"}
      </button>
    ),
  ].filter(Boolean);
  const view = [
    can.canFold && (
      <button key="f" className="act" onClick={fold} title={`${B["set_message_flags:folded"].tip} (F)`}><Icon name="collapse" /> Fold</button>
    ),
  ].filter(Boolean);
  const trace = [
    can.canViewPrompt && msgRun && (
      <button key="t" className="act" onClick={openPrompt}
        title={isAgent ? "The exact brief this agent was handed — kept with the run (T)" : "The exact prompt this reply was written from — kept with the run (T)"}>
        <Icon name="code" /> {isAgent ? "Brief" : "Prompt"}
      </button>
    ),
    item.history > 1 && (
      <button key="h" className="act act-history" onClick={() => setShowHistory(o => !o)} aria-expanded={showHistory}
        title="Every text this card has had, with who wrote each one — and the prompt behind each one a model wrote">
        <Icon name="history" /> History <span className="act-count">{item.history}</span>
      </button>
    ),
  ].filter(Boolean);

  const showActions = !isWriting && editText === null && pinText === null;
  const alwaysShown = isLatest && !isUser;

  return (
    <article
      className={[
        "msg", `msg-${item.role}`,
        notSent ? "is-notsent" : "", isWriting ? "is-pending" : "", isUnfinished ? "is-failed" : "",
        isLatest ? "is-latest" : "", noteDrop ? "is-note-drop" : "", inReview ? "is-in-review" : "",
      ].join(" ")}
      aria-label={`${authorLabel(item)}${notSent ? ", not sent" : ""}`}
      {...keyProps}
      onDragOver={e => {
        if (e.dataTransfer.types.includes(NOTE_TYPE)) {
          e.preventDefault();
          const already = item.items.some(n => n.note_id === draggedItem(e)?.id);
          const hint = already ? "It already goes with this message" : "Drop to put it with this message, and nowhere else in this thread";
          if (noteDrop !== hint) setNoteDrop(hint);
        }
      }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setNoteDrop(null); }}
      onDrop={e => {
        const noteId = e.dataTransfer.getData(NOTE_TYPE);
        const dragged = draggedItem(e);
        setNoteDrop(null);
        if (!noteId || !thread) return;
        e.preventDefault();
        endDrag();
        if (item.items.some(n => n.note_id === noteId)) return;
        void toMessage(thread, noteId, item.id, dragged?.label ?? "It");
      }}
    >
      {noteDrop && <div className="msg-drop-hint">{noteDrop}</div>}

      {/* Everything about this entry sits in one block; its buttons go under it. */}
      <div className="msg-block">
      {hasHeader && (
        <header className="msg-meta">
          {author && <span className="msg-author" title={when}>{author}</span>}
          {item.edited && <span className="msg-edited" title={`What ${isAgent ? "the agent" : "the model"} wrote is in this card's history, with its ${isAgent ? "brief" : "prompt"}`}>Edited by you</span>}
          {showTime && <time className="msg-time" dateTime={item.created_at} title={when}>{timeLabel(item.created_at)}</time>}
          {nothingSent && <span className="notsent-label" title="There's nothing in it to send">Not sent</span>}
          {notSent && (
            <>
              <span className="notsent-label" title="The model doesn't see this">Not sent</span>
              {can.canExclude && <button className="act act-include" onClick={toggleExcluded} title={`${B["set_message_flags:included"].tip} (X)`}>Include</button>}
              <button className="act" onClick={() => setExpanded(false)} title="Back to one line"><Icon name="collapse" /> Collapse</button>
            </>
          )}
          <span className="spacer" />
          {isWriting && can.canExclude && !notSent && item.context !== "summarized" && (
            <button className="act" onClick={toggleExcluded} title={B.set_message_flags.tip}>
              <Icon name="eyeOff" /> Exclude
            </button>
          )}
          {isWriting && msgRun && can.canCancel && (
            <button className="act" onClick={() => run("cancel_run", { run_id: msgRun.id })}>
              {isQueued ? "Cancel" : <><Icon name="stop" /> {msgRun.cancel_requested ? "Stopping…" : "Stop"}</>}
            </button>
          )}
        </header>
      )}

      {isAgent && msgRun?.task && (
        <p className="msg-task" title={msgRun.task}>
          <span className="msg-task-label">{msgRun.follows_run_id ? "Follow-up task" : "Task"}</span>
          <span className="msg-task-text">{msgRun.task}</span>
        </p>
      )}

      {isAgent && msgRun && !isWriting && msgRun.changes && <AgentChanges run={msgRun} steps={steps} />}

      {item.items.length > 0 && (
        <ul className="msg-notes">
          {item.items.map(n => (
            <li key={n.note_id} className={`msg-note ${n.sent ? "is-sent" : "is-notsent"}`}>
              <Icon name="paperclip" className="msg-note-clip" />
              <button className="msg-note-name" onClick={() => setUi({ noteEditor: n.note_id })}>{n.name}</button>
              {n.sent ? <span className="msg-note-state">sent with this message</span> : <>
                <span className="notsent-label" title="The model doesn't get this item">Not sent</span>
                {!n.excluded && <span className="msg-note-state">the message isn't</span>}
              </>}
              {thread && <button className="act" onClick={() => setItemSwitch(thread, n.note_id, !n.excluded)}>
                {n.excluded ? "Include" : "Exclude"}
              </button>}
              {thread && <button className="icon-btn" aria-label={`Remove ${n.name} from this thread`} title={`Remove it from this thread: ${B.remove_item.tip.toLowerCase()}`}
                onClick={() => removeFromThread(thread, n.note_id, n.name)}><Icon name="close" /></button>}
            </li>
          ))}
        </ul>
      )}

      {!(isEmpty && isUnfinished) && <div className={`msg-body ${isUser ? "is-input" : "is-output"}`}>
        {isWriting ? (
          <WritingBody item={item} liveText={liveText} liveSteps={liveSteps} />
        ) : editText !== null ? (
          <div className="msg-edit" ref={formRef}>
            <RichEditor
              content={editText}
              onChange={setEditText}
              onCancel={() => setEditText(null)}
            />
            <div className="msg-edit-actions">
              <button className="btn btn-primary btn-sm" onClick={() => save(false)}>Save</button>
              {isUser && (replyBelow || !next) && !notSent && (
                <button className="btn btn-sm" onClick={() => save(true)}>{replyBelow ? "Save and get a new reply" : "Save and get a reply"}</button>
              )}
              <button className="btn btn-ghost btn-sm" onClick={() => setEditText(null)}>Cancel</button>
            </div>
            <p className="msg-edit-help">
              {isUser
                ? replyBelow
                  ? <>Saves your new text; the old one stays in its history. The reply under it stays as it is — <em>Save and get a new reply</em> writes it again, in the same place.</>
                  : <>Saves your new text; the old one stays in its history.</>
                : <>Saves your version of this {isAgent ? "result" : "reply"}: it's what's sent from now on, marked as edited by you. What {isAgent ? "the agent" : "the model"} wrote stays in its history.</>}
            </p>
          </div>
        ) : isEmpty ? (
          <span className="msg-empty">(empty message — nothing is sent)</span>
        ) : (
          <Md text={item.content} />
        )}
      </div>}

      {isUnfinished && <RunStatus item={item} onRetry={can.canRegenerate ? regenerate : undefined} />}

      {lengthCut && (
        <div className="run-note is-cutoff" role="status">
          <span className="run-note-text">Cut off: it reached the most a reply may write</span>
          {can.canRegenerate && <button className="act" onClick={regenerate} title={B.regenerate.tip}><Icon name="regenerate" /> Regenerate</button>}
        </div>
      )}

      {pinText !== null && (
        <div className="inline-form pin-form" ref={formRef}>
          <label className="inline-form-label" htmlFor={`pin-${item.id}`}>
            Keep it in front of the model <span>— trim it to the part you want to keep.</span>
          </label>
          <textarea id={`pin-${item.id}`} autoFocus rows={3} value={pinText} onChange={e => setPinText(e.target.value)}
            onKeyDown={e => { if (e.key === "Escape") setPinText(null); }} />
          <div className="inline-form-actions">
            <button className="btn btn-primary btn-sm" onClick={savePin} disabled={!pinText.trim() || keeping}
              title={B.pin_directive.tip}><Icon name="pin" /> Pin</button>
            <button className="btn btn-sm" onClick={saveToLibrary} disabled={!pinText.trim() || keeping}
              title="A library item: sent with every reply here, and reusable in any thread"><Icon name="note" /> Save to the library</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setPinText(null)}>Cancel</button>
          </div>
        </div>
      )}

      {isAgent && msgRun && !isWriting && msgRun.has_transcript && (
        <div className="agent-extras">
          <button className="act agent-steps-toggle" aria-expanded={showSteps} onClick={() => setShowSteps(o => !o)}>
            <Icon name={showSteps ? "chevronDown" : "chevronRight"} /> {showSteps ? "Hide its steps" : "Show its steps"}
          </button>
          {showSteps && (steps ? <AgentLog steps={steps} full /> : <span className="msg-waiting"><span className="spinner is-inline" aria-hidden />Reading its steps…</span>)}
        </div>
      )}

      {showHistory && <CardHistory cardId={item.id} role={item.role} count={item.history} />}
      </div>

      {showActions && (
        <footer className={`msg-actions ${alwaysShown ? "is-shown" : ""}`} aria-label="Message actions">
          {[rewrite, steer, view, trace].filter(g => g.length).map((g, i) => <div key={i} className="act-group">{g}</div>)}
          {more.length > 0 && <Menu label="More actions" className="act act-more" text="More" icon="more" align="start" items={more} />}
        </footer>
      )}
    </article>
  );
}

function WritingBody({ item, liveText, liveSteps }: { item: MessageItem; liveText: string; liveSteps: AgentStep[] }) {
  const r = item.run;
  if (!r) return <span className="msg-waiting"><span className="spinner is-inline" aria-hidden />Starting…</span>;
  // Its first words can arrive before the snapshot that says it started.
  if (item.role !== "agent" && liveText) return <div className="is-streaming"><Md text={closeOpenMarkdown(liveText)} /></div>;
  if (r.status === "queued") {
    return (
      <>
        {item.content && <div className="is-kept"><Md text={item.content} /></div>}
        <span className="msg-waiting" title={queueTitle(r.queue?.detail, r.queue?.reason)}><span className="spinner is-inline" aria-hidden />{r.queue?.reason === "waiting" ? "Waiting for the card above" : r.queue?.reason === "agent" ? "Waiting for the other agent in this folder" : "Queued"}</span>
      </>
    );
  }
  if (item.role === "agent") {
    const visible = liveSteps.some(s => s.type === "text" || s.type === "tool" || s.type === "result");
    return visible
      ? <AgentLog steps={liveSteps} live />
      : <span className="msg-waiting" title="Its steps appear here as it works"><span className="spinner is-inline" aria-hidden />Starting…</span>;
  }
  return liveText
    ? <div className="is-streaming"><Md text={closeOpenMarkdown(liveText)} /></div>
    : <span className="msg-waiting"><span className="spinner is-inline" aria-hidden />Writing…</span>;
}
