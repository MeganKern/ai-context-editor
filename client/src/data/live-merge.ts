import type { AgentEvent, AgentStep, LiveOutput } from "../../../shared/snapshot.js";

/** What a run going now has written: text (a reply, a summary, a combined item), or an agent's steps; and whose it is. */
export interface LiveBuf { text: string; steps: AgentStep[]; thread_id: string | null }

export function applyText(buf: string, offset: number, chunk: string): { text: string; gap: boolean } {
  if (offset > buf.length) return { text: buf, gap: true };
  if (offset + chunk.length <= buf.length) return { text: buf, gap: false };
  return { text: buf + chunk.slice(buf.length - offset), gap: false };
}

/** A new step goes at `offset`; a tool's result fills in the step it belongs to. */
export function applyEvent(steps: AgentStep[], offset: number, ev: AgentEvent): { steps: AgentStep[]; gap: boolean } {
  if (ev.step) {
    if (offset > steps.length) return { steps, gap: true };
    if (offset < steps.length) return { steps, gap: false };
    return { steps: [...steps, ev.step], gap: false };
  }
  if (ev.result_for !== undefined) {
    if (ev.result_for >= steps.length) return { steps, gap: true };
    const next = steps.slice();
    next[ev.result_for] = { ...next[ev.result_for], output: ev.output, failed: ev.failed };
    return { steps: next, gap: false };
  }
  return { steps, gap: false };
}

/**
 * Buffers brought in line with a snapshot. A snapshot is authoritative for the runs of its scope —
 * the workspace's own (thread_id null) or one thread's: a run it lists keeps what's ahead here or
 * takes the server's copy where they disagree; a run of that scope it doesn't list is over, and
 * its buffer goes. Buffers of other scopes are left alone.
 */
export function reconcile(client: Record<string, LiveBuf>, snapLive: Record<string, LiveOutput>, scope: string | null): Record<string, LiveBuf> {
  const result: Record<string, LiveBuf> = {};
  for (const [runId, buf] of Object.entries(client)) {
    if (buf.thread_id === scope && !(runId in snapLive)) continue;
    result[runId] = buf;
  }
  for (const [runId, server] of Object.entries(snapLive)) {
    const serverText = server.text ?? "";
    const serverSteps = server.steps ?? [];
    const mine = client[runId];
    if (!mine) { result[runId] = { text: serverText, steps: serverSteps, thread_id: scope }; continue; }
    const text = mine.text.length >= serverText.length
      ? (serverText.length > 0 && !mine.text.startsWith(serverText) ? serverText : mine.text)
      : serverText;
    // The server's copy has every result filled in so far; the client's may only be ahead in count.
    const steps = mine.steps.length > serverSteps.length ? mine.steps : serverSteps;
    result[runId] = { text, steps, thread_id: scope };
  }
  return result;
}
