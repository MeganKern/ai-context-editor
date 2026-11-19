import { Fragment, useMemo } from "react";
import { threadPending, useModel } from "../../data/model.js";
import { usePrefs } from "../../session/prefs.js";
import { useRows } from "../../session/rows.js";
import { activity, useActivityOf } from "../../session/activity.js";
import { conversationView } from "../../derive/cards.js";
import { Menu } from "../../kit/Menu.js";
import { Icon } from "../../kit/Icon.js";
import { Card } from "./Card.js";
import { BranchPoint } from "./BranchPoint.js";
import { InsertForm } from "./InsertForm.js";
import { SelectionBar } from "./SelectionBar.js";
import { SummaryReview } from "./SummaryReview.js";
import { useConvoScroll } from "./useConvoScroll.js";
import { ThreadOutline } from "./ThreadOutline.js";
import * as ops from "./ops.js";

/** The cards in order, with what sits between them: branch points, summaries under review, the + to add or branch. */
export function Conversation() {
  const thread = useModel(s => s.thread)!;
  const pending = useModel(threadPending);
  const ws = useModel(s => s.ws);
  const hideExcluded = usePrefs(s => s.hideExcluded);
  const open = useRows(s => s.open);
  const flash = useRows(s => s.flash);
  const view = useMemo(() => conversationView(thread, ws, { expanded: new Set(Object.keys(open)), hideExcluded }), [thread, ws, open, hideExcluded]);
  const summarize = useActivityOf("summarize");
  const insertAfter = useActivityOf("insert-after");
  const { scrollRef, onScroll, newSinceId, jump, jumpTo } = useConvoScroll();

  const selecting = summarize !== null;
  const picked = new Set(summarize?.picked ?? []);
  const toggle = (id: string) => {
    if (!summarize) return;
    activity.update("summarize", { picked: picked.has(id) ? summarize.picked.filter(k => k !== id) : [...summarize.picked, id] });
  };

  return (
    <div className="convo-wrap">
    <ThreadOutline outline={view.outline} />
    <div className={`convo ${selecting ? "is-selecting" : ""} ${pending ? "is-pending" : ""}`} inert={pending} aria-busy={pending || undefined}
      ref={scrollRef} onScroll={onScroll} data-help-area="area.convo">
      {selecting && <SelectionBar />}
      <div className="convo-inner">
        {view.cards.length === 0 && (
          <div className="convo-empty"><p className="convo-empty-title">Write the first message below.</p></div>
        )}
        {view.cards.map(card => {
          if (card.hidden) return null;
          const isPicked = picked.has(card.id);
          const pickable = selecting && card.can.summarize;
          return (
            <Fragment key={card.id}>
              {newSinceId === card.id && <div className="new-since" id="new-since" role="separator" data-help="run.new-since"><span>New since you were here</span></div>}
              {card.reviewsBefore.map(s => <SummaryReview key={`r-${s.id}`} summary={s} />)}
              <div id={`msg-${card.id}`}
                className={["turn", card.collapsed ? "is-row" : "", isPicked ? "is-selected" : "", pickable ? "is-pickable" : "",
                  card.inReview ? "is-in-review" : "", flash === card.id ? "is-flash" : ""].join(" ")}
                onClickCapture={e => { if (selecting) { e.preventDefault(); e.stopPropagation(); if (pickable) toggle(card.id); } }}>
                <Card view={card} />
              </div>
              {card.branchPoint && <BranchPoint pointKey={card.branchPoint.key} choices={card.branchPoint.choices} current={thread.thread.id} />}
              {insertAfter?.cardId === card.id ? (
                <InsertForm afterId={card.id} />
              ) : card.canInsertAfter && !selecting ? (
                <div className="gap">
                  <Menu label="Add a message or branch here" className="gap-btn" icon="plus" align="start" title="Add a message here, or branch from here" help="ins.gap"
                    items={[
                      { label: "Add a message here", icon: "insert", hint: "The messages below stay where they are", help: "insert_message", onSelect: () => activity.open({ kind: "insert-after", cardId: card.id }) },
                      { label: "Branch from here", hint: "A thread of its own with everything up to here", help: "branch_thread", onSelect: () => void ops.branchFrom(card.id) },
                    ]} />
                </div>
              ) : null}
            </Fragment>
          );
        })}
        {view.reviewsAtEnd.map(s => <SummaryReview key={`r-${s.id}`} summary={s} />)}
      </div>
    </div>
      <button type="button" className={`convo-jump is-down ${jump === "down" ? "is-on" : ""}`}
        onClick={() => jumpTo("down")} aria-label="Jump to latest" title="Jump to latest" tabIndex={jump === "down" ? 0 : -1}>
        <Icon name="arrowDown" />
      </button>
      <button type="button" className={`convo-jump is-up ${jump === "up" ? "is-on" : ""}`}
        onClick={() => jumpTo("up")} aria-label="Jump to top" title="Jump to top" tabIndex={jump === "up" ? 0 : -1}>
        <Icon name="arrowUp" />
      </button>
    </div>
  );
}
