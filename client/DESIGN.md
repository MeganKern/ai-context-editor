# The Desk — interface design notes

These notes explain why the interface looks the way it does, so later changes keep the
reasoning. They cover the client; the last section says what it relies on from the server, and
why. What each action does is said once, in `shared/behaviour.ts` — the help cards and the
controls' tooltips take their words from there — so it isn't repeated here.

## What the person is doing, and how often

The Desk is a context editor: the model sees exactly what the thread shows, and the person
shapes it by hand. Weighting comes from how the work actually happens — rough numbers for
someone using it as their main thinking tool:

| Situation | How often | State of mind | What it needs |
|---|---|---|---|
| Reading a reply, writing the next message | every exchange (~300/week) | absorbed in the subject | the text, the box, two send buttons |
| Judging a reply | every exchange, seconds | quick verdict | the fixes in reach, quiet |
| Coming back to a thread | ~100/week | cold | the last exchange, what's pinned, what's new |
| Keeping several things in flight | dozens a day | split | which threads finished, failed or need a decision |
| Shaping what a thread knows before the next step | several a day | deliberate, hands-on | switch things off and on, reorder, edit in place, bring things in, move them between scopes |
| Diagnosing a surprise | ~10/week | investigative | what that reply saw, what's different now, the fix |
| Handing off to an agent | a few a day | cautious | what it gets, where, what it may do; what it changed |
| Templates, housekeeping, learning | rare / once | routine | — |

## Principles

1. **The right panel is where you work on the context, and it stays in view.** It isn't a
   summary of the thread; it's the controls for what the next reply gets. Beside a thread it
   holds, top to bottom (the order they're sent in): **Pinned** — this thread only: decisions
   and facts you don't want lost in the scroll; **In this thread** — the library items it uses,
   each in one place: with every reply, or with one message; and the **Library** — reference
   text shared across the workspace, to bring in. Every row has its switch, opens in place to read and edit,
   and can be dragged: to change the order, into another section, onto a message, or onto the
   message box. An item ends up where you drop it. The line between this thread's part and the
   library can be dragged. On a wide screen the panel is a permanent column; when three columns
   don't fit it's a drawer opened from the header.
2. **No statistics, no nudges.** No sizes, counts or shares of the context anywhere in everyday
   use. When the thread is more than the model can take, the panel states it ("Context limit
   reached") and nothing more: what to do about it is yours. The exact prompt is one click away
   for anyone who wants to dig in; it keeps its token estimate.
3. **Sent is unmarked; not sent has one look.** Dim, with a small "Not sent" label, for
   messages, summaries, items on messages and the originals behind a summary; in the panel the
   switch is the label (an empty box, the row dim). Dim means only that the model doesn't get
   it; an item has one place in a thread, so it's never sent from somewhere else instead.
   Excluded messages and summaries sit on one line until opened. The verbs are
   always Exclude / Include, as quiet actions everywhere; switches answer at once.
4. **Headers only when they carry news**: not sent, an agent or template wrote it, you edited
   what a model or agent wrote, time has passed, it's running, it was cut off. Every entry in the conversation is one
   block of one shade — your messages, replies, agents' results and summaries alike — with its
   header, items and notices inside and its buttons under it; the text is the same size and
   colour whoever wrote it. Who wrote it is a small tick at the block's top-left (you, the model,
   an agent: three hues of the same lightness), so no kind of entry outranks another. Not sent
   keeps the block's edge but not its fill. Notices have an edge and an icon.
5. **Buttons are grouped by what they affect**: rewrite (Edit, Regenerate, Follow up) · steer
   the model (Pin, Exclude) · just your view (Fold) · trace (Prompt / Brief, History). Every card is
   edited in place; branching is something you do on purpose (Branch from here).
   They appear on hover or focus, quietly in view on the latest reply. A focused message takes
   keys: E edit, R regenerate, P pin, X exclude/include, F fold, T trace,
   J/K or ↓/↑ to move. In the panel, a row's menu shows at the end of the row while it's
   hovered: names use the full width until then, and pinned text leaves room for it on its first
   line, so it never covers words; Alt ↑/↓ moves a row. A removal says what happened in a
   notice; nothing is undone from it.
6. **Colour is spent only where it means something.** Mint: the one commit in a form.
   Amber: a decision with consequences waits on you (a summary to accept, a context past the
   limit, unsaved typing). Coral: failed or destructive — a failure is the same coral band
   wherever it shows. Violet: an agent. Blue: what your next click or key applies to (keyboard
   focus, and Alt-click help). "Here it is" is a neutral glow.
7. **Things that change while you're away are surfaced where you'll look next.** The sidebar
   marks a thread only when there's something for you (failed, review waiting, new result,
   or a grey spinner while running). A closed folder carries them up: a dot in the colour of
   the most urgent thing inside, the spinner while something inside is working, and a ring when
   the thread you have open is inside. The spinner is the one mark for working or waiting its
   turn, wherever it shows, so a dot always means something needs you. Opening a thread with
   new results lands on "New since you were here".
