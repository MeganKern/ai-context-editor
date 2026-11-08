import { useRef } from "react";
import { createPortal } from "react-dom";
import { useStore } from "../store.js";
import type { WorkspaceSnapshot } from "../../../shared/snapshot.js";
import { Icon } from "./Icon.js";
import { Menu } from "./Menu.js";
import { clip, timeLabel } from "../format.js";
import { conversationOf } from "../branches.js";

type ThreadRow = WorkspaceSnapshot["threads"][number];


/**
 * Where a branch was taken, under that card: "‹ 1/3 › name". The choices are the thread itself and
 * each branch taken at this card — threads of their own, so anything in them may have been edited
 * since. Swapping opens the other one with this point where it was on screen.
 * `key` is the card's id in the thread the branches were taken from (the same in every one of them).
 */
export function BranchPoint({ choices, current, pointKey }: { choices: ThreadRow[]; current: string; pointKey: string }) {
  const openThread = useStore(s => s.openThread);
  const ref = useRef<HTMLDivElement>(null);
  const idx = Math.max(0, choices.findIndex(c => c.id === current));
  const go = (id: string) => {
    if (id === current) return;
    const el = ref.current;
    const convo = el?.closest(".convo");
    const top = el && convo ? el.getBoundingClientRect().top - convo.getBoundingClientRect().top : 120;
    void openThread(id, { anchor: { key: pointKey, top } });
  };
  const n = choices.length;
  return (
    <div className="branch-point" ref={ref} data-branch-point={pointKey}>
      <div className="branch-switch" role="group" aria-label="Branches from here">
        <button className="icon-btn branch-step" onClick={() => go(choices[idx - 1].id)} disabled={idx === 0}
          aria-label="Previous branch" title="Previous branch"><Icon name="chevronLeft" /></button>
        <Menu label={`Branch ${idx + 1} of ${n} — all of them`} className="branch-label" icon={null} align="start"
          text={<>{`${idx + 1}/${n}`}<span className="branch-name">{choices[idx].name}</span></>}
          title="Threads branched at this card — each is a thread of its own"
          items={[{ heading: "Branched at this card" }, ...choices.map(c => ({ label: c.name, checked: c.id === current, onSelect: () => go(c.id) }))]} />
        <button className="icon-btn branch-step" onClick={() => go(choices[idx + 1].id)} disabled={idx === n - 1}
          aria-label="Next branch" title="Next branch"><Icon name="chevronRight" /></button>
      </div>
    </div>
  );
}

/** Every branch of this conversation, as a tree — opened from the thread's ⋯ menu. */
export function BranchesDialog() {
  const ws = useStore(s => s.ws);
  const thread = useStore(s => s.thread);
  const open = useStore(s => s.ui.branchesOpen);
  const setUi = useStore(s => s.setUi);
  const openThread = useStore(s => s.openThread);
  if (!open || !ws || !thread) return null;
  const close = () => setUi({ branchesOpen: false });
  const family = conversationOf(ws.threads, thread.thread.id);
  const choose = (t: ThreadRow) => {
    close();
    if (t.id === thread.thread.id) return;
    // A branch opens at the point it was taken; the thread they all came from opens as usual.
    void openThread(t.id, t.branch_at ? { anchor: { key: t.branch_at, top: 140 } } : undefined);
  };
  return createPortal(
    <div className="overlay" onMouseDown={close}>
      <div className="dialog branches-dialog" role="dialog" aria-modal="true" aria-label="Branches"
        onMouseDown={e => e.stopPropagation()} onKeyDown={e => { if (e.key === "Escape") close(); }}>
        <div className="dialog-head">
          <div>
            <h2 className="dialog-title">Branches</h2>
            <p className="dialog-sub">This conversation and every branch taken from it. Each is a thread of its own.</p>
          </div>
          <button className="icon-btn" onClick={close} aria-label="Close" autoFocus><Icon name="close" /></button>
        </div>
        <ul className="picker-list branches-list">
          {family.map(({ t, depth }) => (
            <li key={t.id}>
              <button className={`picker-item branches-item ${t.id === thread.thread.id ? "is-current" : ""}`} onClick={() => choose(t)}
                style={{ paddingLeft: 10 + depth * 22 }}>
                {depth > 0 && <Icon name="nest" className="branches-nest" />}
                <span className="branches-text">
                  <span className="picker-item-name">{t.name}</span>
                  {t.branch_at_preview != null && <span className="branches-at">from “{clip(t.branch_at_preview, 90)}”</span>}
                </span>
                <span className="picker-item-meta">{t.id === thread.thread.id ? "Open now" : timeLabel(t.created_at)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
