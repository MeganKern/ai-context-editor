import { useRef, useEffect, useState, Fragment } from "react";
import { useStore } from "../store.js";
import { buildMessageViews, groupMessages } from "../view-model.js";
import { SUMMARY_INSTRUCTIONS } from "../../../shared/summary.js";
import { Message } from "./Message.js";
import { Icon } from "./Icon.js";
import { Menu } from "./Menu.js";
import { BranchPoint } from "./Branches.js";
import { SummaryBlock, SummaryLine, SummaryReview } from "./Summaries.js";
import { useConvoScroll } from "./useConvoScroll.js";
import type { SummaryView } from "../../../shared/snapshot.js";

export function Conversation() {
  const thread = useStore(s => s.thread);
  const live = useStore(s => s.live);
  const ui = useStore(s => s.ui);
  const setUi = useStore(s => s.setUi);
  const run = useStore(s => s.run);
  const ws = useStore(s => s.ws);
  const hideExcluded = ui.hideExcluded;

  const { scrollRef, stick, newSinceId } = useConvoScroll();

  const [opened, setOpened] = useState<{ threadId: string | undefined; ids: Set<string> }>({ threadId: undefined, ids: new Set() });
  const openIds = opened.threadId === thread?.thread.id ? opened.ids : new Set<string>();
  const setOpen = (id: string, open: boolean) => {
    const next = new Set(openIds);
    if (open) next.add(id); else next.delete(id);
    setOpened({ threadId: thread?.thread.id, ids: next });
  };

  if (!thread) return null;

  const views = buildMessageViews(thread, live);
  const byId = new Map(views.map(m => [m.item.id, m]));
  const path = thread.messages;
  const ids = path.map(m => m.id);
  const groups = groupMessages(path, thread.summaries);

  const latest = new Set<string>();
  const lastItem = path[path.length - 1];
  if (lastItem) latest.add(lastItem.id);

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

  const sel = ui.mode?.kind === "selection" ? ui.mode : null;
  const selecting = sel !== null;
  const picked = new Set(sel?.picked ?? []);
  const toggle = (key: string) => {
    if (!sel) return;
    setUi({ mode: { kind: "selection", picked: picked.has(key) ? sel.picked.filter(k => k !== key) : [...sel.picked, key] } });
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
  const highlighted = ui.visit.highlight ? rangeSet(ui.visit.highlight.first, ui.visit.highlight.last) : new Set<string>();

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
              {ui.mode?.kind === "insertAfter" && ui.mode.messageId === item.id ? (
                <InsertForm afterId={item.id} />
              ) : canInsert && !selecting ? (
                <div className="gap">
                  <Menu label="Add a message or branch here" className="gap-btn" icon="plus" align="start"
                    title="Add a message here, or branch from here"
                    items={[
                      { label: "Add a message here", icon: "insert", hint: "The messages below stay where they are", onSelect: () => setUi({ mode: { kind: "insertAfter", messageId: item.id } }) },
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

function InsertForm({ afterId }: { afterId: string }) {
  const thread = useStore(s => s.thread);
  const run = useStore(s => s.run);
  const setUi = useStore(s => s.setUi);
  const [text, setText] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, []);
  if (!thread) return null;
  const close = () => setUi({ mode: null });
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
  const picked = ui.mode?.kind === "selection" ? ui.mode.picked : [];
  const cards = picked.map(k => k.startsWith("s:") ? { summary_id: k.slice(2) } : { message_id: k });
  const n = picked.length;
  const [ready, setReady] = useState(false);
  const [instructions, setInstructions] = useState(SUMMARY_INSTRUCTIONS);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (ready && taRef.current) {
      taRef.current.focus();
      taRef.current.select();
    }
  }, [ready]);

  if (ready && n > 0) {
    return (
      <div className="selection-bar" role="status">
        <div className="selection-row">
          <span className="selection-step">Instructions</span>
          <span className="spacer" />
          <button className="btn btn-ghost btn-sm" onClick={() => setReady(false)}>Back</button>
          <button className="btn btn-primary btn-sm" onClick={async () => {
            const r = await run("summarize", { cards, instructions: instructions.trim() || undefined });
            if (r) setUi({ mode: null });
          }}><Icon name="summary" /> Summarize</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setUi({ mode: null })}>Cancel</button>
        </div>
        <textarea
          ref={taRef}
          className="selection-instructions"
          value={instructions}
          onChange={e => setInstructions(e.target.value)}
          rows={3}
          onKeyDown={e => {
            if (e.key === "Escape") setReady(false);
          }}
        />
      </div>
    );
  }

  return (
    <div className="selection-bar" role="status">
      <div className="selection-row">
        <span className="selection-step">Summarize</span>
        <span className="selection-text">
          {n === 0 ? "Click each card to include — messages, replies, results or summaries, in any order."
            : `${n} card${n === 1 ? "" : "s"} picked. Click more, or click one again to leave it out.`}
        </span>
        <span className="spacer" />
        {n > 0 && (
          <button className="btn btn-primary btn-sm" onClick={() => setReady(true)}>
            <Icon name="summary" /> Write summary
          </button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={() => setUi({ mode: null })}>Cancel</button>
      </div>
    </div>
  );
}
