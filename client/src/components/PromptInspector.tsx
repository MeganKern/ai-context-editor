import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useStore } from "../store.js";
import { read } from "../api.js";
import type { PromptPreview, RunKind, ThreadSnapshot } from "../../../shared/snapshot.js";
import { groupMessages } from "../view-model.js";
import * as ops from "../context-ops.js";
import { notSentBecause } from "./context/panel-state.js";
import { Icon } from "./Icon.js";
import { Menu } from "./Menu.js";
import { authorLabel, clip, contextBudget, formatK } from "../format.js";
import { BEHAVIOUR as B } from "../../../shared/behaviour.js";

type Tab = "reply" | "agent" | "run";

/**
 * The literal prompt: what a past run was sent (recorded when it started), or what the next reply
 * or agent would get. Beside it, what's sent now, with the switches.
 */
export function PromptInspector() {
  const inspector = useStore(s => s.ui.inspector);
  const setUi = useStore(s => s.setUi);
  const thread = useStore(s => s.thread);
  const [data, setData] = useState<PromptPreview | null>(null);
  const [runKind, setRunKind] = useState<RunKind | null>(null);
  const [loading, setLoading] = useState(true);
  const [task, setTask] = useState("");
  // The task the agent preview shows: what was there when you pressed Update.
  const [applied, setApplied] = useState("");
  const [sourcesOpen, setSourcesOpen] = useState(() => typeof window === "undefined" || window.innerWidth >= 1000);

  const tab: Tab = inspector?.tab ?? "reply";
  const runId = inspector?.runId ?? null;
  const threadId = thread?.thread.id;
  const seq = thread?.seq;

  const load = useCallback(async (t: Tab, taskText?: string, quiet = false) => {
    if (!threadId) return;
    if (!quiet) { setLoading(true); setData(null); }
    try {
      if (t === "reply") setData(await read.preview(threadId, "reply"));
      else if (t === "agent") setData(await read.preview(threadId, "agent", taskText || undefined));
      else if (t === "run" && runId) {
        const p = await read.runPrompt(runId);
        setData(p);
        if (p) setRunKind(p.run_kind);
      }
    } catch { setData(null); } finally { setLoading(false); }
  }, [threadId, runId]);

  // Load when opened or the tab changes; the next reply's or agent's prompt also follows changes
  // made while it's open (from the list beside it, say).
  const lastKey = useRef("");
  useEffect(() => {
    if (!inspector) { lastKey.current = ""; return; }
    const key = `${tab}|${runId}`;
    if (key !== lastKey.current) { lastKey.current = key; void load(tab, applied); }
    else if (tab !== "run") void load(tab, applied, true);
  }, [inspector, tab, runId, load, seq, applied]);

  if (!inspector || !thread) return null;
  const close = () => setUi({ inspector: null });
  const preview = data;

  // Before its prompt has loaded, a run of a card here is known by its card.
  const runIsAgent = runKind ? runKind === "agent" : thread.messages.find(m => m.run?.id === runId)?.role === "agent";
  const isAgent = tab === "agent" || (tab === "run" && runIsAgent);

  const sub = tab === "run"
    ? `Recorded with the ${runIsAgent ? "agent run" : "reply"} when it started. Editing the thread later doesn't change it.`
    : tab === "agent"
      ? "What an agent started now would be handed: this thread, then the task."
      : "What the next reply would be produced from. Nothing else is sent.";

  return createPortal(
    <div className="overlay" onMouseDown={close}>
      <div className={`dialog inspector ${sourcesOpen ? "has-sources" : ""}`} role="dialog" aria-modal="true" aria-label="The exact prompt"
        onMouseDown={e => e.stopPropagation()} onKeyDown={e => { if (e.key === "Escape") close(); }}>
        <div className="dialog-head">
          <div>
            <h2 className="dialog-title">The exact prompt</h2>
            <p className="dialog-sub">{sub}</p>
          </div>
          <button className="icon-btn" onClick={close} aria-label="Close"><Icon name="close" /></button>
        </div>
        <div className="tabs" role="tablist">
          {runId && (
            <button role="tab" aria-selected={tab === "run"} className={`tab ${tab === "run" ? "is-on" : ""}`}
              onClick={() => setUi({ inspector: { tab: "run", runId } })}>{runIsAgent ? "This agent's brief" : "This reply"}</button>
          )}
          <button role="tab" aria-selected={tab === "reply"} className={`tab ${tab === "reply" ? "is-on" : ""}`}
            onClick={() => setUi({ inspector: { tab: "reply", runId } })}>Next reply</button>
          <button role="tab" aria-selected={tab === "agent"} className={`tab ${tab === "agent" ? "is-on" : ""}`}
            onClick={() => setUi({ inspector: { tab: "agent", runId } })}>Next agent</button>
          <span className="spacer" />
          <button className={`tab tab-toggle ${sourcesOpen ? "is-on" : ""}`} onClick={() => setSourcesOpen(o => !o)} aria-expanded={sourcesOpen}>
            <Icon name="panel" /> What's sent now
          </button>
        </div>

        <div className="inspector-cols">
          <div className="inspector-main">
            {tab === "agent" && (
              <form className="inspector-task" onSubmit={e => { e.preventDefault(); setApplied(task.trim()); }}>
                <input value={task} onChange={e => setTask(e.target.value)} placeholder="Optional: type a task to see it in place" aria-label="Agent task" />
                <button className="btn btn-sm" type="submit">Update</button>
              </form>
            )}

            <div className="inspector-body">
              {loading && <p className="inspector-empty">Loading…</p>}
              {!loading && !preview && <p className="inspector-empty">{tab === "run" ? "This run never started, so it was sent nothing." : "Couldn't read it."}</p>}
              {!loading && preview && (
                <>
                  {preview.notice && (preview.kind === "reply" && /^Nothing to reply to/.test(preview.notice) ? (
                    <p className="inspector-note">This is everything sent before your next message. Whatever you send next is added at the end, then the model replies.</p>
                  ) : (
                    <div className="callout"><Icon name="alert" /><span>{preview.notice}</span></div>
                  ))}
                  {preview.agent && <AgentAdds agent={preview.agent} past={tab === "run"} />}
                  {preview.system && (
                    <div className="prompt-block is-system">
                      <div className="prompt-role">
                        System <span>{tab === "run" && runKind !== "reply" ? "the instructions it was given" : "pinned, and the library items sent with every reply"}</span>
                      </div>
                      <pre className="prompt-text">{preview.system}</pre>
                    </div>
                  )}
                  {preview.messages.map((m, i) => (
                    <div key={i} className={`prompt-block is-${m.role} ${m.placeholder ? "is-placeholder" : ""}`}>
                      <div className="prompt-role">
                        {isAgent ? <>Agent prompt <span>one document piped to Claude Code</span></> : m.role === "user" ? "User" : "Assistant"}
                        {m.placeholder && <span className="prompt-placeholder-tag">{isAgent ? "holds a placeholder" : "placeholder"}</span>}
                      </div>
                      <pre className="prompt-text">{m.content}</pre>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
          {sourcesOpen && <SentNow thread={thread} />}
        </div>

        <div className="dialog-foot">
          {preview && preview.tokens > 0 && (
            <span className="dialog-hint">About {formatK(preview.kind === "reply" ? contextBudget(thread.context).tokens : preview.tokens)} tokens</span>
          )}
          {preview && preview.omitted > 0 && tab !== "run" && <span className="dialog-hint">{preview.omitted} excluded message{preview.omitted === 1 ? "" : "s"} left out</span>}
          {preview?.model_id && <span className="dialog-hint">{tab === "run" ? "Sent to" : "Goes to"} <code>{preview.model_id}</code></span>}
          <span className="spacer" />
          <button className="btn" onClick={close}>Done</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** For an agent: what Claude Code adds to the brief, and what it's started without. */
function AgentAdds({ agent, past }: { agent: NonNullable<PromptPreview["agent"]>; past: boolean }) {
  return (
    <dl className="inspector-agent">
      <div><dt>Added</dt><dd>{agent.adds}</dd></div>
      {agent.switched_off && <div><dt>{past ? "Was off" : "Switched off"}</dt><dd>{agent.switched_off}</dd></div>}
      {agent.tool_version && <div><dt>Claude Code</dt><dd>{past ? `ran it: ${agent.tool_version}` : `${agent.tool_version} ran the last agent here`}</dd></div>}
    </dl>
  );
}

/** What goes with the next reply, with its switches: the place to act on what the prompt shows. */
function SentNow({ thread }: { thread: ThreadSnapshot }) {
  const run = useStore(s => s.run);
  const setUi = useStore(s => s.setUi);
  // Editing happens on the message itself: close this and take you there.
  const goTo = (id: string) => setUi({ inspector: null, focus: id });
  const groups = groupMessages(thread.messages, thread.summaries);

  return (
    <aside className="sent-now" aria-label="What's sent now">
      {thread.directives.length > 0 && (
        <div className="sent-group">
          <h3>Pinned</h3>
          <ul>
            {thread.directives.map(d => (
              <li key={d.id} className={d.excluded ? "is-notsent" : ""}>
                <span className="sent-text">{clip(d.text, 90)}</span>
                {d.excluded && <span className="notsent-label">Not sent</span>}
                <button className="act" onClick={() => run("set_excluded", { target: "directive", directive_id: d.id, excluded: !d.excluded })}>
                  {d.excluded ? "Include" : "Exclude"}
                </button>
                <Menu label="Pinned item actions" className="act act-more" icon="more" items={[
                  { label: "Unpin", icon: "trash", danger: true, hint: B.unpin_directive.tip, onSelect: () => void ops.unpin(d) },
                ]} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {thread.items.length > 0 && (
        <div className="sent-group">
          <h3>Library</h3>
          <ul>
            {thread.items.map(n => {
              const message = n.message_id ? thread.messages.find(m => m.id === n.message_id) : undefined;
              const why = notSentBecause(n, message);
              return (
                <li key={n.note_id} className={n.sent ? "" : "is-notsent"}>
                  <span className="sent-text" title={why ? `Not sent: ${why}` : undefined}>
                    <Icon name={n.placement === "with_message" ? "paperclip" : "note"} /> {n.name}
                    {n.placement === "with_message" && <span className="sent-where"> · with one message</span>}
                  </span>
                  {!n.sent && <span className="notsent-label">Not sent</span>}
                  <button className="act" onClick={() => void ops.setItemSwitch(thread, n.note_id, !n.excluded)}>
                    {n.excluded ? "Include" : "Exclude"}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <div className="sent-group">
        <h3>Conversation</h3>
        <ul>
          {groups.map(g => g.kind === "summary" ? (
            <li key={`s-${g.summary.id}`}>
              <span className="sent-text"><b>Summary</b> of {g.summary.message_ids.length} message{g.summary.message_ids.length === 1 ? "" : "s"}</span>
              <button className="act" onClick={() => run("set_summary_status", { summary_id: g.summary.id, status: "inactive" })}>Exclude</button>
            </li>
          ) : (
            <li key={g.item.id} className={g.item.context === "excluded" || g.item.context === "empty" ? "is-notsent" : ""}>
              <button className="sent-text sent-go" onClick={() => goTo(g.item.id)} title="Go to it in the conversation (to edit it there)">
                <b>{authorLabel(g.item)}</b> {clip(g.item.content, 70) || (g.item.status === "writing" ? "(being written)" : "(empty)")}
              </button>
              {(g.item.context === "excluded" || g.item.context === "empty") && <span className="notsent-label">Not sent</span>}
              {g.item.context === "writing" && <span className="sent-where">being written</span>}
              {g.item.content.trim() && g.item.status !== "writing" && (
                <button className="act" onClick={() => run("set_message_flags", { message_id: g.item.id, excluded: !g.item.excluded })}>
                  {g.item.excluded ? "Include" : "Exclude"}
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
