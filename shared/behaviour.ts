import type { ActionName } from "./actions.js";

/**
 * What each action does, said once. The app's help (Alt-click) and the tooltips and menu hints on
 * the controls that run an action take their words from here, so there's one statement to keep
 * true, beside the action's own name: add, rename or remove an action and this file stops
 * compiling until its words are written.
 *
 * `tip` is a few words for a tooltip or a menu hint; `help` is what Alt-click shows. Both say only
 * what the control's label doesn't: what the model gets from then on, what happens elsewhere (other
 * threads, your computer), and whether it can be undone — in plain words, with no names from the
 * code. An action whose effect depends on how it's asked has a variant after a colon.
 *
 * Every statement must be how the action behaves in server/src/actions (and the domain code it
 * calls). Nothing in the app can be undone except by doing the opposite.
 */
export interface Said { tip: string; help: string }

type Key = ActionName | `${ActionName}:${string}`;

const AGENT_HANDS = "It works on your computer, starting in this workspace's folder. What it can do depends on the permission level you choose — from research-only to full access.";
const AGENT_LEFT_OUT = "Claude Code reads only your user settings: CLAUDE.md files, the folder's project settings and its own memory are switched off.";
const SESSIONS = "Claude Code keeps sessions for 30 days by default; after that it can't be continued.";

