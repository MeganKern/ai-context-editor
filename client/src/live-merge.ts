import type { AgentEvent, AgentStep, ThreadSnapshot } from "../../shared/snapshot.js";

/** What a run going now has written: text (a reply, a summary), or an agent's steps. */
export interface LiveBuf { text: string; steps: AgentStep[] }

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

export function activeRunIds(snap: ThreadSnapshot): Set<string> {
  const ids = new Set<string>();
  for (const item of snap.messages) {
    if (item.status === "writing" && item.run) ids.add(item.run.id);
  }
  for (const s of snap.summaries) {
    if (s.status === "drafting" && s.run_id) ids.add(s.run_id);
  }
  return ids;
}

export function mergeSnapshotLive(
  client: Record<string, LiveBuf>,
  snap: ThreadSnapshot,
): Record<string, LiveBuf> {
  const result: Record<string, LiveBuf> = {};
  const active = activeRunIds(snap);

  for (const [runId, serverData] of Object.entries(snap.live)) {
    const serverText = serverData.text ?? "";
    const serverSteps = serverData.steps ?? [];
    const clientBuf = client[runId];

    if (!clientBuf) {
      result[runId] = { text: serverText, steps: serverSteps };
      continue;
    }

    let text: string;
    if (clientBuf.text.length >= serverText.length) {
      text = serverText.length > 0 && !clientBuf.text.startsWith(serverText)
        ? serverText
        : clientBuf.text;
    } else {
      text = serverText;
    }
    // The server's copy has every result filled in so far; the client's may only be ahead in count.
    const steps = clientBuf.steps.length > serverSteps.length ? clientBuf.steps : serverSteps;
    result[runId] = { text, steps };
  }

  for (const [runId, buf] of Object.entries(client)) {
    if (result[runId]) continue;
    if (active.has(runId)) {
      result[runId] = buf;
    }
  }

  return result;
}
