import type { MessageItem } from "../../../shared/snapshot.js";
import { Icon } from "./Icon.js";

interface RunPresentation {
  title: string;
  detail: string | null;
  /** A failure (shown as an error) rather than something you did, like stopping it. */
  error?: boolean;
}

/** Pull the human message out of a provider error body like {"error":{"message":"Overloaded"}}. */
function humanDetail(raw: string): string {
  const s = raw.trim();
  if (s.startsWith("{")) {
    try {
      const j = JSON.parse(s);
      const msg = j?.error?.message ?? j?.message ?? j?.error;
      if (typeof msg === "string") return msg;
    } catch { /* not JSON */ }
  }
  return s;
}

/** A run's error, in plain words. */
function describeError(err: string): RunPresentation {
  const proxy = err.match(/^The model proxy answered (\d+)(?:: (.+))?/s);
  if (proxy) {
    const code = proxy[1];
    const meaning = code === "529" || code === "503" ? "The model service is overloaded right now."
      : code === "429" ? "Rate limited by the model service."
      : code.startsWith("5") ? "The model service had an error." : "The model service refused the request.";
    return { title: meaning, detail: `${proxy[2] ? humanDetail(proxy[2]) : ""} (HTTP ${code})`.trim(), error: true };
  }
  if (err.startsWith("Couldn't reach the model proxy"))
    return { title: "Couldn’t reach the model service", detail: "Check that the model proxy is running.", error: true };
  const exit = err.match(/^The agent exited with code (\d+)(?:: (.+))?/s);
  if (exit) return { title: `The agent stopped with an error (code ${exit[1]})`, detail: exit[2] ?? null, error: true };
  return { title: err || "Something went wrong", detail: null, error: true };
}

/** What a card's state says about the run on it: waiting, stopping, cut off, or failed. */
function describeOutcome(item: MessageItem): RunPresentation | null {
  const run = item.run;
  if (item.status === "writing") {
    if (run?.cancel_requested) return { title: "Stopping…", detail: null };
    if (run?.status === "queued") return { title: "Waiting to start", detail: run.queue?.detail ?? null };
    return null;
  }
  if (item.status === "done") return null;
  const err = run?.error ?? "";
  if (item.status === "cut_off") {
    switch (item.cut_off) {
      case "copied": return { title: "Copied while it was being written: this is what it had then", detail: null };
      case "stopped": return { title: "Stopped before it finished", detail: null };
      case "interrupted": return { title: err || "Interrupted before it finished", detail: null };
      case "timed_out": return { title: "Timed out before it finished", detail: err || null, error: true };
      default: return { ...describeError(err), title: `${describeError(err).title} What it had written is kept.` };
    }
  }
  // failed: nothing written. An agent's steps (and what it did) are kept even without a result.
  const none = item.role !== "agent" ? "nothing was written" : run?.has_transcript ? "it didn't report back; its steps are kept" : "it didn't report back";
  if (!run) return { title: item.role === "agent" ? "No result" : "Nothing was written", detail: null };
  // Its prompt is recorded when it starts: without one, it never did.
  if (run.status === "stopped" && !run.has_prompt) return { title: "Cancelled before it started", detail: null };
  if (run.status === "stopped") return { title: `Stopped — ${none}`, detail: null };
  if (run.status === "interrupted") return { title: `${err || "Interrupted"} — ${none}`, detail: null };
  if (run.status === "timed_out") return { title: `Timed out — ${none}`, detail: err || null, error: true };
  return describeError(err);
}

export function RunStatus({ item, onRetry }: { item: MessageItem; onRetry?: () => void }) {
  const outcome = describeOutcome(item);
  if (!outcome || item.status === "writing") return null;
  const canRetry = !!onRetry;
  const retryTitle = item.status === "cut_off"
    ? "Write it again from everything above it. The text it has now stays in its history."
    : "Ask again, in this card";

  // Something you did (stopped), a restart, or a copy: one quiet line, not an alert.
  if (!outcome.error) {
    return (
      <div className="run-note" role="status">
        <span className="run-note-text">{outcome.title}</span>
        {canRetry && <button className="act" onClick={onRetry} title={retryTitle}><Icon name="regenerate" /> Try again</button>}
      </div>
    );
  }
  return (
    <div className="run-status is-error" role="alert">
      <Icon name="alert" />
      <div className="run-status-text">
        <strong>{outcome.title}</strong>
        {outcome.detail && <span>{outcome.detail}</span>}
      </div>
      {canRetry && (
        <button className="btn btn-sm" onClick={onRetry} title={retryTitle}>
          <Icon name="regenerate" /> Try again
        </button>
      )}
    </div>
  );
}
