import type { MessageItem } from "../../../../shared/snapshot.js";
import { run } from "../../data/model.js";
import { navigate } from "../../session/route.js";
import { notices } from "../../session/notices.js";

/**
 * What the conversation does that has a consequence in the app beyond the action itself — a word
 * said, a thread opened. An action with no such consequence is run where it's asked for.
 */

export async function deleteMessage(messageId: string): Promise<void> {
  if (await run("delete_message", { message_id: messageId })) notices.toast("Message deleted");
}

export async function branchFrom(messageId: string): Promise<void> {
  const r = await run("branch_thread", { message_id: messageId });
  if (r) {
    notices.toast("Branched — this is its own thread now, with its own context.");
    navigate({ threadId: r.thread_id });
  }
}

/** The card's text becomes a library item in this thread; the card is excluded so it isn't sent twice. */
export async function saveToLibrary(workspaceId: string, threadId: string, item: MessageItem): Promise<void> {
  const name = item.content.split("\n")[0].slice(0, 60) || "Untitled";
  const r = await run("create_note", { workspace_id: workspaceId, name, content: item.content, load_into_thread_id: threadId, exclude_message_id: item.id });
  if (r) notices.toast("Saved to the library and added to this thread. The message is now excluded.");
}
