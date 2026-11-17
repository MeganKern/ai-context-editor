import { useMemo, useState } from "react";
import type { PromptPreview, ThreadSnapshot } from "../../../../shared/snapshot.js";
import { read } from "../../data/api.js";
import { run, useModel } from "../../data/model.js";
import { useResource } from "../../data/resources.js";
import { activity, useActivityOf } from "../../session/activity.js";
import { setVisit } from "../../session/route.js";
import { contextBudget } from "../../derive/budget.js";
import { conversationView } from "../../derive/cards.js";
import { clip, formatK, plural } from "../../derive/text.js";
import { Icon } from "../../kit/Icon.js";
import { Act, Button } from "../../kit/Button.js";
import { Dialog } from "../../kit/Dialog.js";

type Tab = "reply" | "agent" | "run";

/**
 * The literal prompt: what a past run was sent (recorded when it started), or what the next reply
 * or agent would get. Beside it, what's sent now, with the switches.
 */
export function Inspector() {
  const open = useActivityOf("inspector")!;
  const thread = useModel(s => s.thread)!;
  const [task, setTask] = useState("");
  const [applied, setApplied] = useState("");
  const [sourcesOpen, setSourcesOpen] = useState(() => typeof window === "undefined" || window.innerWidth >= 1000);
  const { tab, runId } = open;
  const agents = useModel(s => s.app?.features.agents === "on");
  const threadId = thread.thread.id;
  // The next reply's or agent's prompt follows the thread as it changes (seq); a run's is fixed.
  const key = tab === "run" ? (runId ? `runprompt:${runId}` : null) : `preview:${threadId}:${thread.seq}:${tab}:${applied}`;
  const { data: preview, loading } = useResource<PromptPreview | null>(key, () =>
    tab === "run" ? read.runPrompt(runId!) : read.preview(threadId, tab, applied || undefined));
  const close = () => activity.close();
  const setTab = (t: Tab) => activity.update("inspector", { tab: t });

  // Before its prompt has loaded, a run of a card here is known by its card.
  const runIsAgent = preview ? preview.kind === "agent" : thread.messages.find(m => m.run?.id === runId)?.role === "agent";
  const isAgent = tab === "agent" || (tab === "run" && runIsAgent);
  const sub = tab === "run"
    ? `Recorded with the ${runIsAgent ? "agent run" : "reply"} when it started. Editing the thread later doesn't change it.`
    : tab === "agent" ? "What an agent started now would be handed: this thread, then the task."
    : "What the next reply would be produced from. Nothing else is sent.";

  return (
    <Dialog className={`inspector ${sourcesOpen ? "has-sources" : ""}`} title="The exact prompt" sub={sub} onClose={close} help="ip.dialog"
      foot={<>
        {preview && preview.tokens > 0 && <span className="dialog-hint" data-help="ip.size">About {formatK(preview.of === "next" && preview.kind === "model" ? contextBudget(thread.context).tokens : preview.tokens)} tokens</span>}
        {preview && preview.omitted > 0 && tab !== "run" && <span className="dialog-hint">{plural(preview.omitted, "excluded message")} left out</span>}
        {preview?.model_id && <span className="dialog-hint">{tab === "run" ? "Sent to" : "Goes to"} <code>{preview.model_id}</code></span>}
        <span className="spacer" />
        <Button onClick={close}>Done</Button>
      </>}>
      <div className="tabs" role="tablist">
        {runId && <button role="tab" aria-selected={tab === "run"} className={`tab ${tab === "run" ? "is-on" : ""}`} data-help="ip.this" onClick={() => setTab("run")}>{runIsAgent ? "This agent's brief" : "This reply"}</button>}
        <button role="tab" aria-selected={tab === "reply"} className={`tab ${tab === "reply" ? "is-on" : ""}`} data-help="ip.reply" onClick={() => setTab("reply")}>Next reply</button>
        {agents && <button role="tab" aria-selected={tab === "agent"} className={`tab ${tab === "agent" ? "is-on" : ""}`} data-help="ip.agent" onClick={() => setTab("agent")}>Next agent</button>}
        <span className="spacer" />
        <button className={`tab tab-toggle ${sourcesOpen ? "is-on" : ""}`} data-help="ip.sources" onClick={() => setSourcesOpen(o => !o)} aria-expanded={sourcesOpen}><Icon name="panel" /> What's sent now</button>
      </div>
      <div className="inspector-cols">
        <div className="inspector-main">
          {tab === "agent" && (
            <form className="inspector-task" onSubmit={e => { e.preventDefault(); setApplied(task.trim()); }}>
              <input value={task} onChange={e => setTask(e.target.value)} placeholder="Optional: type a task to see it in place" aria-label="Agent task" />
              <Button size="sm" type="submit">Update</Button>
            </form>
          )}
          <div className="inspector-body">
            {loading && <p className="inspector-empty">Loading…</p>}
            {!loading && !preview && <p className="inspector-empty">{tab === "run" ? "This run never started, so it was sent nothing." : "Couldn't read it."}</p>}
            {!loading && preview && (
              <>
                {!preview.ok && <p className="inspector-note">This is everything sent before your next message. Whatever you send next is added at the end, then the model replies.</p>}
                {preview.notice && <div className="callout" data-help="ip.placeholder"><Icon name="alert" /><span>{preview.notice}</span></div>}
                {preview.agent && (
                  <dl className="inspector-agent">
                    <div><dt>Added</dt><dd>{preview.agent.adds}</dd></div>
                    {preview.agent.switched_off && <div><dt>{tab === "run" ? "Was off" : "Switched off"}</dt><dd>{preview.agent.switched_off}</dd></div>}
                    {preview.agent.tool_version && <div><dt>Claude Code</dt><dd>{tab === "run" ? `ran it: ${preview.agent.tool_version}` : `${preview.agent.tool_version} ran the last agent here`}</dd></div>}
                  </dl>
                )}
                {preview.system && (
                  <div className="prompt-block entry is-system">
                    <div className="prompt-role">System <span>{tab === "run" && preview.kind === "model" && runIsAgent === false && !preview.messages.length ? "the instructions it was given" : "the system message, then the library items sent with every reply"}</span></div>
                    <pre className="prompt-text">{preview.system}</pre>
                  </div>
                )}
                {preview.messages.map((m, i) => (
                  <div key={i} className={`prompt-block entry ${m.role === "user" ? "src-you" : "src-model"} ${m.placeholder ? "is-placeholder" : ""}`} data-help={m.placeholder ? "ip.placeholder" : undefined}>
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
    </Dialog>
  );
}

/** What goes with the next reply, with its switches: the place to act on what the prompt shows. */
function SentNow({ thread }: { thread: ThreadSnapshot }) {
  const cards = useMemo(() => conversationView(thread, null, { expanded: new Set(), hideExcluded: false }).cards, [thread]);
  const goTo = (id: string) => { activity.close(); setVisit({ focus: id }); };
  return (
    <aside className="sent-now" aria-label="What's sent now" data-help-area="ip.sources">
      {thread.items.length > 0 && (
        <div className="sent-group">
          <h3>Library</h3>
          <ul>{thread.items.map(n => (
            <li key={n.note_id}>
              <span className="sent-text"><Icon name="note" /> {n.name}</span>
              {n.inline && <span className="sent-where" title="A message mentions it, so it's sent in full there rather than at the top">where mentioned</span>}
            </li>
          ))}</ul>
        </div>
      )}
      <div className="sent-group">
        <h3>Conversation</h3>
        <ul>
          {cards.map(c => (
            <li key={c.id} className={c.notSent || c.nothingSent ? "is-notsent" : ""}>
              <button className="sent-text sent-go" onClick={() => goTo(c.id)} title="Go to it in the conversation (to edit it there)">
                <b>{c.authorLabel}</b> {clip(c.item.content, 70) || (c.writing ? "(being written)" : "(empty)")}
              </button>
              {(c.notSent || c.nothingSent) && <span className="notsent-label">Not sent</span>}
              {c.writing && <span className="sent-where">being written</span>}
              {c.can.exclude && !c.writing && (
                <Act help={c.item.excluded ? "exclude_message:included" : "exclude_message"} onClick={() => void run("exclude_message", { message_id: c.id, excluded: !c.item.excluded })}>{c.item.excluded ? "Include" : "Exclude"}</Act>
              )}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