export const BEHAVIOUR = {
  // ── workspaces & folders ─────────────────────────────────────────────────
  create_workspace: {
    tip: "A home folder for agents, and a library shared by every thread inside",
    help: "Creates a workspace with its own folder on your computer at ~/.thedesk/workspaces. Agents you dispatch start in that folder and can read, write and run commands there. Every thread in the workspace shares one library. Workspaces can't be renamed or deleted from the app, so choose the name with care.",
  },
  create_folder: {
    tip: "Organize threads — the model never sees folders",
    help: "Folders organize your thread list; nothing about them reaches the model. A thread and all its branches move together — folder a thread and its branches come with it.",
  },
  rename_folder: {
    tip: "Only for your list — the model never sees folder names",
    help: "Renames the folder in your thread list. Folders are purely organizational; the model never sees them.",
  },
  move_folder: {
    tip: "Nest it under another folder, or move it to the top level",
    help: "Moves the folder and everything inside it — threads, subfolders, all of it — to sit under another folder, or back to the top level.",
  },
  delete_folder: {
    tip: "Only the folder goes — threads and items inside move up a level",
    help: "Only the folder itself is removed. Everything that was inside it — threads, subfolders, items — moves to the parent folder (or to the top level). Nothing is deleted except the folder.",
  },
  move_thread: {
    tip: "Takes its branches with it",
    help: "A thread moves with all its branches (and their branches). Folders are only for your list — moving doesn't affect what the model sees. A template's runs live on its own page, not in a folder.",
  },

  // ── library ──────────────────────────────────────────────────────────────
  create_note: {
    tip: "Write reference text once, use it in any thread",
    help: "Creates a library item: text you write once and attach to any thread in this workspace. There's one copy in the database — threads point to it, not to their own version. If a thread is open, the new item is added to it immediately and sent with every reply — the model reads it starting from the next reply. The item counts toward the context window of every thread using it.",
  },
  update_note: {
    tip: "One copy — every thread using it gets the new text immediately",
    help: "A library item is shared, not copied. Saving changes it everywhere at once: every thread using it sends the new text from their next reply on. Replies already written keep what they were sent. Summaries already written keep what they say.",
  },
  "update_note:name": {
    tip: "The name is sent to the model as the item's heading",
    help: "A library item's name is sent with it as its heading, so renaming it changes what every thread using it sends to the model. Pick a name that helps the model understand what the item is about.",
  },
  move_note: {
    tip: "Move it into a library folder or back to the top level",
    help: "Moves the item into a library folder or out to the top level. This is purely organizational — it stays in every thread that uses it, and what the model sees doesn't change.",
  },
  link_note_version: {
    tip: "Manage linked versions of this item",
    help: "Opens the version chain for this item: a list from newest to oldest. Only the newest version shows in the library; the rest are hidden but accessible here. You can add items, reorder the chain, or unlink any item to make it standalone again. Threads using an older version see an upgrade indicator and can switch to the newest with one click.",
  },
  combine_notes: {
    tip: "AI reads the selected items and writes one combined item",
    help: "Select two or more items, then edit the instructions that tell the model how to combine them. The model reads every selected item and writes a single new library item. You see the result streaming as it's written, then review it: accept, rename, edit the text inline, open the full editor, or discard it entirely. The original items stay untouched.",
  },
  duplicate_note: {
    tip: "An independent copy in the library — editing it won't touch the original",
    help: "Makes a separate copy of this item in the library, named with (copy) after it. The copy is fully independent: editing it doesn't affect the original or any thread using the original. The copy isn't added to any thread — add it yourself if you want to use it.",
  },
  delete_note: {
    tip: "Gone from the library and every thread · can't be undone",
    help: "Permanently removes the item from the library and from every thread that uses it. Replies already written keep what they were sent. Summaries keep what they say. If this item is part of a version chain, it's unlinked first. There is no undo.",
  },

  // ── threads ──────────────────────────────────────────────────────────────
  create_thread: {
    tip: "A blank conversation — bring in context from the library",
    help: "Starts a new thread with nothing: no pins, no library items, no messages. The model knows nothing from your other threads until you attach library items or write messages. Each thread is its own conversation.",
  },
  rename_thread: {
    tip: "Only for you — the model never sees the thread name",
    help: "The thread name is purely for your navigation. The model never sees it — only the messages, pins and library items inside.",
  },
  set_thread_model: {
    tip: "Changes which model this thread uses, from now on",
    help: "Switches the model for this thread only. Everything it asks for from now on — replies, summaries, title suggestions, agents — uses the new model. Replies already written stay on whatever model wrote them. Each reply records which model produced it. Different models have different context windows and pricing — a longer thread may fit in one model but not another.",
  },
  delete_thread: {
    tip: "Permanent · branches survive on their own",
    help: "Deletes the thread and stops anything running in it. Branches taken from it survive with all their content and take the thread's place in the list. Library items it used stay in the library. There is no undo.",
  },
  "delete_thread:template": {
    tip: "Deletes the template and all its runs' threads · can't be undone",
    help: "Deletes the template, every thread its runs created, and every branch of those threads. Anything still running is stopped. A template with an active run can't be deleted — stop the run first. Library items stay in the library. There is no undo.",
  },
  duplicate_thread: {
    tip: "A full copy: every message, pin, summary and library item placement",
    help: "Copies everything into a new thread without touching the original: every message with its full edit history, pins, library item placements, and summaries. Library items themselves aren't copied — both threads share the same items, so editing an item's text affects both. Anything mid-write copies as-is: a reply in progress comes with what it had so far, a summary in progress comes as a draft.",
  },
  "duplicate_thread:template": {
    tip: "Copies the template's steps, pins and library items",
    help: "Makes a new template with the same steps, pins and library items. Library items are shared, not copied. The original template's runs stay with the original — the copy starts fresh.",
  },
  branch_thread: {
    tip: "A new thread forking from this point, with everything above it",
    help: "Creates a new thread containing everything up to and including this message — each message with its full edit history — plus the current pins, library items and summaries. From then on the two threads are independent: editing or deleting messages in one doesn't touch the other. The exception is library items, which are shared — editing an item's text changes it in both threads. The branch is listed under this thread in the sidebar.",
  },
  make_template: {
    tip: "Turn your messages into reusable steps that can be run repeatedly",
    help: "Your messages become steps, agents' tasks become agent steps, and replies are dropped (each run gets fresh ones). Excluded messages are skipped. Pins and library items sent with every reply are included; items attached to a single message are not. The original thread stays as it is — the template is a new thing. Each run plays the steps into a fresh thread.",
  },
  generate_title: {
    tip: "AI suggests a name based on the first few messages",
    help: "Reads the start of the first six messages and suggests a thread name. Costs one small model request. If you rename the thread before it finishes, your name wins.",
  },

  // ── messages ─────────────────────────────────────────────────────────────
  send_message: {
    tip: "Adds your message without calling the model — free",
    help: "Adds your message to the thread without sending anything to the model. Use this to lay down material, paste references, or set up context before asking for a reply. Library items queued for your next message go with it.",
  },
  "send_message:reply": {
    tip: "Adds your message, then the model replies to the full thread",
    help: "The model has no memory between replies. Each reply is written from the entire thread, sent fresh: pins first, then library items, then every included message (with any active summary standing in for the messages it covers). Longer threads send more per reply; summaries compress older sections. If something above is still being written, the reply waits. The exact prompt is recorded with the reply.",
  },
  insert_message: {
    tip: "Insert here — nothing below is redone",
    help: "Inserts a message at this point in the conversation. The messages and replies below it stay exactly as they were (they were written without it). Every new reply from now on will see it.",
  },
  "insert_message:reply": {
    tip: "The model answers from what's above this point only",
    help: "Inserts a model reply here, written only from what comes before this point — not what's below. Waits for anything above that's still being written. The messages below stay as they are.",
  },
  request_reply: {
    tip: "Ask for a reply right after this message",
    help: "The model writes a reply right after this message, using everything above it as context. Waits for anything above that's still being written. The reply's exact prompt is recorded with it.",
  },
  edit_message: {
    tip: "Edit in place — the old text is kept in its history",
    help: "Edits the message where it is — yours, a reply, or an agent's result. The previous text stays in the message's history (click to see older versions). Replies below keep what they were sent; new replies see your edit. Editing an agent's displayed text doesn't change what it actually did on your computer — only what's shown and sent to future replies. Can't edit while it's being written.",
  },
  "edit_message:reply": {
    tip: "Save your edit, then the reply below is rewritten",
    help: "Saves your text, then the model rewrites the reply directly below (or adds one if none follows). Uses the full thread above as it stands now. Messages below the reply stay. If the rewrite fails, the reply keeps what it had and the attempt goes into its history.",
  },
  regenerate: {
    tip: "Rewrite this reply from the current context",
    help: "The model writes this reply again, in the same card, from everything above it as the thread stands now. Messages below stay and aren't redone. The card keeps its current text until the new one finishes — if it doesn't finish, the old text stays and the attempt goes into its history.",
  },
  "regenerate:agent": {
    tip: "Run the same task again with the same permissions",
    help: `Runs the agent again with the same task, system message, permission level and effort as the original. ${AGENT_HANDS} Whatever the first run changed on your computer stays changed — files it wrote or commands it ran are not rolled back. The new result replaces the card; the earlier result stays in its history. A redone follow-up starts fresh from the session it followed, so the previous attempt isn't in its memory.`,
  },
  delete_message: {
    tip: "Permanent — replies below it stay, answering something now gone",
    help: "Removes this message permanently. Library items that went with it leave this thread (they stay in the library). Everything below it stays — so a reply that answered this message now answers something that isn't there. Stops anything being written. There is no undo.",
  },
  set_message_flags: {
    tip: "Exclude it — the model stops seeing it, but it stays for you",
    help: "The model stops seeing this message — and any library items attached to it — starting from the next reply. Nothing is deleted; you can include it again at any time.",
  },
  "set_message_flags:included": {
    tip: "Include it again — the model sees it from the next reply",
    help: "The model sees this message again starting from the next reply, along with any library items attached to it.",
  },
  "set_message_flags:folded": {
    tip: "Collapse to one line in your view — still sent to the model",
    help: "Collapses the message to a single line on your screen (in every browser). The model still receives the full text. To actually stop sending it, use Exclude instead.",
  },

  // ── context ──────────────────────────────────────────────────────────────
  pin_directive: {
    tip: "Pinned at the top of every reply — can't be lost or summarized away",
    help: "Pins text at the very top of every reply's prompt in this thread, before library items and before the conversation. Pins are immune to summarization — they're always sent in full. This pin belongs to this thread only; other threads don't see it. To share it across threads, move it to the library. Pins count toward the context window on every reply.",
  },
  update_directive: {
    tip: "New text takes effect from the next reply",
    help: "Updates the pin's text. Takes effect from the next reply; replies already written keep what they were sent. Pins belong to this thread alone — changing one here doesn't affect other threads.",
  },
  unpin_directive: {
    tip: "Its text is gone from this thread · can't be undone",
    help: "Removes the pin and its text from this thread permanently. The model stops seeing it from the next reply. Replies already written keep what they were sent. There is no undo — if you might want it back, consider excluding it instead.",
  },
  reorder_directives: {
    tip: "Controls the order the model reads them",
    help: "Pins are sent in this order at the very top of every reply's prompt, before library items and before the conversation. Put your most important instructions first.",
  },
  convert_directive_to_note: {
    tip: "Becomes a library item — reusable in other threads, still sent here",
    help: "Converts this pin into a library item (named from its first line) so other threads can use it too. It stays in this thread, sent with every reply, switched the same way the pin was. In the model's reading order it moves down — library items come after pins. From now on, editing this text changes it in every thread that adds it, not just here.",
  },
  place_item: {
    tip: "Sent with every reply in this thread",
    help: "Attaches this library item to the thread, sent with every reply after the pins, in the order shown. A library item can only be in one place per thread: if it was attached to a single message, it moves here instead. The thread points to the library's shared copy, so edits to the item's text reach this thread automatically. It adds to the context window on every reply — long items in many threads compound quickly.",
  },
  "place_item:with_message": {
    tip: "Sent only with this specific message",
    help: "Attaches the library item to this specific message — it goes right after the message in the prompt, and drops out when the message isn't sent (excluded or behind a summary). A library item has one place per thread, so it moves here from wherever it was.",
  },
  reorder_items: {
    tip: "Controls the order the model reads them",
    help: "Library items sent with every reply are read in this order, after the pins. Reordering can matter when items reference each other or when you want the model to read background before specifics.",
  },
  remove_item: {
    tip: "Stops sending it here — the item stays in the library",
    help: "Removes the library item from this thread entirely — no longer sent with every reply or with any message. The item itself stays in the library, unchanged, and stays in any other threads that use it.",
  },
  use_own_copy: {
    tip: "Makes a private copy — edits here won't change other threads",
    help: "Creates a new library item with the same name and text, placed here in the same spot and switched the same way. Editing this copy won't affect the original or other threads using it. The original stays in the library for everyone else.",
  },
  set_excluded: {
    tip: "Toggle whether this item is sent to the model",
    help: "When off, the item stays in this thread but isn't sent — handy for temporarily removing context without losing the placement. When on, it's sent again from the next reply. Items attached to a message are only sent when that message is.",
  },
  "set_excluded:directive": {
    tip: "Toggle whether this pin is sent to the model",
    help: "When off, the pin stays here but isn't sent — useful for testing how replies work without it. When on, it's sent again from the next reply.",
  },
  set_excluded_all: {
    tip: "Toggle all at once — useful for A/B testing context",
    help: "Includes or excludes every pin, or every library item in this thread, at once. Useful for seeing how replies change when you strip all context and add it back. Nothing is removed — just temporarily silenced.",
  },

  // ── summaries ────────────────────────────────────────────────────────────
  summarize: {
    tip: "Compress older messages — you review before it's used",
    help: "Select which messages to summarize, then the model writes a summary. You review it before anything changes. Once you accept it, the model gets the summary instead of those messages — making each reply cheaper and faster, but the model loses whatever the summary left out. The original messages stay in the database untouched; you can deactivate the summary and go back to sending them at any time. Each summary records exactly which messages it was written from.",
  },
  revise_summary: {
    tip: "Rewrite this summary — add a note to steer the revision",
    help: "Generates a fresh summary from the same messages (read as they are now — any deleted since are skipped). You can write a note to steer it (e.g. keep more detail about the API design). The new draft comes back for review before anything changes.",
  },
  "revise_summary:again": {
    tip: "Another take on the same messages",
    help: "Generates a new summary from the same messages, read as they are now. The current summary stays until you choose to use the new one. You review the new draft before anything is sent differently.",
  },
  edit_summary: {
    tip: "Write it yourself — your text is sent as-is",
    help: "Replaces the generated text with your own words. What you write is sent as-is in place of the messages it covers — the model never rewrites your edit. If the summary is in use, your edit takes effect from the next reply.",
  },
  set_summary_status: {
    tip: "Use it — the model sees this instead of the original messages",
    help: "Activates the summary: from the next reply on, the model reads this instead of the messages it was written from. Whatever the summary left out, the model won't know. If another summary covered some of the same messages, it's set aside (you can bring it back).",
  },
  "set_summary_status:inactive": {
    tip: "Stop using it — the model gets the original messages again",
    help: "Deactivates the summary. The model goes back to reading the original messages from the next reply. The summary stays here, unused, ready to reactivate if you want.",
  },
  "set_summary_status:discarded": {
    tip: "Delete the summary permanently",
    help: "Permanently removes the summary. The original messages it was written from stay as they are. If it was still being written, that's stopped. There is no undo.",
  },

  // ── templates ────────────────────────────────────────────────────────────
  add_step: {
    tip: "Appended at the end — runs already made aren't changed",
    help: "Adds a new step at the end of the template. Runs that already started or finished keep their own copy of the steps — this only affects future runs.",
  },
  update_step: {
    tip: "Changes future runs only — active runs keep the original",
    help: "Edits this step for future runs. A run copies all steps when it starts, so runs already going or finished keep the version they started with.",
  },
  remove_step: {
    tip: "Removed from future runs only",
    help: "Removes this step from the template. Runs that already started or finished keep their own copy — this only affects future runs.",
  },
  reorder_steps: {
    tip: "The order a run plays them in",
    help: "Steps are played in this order during each run. Runs that already started keep the order they started with.",
  },
  run_template: {
    tip: "Creates a new thread and plays every step in order",
    help: "Makes a fresh thread and plays each step into it, waiting for each reply before moving to the next. Steps, blanks and pins are copied when the run starts — editing those mid-run won't change it. But library items are shared, not copied, so editing an item's text during a run affects its later steps. Agent steps run on your computer with the workspace's default agent permissions. The run's thread lives on the template's page, not in your thread list.",
  },

  // ── system message ────────────────────────────────────────────────────────
  set_system_message: {
    tip: "A global instruction at the top of every prompt, across all workspaces",
    help: "This text goes at the very top of every prompt the model sees, in every workspace. Use it to set tone, verbosity, what to assume you know, or any standing instruction. Changes take effect from the next reply in any thread. The history tracks every change.",
  },

  // ── agent config ─────────────────────────────────────────────────────────
  set_agent_defaults: {
    tip: "Default system message and permissions for agents in this workspace",
    help: "Sets the default system message and permission level that agents start with in this workspace. These defaults apply when you dispatch an agent and when template agent steps run. You can override both when dispatching. Rerunning an agent keeps whatever the original used, not the current defaults.",
  },

  // ── runs ─────────────────────────────────────────────────────────────────
  dispatch_agent: {
    tip: "An agent on your computer, with the permissions you choose",
    help: `${AGENT_HANDS} Its brief is your system message first, then the whole thread as a reply would get it — nothing is left out to fit — then your task at the end. The effort level you pick controls how much the agent thinks before acting (the --effort CLI flag). ${AGENT_LEFT_OUT} One agent works in a workspace's folder at a time, so a second dispatch waits for the first to finish. The server snapshots the workspace folder before and after to show you what changed.`,
  },
  agent_follow_up: {
    tip: "Continue from the agent's own session — it remembers what it did",
    help: `Carries on from a copy of the agent's session, so the original stays intact: it remembers everything it did, plus it sees what's been said in the thread since its card, then your new message. Pins and library items aren't re-sent, so changes to them don't reach it. Uses the workspace's current default permissions — not what the original agent had. ${SESSIONS} ${AGENT_HANDS}`,
  },
  cancel_run: {
    tip: "Stop it where it is — work already done stays done",
    help: "A reply being written for the first time keeps what it had so far, marked as stopped. A reply being rewritten keeps its previous text, and the partial rewrite goes into its history. An agent that's stopped keeps its steps but no result — files it changed on your computer stay changed. Stopping a template step stops the whole run.",
  },
  mark_seen: {
    tip: "Dismiss — synced across all your browsers",
    help: "Marks this notification as seen. The state is stored on the server, so it's dismissed in every browser at once.",
  },
} satisfies { [K in ActionName]: Said } & Record<Key, Said>;

export type BehaviourKey = keyof typeof BEHAVIOUR;
