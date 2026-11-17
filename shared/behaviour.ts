import type { ActionName } from "./actions.js";
import { AGENT_PERMISSION_LABELS as P, AGENT_SWITCHED_OFF, list } from "./agent.js";

/**
 * What each action does, said once. The app's help (Alt-click) and the tooltips and menu hints on
 * the controls that run an action take their words from here, so there's one statement to keep
 * true, beside the action's own name: add, rename or remove an action and this file stops
 * compiling until its words are written.
 *
 * `name` is the action in a few words, as the help lists it; `tip` is a few words for a tooltip or
 * a menu hint; `help` is what Alt-click shows. Each `help` stands on its own: someone who has
 * clicked nothing else must come away knowing what happens on the server, what the model gets from
 * then on, what it costs, what happens elsewhere (other threads, other browsers, their computer),
 * and whether it can be undone — in plain words, with no names from the code. An action whose
 * effect depends on how it's asked has a variant after a colon.
 *
 * Every statement must be how the action behaves in server/src/actions (and the domain code it
 * calls). Nothing in the app can be undone except by doing the opposite.
 */
export interface Said { name: string; tip: string; help: string }

type Key = ActionName | `${ActionName}:${string}`;

const AGENT_HANDS = `The agent is Claude Code running on this computer, started in the workspace's own folder. What it may do is set by the permission level you pick: ${P.locked} lets it read and search but change nothing; ${P.standard} lets it also create and change files; ${P.full} lets it run any command and change anything, with no confirmation asked. Nothing confines it to the folder — with ${P.full} it can reach anything your user account can.`;
const AGENT_LEFT_OUT = `It starts with only your user-level Claude Code settings: ${list(AGENT_SWITCHED_OFF)} are switched off, so what it knows is what the brief says.`;
const SESSIONS = "Claude Code keeps a session for 30 days by default; after that there is nothing to continue from.";
const COSTS_ONE = "This is one request to the model provider set for replies, paid for by whatever account that provider bills.";
const NEW_THREAD = "With no thread open, a new thread is made first, named after the first line of what you wrote, in the same step.";

