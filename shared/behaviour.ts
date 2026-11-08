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
    tip: "Also makes a folder for its agents",
    help: "Also makes a folder on your computer, in ~/.thedesk/workspaces. Agents you dispatch start here and can read, write and run commands in that folder, so it becomes the workspace's home directory. Workspaces can't be renamed or deleted from the app, so choose the name with care.",
  },
  create_folder: {
    tip: "Folders only organize your list",
    help: "Folders only organize your list; nothing about them reaches the model. A conversation goes in a folder whole: the thread it started from, with every branch taken from it.",
  },
  rename_folder: {
    tip: "Only for your list",
    help: "Folders only organize your list; the model never sees them.",
  },
  delete_folder: {
    tip: "Only the folder goes — what's in it moves out",
    help: "Only the folder goes: what was in it is then in no folder, and nothing in it changes.",
  },
  move_thread: {
    tip: "The conversation moves whole",
    help: "A conversation moves whole: the thread it started from holds the folder, and every branch taken from it (and from those) is listed with it. Folders only organize your list. A template's runs live on its page, so they have no folder.",
  },

  // ── library ──────────────────────────────────────────────────────────────
  create_note: {
    tip: "Any thread in the workspace can use it",
    help: "Reference text written once and used in any thread of this workspace. If a thread is open, the new item is added to it straight away, sent with every reply — the model reads it from the next reply on.",
  },
  update_note: {
    tip: "Every thread using it gets the new text",
    help: "A library item has one copy, so saving changes it in every thread that uses it, from their next reply on. Replies already written keep what they were sent, and a summary already written keeps what it says.",
  },
  "update_note:name": {
    tip: "The name reaches the model, as its heading",
    help: "A library item's name is sent with it, as its heading, so renaming it changes what every thread using it sends.",
  },
  duplicate_note: {
    tip: "An independent copy, not added to any thread",
    help: "Makes an independent copy in the library, named “… (copy)”: editing it won't touch the original or the threads that use it. The copy isn't added to any thread.",
  },
  delete_note: {
    tip: "From the library and every thread · can't be undone",
    help: "Removes it from the library and from every thread that uses it, wherever it was in each. Replies already written keep what they were sent, and a summary already written keeps what it says. There's no Undo.",
  },

  // ── threads ──────────────────────────────────────────────────────────────
  create_thread: {
    tip: "Starts clean",
    help: "Starts clean: nothing pinned and no library items, so the model knows nothing from your other threads until you bring it in.",
  },
  rename_thread: {
    tip: "Only for you; the model never sees it",
    help: "The name is only for you; the model never sees it.",
  },
  set_thread_model: {
    tip: "This thread only, from now on",
    help: "Applies to this thread only, and to everything it asks for from now on: replies, summaries, naming and agents. Replies already written stay on whatever model wrote them. Each run records the exact model it was sent to, so you can always see which.",
  },
  delete_thread: {
    tip: "Can't be undone",
    help: "The thread is deleted, and anything running in it is stopped. Branches taken from it stay with all their content, and take its place in the list. There's no Undo.",
  },
  "delete_thread:template": {
    tip: "With its runs' threads · can't be undone",
    help: "The template is deleted, and so are the threads its runs made and the branches taken from them; anything running in them is stopped. A template with a run still going can't be deleted until you stop that run. Library items it used stay in the library. There's no Undo.",
  },
  duplicate_thread: {
    tip: "Every card with its history, the pins and summaries",
    help: "Takes a copy somewhere new without touching the original: every card with every text it has had, the pins, the library items in their places and the summaries, in the same folder. Library items aren't copied, though: both threads use the same ones, so editing one changes both. Anything being written is copied as it is: a card being written for the first time comes with what it had so far, and a summary being written comes as a draft for you to review.",
  },
  "duplicate_thread:template": {
    tip: "Its steps, pins and library items",
    help: "Makes a copy of the template — its steps, its pins and the library items it uses — in the same folder. Library items aren't copied, though: both use the same ones. Its runs stay with the original.",
  },
  branch_thread: {
    tip: "A thread of its own with everything up to here",
    help: "Makes a thread of its own from everything up to and including this card — each card with every text it has had — and the pins, library items and summaries as they are now. A card still being written comes with what it had so far, marked as cut off; a summary still being written comes as a draft for you to review. This thread stays as it is; from then on nothing done in one reaches the other, except library items, which they share. The branch is listed under this thread.",
  },
  make_template: {
    tip: "Your messages become reusable steps",
    help: "Your messages become steps — a step with a reply where the model answered one — and agents' tasks become agent steps (a reply after an agent's result isn't kept: there's no step for one). Excluded messages are left out. The pins and the library items sent with every reply come along; items with a single message don't, and nor do replies — each run gets fresh ones. This thread stays as it is.",
  },
  generate_title: {
    tip: "Read from how the thread began",
    help: "Only the start of the first six messages is read, so the name reflects how the thread began. It's one small request to this thread's model; if you rename the thread before it's done, your name stays.",
  },

  // ── messages ─────────────────────────────────────────────────────────────
  send_message: {
    tip: "Adds your message. Nothing is sent to the model.",
    help: "Adding is free: nothing goes to the model, so you can lay down material before you ask anything, and ask for a reply later. Library items chosen for your next message go with it.",
  },
  "send_message:reply": {
    tip: "Adds your message, then the model replies to the context as it now stands",
    help: "The model has no memory between replies: each is written from the whole thread, sent fresh — pins, library items in use, and every message that's sent, with a summary in use in place of its cards. Longer threads mean more is sent per reply; summaries can compress older parts. If a card above is still being written, the reply waits for it. What it's sent is recorded with it when it starts.",
  },
  insert_message: {
    tip: "The messages below stay; their replies aren't redone",
    help: "Adds a message at this point without redoing what follows: the replies below stay as they were, written without it, and every reply from now on sees it.",
  },
  "insert_message:reply": {
    tip: "The model answers here, from what comes before",
    help: "The model answers right here, from what comes before this point only, once any card above it has been written. The messages below stay, and their replies aren't redone.",
  },
  request_reply: {
    tip: "A reply right after it, from everything above",
    help: "Adds a reply right after this message, written from everything above it as it is now — once any card above it still being written is done. What it's sent is recorded with it.",
  },
  edit_message: {
    tip: "Edit it here, in place",
    help: "Edits it where it is — yours, a reply or an agent's result — and the text it had stays in its history. Replies already written keep what they were sent; from the next one on, the model gets your wording. Editing an agent's displayed result doesn't change what it actually did or what a follow-up continues from — only the text shown and sent onward. A card can't be edited while it's being written.",
  },
  "edit_message:reply": {
    tip: "Saves, then writes the reply under it again",
    help: "Saves your text, then the model writes the reply under it again, in the same place — or, if no reply follows directly, adds one — from everything above it as it is now. What's below stays. If the new reply doesn't finish, the card keeps the reply it had, and what was written goes in its history.",
  },
  regenerate: {
    tip: "Write it again, in the same place, from everything above it",
    help: "Writes it again in the same card, from everything above it as it is now; the messages below stay and aren't redone. The card keeps its text until the new one is finished — if it doesn't finish, the old one stays, and what was written goes in its history.",
  },
  "regenerate:agent": {
    tip: "Runs its task again, in this card, with the same permissions it had",
    help: `Runs the agent again with the same task, system message, permission level and effort as the original, in this card. It works on your computer, starting in this workspace's folder. What the first run changed stays changed; files it wrote or commands it ran are not rolled back. The card shows the new attempt, finished or not; the earlier result stays in its history. A redone follow-up starts again from the session it followed, in a fresh copy, so the attempt it replaces isn't in its memory.`,
  },
  delete_message: {
    tip: "Can't be undone",
    help: "Only this card goes — any library items that went with it leave this thread, staying in the library. Everything after it stays, so a reply to it now answers something that isn't there. If it's being written, that's stopped. There's no Undo.",
  },
  set_message_flags: {
    tip: "Stop sending it to the model; it stays here for you",
    help: "The model stops seeing it — and any library items that go with it — from the next reply on. Nothing is deleted; Include brings it back.",
  },
  "set_message_flags:included": {
    tip: "Send it to the model again",
    help: "From the next reply on, the model sees it again, with any library items that go with it.",
  },
  "set_message_flags:folded": {
    tip: "Fold it to one line in your view; it's still sent",
    help: "Only tidies your screen (in every browser): the model still gets the whole message. To stop sending it, exclude it instead.",
  },

  // ── context ──────────────────────────────────────────────────────────────
  pin_directive: {
    tip: "Sent at the top of every reply in this thread",
    help: "Lifts what matters out of the conversation and puts it at the top of every reply in this thread, ahead of the conversation, where it can't get lost or summarized away. It belongs to this thread only.",
  },
  update_directive: {
    tip: "From the next reply on",
    help: "Takes effect from the next reply; replies already written keep what they were sent. A pin belongs to this thread alone.",
  },
  unpin_directive: {
    tip: "Its text goes · can't be undone",
    help: "From the next reply on, the model doesn't get it; replies already written keep what they were sent. Its text goes from this thread, and there's no Undo.",
  },
  reorder_directives: {
    tip: "The order the model reads them in",
    help: "Pins are sent in this order, at the top of every reply.",
  },
  convert_directive_to_note: {
    tip: "Reusable in other threads; still sent here",
    help: "It becomes a library item, named from its first line, still sent with every reply here and switched the way the pin was. In what the model reads it moves down, since library items come after the pins. Dropping a pin on the library instead also stops sending it here.",
  },
  place_item: {
    tip: "Sent with every reply",
    help: "Sent with every reply in this thread, after the pins, in the order shown. A library item has one place in a thread: if it went with a message here, it moves from there. The thread uses the library's one copy, so later edits to the item reach it too.",
  },
  "place_item:with_message": {
    tip: "With this message, and nowhere else here",
    help: "From now on it goes right after this message, wherever that is in the conversation — not at the top — and drops out when the message isn't sent. A library item has one place in a thread, so it moves here from wherever it was.",
  },
  reorder_items: {
    tip: "The order the model reads them in",
    help: "Library items sent with every reply go in this order, after the pins.",
  },
  remove_item: {
    tip: "It stays in the library",
    help: "Nothing of it is sent in this thread any more, wherever it was — with every reply or with a message. It stays in the library, and in the other threads that use it.",
  },
  use_own_copy: {
    tip: "Same name and place; edits to it don't change the others",
    help: "The copy is a new library item with the same name and text, in the same place here and switched the same way. Edits to it don't change the original, which stays in the library for the other threads that use it.",
  },
  set_excluded: {
    tip: "Off keeps it here without sending it",
    help: "Off keeps the item here without sending it; on sends it again from the next reply. One that goes with a message is sent only when that message is.",
  },
  "set_excluded:directive": {
    tip: "Off keeps it here without sending it",
    help: "Off keeps the pin here without sending it — handy for seeing how replies do without it. On sends it again from the next reply.",
  },
  set_excluded_all: {
    tip: "All of them at once",
    help: "Switches every pin, or every library item this thread uses, at once. Switched off, they stay here but aren't sent — an easy way to see how replies do without them.",
  },

  // ── summaries ────────────────────────────────────────────────────────────
  summarize: {
    tip: "Pick the cards; you read it before it's used",
    help: "Pick the cards to include, then read the summary before it's used. It's written from their texts as they are when it starts, and records exactly which. Once you use it, the model gets it instead of those cards and knows only what it kept — making each reply smaller, but losing whatever the summary left out. The cards themselves stay, so you can switch back.",
  },
  revise_summary: {
    tip: "A fresh draft, for you to review",
    help: "A fresh draft from the same cards, read as they are now (any deleted since are left out), takes this one's place — steered by your note, if you write one — and comes back for you to review before anything is sent differently.",
  },
  "revise_summary:again": {
    tip: "A new summary of the same cards, for review",
    help: "A new summary from the same cards, read as they are now (any deleted since are left out), comes back for you to review. This one stays as it is until you choose; using the new one replaces it (or sets it aside, if another summary was written from it).",
  },
  edit_summary: {
    tip: "Your own words, used as-is",
    help: "Replaces the generated text with your own. What you write is sent as-is in place of the cards it covers — the model never rewrites it. If the summary is in use, your edit takes effect from the next reply.",
  },
  set_summary_status: {
    tip: "The model gets it instead of its cards",
    help: "From the next reply on, the model gets this summary instead of the cards it was written from — whatever it left out, the model won't know. An older summary of the same cards is replaced (or only set aside, if another summary was written from it); one in use that stands in for some of the same messages (other than one this was written from) is set aside, to bring back if you like.",
  },
  "set_summary_status:inactive": {
    tip: "The model gets its cards again",
    help: "The model gets the cards it was written from again, as they are now. The summary stays here, unused, to bring back.",
  },
  "set_summary_status:discarded": {
    tip: "Can't be undone",
    help: "The summary goes; the cards it was written from stay as they are. If it's still being written, that's stopped. One that another summary was written from stays until that one goes. There's no Undo.",
  },

  // ── templates ────────────────────────────────────────────────────────────
  add_step: {
    tip: "Added at the end",
    help: "Added at the end. Runs already made keep their own copy of the steps.",
  },
  update_step: {
    tip: "Future runs only",
    help: "Changes future runs only: a run copies the steps when it starts, so one going or done keeps its own.",
  },
  remove_step: {
    tip: "Future runs only",
    help: "Runs already made keep their own copy of the steps.",
  },
  reorder_steps: {
    tip: "The order a run takes them in",
    help: "A run takes the steps in this order. Runs already made keep theirs.",
  },
  run_template: {
    tip: "A fresh thread, playing the steps in order",
    help: "Makes a fresh thread and plays the steps into it, waiting for each reply. Its steps, blanks and pins are fixed when it starts, so editing those mid-run won't change it — but library items are shared, so an edit to one reaches its later steps. Agent steps act on your computer, with this workspace's default agent permissions.",
  },

  // ── agent config ─────────────────────────────────────────────────────────
  set_agent_defaults: {
    tip: "For every agent in this workspace",
    help: "Sets the default system message and permission level for agents in this workspace — used when you dispatch and by template agent steps. You can override both on each dispatch. Running an agent again keeps whatever the original used.",
  },

  // ── runs ─────────────────────────────────────────────────────────────────
  dispatch_agent: {
    tip: "On your computer, with the permissions you choose",
    help: `${AGENT_HANDS} Its brief is your system message first, then the whole thread as a reply would get it — nothing is left out to fit — then your task at the end. The effort level you pick controls how much the agent thinks before acting (the --effort CLI flag). ${AGENT_LEFT_OUT} One agent works in a workspace's folder at a time, so it may wait for another to end.`,
  },
  agent_follow_up: {
    tip: "Carries on from a copy of its own session",
    help: `Carries on from the agent's own session, in a copy of it, so the original stays as it was: it remembers what it did, and gets what's been said in the thread after its card, then your message. Your pins and the library items sent with every reply aren't sent again, so changes to them don't reach it. The follow-up uses the workspace's current default permission and system message, not what the original agent had — so if the defaults changed since, the follow-up could be more or less permissive. ${SESSIONS} ${AGENT_HANDS}`,
  },
  cancel_run: {
    tip: "Stop it where it is",
    help: "A reply written for the first time keeps what it had written, marked as stopped, and later replies see it; one being written again keeps the text it had, and what was written goes in its history. One that hasn't started is just cancelled. A stopped agent keeps its steps but no result, and what it already did on your computer stays done. Stopping a step of a template run stops the whole run; stopping the template run itself also stops whatever step is currently going.",
  },
  mark_seen: {
    tip: "Seen in every browser",
    help: "What you've seen is kept on the server, so every browser agrees.",
  },
} satisfies { [K in ActionName]: Said } & Record<Key, Said>;

export type BehaviourKey = keyof typeof BEHAVIOUR;
