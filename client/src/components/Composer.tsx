import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { useStore } from "../store.js";
import { saveDraft } from "../api.js";
import { AGENT_PERMISSIONS, AGENT_PERMISSION_LABELS, AGENT_PERMISSION_TOOLS, DEFAULT_AGENT_PREAMBLE, DEFAULT_AGENT_PERMISSION,
  AGENT_EFFORTS, AGENT_EFFORT_LABELS, DEFAULT_AGENT_EFFORT, type AgentPermission, type AgentEffort } from "../../../shared/agent.js";
import { Icon } from "./Icon.js";
import { MOD, clip, modelLabel } from "../format.js";
import { LIBRARY_TYPE, draggedItem, endDrag } from "../drag.js";
import { BEHAVIOUR as B } from "../../../shared/behaviour.js";

const NONE: string[] = [];

/**
 * What you've typed and not sent stays with its thread, on the server (so it's there after a
 * reload, or on another computer), and here meanwhile, so switching threads never waits for it.
 */
interface Draft { message: string; task: string }
const typed = new Map<string, Draft>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let unsaved: { threadId: string; draft: Draft } | null = null;
function flushDraft() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (unsaved) { void saveDraft(unsaved.threadId, unsaved.draft); unsaved = null; }
}
function rememberDraft(threadId: string, draft: Draft) {
  typed.set(threadId, draft);
  if (unsaved && unsaved.threadId !== threadId) flushDraft();
  unsaved = { threadId, draft };
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(flushDraft, 500);
}
if (typeof window !== "undefined") window.addEventListener("pagehide", flushDraft);

/** The key hint under the box is for the first few messages; after that it's furniture. */
const TAUGHT = "desk.taught.composer";
function taughtCount(): number { try { return Number(localStorage.getItem(TAUGHT)) || 0; } catch { return 0; } }
function noteTaught() { try { localStorage.setItem(TAUGHT, String(taughtCount() + 1)); } catch { /* private mode */ } }

function useAutoGrow(ref: React.RefObject<HTMLTextAreaElement | null>, value: string, max = 320) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(max, el.scrollHeight) + "px";
  }, [ref, value, max]);
}

/**
 * Adds a card to the conversation. Enter adds your message without a reply; Ctrl/⌘+Enter adds it
 * and asks the model to reply to the context as it now stands. Both are ordinary commits, so
 * neither button is louder than the other — each shows its key. Library items can go with the
 * message you send next (dropped on the box, or chosen in the library); they go with it in the
 * same step, before any reply. Agent mode writes a brief for a bounded task; the thread is the
 * rest of the brief.
 */
