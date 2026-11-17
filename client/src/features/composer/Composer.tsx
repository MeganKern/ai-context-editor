import { useEffect, useRef, useState } from "react";
import { BEHAVIOUR as B } from "../../../../shared/behaviour.js";
import { marker } from "../../../../shared/note-markers.js";
import { AGENT_EFFORTS, AGENT_EFFORT_LABELS, AGENT_MODELS, AGENT_MODEL_LABELS, type AgentEffort, type AgentModel } from "../../../../shared/agent.js";
import { run, useModel } from "../../data/model.js";
import { setDraft, useDraft } from "../../data/drafts.js";
import { composer, useComposer } from "../../session/composer.js";
import { navigate } from "../../session/route.js";
import { setPref, usePrefs } from "../../session/prefs.js";
import { clip, MOD } from "../../derive/text.js";
import { Icon } from "../../kit/Icon.js";
import { Button, IconButton } from "../../kit/Button.js";
import { Layer } from "../../kit/Layer.js";
import { Picker } from "../../kit/Picker.js";
import { Dial, useAutoGrow } from "../../kit/Fields.js";
import { AgentConfig } from "./AgentConfig.js";
import { SystemMessage } from "./SystemMessage.js";

/**
 * Adds a card to the conversation. Enter adds your message without a reply; Ctrl/⌘+Enter adds it
 * and asks the model to reply to the context as it now stands. Both are ordinary commits, so
 * neither button is louder than the other — each shows its key. Agent mode writes a brief for a
 * bounded task; the thread is the rest of the brief, and the agent's own dials sit above the box.
 * With no thread open, the first message makes one — one ask, done whole on the server.
 */
