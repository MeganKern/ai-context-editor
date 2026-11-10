import { useEffect, useRef, useState } from "react";
import { useStore } from "../store.js";
import type { ThreadSnapshot } from "../../../shared/snapshot.js";
import { contextBudget } from "../format.js";
import { Icon } from "./Icon.js";
import { usePanel } from "./context/panel-state.js";
import { PinnedSection } from "./context/PinnedSection.js";
import { InThreadSection } from "./context/InThreadSection.js";
import { LibrarySection } from "./context/LibrarySection.js";

/**
 * The right panel is where the thread's context is worked on, and it stays in view beside it:
 *   Pinned — this thread only: decisions and facts you don't want lost in the scroll.
 *   In this thread — the library items it uses, each in one place: with every reply, or with one
 *     message.
 *   Library — reference text shared across the workspace, to bring in.
 * Top to bottom is the order they're sent in. Every row has its switch, opens in place to read
 * and edit, and can be dragged: to change the order, into another section, or onto a message.
 * An item ends up where you drop it. Nothing here is a statistic.
 */

const SPLIT_KEY = "desk.ctxSplit";
function readSplit(): number | null {
  try { const v = Number(localStorage.getItem(SPLIT_KEY)); return v >= 15 && v <= 85 ? v : null; } catch { return null; }
}
function saveSplit(v: number | null) {
  try { if (v === null) localStorage.removeItem(SPLIT_KEY); else localStorage.setItem(SPLIT_KEY, String(Math.round(v))); } catch { /* private mode */ }
}

export function ContextPanel() {
  const thread = useStore(s => s.thread);
  const activeThreadId = useStore(s => s.activeThreadId);
  const chat = thread && activeThreadId === thread.thread.id && thread.thread.kind !== "template" ? thread : null;
  const chatId = chat?.thread.id;
  const rootRef = useRef<HTMLDivElement>(null);
  const [split, setSplit] = useState<number | null>(readSplit);

  useEffect(() => { usePanel.setState({ open: {}, editing: null }); }, [chatId]);

  // The line between this thread's part and the library can be dragged; double-click resets it.
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const box = rootRef.current?.getBoundingClientRect();
    if (!box) return;
    let last = split;
    const move = (ev: MouseEvent) => {
      last = Math.max(15, Math.min(85, ((ev.clientY - box.top) / box.height) * 100));
      setSplit(last);
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.classList.remove("is-row-resizing");
      if (last != null) saveSplit(last);
    };
    document.body.classList.add("is-row-resizing");
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  const resetSplit = () => { setSplit(null); saveSplit(null); };
  const nudgeSplit = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const box = rootRef.current?.getBoundingClientRect();
    const part = rootRef.current?.querySelector<HTMLElement>(".ctxp-thread");
    const now = split ?? (box && part ? (part.offsetHeight / box.height) * 100 : 50);
    const next = Math.max(15, Math.min(85, now + (e.key === "ArrowUp" ? -5 : 5)));
    setSplit(next);
    saveSplit(next);
  };

  return (
    <div ref={rootRef} className={`ctxp ${chat ? "" : "is-library-only"}`}
      style={split != null && chat ? ({ "--ctxp-split": `${split}%` } as React.CSSProperties) : undefined}>
      {chat && (
        <>
          <div className={`ctxp-thread ${split != null ? "is-sized" : ""}`}>
            <PanelHead thread={chat} />
            <PinnedSection thread={chat} />
            <InThreadSection thread={chat} />
          </div>
          <div className="ctxp-split" role="separator" aria-orientation="horizontal" aria-label="Height of this thread's part and the library"
            tabIndex={0} title="Drag to share the height with the library · double-click to reset"
            onMouseDown={startResize} onDoubleClick={resetSplit} onKeyDown={nudgeSplit} />
        </>
      )}
      <LibrarySection thread={chat} />
    </div>
  );
}

function PanelHead({ thread }: { thread: ThreadSnapshot }) {
  const setUi = useStore(s => s.setUi);
  const togglePanel = useStore(s => s.togglePanel);
  const budget = contextBudget(thread.context);
  return (
    <header className="ctxp-head">
      <div className="ctxp-title-row">
        <h2 className="ctxp-title">Context</h2>
        <span className="spacer" />
        <button className="btn btn-ghost btn-sm ctxp-prompt" onClick={() => setUi({ mode: { kind: "inspector", tab: "reply", runId: null } })}
          title="Word for word what the next reply would be sent">
          <Icon name="code" /> Exact prompt
        </button>
        <button className="icon-btn panel-close" onClick={() => togglePanel(false)} aria-label="Close" title="Close"><Icon name="close" /></button>
      </div>
      {budget.over && (
        <div className="ctxp-alert" role="status">
          <Icon name="alert" />
          <p>Context limit reached: this is more than the model can take.</p>
        </div>
      )}
    </header>
  );
}

// ── Templates ────────────────────────────────────────────────────────────────

/** A template's own context, shown in the template page: what every run starts with. */
export function TemplatePinned() {
  const thread = useStore(s => s.thread);
  return thread ? <PinnedSection thread={thread} /> : null;
}

export function TemplateLibraryItems() {
  const thread = useStore(s => s.thread);
  return thread ? <InThreadSection thread={thread} /> : null;
}