export function Composer() {
  const thread = useStore(s => s.thread);
  const ws = useStore(s => s.ws);
  const run = useStore(s => s.run);
  const pending = useStore(s => s.pending);
  const composer = useStore(s => s.ui.composer);
  const setUi = useStore(s => s.setUi);
  const threadId = thread?.thread.id ?? "";
  const nextIds = useStore(s => s.nextNotes[threadId]) ?? NONE;
  const setNextNotes = useStore(s => s.setNextNotes);
  const [text, setText] = useState("");
  const [taught] = useState(() => taughtCount() >= 3);
  const [task, setTask] = useState("");
  const [busy, setBusy] = useState(false);
  const [dropOver, setDropOver] = useState(false);
  const [agentEffort, setAgentEffort] = useState<AgentEffort>(DEFAULT_AGENT_EFFORT);
  const msgRef = useRef<HTMLTextAreaElement>(null);
  const taskRef = useRef<HTMLTextAreaElement>(null);
  const agentCfg = useRef<{ permission: AgentPermission; preamble: string }>({
    permission: ws?.agent_defaults.permission ?? DEFAULT_AGENT_PERMISSION,
    preamble: ws?.agent_defaults.preamble || DEFAULT_AGENT_PREAMBLE,
  });
  // The thread the box holds the text of: it takes the text kept for a thread when that thread
  // arrives (what was typed here this session, or else what the server kept).
  const [shownId, setShownId] = useState<string | null>(null);
  if (thread && shownId !== thread.thread.id) {
    const kept = typed.get(thread.thread.id) ?? thread.draft;
    setShownId(thread.thread.id);
    setText(kept.message);
    setTask(kept.task);
  }
  // For a send that finishes after you've moved to another thread.
  const shown = useRef<string | null>(null);
  useEffect(() => { shown.current = shownId; }, [shownId]);
  const editText = (v: string) => { setText(v); if (shownId) rememberDraft(shownId, { message: v, task }); };
  const editTask = (v: string) => { setTask(v); if (shownId) rememberDraft(shownId, { message: text, task: v }); };

  useEffect(() => {
    (composer.mode === "agent" ? taskRef : msgRef).current?.focus();
  }, [threadId, composer.mode, composer.continueMessageId]);
  useEffect(() => flushDraft, []);

  useAutoGrow(msgRef, text);
  useAutoGrow(taskRef, task);

  if (!thread || !ws) return null;

  const isAgent = composer.mode === "agent";
  const continueId = composer.continueMessageId;
  const continueTask = continueId ? thread.messages.find(m => m.id === continueId)?.run?.task : null;
  const busyAbove = thread.messages.some(m => m.status === "writing");
  const sending = busy || !!pending.send_message || !!pending.dispatch_agent || !!pending.agent_follow_up;
  const models = ws.models ?? [];
  const def = models.find(m => m.default);
  const setMode = (mode: "message" | "agent") => setUi({ composer: { mode, continueMessageId: null } });
  const empty = !text.trim();
  // Items deleted from the library meanwhile drop out, and so do items sent with every reply here
  // (they stay where they are). One that goes with another message here moves to this one.
  const placed = new Map(thread.items.map(i => [i.note_id, i.placement]));
  const withNext = nextIds.map(id => ws.notes.find(n => n.id === id))
    .filter((n): n is NonNullable<typeof n> => !!n && placed.get(n.id) !== "every_reply");

  // The library items go with it in the same step, before any reply is asked for.
  const send = async (reply: boolean) => {
    if (empty || sending) return;
    const tid = thread.thread.id;
    setBusy(true);
    try {
      const r = await run("send_message", { thread_id: tid, content: text.trim(), reply, note_ids: withNext.map(n => n.id) });
      if (!r) return;
      rememberDraft(tid, { message: "", task: typed.get(tid)?.task ?? "" });
      if (shown.current === tid) setText("");
      noteTaught();
      if (withNext.length) setNextNotes(tid, []);
    } finally {
      setBusy(false);
    }
  };
  const acceptsDrop = (e: React.DragEvent) => !isAgent && e.dataTransfer.types.includes(LIBRARY_TYPE);

  const startAgent = async (perm: AgentPermission, pre: string, eff?: AgentEffort) => {
    if (!task.trim() || sending) return;
    const tid = thread.thread.id;
    const extra = { preamble: pre || undefined, permission: perm, effort: eff };
    const r = continueId
      ? await run("agent_follow_up", { message_id: continueId, message: task.trim(), ...extra })
      : await run("dispatch_agent", { thread_id: tid, task: task.trim(), ...extra });
    if (!r) return;
    rememberDraft(tid, { message: typed.get(tid)?.message ?? "", task: "" });
    if (shown.current === tid) { setTask(""); setUi({ composer: { mode: "message", continueMessageId: null } }); }
  };

  const modelSelect = (
    <label className="composer-model" title="The model that replies in this thread">
      <span className="sr-only">Model for this thread</span>
      <select
        value={thread.thread.model ?? ""}
        onChange={e => run("set_thread_model", { thread_id: thread.thread.id, model: e.target.value || null })}
      >
        <option value="">{def ? `${modelLabel(def.alias, def.id)} (default)` : "Default model"}</option>
        {models.map(m => <option key={m.alias} value={m.alias}>{modelLabel(m.alias, m.id)}</option>)}
      </select>
      <Icon name="chevronDown" />
    </label>
  );

  return (
    <div className={`composer ${isAgent ? "is-agent" : ""}`}>
      <div className={`composer-box ${dropOver ? "is-note-drop" : ""}`}
        onDragOver={e => { if (acceptsDrop(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; if (!dropOver) setDropOver(true); } }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropOver(false); }}
        onDrop={e => {
          setDropOver(false);
          if (!acceptsDrop(e)) return;
          const id = draggedItem(e)?.id ?? e.dataTransfer.getData(LIBRARY_TYPE);
          if (!id) return;
          e.preventDefault();
          endDrag();
          setNextNotes(thread.thread.id, [...nextIds, id]);
          msgRef.current?.focus();
        }}>
        {dropOver && <div className="composer-drop-hint">Drop to send it with your next message</div>}
        <div className="composer-modes" role="tablist" aria-label="What to add">
          <button role="tab" aria-selected={!isAgent} className={`mode ${!isAgent ? "is-on" : ""}`} onClick={() => setMode("message")}>
            Message
          </button>
          <button role="tab" aria-selected={isAgent} className={`mode mode-agent ${isAgent ? "is-on" : ""}`} onClick={() => setMode("agent")}>
            <Icon name="agent" /> Agent task
          </button>
          {isAgent && continueId && continueTask && (
            <span className="composer-follow">
              Following up on: <em>{clip(continueTask, 60)}</em>
              <button className="icon-btn" aria-label="Start a new agent instead" title="Start a new agent instead"
                onClick={() => setUi({ composer: { mode: "agent", continueMessageId: null } })}><Icon name="close" /></button>
            </span>
          )}
          {isAgent && (
            <>
              <span className="spacer" />
              <label className="agent-config-select" title="Model for this agent">
                <span className="agent-config-label">Model</span>
                <select value={thread.thread.model ?? ""} onChange={e => run("set_thread_model", { thread_id: thread.thread.id, model: e.target.value || null })}>
                  <option value="">{def ? `${modelLabel(def.alias, def.id)} (default)` : "Default"}</option>
                  {models.map(m => <option key={m.alias} value={m.alias}>{modelLabel(m.alias, m.id)}</option>)}
                </select>
                <Icon name="chevronDown" />
              </label>
              <label className="agent-config-select" title="Thinking effort level (--effort flag)">
                <span className="agent-config-label">Effort</span>
                <select value={agentEffort} onChange={e => setAgentEffort(e.target.value as AgentEffort)}>
                  {AGENT_EFFORTS.map(e => (
                    <option key={e} value={e}>{AGENT_EFFORT_LABELS[e]}</option>
                  ))}
                </select>
                <Icon name="chevronDown" />
              </label>
            </>
          )}
        </div>

        {!isAgent ? (
          <textarea
            ref={msgRef}
            className="composer-input"
            value={text}
            onChange={e => editText(e.target.value)}
            placeholder="Add to the context…"
            aria-label="Message"
            rows={2}
            disabled={sending}
            onKeyDown={e => {
              if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
              if (e.metaKey || e.ctrlKey) { e.preventDefault(); void send(true); }
              else if (!e.shiftKey) { e.preventDefault(); void send(false); }
            }}
          />
        ) : (
          <textarea
            ref={taskRef}
            className="composer-input"
            value={task}
            onChange={e => editTask(e.target.value)}
            placeholder={continueId ? "What should the agent do next?" : ""}
            aria-label="Agent task"
            rows={3}
            disabled={sending}
            onKeyDown={e => {
              if (e.key === "Escape") setMode("message");
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void startAgent(agentCfg.current.permission, agentCfg.current.preamble, agentEffort); }
            }}
          />
        )}

        {!isAgent && withNext.length > 0 && (
          <div className="composer-with" aria-label="Goes with this message">
            <span className="composer-with-label">With this message</span>
            {withNext.map(n => (
              <span key={n.id} className="composer-chip">
                <Icon name="paperclip" />
                <button className="composer-chip-name" onClick={() => setUi({ noteEditor: n.id })}
                  title={placed.get(n.id) === "with_message" ? "It goes with another message here now; sending this one moves it to this one" : "Open it"}>{n.name}</button>
                <button className="composer-chip-x" aria-label={`Don't send ${n.name} with this message`} title="Don't send it with this message"
                  onClick={() => setNextNotes(thread.thread.id, nextIds.filter(id => id !== n.id))}><Icon name="close" size={12} /></button>
              </span>
            ))}
          </div>
        )}

        {isAgent && <AgentConfig ws={ws} onStart={(perm, pre) => startAgent(perm, pre, agentEffort)}
          sending={sending} taskEmpty={!task.trim()} continueId={continueId} cfgRef={agentCfg} />}

        {!isAgent && (
          <div className="composer-bar">
            {modelSelect}
            <span className="spacer" />
            <button className="btn btn-send" onClick={() => send(false)} disabled={empty || sending}
              title={B.send_message.tip}>
              Add without reply <kbd>⏎</kbd>
            </button>
            <button className="btn btn-send" onClick={() => send(true)} disabled={empty || sending}
              title={B["send_message:reply"].tip}>
              Add and get reply <kbd>{MOD} ⏎</kbd>
            </button>
          </div>
        )}
      </div>
      {!isAgent && (
        <div className="composer-foot">
          <span className="spacer" />
          {busyAbove && !empty ? (
            <span className="composer-queue" title="A card above is still being written. A reply you ask for now starts once the cards above it are written.">A reply asked for now waits its turn</span>
          ) : !taught && empty ? (
            <span className="composer-hint" title="A message added without a reply can get one later, from the message."><kbd>Shift ⏎</kbd> new line</span>
          ) : null}
        </div>
      )}
    </div>
  );
}

