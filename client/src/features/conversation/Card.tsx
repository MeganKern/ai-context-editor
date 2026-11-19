import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentStep, Role } from "../../../../shared/snapshot.js";
import { BEHAVIOUR as B } from "../../../../shared/behaviour.js";
import { read } from "../../data/api.js";
import { hasAgents, run, useModel } from "../../data/model.js";
import { useResource } from "../../data/resources.js";
import { rows } from "../../session/rows.js";
import { composer } from "../../session/composer.js";
import { activity } from "../../session/activity.js";
import type { CardView } from "../../derive/cards.js";
import { clip, closeOpenMarkdown } from "../../derive/text.js";
import type { HelpKey } from "../../help/entries.js";
import { Icon } from "../../kit/Icon.js";
import { Act, Button } from "../../kit/Button.js";
import { Md, type NoteRefInfo } from "../../kit/Md.js";
import { RichEditor } from "../../kit/RichEditor.js";
import { AgentChanges, AgentLog } from "./AgentWork.js";
import { CardHistory } from "./CardHistory.js";
import * as ops from "./ops.js";

const isTyping = (t: EventTarget | null) =>
  !!(t as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable], .layer");

/** Move keyboard focus to the next or previous card in the conversation. */
function focusSibling(from: HTMLElement, dir: 1 | -1) {
  const all = [...document.querySelectorAll<HTMLElement>(".convo [data-msg]")];
  const next = all[all.indexOf(from) + dir];
  if (next) { next.focus(); next.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
}

/** The hue of who wrote it, and what the help says of the whole card. */
const SRC: Record<Role, string> = { user: "src-you", assistant: "src-model", agent: "src-agent" };
const AREA: Record<Role, HelpKey> = { user: "area.user", assistant: "area.reply", agent: "area.agent" };

/**
 * One piece of the context, in one block like every other entry. A header appears only when
 * there's something to say. Every card is edited in place and keeps every text it has had. Its
 * buttons show on hover or focus (quietly always on the latest reply), and a focused card takes
 * single keys: E X F, and J / K to move. Everything shown here was decided in derive/cards.ts.
 */
export function Card({ view }: { view: CardView }) {
  const { item, can } = view;
  const ws = useModel(s => s.ws);
  const agents = useModel(hasAgents);
  const threadId = useModel(s => s.threadId);
  const live = useModel(s => (item.run ? s.live[item.run.id] : undefined));
  const [editText, setEditText] = useState<string | null>(null);
  const [showSteps, setShowSteps] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editText === null) return;
    const id = requestAnimationFrame(() => formRef.current?.scrollIntoView({ block: "nearest" }));
    return () => cancelAnimationFrame(id);
  }, [editText !== null]);

  const noteRefs = useMemo(() => {
    const map = new Map<string, NoteRefInfo>();
    for (const n of ws?.notes ?? []) map.set(n.id, { name: n.name, is_current: n.is_current });
    return map;
  }, [ws?.notes]);

  // An agent's steps, read from Claude Code's own output once it has ended.
  const isAgent = item.role === "agent";
  const stepsRun = view.hasSteps ? item.run!.id : null;
  const { data: steps } = useResource<AgentStep[]>(stepsRun ? `steps:${stepsRun}` : null, () => read.steps(stepsRun!));

  const exclude = () => void run("exclude_message", { message_id: item.id, excluded: !item.excluded });
  const fold = (folded = true) => void run("fold_message", { message_id: item.id, folded });
  const verbs = {
    e: can.edit ? () => setEditText(item.content) : null,
    x: can.exclude ? exclude : null,
    f: can.fold ? () => fold() : null,
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
      if (fn) { e.preventDefault(); fn(); }
    },
  };
  const includeAct = <Act className="act-include" help="exclude_message:included" title={`${B["exclude_message:included"].tip} (X)`} onClick={exclude}>Include</Act>;

  // ── Collapsed to one line: folded (your view only), or not sent (shown dim until opened) ──
  if (view.collapsed) {
    const open = () => {
      if (item.folded) fold(false);
      if (view.notSent) rows.setOpen(item.id, true);
    };
    return (
      <div className={`msg msg-row entry ${SRC[item.role]} ${view.notSent ? "is-notsent" : ""}`} data-help="msg.row" {...keyProps}>
        <span className="msg-row-author">{view.authorLabel}</span>
        <button className="msg-row-btn" onClick={open}
          title={view.notSent ? "Not sent to the model. Click to read it." : "Folded in your view — still sent. Click to unfold."}>
          <span className="msg-row-preview">{clip(item.content, 150) || "(empty)"}</span>
          <span className="msg-row-state">{view.notSent ? "Not sent" : "Folded"}</span>
          <span className="msg-row-hint"><Icon name="expand" /> {item.folded ? "Unfold" : "Show"}</span>
        </button>
        {view.notSent && can.exclude && includeAct}
      </div>
    );
  }

  // Edits are made in place, on any card; the text it had stays in its history. Saving yours can
  // also write the reply under it again — or, at the end of the thread, ask for one — in one step.
  const save = async (thenReply: boolean) => {
    const text = editText ?? "";
    if (!text.trim()) { setEditText(null); return; }
    if (await run("edit_message", { message_id: item.id, content: text, reply: thenReply })) setEditText(null);
  };

  const isUser = item.role === "user";
  const run_ = item.run;
  const actions = [
    can.edit && <Act key="e" icon="edit" help="edit_message" title={`${B.edit_message.tip} (E)`} onClick={() => setEditText(item.content)}>Edit</Act>,
    can.followUp && agents && (
      <Act key="fu" icon="agent" help="agent_follow_up" title={`Give this agent another task. ${B.agent_follow_up.tip}.`} onClick={() => composer.followUp(item.id)}>Follow up</Act>
    ),
    can.exclude && (
      <Act key="x" icon={item.excluded ? "eye" : "eyeOff"} aria-pressed={item.excluded} help={item.excluded ? "exclude_message:included" : "exclude_message"}
        title={item.excluded ? `${B["exclude_message:included"].tip} (X)` : `${B.exclude_message.tip} (X)`} onClick={exclude}>
        {item.excluded ? "Include" : "Exclude"}
      </Act>
    ),
    can.fold && <Act key="f" icon="collapse" help="fold_message" title={`${B.fold_message.tip} (F)`} onClick={() => fold()}>Fold</Act>,
    item.history > 1 && (
      <Act key="h" icon="history" help="msg.history" aria-expanded={showHistory} onClick={() => setShowHistory(o => !o)}
        title="Every text this card has had, with who wrote each one — and the prompt behind each one a model wrote">
        History <span className="act-count">{item.history}</span>
      </Act>
    ),
    can.summarize && <Act key="s" icon="summary" help="summarize" title="Then pick the other messages to include" onClick={() => activity.open({ kind: "summarize", picked: [item.id] })}>Summarize</Act>,
    can.saveToLibrary && ws && threadId && (
      <Act key="lib" icon="note" help="create_note" title="Save as a library item, add it to this thread, and exclude this message" onClick={() => void ops.saveToLibrary(ws.workspace.id, threadId, item)}>Save to library</Act>
    ),
    can.delete && <Act key="del" icon="trash" help="delete_message" title={B.delete_message.tip} onClick={() => void ops.deleteMessage(item.id)}>Delete</Act>,
  ].filter(Boolean);
  const showActions = !view.writing && editText === null;
  const isSummary = item.author_kind === "summary";

  return (
    <article className={["msg", SRC[item.role], isSummary ? "is-summary" : "", view.notSent ? "is-notsent" : "", view.writing ? "is-pending" : "",
      view.unfinished ? "is-failed" : "", view.actionsPinned ? "is-latest" : "", view.inReview ? "is-in-review" : ""].join(" ")}
      aria-label={`${view.authorLabel}${view.notSent ? ", not sent" : ""}`} data-help-area={isSummary ? "msg.summary" : AREA[item.role]} {...keyProps}>
      <div className="msg-block entry">
        {view.header && (
          <header className="msg-meta">
            {view.header.author && <span className="msg-author" title={view.header.when}>{view.header.author}</span>}
            {view.header.edited && <span className="msg-edited" data-help="msg.edited" title={`What ${isAgent ? "the agent" : "the model"} wrote is in this card's history, with its ${isAgent ? "brief" : "prompt"}`}>Edited by you</span>}
            {view.header.nothingSent && <span className="notsent-label" title="There's nothing in it to send">Not sent</span>}
            {view.header.notSent && (
              <>
                <span className="notsent-label" title="The model doesn't see this">Not sent</span>
                {can.exclude && includeAct}
                <Act icon="collapse" help="msg.collapse" title="Back to one line" onClick={() => rows.setOpen(item.id, false)}>Collapse</Act>
              </>
            )}
            <span className="spacer" />
            {view.header.exclude && <Act icon="eyeOff" help="exclude_message" title={B.exclude_message.tip} onClick={exclude}>Exclude</Act>}
            {view.header.cancel && run_ && (
              <Act help="cancel_run" onClick={() => void run("cancel_run", { run_id: run_.id })}>
                {view.queued ? "Cancel" : <><Icon name="stop" /> {run_.cancel_requested ? "Stopping…" : "Stop"}</>}
              </Act>
            )}
          </header>
        )}

        {view.hasTask && run_ && (
          <p className="msg-task" title={run_.task!}>
            <span className="msg-task-label">{run_.follows_run_id ? "Follow-up task" : "Task"}</span>
            <span className="msg-task-text">{run_.task}</span>
          </p>
        )}
        {view.hasChanges && run_ && <AgentChanges run={run_} steps={steps} />}

        {view.hasBody && (
          <div className={`msg-body ${isUser ? "is-input" : "is-output"}`}>
            {view.writing ? (
              <WritingBody view={view} liveText={live?.text ?? ""} liveSteps={live?.steps ?? []} />
            ) : editText !== null ? (
              <div className="msg-edit" ref={formRef} data-help="msg.edit">
                <RichEditor content={editText} onChange={setEditText} onCancel={() => setEditText(null)} />
                <div className="inline-form-actions is-under">
                  <Button kind="primary" size="sm" help="edit_message" onClick={() => void save(false)}>Save</Button>
                  {can.replyAfterEdit && (
                    <Button size="sm" help="edit_message:reply" onClick={() => void save(true)}>{view.replyBelow ? "Save and get a new reply" : "Save and get a reply"}</Button>
                  )}
                  <Button kind="ghost" size="sm" onClick={() => setEditText(null)}>Cancel</Button>
                </div>
                <p className="msg-edit-help">
                  {isUser
                    ? view.replyBelow
                      ? <>Saves your new text; the old one stays in its history. The reply under it stays as it is — <em>Save and get a new reply</em> writes it again, in the same place.</>
                      : <>Saves your new text; the old one stays in its history.</>
                    : <>Saves your version of this {isAgent ? "result" : "reply"}: it's what's sent from now on, marked as edited by you. What {isAgent ? "the agent" : "the model"} wrote stays in its history.</>}
                </p>
              </div>
            ) : view.nothingSent ? (
              <span className="msg-empty">(empty message — nothing is sent)</span>
            ) : (
              <Md text={item.content} notes={noteRefs} onNotePill={noteId => activity.open({ kind: "note-view", noteId })} />
            )}
          </div>
        )}

        {view.outcome && (view.outcome.error ? (
          <div className="run-status is-error" role="alert" data-help="msg.failed">
            <Icon name="alert" />
            <div className="run-status-text"><strong>{view.outcome.title}</strong>{view.outcome.detail && <span>{view.outcome.detail}</span>}</div>
          </div>
        ) : (
          <div className="run-note" role="status" data-help="msg.stopped"><span className="run-note-text">{view.outcome.title}</span></div>
        ))}
        {view.lengthCut && <div className="run-note is-cutoff" role="status" data-help="msg.cutoff"><span className="run-note-text">Cut off: it reached the most a reply may write</span></div>}

        {view.hasSteps && (
          <div className="agent-extras">
            <Act className="agent-steps-toggle" help="msg.steps" aria-expanded={showSteps} icon={showSteps ? "chevronDown" : "chevronRight"} onClick={() => setShowSteps(o => !o)}>
              {showSteps ? "Hide its steps" : "Show its steps"}
            </Act>
            {showSteps && (steps ? <AgentLog steps={steps} full /> : <span className="msg-waiting"><span className="spinner is-inline" aria-hidden />Reading its steps…</span>)}
          </div>
        )}
        {showHistory && <CardHistory cardId={item.id} role={item.role} count={item.history} />}
      </div>

      {showActions && actions.length > 0 && (
        <footer className={`msg-actions ${view.actionsPinned ? "is-shown" : ""}`} aria-label="Message actions">{actions}</footer>
      )}
    </article>
  );
}

function WritingBody({ view, liveText, liveSteps }: { view: CardView; liveText: string; liveSteps: AgentStep[] }) {
  const r = view.item.run;
  if (!r) return <span className="msg-waiting"><span className="spinner is-inline" aria-hidden />Starting…</span>;
  // Its first words can arrive before the snapshot that says it started.
  if (view.role !== "agent" && liveText) return <div className="is-streaming"><Md text={closeOpenMarkdown(liveText)} /></div>;
  if (view.waiting) {
    return (
      <>
        {view.item.content && <div className="is-kept"><Md text={view.item.content} /></div>}
        <span className="msg-waiting" title={view.waiting.detail}><span className="spinner is-inline" aria-hidden />{view.waiting.label}</span>
      </>
    );
  }
  if (view.role === "agent") {
    const visible = liveSteps.some(s => s.type === "text" || s.type === "tool" || s.type === "result");
    return visible
      ? <AgentLog steps={liveSteps} live />
      : <span className="msg-waiting" title="Its steps appear here as it works"><span className="spinner is-inline" aria-hidden />Starting…</span>;
  }
  return <span className="msg-waiting"><span className="spinner is-inline" aria-hidden />Writing…</span>;
}
