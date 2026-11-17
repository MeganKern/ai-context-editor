import { z } from "zod";
import { join } from "path";
import { mkdir } from "fs/promises";
import { implementInternal } from "../db/writer.js";
import { WORKSPACES_ROOT } from "../config.js";
import { putBlob } from "../db/blobs.js";
import { createThread } from "../domain/threads.js";
import { newUserCard, newRunCard, addRevision } from "../domain/cards.js";
import { placeItem } from "../domain/items.js";
import { keysBetween } from "../domain/order-key.js";

/**
 * What a brand-new database opens with: one workspace, one thread, and a short tour written as a
 * conversation that explains the app by being one. It runs once, only when there is nothing else,
 * and returns the thread to open at.
 *
 * The assistant turns are tour copy written by hand. Each is seeded as a completed reply run so it
 * reads as an ordinary assistant message (not one marked "edited by you"); the run names the same
 * free model a real reply here would use.
 */
function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const TOUR: Array<{ you: string; model: string }> = [
  {
    you: "What is this?",
    model: "An AI chat where replies happen only when you ask for them. Add to a thread freely with notes to yourself, references, or questions and nothing is answered until you explicitly decide.",
  },
  {
    you: "What can I do with what's in a thread?",
    model: "Edit any message in place, leave one out so it isn't sent, or fold it away to visually tidy the thread. A reply is built from whatever the thread holds at that moment.",
  },
  {
    you: "What's the library panel on the right?",
    model: "Reference material kept apart from the chat and reused. Check an item in and it's included with every reply in this thread; uncheck it to leave it out.",
  },
  {
    you: "How can I learn more about features?",
    model: "Hold ⌥ and click anything to see what it does. Replies run on a rate limited free model for now; switch providers any time at the top left.",
  },
];

// The reference the thread opens with, checked into the library: a technical manual of what every
// feature does and what it changes, drawn from the app's own ⌥-click help text. The sample
// conversation stays light; this carries the full picture.
const HOW_IT_WORKS = `# How this works

A reference to what everything here does, and what each thing changes. One mechanism sits under all of it: adding to a thread costs nothing and sends nothing; asking for a reply sends the whole thread to the model, assembled fresh. The model keeps nothing between replies.

## How a reply is built
Each reply is assembled from the thread as it stands at that moment, in this order: the system message, then the library items in use (each under its name), then every message that isn't excluded — with any accepted summary standing in for the messages it covers. Folder names and other branches are never sent. Rework the thread and the next reply changes with it; the longer the thread, the more each reply sends. One reply is one request to your model provider, billed to that provider's account. The exact prompt and the model are recorded with each reply and never change, even after you edit the thread.

## Messages
- **Add** a message: appended, free, sends nothing. **Add and get a reply**: appended, then the model answers the whole thread. With no thread open, one is created first, named from your first line.
- **Insert** between two messages: the cards below are untouched and their replies aren't redone. **Insert and reply** answers from what's above that point only. **Ask for a reply** after any message answers from everything up to and including it.
- **Edit** any card in place — your message or a reply. The old text is kept in the card's history with the prompt it was written from; replies already below keep what they were sent. **Edit and get a new reply** also rewrites the reply directly below.
- **Write again (regenerate)** rewrites a reply in place from the current context; the old text stays until the new one finishes, and a failed attempt goes to history.
- **Exclude**: the card stays in the thread but isn't sent, from the next reply on (nor any library item it mentions). **Fold**: one line in your view only — still sent in full. **Delete**: permanent, no undo; everything below stays, so a reply that answered it now answers something gone.
- Every card keeps its full edit history. A reply can end **cut off** (hit the model's output limit), **failed**, or **stopped**; it keeps what was written, and later replies get it as it is. Nothing retries itself.

## The library
- Reference text kept once in a workspace's library — a brief, a spec, a set of constraints. There is one copy of each item: editing it changes it for every thread using it, from each one's next reply on; replies already written keep what they were sent.
- **Check an item into a thread** and its name and text are sent with every reply there, after the system message and before the conversation, in the panel's order — which **reorder** controls. **Remove** stops sending it here; the item stays in the library and other threads.
- **Insert note** drops a reference to an item into a message: the model gets the item's full text at the last message mentioning it, and just its name earlier.
- **Retire** pulls an item from the library and every thread at once (reactivating returns it to the library, not to those threads). **Delete** removes it everywhere for good. **Combine** sends several items to the model, which writes one new item from them — one request, reviewed before it's kept, with the originals left unchanged.
- **Folders** group items in the panel only; the model never sees them.
- **Versions**: an item can keep older versions behind its current one as a tree. Only the current version is sent; make another current and every thread on the old one switches from its next reply. You can detach a version, add an older one, or reshape the tree without sending anything.

## Summaries
Pick any messages and the model writes a summary of exactly those — one request. The draft appears for review and changes nothing until you accept it. **Accepting** replaces those messages with the summary card for good: the originals are removed (the card's history records which), and from then on each reply sends the summary in their place — so it sends less, and the model no longer sees what the summary left out. You can **revise** (the model rewrites, with your steering), **edit** (your words, sent as-is), or **discard** it.

## Branches and copies
- **Branch from a message**: a new thread with a copy of everything up to that message. The two are independent from then on — writing, editing, or deleting in one never reaches the other — except library items, which both share. A branch survives even if its original thread is deleted.
- **Duplicate a thread**: a full copy (every message with its history, the summaries, which items are in use), independent thereafter except for shared library items.

## Templates
- **Make a template from a thread**: each message becomes a step (one that waits for a reply if the model answered it here, one that just posts otherwise — replies are dropped, and the library items in use come along.
- **Steps** are a message, or a message with a reply. Step text can hold **blanks**: \`{{name}}\` must be filled before a run starts, \`{{name|default}}\` falls back to its default, and \`{{@date}}\`-style blanks fill themselves.
- **Running** creates a fresh thread and plays the steps in order; each reply step is one request. The steps and the blanks you fill are copied when the run starts, so editing the template mid-run doesn't change it — but library items are shared, so editing one does reach later steps. A run's thread lives on the template's own page, not your thread list. Adding, changing, reordering, or removing steps affects future runs only.

## Workspaces
Each workspace has its own threads, folders, and library, and nothing crosses between them. The model provider, its key, and the system message are shared across all workspaces. A workspace can't be renamed or deleted from the app, so name it with care.

## The model provider
Choosing a provider and model sets what writes every reply, summary, combined item, and template reply step, in every workspace, from then on; replies already written keep the model that wrote them, each billed to that provider's account. A key is kept per provider in your device's local storage, never shown again, and sent only to that provider. Start free on Kilo (rate-limited, no key), or use OpenAI, Anthropic, Google, xAI, Groq, OpenRouter, a local model via Ollama, or your own OpenAI-compatible endpoint by its address.

## The system message
There is one system message. It goes at the very top of every prompt — for every reply in every thread of every workspace. A change takes effect from the next reply on.

## Seeing exactly what's sent
Hold **⌥ (Option)** and click almost any element — a message, a button, a mark, a whole area — to read what it is, what it does, what the model gets from then on, what it costs, and whether it can be undone. The inspector shows the next reply's prompt word for word, in order, with its size estimated in tokens (roughly four characters each). Each model has a limit; a prompt over it fails, and nothing is trimmed to fit — exclude messages, remove items, or summarize to get under it.

## Running and saving
A reply or summary runs in the background, so you can keep working in other threads while it does. Your choices about a thread — what's excluded, folded, or already seen — are saved, not only shown on screen. Nothing here can be undone except by doing the opposite.`;

