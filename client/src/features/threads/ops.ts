import { run } from "../../data/model.js";
import { navigate } from "../../session/route.js";
import { notices } from "../../session/notices.js";

/**
 * What the thread list does that has a consequence in the app beyond the action itself — a word
 * said with a way to the new thing, the page shown when the open thread goes. An action with no
 * such consequence is run where it's asked for.
 */

export async function duplicateThread(threadId: string, name: string): Promise<void> {
  const r = await run("duplicate_thread", { thread_id: threadId });
  if (r) notices.toast(`Duplicated as "${name} (copy)"`, () => navigate({ threadId: r.thread_id }), "Open copy");
}

export async function makeTemplate(threadId: string): Promise<void> {
  const r = await run("make_template", { thread_id: threadId });
  if (r) notices.toast("Template created", () => navigate({ threadId: r.thread_id }), "Open template");
}

/** Deletes a thread; if it's the one open, the workspace page shows. */
export async function deleteThread(threadId: string, isOpen: boolean): Promise<void> {
  if (isOpen) navigate({ threadId: null });
  await run("delete_thread", { thread_id: threadId });
}