export const BEHAVIOUR = {
  // ── workspaces & folders ─────────────────────────────────────────────────
  create_workspace: {
    name: "Create a workspace",
    tip: "A home folder for agents, and a library shared by every thread inside",
    help: "Creates a workspace: a named set of threads, thread folders and library items that nothing outside it can see, plus a folder of its own on this computer under ~/.thedesk/workspaces, named after it. Agents you start in any of its threads begin in that folder and can read, write and run commands there. Every thread in it shares the same library, and the same default agent settings. The model provider, its key, and the system message are shared by all workspaces, not per workspace. A workspace can't be renamed or deleted from the app, so choose the name with care.",
  },
  create_folder: {
    name: "Create a folder",
    tip: "Organize your list — the model never sees folders",
    help: "Makes a folder in this list — the thread list or the library — purely to organize it. Folders and their names are never sent to the model, so filing something changes nothing in any reply. Drag threads or library items in and out at any time. Deleting a folder later moves whatever is inside it to the top level and deletes nothing else.",
  },
  rename_folder: {
    name: "Rename a folder",
    tip: "Only for your list — the model never sees folder names",
    help: "Changes the folder's name in your list. Folder names are never sent to the model, so nothing changes in any reply, and nothing inside the folder is touched.",
  },
  move_folder: {
    name: "Move a folder",
    tip: "Nest it under another folder, or move it to the top level",
    help: "Moves the folder, with every thread, library item and subfolder inside it, under another folder or back to the top level. This is only how your list is arranged: nothing is sent to the model, and nothing inside changes.",
  },
  delete_folder: {
    name: "Delete a folder",
    tip: "Only the folder goes — everything inside moves to the top level",
    help: "Removes the folder itself and nothing else. Every thread, library item and subfolder that was inside it moves to the top level of the list, untouched. No message, reply or library text is deleted.",
  },
  move_thread: {
    name: "Move a thread to a folder",
    tip: "Takes its branches with it",
    help: "Files the thread in a folder, or takes it back out to the top level. Its branches — threads that were forked from it — move with it, and so do their branches. This only arranges your list: the model never sees folders, and nothing in the thread changes. A template's runs aren't filed in folders at all; they live on the template's own page.",
  },

  // ── library ──────────────────────────────────────────────────────────────
  create_note: {
    name: "Create a library item",
    tip: "Write reference text once, use it in any thread",
    help: "Makes a library item: text kept once, in this workspace's library, that any thread here can use. When you make one beside an open thread, it's added to that thread at once and sent with every later reply, in the order the items appear in the panel. When you make one from a message's text (Save to library), the message itself is excluded from then on so the text isn't sent twice. An item adds to the context window of every thread that uses it, on every reply. There's one copy: editing it later changes it for every thread using it.",
  },
  update_note: {
    name: "Edit a library item",
    tip: "One copy — every thread using it gets the new text immediately",
    help: "Saves new text for the item. There is one copy of a library item, so every thread that uses it sends the new text from its next reply on — in this workspace, in every thread, whoever is using it. Replies already written keep what they were sent. Summaries already written keep what they say. The app keeps no earlier text of a library item to go back to: once saved, the previous wording is gone unless you kept it as a separate version.",
  },
  "update_note:name": {
    name: "Rename a library item",
    tip: "The name is sent to the model as the item's heading",
    help: "Changes the item's name. The name is sent to the model as the item's heading wherever the item is used, so the new name reaches every thread that uses it from the next reply on. Pick a name that tells the model what the item is.",
  },
  move_note: {
    name: "Move a library item to a folder",
    tip: "Move it into a library folder or back to the top level",
    help: "Files the item in a library folder, or takes it back out to the top level. Library folders only arrange the panel: the model never sees them, the item stays in every thread that uses it, and what is sent doesn't change.",
  },
  version_add_older: {
    name: "Add an older version",
    tip: "Add a library item as an older version of this one",
    help: "Puts the item you pick into this item's version tree, directly under this version, as one it was followed by. Only items that aren't already in a version tree can be picked. The picked item becomes a past version: it leaves the library's active list and every thread it was in. Where it was in use, the tree's current version is sent instead from the next reply on; if the tree has no current version, nothing is sent in its place. Its text isn't changed, and you can make it current later to bring it back.",
  },
  version_detach: {
    name: "Take a version out of its tree",
    tip: "Take this version out of the tree",
    help: "Lifts this item out of its version tree and leaves it as it is: if it was the current version it's still in its threads and still sent; if it was a past version it stays out of circulation until you reactivate it. Any versions that pointed to it now point to what it pointed to, so the rest of the tree stays connected. A tree left with one member stops being a tree.",
  },
  version_set_current: {
    name: "Make a version current",
    tip: "Make this the current version",
    help: "Makes this the version threads use. It moves to the top of the tree, and every thread that was using the version it replaces sends this one instead, from the next reply on — in every thread at once. The path between the two flips, so the old current version now reads as one that was followed by this one. Replies already written keep what they were sent.",
  },
  version_set_newer: {
    name: "Change what a version was followed by",
    tip: "Change which version this one was followed by",
    help: "Points this version — and every version under it — at a different newer version in the same tree. It only changes how the history is drawn: nothing is sent to the model and no thread changes. The current version is the top of the tree and can't be moved; a version can't be pointed at one of its own past versions.",
  },
  combine_notes: {
    name: "Combine library items",
    tip: "AI reads the selected items and writes one combined item",
    help: `Sends every selected item's text to the model with your instructions, and the model writes one new library item from them; you watch it being written. Then you review it: accept it into the library, rename it, edit the text, open it in the full editor, or discard it. Until you accept, nothing is in the library and no thread changes; the original items are never changed or removed. ${COSTS_ONE}`,
  },
  retire_note: {
    name: "Retire a library item",
    tip: "Out of the library and every thread — still exists, can come back",
    help: "Takes the item out of circulation: it leaves the active library list and every thread that was using it, in every thread at once, so from the next reply on no thread sends it. Nothing is sent in its place. If it was the current version of a version tree, the tree is left with no current version until you make another version current. Its text is kept, it's listed under Retired, and reactivating it brings it back to the library — though not to the threads it was in.",
  },
  reactivate_note: {
    name: "Reactivate a library item",
    tip: "Back in the library, ready to use again",
    help: "Brings a retired item back into the active library. An item on its own comes back to no threads — add it to a thread yourself. An item that's a version in a version tree becomes that tree's current version instead: every thread using the version it displaces sends this one from the next reply on.",
  },
  delete_note: {
    name: "Delete a library item",
    tip: "Gone from the library and every thread · can't be undone",
    help: "Removes the item for good: from the library and from every thread that was using it, in every thread at once, so no later reply sends it. Replies already written keep what they were sent, and summaries keep what they say. If it was in a version tree, versions that pointed to it now point to what it pointed to. There is no undo.",
  },

  // ── threads ──────────────────────────────────────────────────────────────
  create_thread: {
    name: "Create a thread",
    tip: "A blank conversation — bring in context from the library",
    help: "Starts an empty thread in this workspace: no messages, no library items. The model knows nothing from your other threads; each reply is written only from what this thread holds — its own messages and the library items you add to it. Nothing is sent to the model until you ask for a reply.",
  },
  rename_thread: {
    name: "Rename a thread",
    tip: "Only for you — the model never sees the thread name",
    help: "Changes the thread's name in your list. The name is never sent to the model: a reply is written from the thread's messages and library items only, so renaming changes nothing in any reply.",
  },
  delete_thread: {
    name: "Delete a thread",
    tip: "Permanent · branches survive on their own",
    help: "Removes the thread for good and stops anything being written in it. Branches that were taken from it aren't deleted: each is a thread of its own and keeps everything it has; in the list they move up to where this thread was. Library items the thread used stay in the library and in every other thread. There is no undo.",
  },
  "delete_thread:template": {
    name: "Delete a template",
    tip: "Deletes the template and all its runs' threads · can't be undone",
    help: "Removes the template for good, together with every thread its runs made and every branch taken from those threads, and stops anything still being written in them. A template with a run still going can't be deleted — stop the run first. Library items stay in the library and in every other thread. There is no undo.",
  },
  duplicate_thread: {
    name: "Duplicate a thread",
    tip: "A full copy: every message, summary and library item placement",
    help: "Makes a new thread with a copy of everything in this one: every message with its full history, the summaries, and which library items are in use. The original isn't touched, and from now on the two are independent — editing or deleting in one never reaches the other. Library items are the exception: both threads use the same items, so editing an item's text changes it in both. Anything still being written copies as it is at that moment. Nothing is sent to the model.",
  },
  "duplicate_thread:template": {
    name: "Duplicate a template",
    tip: "Copies the template's steps and library items",
    help: "Makes a new template with the same steps and the same library items. The steps are copied, so editing one template never changes the other; library items are shared, so editing an item's text changes it for both. The original template's runs stay with the original — the copy starts with none.",
  },
  branch_thread: {
    name: "Branch from a message",
    tip: "A new thread forking from this point, with everything above it",
    help: "Makes a new thread holding a copy of everything up to and including this message — each message with its full history — along with the thread's library items and summaries as they stand now. From then on the two threads are independent: writing, editing or deleting in one never reaches the other. Library items are the exception: both use the same items, so editing an item's text changes it in both. The branch is listed under this thread, and this card shows a switch between them. Nothing is sent to the model.",
  },
  make_template: {
    name: "Make a template from a thread",
    tip: "Turn your messages into reusable steps that can be run repeatedly",
    help: "Makes a template from this thread. Each of your messages becomes a step — one that waits for a reply if the model answered it here, one that just posts otherwise; an agent's task becomes an agent step; replies are dropped, since each run gets fresh ones. Excluded and deleted messages are left out. The library items in use come along. This thread isn't changed; the template is a new thing in your list, and each run of it plays the steps into a fresh thread of its own.",
  },

  // ── messages ─────────────────────────────────────────────────────────────
  send_message: {
    name: "Add a message",
    tip: "Adds your message without calling the model — free",
    help: `Adds your message to the end of the thread and sends nothing to the model, so it costs nothing. From the next reply on, the model gets this message along with the rest of the thread, unless you exclude it. Use it to lay down material, paste references, or set up context before asking for a reply. ${NEW_THREAD}`,
  },
  "send_message:reply": {
    name: "Add a message and get a reply",
    tip: "Adds your message, then the model replies to the full thread",
    help: `Adds your message, then asks the model for a reply. The model keeps nothing between replies: each one is written from the whole thread, sent fresh — the system message first, then the library items in use, then every message that isn't excluded, with any accepted summary standing in for the messages it covers. The longer the thread, the more each reply sends. If a card above is still being written, this reply waits for it and is written from the finished text. The exact prompt is recorded with the reply, so you can always see what it was written from. ${NEW_THREAD} ${COSTS_ONE}`,
  },
  insert_message: {
    name: "Insert a message",
    tip: "Insert here — nothing below is redone",
    help: "Adds your message at this point in the conversation, between the cards above and below. The cards below stay exactly as they are — the replies among them were written without it and aren't redone. From the next reply on, the model gets it in this position. Nothing is sent to the model now.",
  },
  "insert_message:reply": {
    name: "Insert a message and get a reply",
    tip: "The model answers from what's above this point only",
    help: `Adds your message at this point, then asks the model for a reply written only from what comes before this point — the system message, the library items in use, and the cards above — and places the reply right under it. The cards below stay as they are. If a card above is still being written, the reply waits for it. The exact prompt is recorded with the reply. ${COSTS_ONE}`,
  },
  request_reply: {
    name: "Ask for a reply",
    tip: "Ask for a reply right after this message",
    help: `Asks the model for a reply and places it right after this message. It's written from everything above that point — the system message, the library items in use, and every card up to and including this one that isn't excluded. Anything below the new reply stays as it is. If a card above is still being written, the reply waits for it. The exact prompt is recorded with the reply. ${COSTS_ONE}`,
  },
  edit_message: {
    name: "Edit a message",
    tip: "Edit in place — the old text is kept in its history",
    help: "Replaces this card's text with yours, where it is — a message of your own, a reply, or an agent's result. The text it had is kept in the card's history, with the prompt it was written from, and can be read there at any time. Replies below keep what they were sent; replies from now on get your text. Editing what an agent wrote changes only what's shown and sent on — not what it did on your computer. Saving the text unchanged records nothing. A card still being written can't be edited.",
  },
  "edit_message:reply": {
    name: "Save an edit and get a new reply",
    tip: "Save your edit, then the reply below is rewritten",
    help: `Saves your text, then has the model write the reply directly below it again, from the whole thread above as it stands now; if no reply follows, a new one is added. Cards below that reply stay as they are. While the new reply is being written the old one is still shown; if the attempt fails, the old reply stays and the attempt goes into the card's history. ${COSTS_ONE}`,
  },
  regenerate: {
    name: "Write a reply again",
    tip: "Rewrite this reply from the current context",
    help: `Has the model write this reply again, in the same card, from everything above it as the thread stands now — the system message, the library items in use, and the cards above that aren't excluded. Cards below stay as they are and aren't redone. The card keeps its current text until the new one is finished; if the attempt fails, the old text stays and the attempt goes into the card's history. An agent's card runs its task again exactly as it was started — model, effort, permission level and standing instructions — in a fresh fork of its session. The exact prompt is recorded. ${COSTS_ONE}`,
  },
  delete_message: {
    name: "Delete a message",
    tip: "Permanent — replies below it stay, answering something now gone",
    help: "Removes this card from the thread for good; the app has no way to bring it back. Everything below it stays — so a reply that answered this message now answers something that isn't there, and later replies are written without it. Anything being written on this card is stopped. Library items mentioned in it no longer reach the model through it; the items themselves stay in the library. There is no undo.",
  },
  exclude_message: {
    name: "Exclude a message",
    tip: "Exclude it — the model stops seeing it, but it stays for you",
    help: "Keeps the card in the thread but stops sending it: from the next reply on, the model doesn't get this message, nor any library item mentioned inside it. Nothing is deleted, and replies already written keep what they were sent. The choice is kept on the server, so it's the same in every browser. Include it again at any time.",
  },
  "exclude_message:included": {
    name: "Include a message again",
    tip: "Include it again — the model sees it from the next reply",
    help: "Sends this card again: from the next reply on, the model gets this message, and any library item mentioned inside it, in its place in the thread. Replies written while it was excluded keep what they were sent. The choice is kept on the server, so it's the same in every browser.",
  },
  fold_message: {
    name: "Fold a message",
    tip: "Collapse to one line in your view — still sent to the model",
    help: "Shrinks the card to one line on your screen, and nothing more: the model still gets its full text with every reply. The fold is kept on the server, so the card is folded in every browser you open it in. To stop sending the message, exclude it instead.",
  },

  // ── context ──────────────────────────────────────────────────────────────
  place_item: {
    name: "Add a library item to a thread",
    tip: "Sent with every reply in this thread",
    help: "Adds the library item to this thread. From the next reply on, its name and text are sent with every reply, after the system message and before the conversation, in the order the items appear in the panel. The thread uses the library's one copy, so later edits to the item reach this thread by themselves. It adds to the context window on every reply, so a long item in many threads adds up. Replies already written keep what they were sent. With no thread open, a new thread is made first, in the same step.",
  },
  reorder_items: {
    name: "Reorder a thread's library items",
    tip: "Controls the order the model reads them",
    help: "Changes the order the library items are sent in: they go to the model in this order, after the system message and before the conversation, from the next reply on. Order can matter when one item refers to another, or when you want the model to read background before specifics. Nothing else changes.",
  },
  remove_item: {
    name: "Remove a library item from a thread",
    tip: "Stops sending it here — the item stays in the library",
    help: "Takes the library item out of this thread: from the next reply on, it's no longer sent here. The item itself isn't changed or deleted — it stays in the library and in every other thread that uses it. Replies already written keep what they were sent. Add it again at any time.",
  },

  // ── summaries ────────────────────────────────────────────────────────────
  summarize: {
    name: "Summarize messages",
    tip: "Compress older messages — you review before it's used",
    help: `Starts a summary: pick the messages to compress, then the model writes a summary of exactly those, read as they are now, with instructions you can edit first. The draft appears in the conversation for review, and until you accept it nothing changes in what the model gets. Accepting it turns the draft into a card where the first of those messages was, and removes the messages it was written from — for good, with no way back from the app; the summary's history records what it was written from. From then on the model gets the summary instead of those messages, so each reply sends less, and the model loses whatever the summary left out. ${COSTS_ONE}`,
  },
  revise_summary: {
    name: "Revise a summary",
    tip: "Rewrite this summary — add a note to steer the revision",
    help: `Has the model write the draft again from the same messages, read as they are now — any deleted since are skipped — with a note from you steering it, if you write one. The new text replaces the draft for you to review; the messages it summarizes aren't touched, and nothing changes in what the model gets until you accept a draft. ${COSTS_ONE}`,
  },
  edit_summary: {
    name: "Edit a summary draft",
    tip: "Write it yourself — your text is sent as-is",
    help: "Replaces the draft's text with your own words before it's used. The model never rewrites what you typed: if you then accept the summary, your text is what's sent in place of the messages it covers. Nothing changes in what the model gets until you accept it. Once a summary is in use it's a card like any other, and you edit it the way you edit a message.",
  },
  accept_summary: {
    name: "Accept a summary",
    tip: "Accept — replaces the original messages with this summary card",
    help: "Puts the summary to use. It becomes a card in the conversation where the first of the summarized messages was, and those messages are removed from the thread — for good, with no way back from the app; the summary's history records which ones. Any other draft summary covering one of those messages is discarded. From the next reply on, the model gets the summary's text in their place, so each reply sends less and the model no longer sees what the summary left out. The new card can be excluded, folded, edited or deleted like any message. Nothing is sent to the model now.",
  },
  discard_summary: {
    name: "Discard a summary",
    tip: "Discard the summary permanently",
    help: "Throws the draft away for good; it can't be brought back. The messages it was written from stay exactly as they are, still sent as before. If the draft was still being written, that's stopped. Nothing changes in what the model gets.",
  },

  // ── templates ────────────────────────────────────────────────────────────
  add_step: {
    name: "Add a step to a template",
    tip: "Appended at the end — runs already made aren't changed",
    help: "Adds a step to the end of the template, for runs started from now on. A run takes its own copy of all the steps when it starts, so runs already going or finished aren't changed. Nothing is sent to the model now.",
  },
  update_step: {
    name: "Change a template step",
    tip: "Changes future runs only — active runs keep the original",
    help: "Changes this step's text or kind for runs started from now on. A run takes its own copy of all the steps when it starts, so runs already going or finished keep the step as it was. Nothing is sent to the model now.",
  },
  remove_step: {
    name: "Remove a template step",
    tip: "Removed from future runs only",
    help: "Removes this step from the template, for runs started from now on. A run takes its own copy of all the steps when it starts, so runs already going or finished keep it. There is no undo, but nothing else is affected.",
  },
  reorder_steps: {
    name: "Reorder a template's steps",
    tip: "The order a run plays them in",
    help: "Changes the order the steps are played in, for runs started from now on. A run takes its own copy of the steps when it starts, so runs already going keep the order they started with. Nothing is sent to the model now.",
  },
  run_template: {
    name: "Run a template",
    tip: "Creates a new thread and plays every step in order",
    help: "Makes a fresh thread and plays the steps into it, one after another: a step that posts a message adds it and moves on; a step that waits for a reply asks the model and waits for the answer before the next step; an agent step starts an agent on your computer, with the workspace's saved standing instructions and permission level, and waits for it to finish. The steps and the blanks you fill in are copied when the run starts, so editing the template mid-run doesn't change it; library items are shared, not copied, so editing one mid-run does reach later steps. You can work in the run's thread while it goes, and each next step is added at the end, written from the thread as it is then. The run's thread lives on the template's page, not in your thread list. Each reply step and agent step costs a model request.",
  },

  // ── system message ────────────────────────────────────────────────────────
  set_system_message: {
    name: "Set the system message",
    tip: "A global instruction at the top of every prompt, across all workspaces",
    help: "Saves the one system message. It goes at the very top of every prompt the model gets, for every reply in every thread of every workspace, and into every agent's brief under its own heading — from the next reply or agent on; replies already written keep what they were sent. Use it for tone, length, what to assume you know, or any standing instruction. Every change is recorded, though earlier versions aren't shown in the app.",
  },

  // ── agent defaults ───────────────────────────────────────────────────────
  set_agent_defaults: {
    name: "Save the workspace's agent defaults",
    tip: "Default standing instructions and permission level for agents in this workspace",
    help: "Saves, for this workspace, the standing instructions and permission level that the agent bar starts with and that template agent steps use. Agents in other workspaces aren't affected. You can still change both for any one agent before starting it. Running an agent again uses what that run used, not these defaults. Nothing is sent to the model now.",
  },

  // ── model provider ───────────────────────────────────────────────────────
  set_llm: {
    name: "Choose the model provider",
    tip: "Where every reply goes, for every workspace",
    help: "Sets the provider and model that write every reply, summary, combined item and template reply step, in every workspace, from now on. Replies already written keep the model that wrote them — each records it. Agents aren't affected: they run through Claude Code on this computer with its own model settings. A key you enter is kept, per provider, in this computer's database and never shown again, so switching back to that provider later doesn't ask for it; the key is sent to that provider and to no one else. Each reply from now on is billed to whatever account that provider's key belongs to.",
  },
  add_connection: {
    name: "Add your own endpoint",
    tip: "Your own OpenAI-compatible endpoint, saved and switched to",
    help: "Saves an endpoint of your own — a local proxy, a server you run — by its chat-completions address, with a key if it needs one, and switches every reply, summary and template reply step to it, in every workspace, from now on. The address and key are kept in this computer's database. The endpoint is asked for its model list at the matching models address; when it answers, you pick from that list, and otherwise the model name you type is sent as is. What you send goes to that address and nowhere else.",
  },
  remove_connection: {
    name: "Remove an endpoint",
    tip: "Forgets a saved endpoint",
    help: "Removes the saved endpoint and its key from this computer's database. The one in use can't be removed — switch to another provider or connection first. Replies already written through it are unchanged and still show the model that wrote them.",
  },

  // ── runs ─────────────────────────────────────────────────────────────────
  dispatch_agent: {
    name: "Start an agent",
    tip: "An agent on your computer, with the permissions you choose",
    help: `Starts an agent with your task. ${AGENT_HANDS} Its brief is your task first, then the standing instructions, then the system message, then the library items in use, then the whole conversation as a reply would get it — nothing is left out to fit. The model and effort you pick are passed to Claude Code as its own options; left on Default, it uses its own settings on this computer. ${AGENT_LEFT_OUT} Only one agent works in a workspace's folder at a time, so a second one waits for the first to finish. The folder is compared before and after the run, so the card can list what changed in it. Its steps are kept, and its result becomes a card that later replies get, headed with its task. ${NEW_THREAD} It's billed to whatever account Claude Code uses on this computer.`,
  },
  agent_follow_up: {
    name: "Follow up with an agent",
    tip: "Continue from the agent's own session — it remembers what it did",
    help: `Starts a new agent run from a copy of this agent's session, so the original run is kept as it was: the new agent remembers everything the earlier one did and said, then gets what's been said in the thread since its card — messages and replies, not library items, so changes to items don't reach it — and then your new message. It uses the permission level, standing instructions, model and effort the agent bar shows when you send it, not what the earlier run had. ${AGENT_HANDS} ${SESSIONS} Its result becomes a new card, and it's billed to whatever account Claude Code uses on this computer.`,
  },
  cancel_run: {
    name: "Stop a run",
    tip: "Stop it where it is — work already done stays done",
    help: "Stops what's being written on this card and keeps the card. A reply being written for the first time keeps the words it had so far, marked as stopped, and later replies get it as it is. A reply being written again keeps its earlier text, and the unfinished attempt goes into its history. An agent that's stopped keeps its steps and whatever it had said so far, marked as stopped; files it changed on your computer stay changed. Stopping a template's step stops the whole run; what's already in the run's thread stays.",
  },
  mark_seen: {
    name: "Dismiss a notice",
    tip: "Dismiss — synced across all your browsers",
    help: "Clears this notice. The server records that you've seen it, so it's gone from every browser you use, and the mark in the thread list goes with it. Nothing about the thread, the reply or the model changes.",
  },
} satisfies { [K in ActionName]: Said } & Record<Key, Said>;

export type BehaviourKey = keyof typeof BEHAVIOUR;
