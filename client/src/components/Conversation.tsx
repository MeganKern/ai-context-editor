import { useRef, useEffect, useState, Fragment } from "react";
import { useStore } from "../store.js";
import { buildMessageViews, groupMessages, liveText } from "../view-model.js";
import type { SummaryView, SummarySource } from "../../../shared/snapshot.js";
import { read } from "../api.js";
import { Message } from "./Message.js";
import { Icon } from "./Icon.js";
import { Menu, type MenuItem } from "./Menu.js";
import { Md } from "./Markdown.js";
import { BranchPoint } from "./Branches.js";

/**
 * The messages, in the order they're sent (what's pinned and the library items in use go
 * before them, and are managed in the right panel). Summaries live here too, where they'd go.
 * Anything not sent has one look — dim, labelled "Not sent" — and excluded messages and
 * summaries sit on one line until opened. Sent things carry no mark.
 */
export function Conversation() {
  const thread = useStore(s => s.thread);
  const live = useStore(s => s.live);
  const ui = useStore(s => s.ui);
  const setUi = useStore(s => s.setUi);
  const run = useStore(s => s.run);
  const ws = useStore(s => s.ws);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevLen = useRef(0);
  const prevId = useRef<string | undefined>(undefined);
  const stick = useRef(true);
  const hideExcluded = ui.hideExcluded;
  // Excluded messages you've opened to read, this visit only.
  const [opened, setOpened] = useState<{ threadId: string | undefined; ids: Set<string> }>({ threadId: undefined, ids: new Set() });
  const openIds = opened.threadId === thread?.thread.id ? opened.ids : new Set<string>();
  const setOpen = (id: string, open: boolean) => {
    const next = new Set(openIds);
    if (open) next.add(id); else next.delete(id);
    setOpened({ threadId: thread?.thread.id, ids: next });
  };

  const newSinceId = ui.newSince && ui.newSince.threadId === thread?.thread.id ? ui.newSince.messageId : null;

  // Open at the end — or at "New since you were here" when something finished while you were away.
  useEffect(() => {
    const changed = thread?.thread.id !== prevId.current;
    const added = (thread?.messages.length ?? 0) > prevLen.current;
    prevLen.current = thread?.messages.length ?? 0;
    prevId.current = thread?.thread.id;
    if (!scrollRef.current || ui.focus || ui.anchor || !(changed || added)) return;
    const divider = changed && newSinceId ? document.getElementById("new-since") : null;
    if (divider) {
      divider.scrollIntoView({ block: "start" });
      stick.current = false;
    } else {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      stick.current = true;
    }
  }, [thread?.messages.length, thread?.thread.id]);

  // Swapped here from another branch: put the branch point back where it was on screen, so only
  // what follows it changes.
  useEffect(() => {
    if (!ui.anchor || !thread || !scrollRef.current) return;
    const el = scrollRef.current.querySelector<HTMLElement>(`[data-branch-point="${CSS.escape(ui.anchor.key)}"]`);
    if (el) {
      const box = scrollRef.current;
      box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - ui.anchor.top;
      stick.current = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    } else {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      stick.current = true;
    }
    setUi({ anchor: null });
  }, [ui.anchor, thread, setUi]);

  // Follow a streaming reply while the reader is at the bottom; stop once they scroll up.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [live]);

  // Search results and "show it" links focus a message (or the summary standing in for it).
  useEffect(() => {
    if (!ui.focus || !thread) return;
    const target = thread.messages.find(m => m.id === ui.focus);
    if (!target) { setUi({ focus: null }); return; }
    const el = document.getElementById(`msg-${ui.focus}`)
      ?? (target.summary_id ? document.getElementById(`summary-${target.summary_id}`) : null);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("is-flash");
      setTimeout(() => el.classList.remove("is-flash"), 1600);
    }
    setUi({ focus: null });
  }, [ui.focus, thread?.messages]);

  // When the message box grows (agent mode, long drafts) keep the latest message in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => { if (stick.current) el.scrollTop = el.scrollHeight; });
    ro.observe(el);
    return () => ro.disconnect();
  }, [thread?.thread.id]);

  if (!thread) return null;

  const views = buildMessageViews(thread, live);
  const byId = new Map(views.map(m => [m.item.id, m]));
  const path = thread.messages;
  const ids = path.map(m => m.id);
  const groups = groupMessages(path, thread.summaries);

  // The last reply keeps its buttons quietly in view; that's where the next step is decided.
  const latest = new Set<string>();
  const lastItem = path[path.length - 1];
  if (lastItem) latest.add(lastItem.id);

  // Summaries being written or waiting for review sit where they'd go: before the first card they
  // stand in for. So do summaries that aren't sent (set aside, or overlapping one in use), as one
  // line each: the conversation is the one place summaries are managed.
  const reviewAt = new Map<string, SummaryView[]>();
  const idleAt = new Map<string, SummaryView[]>();
  const inReview = new Set<string>();
  const END = "__end__";
  const spotsDrawn = new Set<string>();
  for (const s of thread.summaries) {
    if (s.status === "discarded" || s.applied || s.not_sent === "inside") continue;
    const at = s.anchor_id ?? END;
    if (s.status === "review" || s.status === "drafting") {
      reviewAt.set(at, [...(reviewAt.get(at) ?? []), s]);
      for (const id of s.message_ids) inReview.add(id);
    } else {
      idleAt.set(at, [...(idleAt.get(at) ?? []), s]);
    }
  }

  // Picking cards to summarize: any card you can see — a message, a reply, an agent's result, or a
  // summary in use — one click each, in any order; they're summarized in the order they appear.
  const sel = ui.selection;
  const selecting = sel !== null;
  const picked = new Set(sel?.picked ?? []);
  const toggle = (key: string) => {
    if (!sel) return;
    setUi({ selection: { picked: picked.has(key) ? sel.picked.filter(k => k !== key) : [...sel.picked, key] } });
  };
  const rangeSet = (a: string | null | undefined, b: string | null | undefined) => {
    const set = new Set<string>();
    if (!a) return set;
    const ai = ids.indexOf(a);
    const bi = b ? ids.indexOf(b) : ai;
    if (ai < 0 || bi < 0) return set;
    for (let i = Math.min(ai, bi); i <= Math.max(ai, bi); i++) set.add(ids[i]);
    return set;
  };
  const highlighted = ui.highlight ? rangeSet(ui.highlight.first, ui.highlight.last) : new Set<string>();
  // Branch points: under a card branches were taken at, the conversation carries on differently in
  // each — this thread first, then the branches in the order they were made. In a branch, the same
  // choice sits under its copy of the card it was taken at.
  const threads = ws?.threads ?? [];
  const byCreated = (a: { created_at: string }, b: { created_at: string }) => a.created_at.localeCompare(b.created_at);
  const self = threads.find(x => x.id === thread.thread.id);
  const pointsHere = new Map<string, { key: string; choices: typeof threads }>();
  if (self) {
    for (const m of path) {
      const taken = threads.filter(x => x.branch_of === self.id && x.branch_at === m.id).sort(byCreated);
      if (taken.length) pointsHere.set(m.id, { key: m.id, choices: [self, ...taken] });
    }
    const from = thread.branched_from;
    const origin = self.branch_of ? threads.find(x => x.id === self.branch_of) : undefined;
    if (from?.here_id && origin && self.branch_at) {
      const siblings = threads.filter(x => x.branch_of === origin.id && x.branch_at === self.branch_at).sort(byCreated);
      const own = pointsHere.get(from.here_id);
      const choices = [origin, ...siblings];
      // Branches of this branch taken at the same card join the same choice.
      if (own) for (const c of own.choices) if (!choices.some(x => x.id === c.id)) choices.push(c);
      pointsHere.set(from.here_id, { key: self.branch_at, choices });
    }
  }

  const branchFrom = async (messageId: string) => {
    const r = await run("branch_thread", { message_id: messageId });
    if (r) {
      useStore.getState().toast("Branched — this is its own thread now, with its own context.");
      void useStore.getState().openThread(r.thread_id);
    }
  };
  // Only a message that is sent can be replied to; an excluded one would leave nothing to answer.
  const awaitingReply = !!lastItem && lastItem.role === "user" && lastItem.status === "done"
    && lastItem.context === "sent" && !lastItem.excluded;

  return (
    <div
      className={`convo ${selecting ? "is-selecting" : ""}`}
      ref={scrollRef}
      onScroll={e => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
    >
      {selecting && <SelectionBar />}

      <div className="convo-inner">
        {path.length === 0 && (
          <div className="convo-empty">
            <p className="convo-empty-title">Write the first message below.</p>
          </div>
        )}

        {groups.map((g, gi) => {
          // What sits before this group: summaries waiting at its spot, and "new since". A summary in
          // use can sit before a message that isn't its own (its first card deleted), so each spot
          // is drawn once, before whichever comes first. (A summary's anchor is usually its own first
          // card, so the same id can be listed twice here: count it once.)
          const groupIds = [...new Set(g.kind === "summary" ? [g.summary.anchor_id ?? END, ...g.items.map(i => i.id)] : [g.item.id])]
            .filter(id => !spotsDrawn.has(id));
          groupIds.forEach(id => spotsDrawn.add(id));
          const reviews = groupIds.flatMap(id => reviewAt.get(id) ?? []);
          const idle = groupIds.flatMap(id => idleAt.get(id) ?? []);
          const before = (
            <>
              {newSinceId && groupIds.includes(newSinceId) && (
                <div className="new-since" id="new-since" role="separator"><span>New since you were here</span></div>
              )}
              {idle.map(s => <SummaryLine key={`i-${s.id}`} summary={s} />)}
              {reviews.map(s => <SummaryReview key={`r-${s.id}`} summary={s} />)}
            </>
          );

          if (g.kind === "summary") {
            const key = `s:${g.summary.id}`;
            return (
              <Fragment key={`s-${g.summary.id}`}>
                {before}
                <SummaryBlock summary={g.summary} highlighted={g.items.some(i => highlighted.has(i.id))}
                  picked={picked.has(key)} onPick={selecting ? () => toggle(key) : undefined} />
              </Fragment>
            );
          }
          const item = g.item;
          const mv = byId.get(item.id);
          if (!mv) return null;
          const itemNotSent = item.excluded || item.context === "excluded";
          if (hideExcluded && itemNotSent) return null;
          const idx = ids.indexOf(item.id);
          const next = path[idx + 1];
          // Times only where time has passed: the first message, then gaps of 10+ minutes.
          const prev = path[idx - 1];
          const gap = prev ? new Date(item.created_at).getTime() - new Date(prev.created_at).getTime() : Infinity;
          const showTime = !prev || gap > 10 * 60_000 || new Date(item.created_at).toDateString() !== new Date(prev.created_at).toDateString();
          const isLastGroup = gi === groups.length - 1;
          const rangeEdges = (set: Set<string>) => set.has(item.id)
            ? `${set.has(ids[idx - 1]) ? "" : "is-range-start"} ${set.has(ids[idx + 1]) ? "" : "is-range-end"}` : "";
          const canInsert = !isLastGroup;
          const isPicked = picked.has(item.id);
          const pickable = selecting && item.status !== "writing" && !!item.content.trim();
          const notSent = item.excluded || item.context === "excluded";
          const collapsed = item.folded || (notSent && !openIds.has(item.id));
          return (
            <Fragment key={item.id}>
              {before}
              <div
                id={`msg-${item.id}`}
                className={[
                  "turn", `turn-${item.role}`, collapsed ? "is-row" : "",
                  isPicked ? "is-selected is-range-start is-range-end" : "", pickable ? "is-pickable" : "", highlighted.has(item.id) ? "is-highlighted" : "",
                  inReview.has(item.id) ? "is-in-review" : "",
                  isPicked ? "" : rangeEdges(highlighted),
                ].join(" ")}
                onClickCapture={e => { if (selecting) { e.preventDefault(); e.stopPropagation(); if (pickable) toggle(item.id); } }}
              >
                <Message mv={mv} isLatest={latest.has(item.id)} next={next} showTime={showTime}
                  expanded={openIds.has(item.id)} setExpanded={open => setOpen(item.id, open)}
                  inReview={inReview.has(item.id)} />
              </div>
              {pointsHere.has(item.id) && (
                <BranchPoint pointKey={pointsHere.get(item.id)!.key} choices={pointsHere.get(item.id)!.choices} current={thread.thread.id} />
              )}
              {ui.insertAfter === item.id ? (
                <InsertForm afterId={item.id} />
              ) : canInsert && !selecting ? (
                <div className="gap">
                  <Menu label="Add a message or branch here" className="gap-btn" icon="plus" align="start"
                    title="Add a message here, or branch from here"
                    items={[
                      { label: "Add a message here", icon: "insert", hint: "The messages below stay where they are", onSelect: () => setUi({ insertAfter: item.id }) },
                      { label: "Branch from here", hint: "A thread of its own with everything up to here", onSelect: () => branchFrom(item.id) },
                    ]} />
                </div>
              ) : null}
            </Fragment>
          );
        })}

        {!spotsDrawn.has(END) && (idleAt.get(END) ?? []).map(s => <SummaryLine key={`i-${s.id}`} summary={s} />)}
        {!spotsDrawn.has(END) && (reviewAt.get(END) ?? []).map(s => <SummaryReview key={`r-${s.id}`} summary={s} />)}

        {awaitingReply && (
          <div className="turn awaiting" title="The model hasn't seen this message yet">
            <span>No reply asked for</span>
            <button className="btn btn-sm" onClick={() => run("request_reply", { message_id: lastItem.id })}>Get reply</button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The exact texts a summary was written from, as its run recorded them when it started — not the
 * cards as they are now (a summary stands in for its cards, whatever is done to them after).
 */
function SummarySourceList({ summary }: { summary: SummaryView }) {
  const thread = useStore(s => s.thread);
  const [source, setSource] = useState<SummarySource | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    read.summarySource(summary.id).then(r => { if (live) setSource(r); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [summary.id, summary.written_by]);
  const here = new Set(thread?.messages.map(m => m.id) ?? []);
  return (
    <div className="summary-originals is-notsent">
      <p className="notsent-note"><span className="notsent-label">Not sent</span> It was written from these texts, exactly as they were then; it's sent in place of their cards.</p>
      {failed && <p className="summary-original-gone">Couldn't read them just now.</p>}
      {!source && !failed && <p className="msg-waiting"><span className="spinner is-inline" aria-hidden />Reading them…</p>}
      {source?.parts.map((p, i) => p.kind === "summary" ? (
        <div key={`s${i}`} className="summary-original is-summary">
          <span className="msg-row-author">A summary in use then</span>
          <div className="msg-body is-output"><Md text={p.text} /></div>
        </div>
      ) : p.kind === "item" ? (
        <div key={`n${i}`} className="summary-original is-item">
          <span className="msg-row-author">Library item “{p.name}”, with the message above</span>
          <div className="msg-body is-output"><Md text={p.text} /></div>
        </div>
      ) : (
        <div key={`c${i}`} id={here.has(p.card_id) ? `msg-${p.card_id}` : undefined} className={`summary-original msg-${p.role}`}>
          <span className="msg-row-author">{p.role === "user" ? "You" : p.role === "agent" ? "Agent" : "Model"}</span>
          <div className="msg-body is-output"><Md text={p.text} /></div>
        </div>
      ))}
      {source && source.parts.length === 0 && <p className="summary-original-gone">Its run kept no record of them.</p>}
    </div>
  );
}

/** A summary in use, sent in place of the cards it stands in for — they aren't sent. */
function SummaryBlock({ summary, highlighted, picked, onPick }: {
  summary: SummaryView;
  highlighted: boolean;
  picked: boolean;
  onPick?: () => void;
}) {
  const run = useStore(s => s.run);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const isSource = useIsSourceOfAnother(summary.id);
  const n = summary.message_ids.length;
  const gone = summary.cards.filter(c => c.deleted).length;
  return (
    <section className={`turn summary-turn ${highlighted ? "is-highlighted" : ""} ${picked ? "is-selected is-range-start is-range-end" : ""} ${onPick ? "is-pickable" : ""}`}
      id={`summary-${summary.id}`} aria-label="Summary in use"
      onClickCapture={onPick ? e => { e.preventDefault(); e.stopPropagation(); onPick(); } : undefined}>
      <div className="summary-block">
        <header className="summary-head">
          <span className="summary-title"><Icon name="summary" /> Summary of {n} message{n === 1 ? "" : "s"}</span>
          <span className="summary-sub">sent instead of them{gone ? ` · ${gone} deleted since` : ""}</span>
          <span className="spacer" />
          <button className="act" aria-expanded={open} onClick={() => setOpen(!open)}>
            <Icon name={open ? "chevronDown" : "chevronRight"} /> {open ? "Hide what it's from" : "Show what it's from"}
          </button>
          <Menu label="Summary actions" className="act act-more" icon="more" items={[
            { label: "Edit", icon: "edit", onSelect: () => setEditing(true) },
            { label: "Write it again", icon: "regenerate", hint: "From the same cards; you review it first", onSelect: () => run("revise_summary", { summary_id: summary.id }) },
            { label: "Exclude — send its cards instead", icon: "eyeOff", onSelect: () => run("set_summary_status", { summary_id: summary.id, status: "inactive" }) },
            { label: "Discard summary", icon: "trash", danger: true, disabled: isSource,
              hint: isSource ? "Another summary was written from it" : "Its cards are sent again",
              onSelect: () => run("set_summary_status", { summary_id: summary.id, status: "discarded" }) },
          ]} />
        </header>
        {editing
          ? <SummaryEdit summary={summary} onDone={() => setEditing(false)} />
          : summary.content && <div className="summary-body msg-body is-output"><Md text={summary.content} /></div>}
        {open && <SummarySourceList summary={summary} />}
      </div>
    </section>
  );
}

function SummaryEdit({ summary, onDone }: { summary: SummaryView; onDone: () => void }) {
  const run = useStore(s => s.run);
  const [text, setText] = useState(summary.content ?? "");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const save = async () => {
    if (!text.trim()) return;
    await run("edit_summary", { summary_id: summary.id, content: text.trim() });
    onDone();
  };
  return (
    <div className="summary-edit">
      <textarea ref={ref} value={text} onChange={e => setText(e.target.value)} rows={4}
        onKeyDown={e => { if (e.key === "Escape") onDone(); if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save(); }} />
      <div className="summary-edit-actions">
        <button className="btn btn-primary btn-sm" onClick={save} disabled={!text.trim()}>Save</button>
        <button className="btn btn-ghost btn-sm" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}

/** Another summary was written from this one, so it stays until that one goes (the server refuses too). */
function useIsSourceOfAnother(summaryId: string): boolean {
  return useStore(s => !!s.thread?.summaries.some(o => o.id !== summaryId && o.cards.some(c => c.summary_id === summaryId)));
}

/**
 * A summary on this path that isn't sent — set aside, or overlapping one in use — as one line
 * where it would go. Open it to read it.
 */
function SummaryLine({ summary }: { summary: SummaryView }) {
  const run = useStore(s => s.run);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const isSource = useIsSourceOfAnother(summary.id);
  const count = summary.message_ids.length;
  const set = (status: "active" | "inactive" | "discarded") => run("set_summary_status", { summary_id: summary.id, status });
  const why = summary.not_sent === "overlaps" ? "another summary in use stands in for some of the same messages"
    : "excluded — its cards are sent instead";

  const more: MenuItem[] = [];
  more.push({ label: "Edit", icon: "edit", onSelect: () => { setOpen(true); setEditing(true); } });
  more.push({ label: "Write it again", icon: "regenerate", hint: "From the same cards; you review it first", onSelect: () => run("revise_summary", { summary_id: summary.id }) });
  if (summary.status === "active") more.push({ label: "Exclude", icon: "eyeOff", hint: "Keep it, unused", onSelect: () => set("inactive") });
  more.push({ label: "Discard summary", icon: "trash", danger: true, disabled: isSource,
              hint: isSource ? "Another summary was written from it" : undefined, onSelect: () => set("discarded") });

  return (
    <section className="turn summary-line is-notsent" id={`summary-${summary.id}`} aria-label="Summary not sent">
      <div className="summary-line-row">
        <button className="summary-line-btn" onClick={() => setOpen(!open)} aria-expanded={open} title={open ? "Hide it" : "Read it"}>
          <Icon name="summary" />
          <span className="summary-line-title">Summary of {count} message{count === 1 ? "" : "s"}</span>
          <span className="notsent-label">Not sent</span>
          <span className="summary-line-why">{why}</span>
          <Icon name={open ? "chevronDown" : "chevronRight"} className="summary-line-caret" />
        </button>
        <button className="act act-include" onClick={() => set("active")}
          title={summary.not_sent === "overlaps" ? "Use this one instead: the other is set aside" : "Send the summary in place of its cards"}>Include</button>
        <Menu label="Summary actions" className="act act-more" icon="more" items={more} />
      </div>
      {open && (editing
        ? <SummaryEdit summary={summary} onDone={() => setEditing(false)} />
        : summary.content && <div className="summary-line-body msg-body is-output"><Md text={summary.content} /></div>)}
    </section>
  );
}

/**
 * A summary you asked for, waiting for your decision, placed where it would go. It isn't
 * used until you accept it — this is the one place the decision is asked for.
 */
function SummaryReview({ summary }: { summary: SummaryView }) {
  const live = useStore(s => s.live);
  const run = useStore(s => s.run);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const count = summary.message_ids.length;
  const drafting = summary.status === "drafting";
  const text = drafting && summary.run_id ? liveText(live, summary.run_id) : summary.content;
  const empty = !drafting && !summary.content;
  const set = (status: "active" | "inactive" | "discarded") => run("set_summary_status", { summary_id: summary.id, status });
  const sendFeedback = () => {
    if (!feedback?.trim()) return;
    void run("revise_summary", { summary_id: summary.id, feedback: feedback.trim() });
    setFeedback(null);
  };

  return (
    <section className={`summary-review ${drafting ? "is-drafting" : "is-review"}`} id={`summary-card-${summary.id}`} aria-label="Summary to review">
      <header className="summary-review-head">
        <span className="summary-review-title">
          {drafting ? <><span className="spinner is-inline" aria-hidden />Writing a summary</> : "Summary to review"}
        </span>
        <span className="summary-review-sub">
          of {summary.cards.length} card{summary.cards.length === 1 ? "" : "s"} below ({count} message{count === 1 ? "" : "s"})
        </span>
      </header>
      {editing
        ? <SummaryEdit summary={summary} onDone={() => setEditing(false)} />
        : text && <div className={`summary-review-text msg-body is-output ${drafting ? "is-streaming" : ""}`}><Md text={text} /></div>}
      {!drafting && !editing && summary.cut_off && (
        <p className="summary-review-note">
          {empty ? "Copied while it was being written, before it had any text. Write it again to have one to use."
            : "Copied while it was being written: this is what it had then."}
        </p>
      )}
      {feedback !== null && !editing && (
        <div className="summary-feedback">
          <input autoFocus value={feedback} onChange={e => setFeedback(e.target.value)} aria-label="What should change"
            placeholder="What should change? e.g. keep the exact numbers"
            onKeyDown={e => { if (e.key === "Enter") sendFeedback(); if (e.key === "Escape") setFeedback(null); }} />
          <button className="btn btn-sm" onClick={sendFeedback} disabled={!feedback.trim()}>Revise</button>
        </div>
      )}
      <div className="summary-review-actions">
        {drafting ? (
          <button className="btn btn-ghost btn-sm" onClick={() => set("discarded")}>Cancel</button>
        ) : empty ? (
          <>
            <button className="btn btn-primary btn-sm" onClick={() => run("revise_summary", { summary_id: summary.id })}><Icon name="regenerate" /> Write it again</button>
            <button className="btn btn-ghost btn-sm" onClick={() => set("discarded")}>Discard</button>
          </>
        ) : (
          <>
            <button className="btn btn-primary btn-sm" onClick={() => set("active")}><Icon name="check" /> Use this summary</button>
            <button className="btn btn-sm" onClick={() => setEditing(true)}>Edit</button>
            <button className="btn btn-sm" onClick={() => setFeedback(feedback === null ? "" : null)}>Revise…</button>
            <Menu label="More summary actions" className="act act-more" icon="more" items={[
              { label: "Write it again from scratch", icon: "regenerate", onSelect: () => run("revise_summary", { summary_id: summary.id }) },
              { label: "Discard", icon: "trash", danger: true, onSelect: () => set("discarded") },
            ]} />
          </>
        )}
      </div>
    </section>
  );
}

function InsertForm({ afterId }: { afterId: string }) {
  const thread = useStore(s => s.thread);
  const run = useStore(s => s.run);
  const setUi = useStore(s => s.setUi);
  const [text, setText] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, []);
  if (!thread) return null;
  const close = () => setUi({ insertAfter: null });
  const go = async (mode: "insert" | "insert_reply") => {
    if (!text.trim()) return;
    const r = await run("insert_message", { thread_id: thread.thread.id, after_message_id: afterId, content: text.trim(), reply: mode === "insert_reply" });
    if (r) close();
  };
  return (
    <div className="turn ctx-insert" ref={ref}>
      <div className="inline-form insert-form">
        <label className="inline-form-label" htmlFor={`ins-${afterId}`}>Add a message here</label>
        <textarea id={`ins-${afterId}`} autoFocus rows={3} value={text} placeholder="Type the message to add…"
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === "Escape") close(); }} />
        <div className="inline-form-actions">
          <button className="btn btn-primary btn-sm" disabled={!text.trim()} onClick={() => go("insert")}
            title="Adds it here. Messages below stay where they are; their replies aren't redone.">Insert</button>
          <button className="btn btn-sm" disabled={!text.trim()} onClick={() => go("insert_reply")}
            title="Adds it here and the model replies to it right here, from what's above it. Messages below stay; their replies aren't redone.">Insert and get reply</button>
          <button className="btn btn-ghost btn-sm" onClick={close}>Cancel</button>
        </div>
        <p className="inline-form-help">
          Everything below stays where it is, and later replies aren't rewritten. To go a different way from here instead, branch from here: the + between messages, or More on a message.
        </p>
      </div>
    </div>
  );
}

function SelectionBar() {
  const ui = useStore(s => s.ui);
  const setUi = useStore(s => s.setUi);
  const run = useStore(s => s.run);
  const picked = ui.selection?.picked ?? [];
  const cards = picked.map(k => k.startsWith("s:") ? { summary_id: k.slice(2) } : { message_id: k });
  const n = picked.length;
  return (
    <div className="selection-bar" role="status">
      <div className="selection-row">
        <span className="selection-step">Summarize</span>
        <span className="selection-text">
          {n === 0 ? "Click each card to include — messages, replies, results or summaries, in any order."
            : `${n} card${n === 1 ? "" : "s"} picked. Click more, or click one again to leave it out. You'll read the summary before it's used.`}
        </span>
        <span className="spacer" />
        {n > 0 && (
          <button className="btn btn-primary btn-sm" onClick={async () => {
            const r = await run("summarize", { cards });
            if (r) setUi({ selection: null });
          }}><Icon name="summary" /> Write summary</button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={() => setUi({ selection: null })}>Cancel</button>
      </div>
    </div>
  );
}