implementInternal("seed_welcome", z.object({}), async (_args, tx, ctx) => {
  // On an empty database there is nothing for the path to collide with.
  const workspaceId = ctx.newId();
  const path = join(WORKSPACES_ROOT, slugify("My workspace") || "workspace");
  await tx.query("INSERT INTO workspaces (id, name, path) VALUES ($1, $2, $3)", [workspaceId, "My workspace", path]);
  ctx.after(async () => { await mkdir(path, { recursive: true }); });

  const thread = await createThread(tx, ctx, { workspaceId, name: "Welcome", kind: "chat" });

  // One ordered key per card: you, model, you, model, …
  const keys = keysBetween(null, null, TOUR.length * 2);
  let k = 0;
  for (const turn of TOUR) {
    await newUserCard(tx, ctx, { threadId: thread.id, key: keys[k++], text: turn.you, authorKind: "you" });
    const cardId = await newRunCard(tx, ctx, { threadId: thread.id, key: keys[k++], kind: "reply" });
    const runId = ctx.newId();
    const resultHash = await putBlob(tx, turn.model);
    // A completed reply run gives the card its text with real provenance, so it isn't "edited by you".
    await tx.query(
      `INSERT INTO runs (id, workspace_id, thread_id, kind, status, card_id, model_id, result_hash, ended_at)
       VALUES ($1, $2, $3, 'reply', 'done', $4, $5, $6, now())`,
      [runId, workspaceId, thread.id, cardId, "kilo-auto/free", resultHash]);
    await addRevision(tx, ctx, {
      cardId, threadId: thread.id, textHash: resultHash, madeBy: "run", runId, cutOff: null, makeCurrent: true,
    });
  }

  const noteId = ctx.newId();
  await tx.query("INSERT INTO notes (id, workspace_id, folder_id, name, content_hash) VALUES ($1, $2, NULL, $3, $4)",
    [noteId, workspaceId, "How this works", await putBlob(tx, HOW_IT_WORKS)]);
  await placeItem(tx, ctx, thread.id, noteId);

  return { workspace_id: workspaceId, thread_id: thread.id };
});
