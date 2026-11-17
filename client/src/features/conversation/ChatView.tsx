import { run, useModel } from "../../data/model.js";
import { navigate, setVisit } from "../../session/route.js";
import { clip, RUN_STATUS_LABEL } from "../../derive/text.js";
import { Icon } from "../../kit/Icon.js";
import { Button, IconButton } from "../../kit/Button.js";
import { Conversation } from "./Conversation.js";
import { Composer } from "../composer/Composer.js";

const KIND = { reply: "reply", agent: "agent run", template: "template run", summarize: "summary", combine: "combine" } as const;

/** The middle: the conversation, what needs attention under it, and the box. Or just the box, before a thread exists. */
export function ChatView() {
  const threadId = useModel(s => s.threadId);
  const thread = useModel(s => s.thread);
  if (!threadId) return (
    <div className="chat draft-chat">
      <div className="draft-spacer" />
      <Composer />
    </div>
  );
  if (!thread) return <div className="chat" aria-busy="true" />;
  return (
    <div className="chat">
      {thread.template_origin && <RunOriginBar />}
      <Conversation />
      <AttentionBar />
      <Composer />
    </div>
  );
}

/**
 * Threads a template made: which run this is, a way to step between runs, and — while the run is
 * going — a way to stop it. You can work in the thread meanwhile: each step is added at the end,
 * written from the thread as it is then.
 */
function RunOriginBar() {
  const origin = useModel(s => s.thread?.template_origin);
  if (!origin) return null;
  const live = origin.status === "running" || origin.status === "queued";
  const statusText = live
    ? origin.cancel_requested ? "Stopping…"
      : `Running${origin.progress ? ` step ${Math.max(1, Math.min(origin.progress.step, origin.progress.total))} of ${origin.progress.total}` : ""}`
    : RUN_STATUS_LABEL[origin.status];
  return (
    <div className={`origin-bar ${live ? "is-live" : ""} status-${origin.status}`} data-help="run.origin">
      <span className="origin-text">This is <strong>run {origin.run_number}</strong> of the template.</span>
      <span className={`status-pill status-${origin.status}`}
        title={live ? "Its next steps are added at the end of this thread, written from the thread as it is then" : undefined}>
        {live && <span className="spinner" aria-hidden />}{statusText}
      </span>
      {origin.error && <span className="origin-error" title={origin.error}>{clip(origin.error, 80)}</span>}
      <span className="spacer" />
      {live && !origin.cancel_requested && <Button size="sm" icon="stop" help="cancel_run" onClick={() => void run("cancel_run", { run_id: origin.run_id })}>Stop run</Button>}
      <div className="origin-nav" role="group" aria-label="Other runs">
        <IconButton icon="chevronLeft" label="Previous run" disabled={!origin.previous_output_thread_id} onClick={() => navigate({ threadId: origin.previous_output_thread_id! })} />
        <IconButton icon="chevronRight" label="Next run" disabled={!origin.next_output_thread_id} onClick={() => navigate({ threadId: origin.next_output_thread_id! })} />
      </div>
    </div>
  );
}

/**
 * Failures no card shows: a summary that failed, or a reply written again that failed (its card
 * kept the reply it had). Each stays until you dismiss it.
 */
function AttentionBar() {
  const attention = useModel(s => s.thread?.attention ?? []);
  if (attention.length === 0) return null;
  const how = (status: string) => (status === "timed_out" ? "timed out" : status === "interrupted" ? "was interrupted" : "failed");
  const said = (error: string | null, n: number) => {
    if (!error) return ".";
    const s = clip(error, n);
    return `: ${s}${/[.!?…]$/.test(s) ? "" : "."}`;
  };
  return (
    <div className="attention" role="region" aria-label="Needs your attention" data-help-area="att.bar">
      {attention.map(item => (
        <div key={item.run.id} className="attention-item is-failed" data-help="att.failed">
          <Icon name="alert" />
          <div className="attention-text">
            {item.kept
              ? <strong>Writing a reply again {how(item.run.status)}{said(item.run.error, 110)} The reply is kept as it was.</strong>
              : <strong>A {KIND[item.run.kind]} {how(item.run.status)}{said(item.run.error, 120)}</strong>}
          </div>
          {item.kept && item.run.card_id && <Button size="sm" onClick={() => setVisit({ focus: item.run.card_id })}>Show it</Button>}
          <Button kind="ghost" size="sm" help="mark_seen" onClick={() => void run("mark_seen", { run_ids: [item.run.id] })}>Dismiss</Button>
        </div>
      ))}
    </div>
  );
}