export function Composer() {
  const ws = useModel(s => s.ws)!;
  const threadId = useModel(s => s.threadId);
  const thread = useModel(s => s.thread);
  const pending = useModel(s => s.pending);
  const { mode, continueCardId, agent } = useComposer();
  const draft = useDraft(threadId);
  const taught = usePrefs(s => s.composerTaught) >= 3;
  const [sysMsgOpen, setSysMsgOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const msgRef = useRef<HTMLTextAreaElement>(null);
  const taskRef = useRef<HTMLTextAreaElement>(null);
  const noteBtnRef = useRef<HTMLButtonElement>(null);
  useAutoGrow(msgRef, draft.message);
  useAutoGrow(taskRef, draft.task);

  const agents = useModel(s => s.app?.features.agents === "on");
  const isAgent = agents && mode === "agent";
  useEffect(() => { (isAgent ? taskRef : msgRef).current?.focus(); }, [threadId, isAgent, continueCardId]);

  const edit = (patch: { message?: string; task?: string }) => setDraft(threadId, patch);
  const continueTask = continueCardId ? thread?.messages.find(m => m.id === continueCardId)?.run?.task : null;
  const busyAbove = thread?.messages.some(m => m.status === "writing") ?? false;
  const sending = !!pending.send_message || !!pending.dispatch_agent || !!pending.agent_follow_up;
  const empty = !draft.message.trim();
  /** The thread it goes in, or the workspace a new one is made in. */
  const where = { thread_id: threadId, workspace_id: ws.workspace.id };

  const send = async (reply: boolean) => {
    if (empty || sending) return;
    const r = await run("send_message", { ...where, content: draft.message.trim(), reply });
    if (!r) return;
    edit({ message: "" });
    setPref("composerTaught", usePrefs.getState().composerTaught + 1);
    if (!threadId) navigate({ threadId: r.thread_id });
  };

  const startAgent = async () => {
    const task = draft.task.trim();
    if (!task || sending) return;
    const how = {
      standing_instructions: agent.standingInstructions ?? undefined, permission: agent.permission ?? undefined,
      model: agent.model || undefined, effort: agent.effort || undefined,
    };
    if (continueCardId) {
      if (!await run("agent_follow_up", { message_id: continueCardId, message: task, ...how })) return;
    } else {
      const r = await run("dispatch_agent", { ...where, task, ...how });
      if (!r) return;
      if (!threadId) navigate({ threadId: r.thread_id });
    }
    edit({ task: "" });
    composer.setMode("message");
  };

  const insertNote = (noteId: string) => {
    const el = msgRef.current;
    const m = marker(noteId);
    if (el) {
      const start = el.selectionStart, end = el.selectionEnd;
      edit({ message: draft.message.slice(0, start) + m + draft.message.slice(end) });
      requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = start + m.length; el.focus(); });
    } else {
      edit({ message: draft.message + m });
    }
    setNoteOpen(false);
  };

  const dialOptions = <V extends string>(labels: Record<V, string>, values: readonly V[]) =>
    [{ value: "" as V | "", label: "Default" }, ...values.map(v => ({ value: v, label: labels[v] }))];

  return (
    <div className={`composer ${isAgent ? "is-agent" : ""}`} data-help-area="area.composer">
      <div className="composer-box">
        <div className="composer-modes">
          <div className="seg is-plain" role="tablist" aria-label="What to add">
            <button type="button" role="tab" aria-selected={!isAgent} className={`seg-opt ${!isAgent ? "is-on" : ""}`} data-help="cb.message-mode" onClick={() => composer.setMode("message")}>Message</button>
            {agents && (
              <button type="button" role="tab" aria-selected={isAgent} className={`seg-opt is-agent ${isAgent ? "is-on" : ""}`} data-help="cb.agent-mode" onClick={() => composer.setMode("agent")}>
                <Icon name="agent" /> Agent task
              </button>
            )}
          </div>
          {isAgent && continueCardId && continueTask && (
            <span className="composer-follow" data-help="cb.follow">
              Following up on: <em>{clip(continueTask, 60)}</em>
              <IconButton icon="close" label="Start a new agent instead" onClick={() => composer.setMode("agent")} />
            </span>
          )}
          <span className="spacer" />
          {isAgent && <>
            <Dial label="Model" value={agent.model} options={dialOptions<AgentModel>(AGENT_MODEL_LABELS, AGENT_MODELS)} onChange={v => composer.patchAgent({ model: v })}
              help="cb.agent-model" title="Claude Code's --model: an alias for the latest model of that line. Default: Claude Code's own setting." />
            <Dial label="Effort" value={agent.effort} options={dialOptions<AgentEffort>(AGENT_EFFORT_LABELS, AGENT_EFFORTS)} onChange={v => composer.patchAgent({ effort: v })}
              help="cb.agent-effort" title="Claude Code's --effort: how much it thinks before acting. Default: Claude Code's own setting." />
          </>}
        </div>

        {!isAgent ? (
          <textarea ref={msgRef} className="composer-input" value={draft.message} onChange={e => edit({ message: e.target.value })}
            placeholder="Add to the context…" aria-label="Message" rows={2} disabled={sending} data-help="cb.input"
            onKeyDown={e => {
              if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
              if (e.metaKey || e.ctrlKey) { e.preventDefault(); void send(false); }
              else if (!e.shiftKey) { e.preventDefault(); void send(true); }
            }} />
        ) : (
          <textarea ref={taskRef} className="composer-input" value={draft.task} onChange={e => edit({ task: e.target.value })}
            placeholder={continueCardId ? "What should the agent do next?" : ""} aria-label="Agent task" rows={3} disabled={sending} data-help="cb.task"
            onKeyDown={e => {
              if (e.key === "Escape") { e.preventDefault(); composer.setMode("message"); }
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void startAgent(); }
            }} />
        )}

        {isAgent && <AgentConfig onStart={() => void startAgent()} disabled={!draft.task.trim() || sending} />}

        {!isAgent && (
          <div className="composer-bar">
            <Button kind="ghost" size="sm" className={`sys-msg-toggle ${sysMsgOpen ? "is-open" : ""}`} help="cb.sys-toggle"
              title={B.set_system_message.help} onClick={() => setSysMsgOpen(o => !o)}>System message</Button>
            <Button ref={noteBtnRef} kind="ghost" size="sm" icon="note" className={noteOpen ? "is-open" : ""} help="cb.insert-note"
              title="Insert a library note inline in this message" onClick={() => setNoteOpen(o => !o)}>Insert note</Button>
            <span className="spacer" />
            <Button className="btn-send" help="send_message" disabled={empty || sending} title={B.send_message.tip} onClick={() => void send(false)}>
              Add without reply <kbd>{MOD} ⏎</kbd>
            </Button>
            <Button className="btn-send" help="send_message:reply" disabled={empty || sending} title={B["send_message:reply"].tip} onClick={() => void send(true)}>
              Add and get reply <kbd>⏎</kbd>
            </Button>
          </div>
        )}
        {!isAgent && noteOpen && (
          <Layer anchor={noteBtnRef.current} placement="above-start" width={280} role="listbox" label="Insert a note" className="insert-note" helpArea="cb.insert-note" onClose={() => setNoteOpen(false)}>
            <Picker className="picker-compact" label="Notes" items={ws.notes.filter(n => n.is_current)} keyOf={n => n.id} search
              matches={(n, q) => n.name.toLowerCase().includes(q)} placeholder="Pick a note to insert" max={8}
              render={n => <><Icon name="note" /><span className="picker-item-name">{n.name}</span></>} onPick={n => insertNote(n.id)} />
          </Layer>
        )}
        {!isAgent && sysMsgOpen && <SystemMessage />}
      </div>
      {!isAgent && (
        <div className="composer-foot">
          <span className="spacer" />
          {busyAbove && !empty ? (
            <span className="composer-queue" data-help="cb.queue" title="A card above is still being written. A reply you ask for now starts once the cards above it are written.">A reply asked for now waits its turn</span>
          ) : !taught && empty ? (
            <span className="composer-hint" title="A message added without a reply can get one later, from the message."><kbd>Shift ⏎</kbd> new line</span>
          ) : null}
        </div>
      )}
    </div>
  );
}