function AgentConfig({ ws, onStart, sending, taskEmpty, continueId, cfgRef }: {
  ws: { workspace: { id: string }; agent_defaults: { preamble: string; permission: AgentPermission } };
  onStart: (permission: AgentPermission, preamble: string) => void;
  sending: boolean; taskEmpty: boolean; continueId: string | null;
  cfgRef: React.MutableRefObject<{ permission: AgentPermission; preamble: string }>;
}) {
  const run = useStore(s => s.run);
  const defaults = ws.agent_defaults;
  const [permission, setPermission] = useState<AgentPermission>(defaults.permission || DEFAULT_AGENT_PERMISSION);
  const effectivePreamble = defaults.preamble || DEFAULT_AGENT_PREAMBLE;
  const [preamble, setPreamble] = useState(effectivePreamble);
  const [showPreamble, setShowPreamble] = useState(false);
  const [showCli, setShowCli] = useState(false);
  const preambleRef = useRef<HTMLTextAreaElement>(null);
  const edited = preamble !== effectivePreamble;
  const permChanged = permission !== (defaults.permission || DEFAULT_AGENT_PERMISSION);

  useEffect(() => {
    setPreamble(defaults.preamble || DEFAULT_AGENT_PREAMBLE);
    setPermission(defaults.permission || DEFAULT_AGENT_PERMISSION);
  }, [defaults.preamble, defaults.permission]);

  useEffect(() => { cfgRef.current = { permission, preamble }; }, [cfgRef, permission, preamble]);

  useEffect(() => {
    if (showPreamble && preambleRef.current) {
      preambleRef.current.focus();
      preambleRef.current.setSelectionRange(preambleRef.current.value.length, preambleRef.current.value.length);
    }
  }, [showPreamble]);

  const saveDefaults = async () => {
    await run("set_agent_defaults", { workspace_id: ws.workspace.id, preamble, permission });
  };

  return (
    <div className="agent-config">
      <div className="agent-config-row">
        <div className="agent-config-perm-group">
          <div className="agent-config-perm-head">
            <label className="agent-config-perm">
              <span className="agent-config-label">Permissions</span>
              <select value={permission} onChange={e => setPermission(e.target.value as AgentPermission)}>
                {AGENT_PERMISSIONS.map(p => (
                  <option key={p} value={p}>{AGENT_PERMISSION_LABELS[p].name}</option>
                ))}
              </select>
              <Icon name="chevronDown" />
            </label>
            <button className={`agent-config-detail-toggle ${showCli ? "is-open" : ""}`}
              onClick={() => setShowCli(s => !s)} aria-label="Show CLI flags" title={showCli ? "Hide CLI details" : "Show CLI details"}>
              <Icon name="chevronDown" />
            </button>
          </div>
          {showCli && (
            <div className="agent-config-cli">
              <code className="agent-config-flag">{AGENT_PERMISSION_LABELS[permission].flag}</code>
              {AGENT_PERMISSION_TOOLS[permission] && (
                <span className="agent-config-tools">{AGENT_PERMISSION_TOOLS[permission]!.join(", ")}</span>
              )}
            </div>
          )}
        </div>
        <span className="spacer" />
        <button className="btn btn-sm btn-ghost" onClick={() => setShowPreamble(s => !s)}>
          Agent system message
        </button>
        <button className="btn btn-agent-primary btn-send" onClick={() => onStart(permission, preamble)} disabled={taskEmpty || sending}>
          <Icon name="play" /> {continueId ? "Send to agent" : "Start agent"} <kbd>{MOD} ⏎</kbd>
        </button>
      </div>

      {showPreamble && (
        <div className="agent-config-preamble">
          <textarea
            ref={preambleRef}
            value={preamble}
            onChange={e => setPreamble(e.target.value)}
            rows={5}
          />
          <div className="agent-config-preamble-actions">
            {edited && <button className="btn btn-sm btn-ghost" onClick={() => setPreamble(effectivePreamble)}>Reset</button>}
            {(edited || permChanged) && (
              <button className="btn btn-sm btn-primary" onClick={saveDefaults} title="Save the current preamble and permission level as the workspace default for all future agents">
                Save as new default
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