8. **Provenance is kept, not tracked at you.** Every card keeps every text it has had (History
   on the card): who wrote each one and, for a run, the exact prompt it was sent, recorded when it
   started. A summary keeps the exact texts it was written from. Every change is logged on the
   server and text is never deleted — so the thread can shift freely without anything saying
   "changed since". The prompt viewer keeps the switches beside the prompt.
9. **Teach once; explain consequences at the moment of choice.** Hints show until used;
   explanations live in tooltips and empty states.

## Screens

| Element | Decision |
|---|---|
| Right panel (threads) | "Context" and Exact prompt; "Context limit reached" only when the thread is past the limit. **Pinned** · this thread only: a switch per item; click the text to edit it in place (Enter saves); drag to reorder; menu: Edit, Move up/down, Move to the library, Unpin. + Pin writes one. **In this thread** · from the library, each item in its one place: first those sent with every reply (switch, drag to reorder), then those that go with one message (switch on the row; Show the message; Send with every reply). Every row opens in place to read and edit the text; menu: rename, open in the editor, use a separate copy here when it's shared (a "copy" tag marks one), remove. Section menus: Include all / Exclude all. **Library** · shared across the workspace: everything the thread doesn't use; find by name or by text (searched on the server; matches inside show a snippet; matches already in the thread are named); Add; open in place to read and edit; menu: Add, Send with my next message, Rename, Open in the editor, Duplicate, Delete (confirmed in the row); + New names it, adds it here and opens it to write in place. |
| Dragging | An item ends up where you drop it, and only there. Pinned item → In this thread: becomes a library item, still sent here; → Library: becomes a library item, no longer sent here. Library item → In this thread (at a place in the order), → a message (with that message only), → the message box (with your next message). Item in this thread → a message: with that one instead; → In this thread: with every reply instead; → Library: no longer used here. Targets outline themselves and say what dropping does. |
| Right panel (no thread open) | The library on its own, with the same rows. |
| Templates | The right panel is the run form, with Past runs: each run (numbered by its place among all the template's runs, so a number never changes) with the branches taken from its thread nested under it, and any branch whose run's thread was deleted after them. The template page's "Every run starts with" uses the same Pinned and "From the library" sections (switches, order, edit in place, move a pin into the library). |
| Conversation | Messages, and summaries where their first card was: in use (a block), to review (a card), and not sent — excluded or overlapping — as one line with Include / Write it again / Discard. No sizes. The + between cards: Add a message here, or Branch from here. Under a card branches were taken at: ‹ n/N › and the name, to swap between them in place (in the thread and in each branch). |
| Message box | Two equal buttons with their keys. Library items going with this message show as chips above the buttons (× takes one off). Under it only the teach-once hint, or "A reply asked for now waits its turn". What you've typed is kept with the thread on the server, so a reload or another computer finds it. Agent mode lists what the agent gets, what's left out (CLAUDE.md files, the folder's project settings, Claude Code's memory), where it starts and with what permissions. |
| Pin on a message | Pin (this thread only) or Save to the library (named from its first line, used here too). |
| Header | Folder (or, on a template's page, the template), title, the thread menu (with Summarize…, and Branches… when the conversation has any; "Move the conversation to" when it has branches, since it moves whole). No branch controls here. The Context button appears only when the panel is a drawer; a dot marks it when the thread is past the limit. |
| Attention bar | Failures no card shows: a summary or naming attempt, or a reply written again that kept the one it had (Show it / Dismiss). |
| Sidebar | Threads and folders, with the status marks, drawn where the server places each thread: a branch nested under the thread it was taken from (or the nearest one still there), a template's runs and their branches on its page, everything else in its conversation's folder. The library moved to the right panel. |
| Prompt viewer | This reply / Next reply / Next agent, each in the same shape: a past run's is what it recorded when it started, with the model it went to. A card above still being written shows as a dashed placeholder with its text so far (the run waits for it). For an agent: what Claude Code adds, what it starts without, and its version. "What's sent now" groups Pinned, Library, Conversation. |
| History | Under a card, newest first: each text it has had, who wrote it (you, the model, the agent, or a copy and where from), whether it was finished, which one shows now, and the Prompt or Brief behind each one a run wrote. |

## Naming

"Notes" are called the **library** in the interface (the API still says notes). Items are
referred to by name; where a noun is unavoidable, "library item". The exact prompt still
reads "## Note: …" because the server writes that text. Pinned items are "directives" in the
API.

## What isn't shown, and why

- **Which model wrote each reply, on the card.** Each run records the model it was sent to by its
  full id, and the prompt viewer shows it ("Sent to …"). It's a fact for diagnosing a reply, not
  for reading one, so the card doesn't carry it.
- **An undo.** Nothing is undone from the app: removing something is put back by doing the
  opposite (pin it again, add it again), and deleting a message, a thread or a library item is
  final in the app. The record of what was there stays on the server, but nothing in the app
  reads it back — an undo that works for some things and not others would be worse than none.

## Legibility (round 6)

Judged from screenshots at the size they appear on screen, the quiet tier was too dim to use
without squinting: grey second lines, block edges and dividers, background bands for hover,
open and selected, and controls that aren't ready yet. The order of importance stays as it was —
titles, names and message text are still the brightest things — and every tier below them was
raised together so each is readable on its own:

- Secondary and tertiary text (`--text-2`, `--text-3`), raised surfaces (`--raised…`), lines
  (`--line`, `--line-2`), the panel's surface, and the edges of tick boxes, the ? button and
  dashed outlines are lighter. Your message's box, item chips, prompt blocks, step
  text and past-run cards are drawn by a surface you can see.
- Bands for a row you point at or have opened, a picked or lit-up stretch of messages, the
  branch you're on, and hovers in lists (the library picker, help results, What's sent now, the
  editor's name) are visible; plain buttons get a clearer hover.
- Controls that aren't ready yet (the send buttons before you type, disabled buttons and their
  keys) stay legible while reading as "not yet".
- Text fields show focus with a lighter edge and a soft blue ring (the message box, which has
  focus most of the time, only with a lighter edge); a focused message gets a blue ring like
  other controls.
- Specific fixes: Start agent keeps its dark ink on violet; the ? is centred in its circle and the
  sidebar keeps a strip at its foot so it never sits on a thread; a closed folder shows a spinner
  while a thread inside is working, and its "your open thread is in here" mark is a ring, distinct
  from the filled "something waiting" dot; pointing at a message shows the + to insert under it;
  a changed block in the exact prompt has a bright bar; drop targets cover what's under them;
  the library editor's name is in the title colour; editing or pinning a message scrolls the whole
  form into view. (Round 7 replaced the breathing dots that meant "working" with the spinner.)

## Visual weight (round 7)

Everything on screen plays one of a few roles, and each role has one look: what was said
(brightest; every entry its own block), names, needs you (colour), in what the model sees or not
(dim + "Not sent"), working (the spinner), actions (mint commit · outlined · quiet grey word ·
red destroy), notes (small grey), the app speaking (an edge and an icon, no fill) and places
(each its own ground). Round 7 removed the places where one role borrowed another's look, or
one role had two:

- Items on a message and in the message box are lines like the panel's rows; the branch
  switcher has an edge; notices under a reply, in the bar above the box, in the exact prompt
  and while a run writes a thread have an edge and an icon; a summary has the summary box from
  the moment it's being written.
- Items the model gets anyway aren't dimmed; an item that isn't sent has the "Not sent" label;
  an item going with your next message says so in a note, not a label.
- A closed folder's dot has the colour of the most urgent thing inside. The library sits on
  the sidebar's darker ground: both are places you pick from, apart from what's sent.
- Keep or throw away is always the question (amber when it's about unsaved typing), Keep
  outlined, then the red button on the right.
- Working or waiting its turn is the spinner everywhere: Starting…, Writing…, Queued, an agent's
  working…, Writing a summary, Running step N of M (the panel, the run's bar, the locked message
  box), a running past run, and Naming… beside a thread's title.
- One band for the row under the pointer, in every list; an opened row is a calmer band, so the
  pointer still shows over it. "Finished" and "stopped" are quiet notes; "failed" keeps its
  coral. Author labels ("Template") are quiet; "Agent" keeps violet.

## The conversation as blocks (round 8)

Everything in the thread is read the same way, so every entry is its own block, whoever wrote
it: your messages, replies, agents' results, summaries (in use, being written, to review), and
the one-line rows for folded and not-sent messages. Inside the block: its header (only when
there's news), library items, the agent's task and changes, the text, a failure. Under it: its
buttons. Every block is the same shade and the text the same size and colour: a difference in
lightness would read as a ranking, and there isn't one. Who wrote it is a 3×16px tick at the
block's top-left — muted blue for you, warm grey for the model (replies and summaries), violet
for an agent — at the same lightness, noticed only when looked for. Template steps (your words,
replayed) carry yours. A not-sent block keeps its edge and loses its fill. The exact prompt
follows suit: every block one shade, the tick saying whose words they are.

## Editing, branching, summaries (round 8)

- **Edit in place, everywhere.** Every card — your message, a reply, an agent's result — has
  Edit, and it saves over the card; the text it had goes in its history. On your message, "Save
  and get a new reply" saves and writes the reply under it again in one step; at the end of the
  thread it's "Save and get a reply". A card can't be edited while it's being written.
- **Regenerate and Try again write into the same card**: from everything above it as it is now;
  the messages below stay. A reply written again keeps its text until the new one is finished; if
  it doesn't finish, the card keeps the reply it had (what was written goes in its history), and
  the failure waits in the bar above the box ("The reply is kept as it was", Show it / Dismiss).
  An agent's card always shows its latest attempt, because what it did happened either way.
- **A thread is a list of cards.** A card's earlier texts are its history, not alternatives to
  switch between. Adding at the end, or after a card, moves nothing below and redoes nothing.
- **Branching is on purpose.** "Branch from here" (the + between cards, or More on a card) makes
  a thread of its own (`branch_thread`): everything up to and including that card, with the
  pins, library items and their switches as they are, and summaries whose cards were all copied.
  It opens at once. On the server each copied card records the card it came from, and the branch
  records where it was taken.
- **Branches are swapped where they split.** Under the card a branch was taken at — in the thread
  and in each branch, under its copy of that card — sits ‹ n/N › and the current one's name (the
  thread first, then its branches taken there, oldest first. ‹ › opens the next one with that point
  kept where it was on screen; each is a thread of its own, so anything in it may have been edited
  since it was taken. The name opens the list. There are no branch controls at the top. The whole family — every
  branch, as a tree, with the words of the card each was taken at — is tucked in the thread's ⋯
  menu (Branches…, shown only when there are branches). In the sidebar a branch is nested under
  its thread with an outline elbow.
- **No borrowed version-control symbols.** No branch or fork glyphs anywhere (they're loaded, and
  mean nothing to most people): "Branch from here" and "Branches…" are words; the sidebar's
  elbow is the ordinary outline mark.
- **Summaries cover the cards you pick** (`summarize` with a list of cards). In picking mode
  (Summarize… in the thread menu or a card's More), any card you can see can be picked one by one,
  in any order — messages, replies, agents' results, not-sent ones, and summaries in use. The
  summary is written from exactly those, as they read when its run starts, in the order they
  appear (a picked summary contributes its own text), and sits where the first of them was. It
  stays in use until you exclude or discard it: nothing marks it out of date. Using a summary sets
  aside any other in use that stands in for some of the same messages (not the ones it was
  written from). A summary another one was written from can't be discarded while that one is
  there (it's set aside instead of replaced, too), so no summary is left pointing at nothing.
  "Show what it's from" shows the exact texts its run recorded, library items with their messages
  included. "Write it again" makes a new one from the same cards for review, leaving out any
  deleted since.
- **Removed: "changed since" tracking.** No "Context changed since" under replies, no
  differences banner or "different now" marks in the exact prompt, no "they changed since it
  was written" on summaries. The prompt viewer shows what each reply was sent.
- **The limit is a statement.** The panel says "Context limit reached" when the (calibrated)
  estimate is past what the model can take, and nothing before; no advice, no Summarize button.
  An agent's brief is the whole thread, as a reply gets it; nothing is left out to fit.

## What the client relies on from the server, and why

What each action does is in `shared/behaviour.ts`; these are the rules behind them.

- **One intent, one action.** Every control is one server action, run as one transaction and
  recorded as one change set, so nothing is ever half done and the client never strings actions
  together (sending with library items, saving and getting a new reply, moving an item to a
  message are each one action).
- **A card's texts are never overwritten.** Each text is a revision of the card that can't be
  changed afterwards, saying who made it (you, a run, or a copy) and whether it was finished.
  A run's prompt, and a list of exactly which texts went into it, are recorded in the transaction
  that starts it, before anything is sent — so "what did this reply see?" is a lookup that
  survives a crash, and a summary's sources are the texts its run recorded, not today's.
- **A run starts only when what's above it is written.** A card waits while a card above it is
  being written (`queue.reason` "waiting"), checked again each time it's about to start, because
  it's written from everything above. A preview shows such a card as a placeholder for the same
  reason. Four model calls and two agents run at once ("capacity").
- **An agent's brief is the whole instruction.** Claude Code is started reading only your user
  settings — CLAUDE.md files, the workspace folder's project settings and its own memory are
  switched off — so what the agent gets is what the brief shows, plus what can't be shown:
  Claude Code's built-in instructions and whatever your own setup has (`AGENT_EXTRAS` in
  `shared/agent.ts`: hooks, skills, commands and agents in ~/.claude; MCP servers). One agent
  works in a workspace's folder at a time, so what changed there belongs to one run: the folder is
  scanned before it starts and after it ends. If the server stops suddenly while it runs, there's
  no after: restart recovery ends the run, and its card says what it changed wasn't recorded
  rather than "no files". Its steps are read from Claude Code's own output, kept as it came.
- **An agent's card keeps the run it stands for** (`AGENT_RUN_OF_CARD` in
  `server/src/domain/cards.ts`): its latest attempt, or for a copy the original's run. Editing its
  result changes its text only — what it changed, its steps and Follow up stay. Regenerate, Follow
  up and the card read the same definition.
- **A library item has one place in a thread** — with every reply, or with one message — so
  "is it sent?" has one answer, and putting it somewhere moves it there.
- **Where a thread is listed is decided on the server**, once (`place`): a conversation (a thread
  and every branch taken from it) lives in one folder, held by the thread it started from; a
  template's runs and their branches live on its page. Moving a thread moves its conversation.
- **What's only about your view is kept apart from the record**: folding a card and what you've
  seen are kept on the server (so every browser agrees), and so is what you've typed (so a reload
  or another computer finds it — though two browsers typing in one thread at once each keep their
  own) — but none of it as changes to the thread.
- **Seen is on the server, per run.** The thread snapshot lists the finished runs it shows that
  you haven't seen (`unseen_run_ids`); while the page is visible the client reports them with
  `mark_seen`. "New since you were here" goes before the first card among them, decided when the
  thread opens. Failures no card shows come as `attention` items and stay until dismissed.
- **The sidebar's marks come with the workspace** (`threads[].flags`), so the workspace is read
  again on every change event (reads that pile up while one is in flight become one). A
  template's flags cover everything on its page.
- **Search is on the server**: messages by what each card shows now (`GET /api/search`), and the
  library by name and text as typed (`GET /api/notes/search`). A text several cards show — a card
  and its copies in branches — is one result, at its earliest thread, with the others listed under
  it to pick from. An item's text is read when it's
  opened, and again whenever the workspace reports a new `content_hash` for it.
- **One server at a time.** A second server against the same database refuses to start, and a
  starting server answers "starting" until it has recovered what the last one left (a run that
  was going is marked interrupted, keeping what it had written).
- **Errors are worded by the server.** The card shows the run's own error; the client only turns
  the model proxy's HTTP status into a plain sentence.
- **Unchanged from earlier rounds:** switches show the new state at once and follow the server;
  a new order shows straight away; text written in place is kept per item until saved or
  discarded (discarding changed text asks first); keys on a focused message (E R P X F T,
  J / K); excluded messages collapse to one line; Run template is offered only when `validate` in
  shared/template-vars passes; Get reply only on a message that is sent.
