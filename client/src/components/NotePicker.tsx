import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useStore } from "../store.js";
import { Icon } from "./Icon.js";
import { clip } from "../format.js";

/**
 * Pick from the workspace library — to send an item with every reply in a template or thread, or
 * with a single message. An item has one place in a thread, so picking one that's used here
 * already moves it. (Beside a thread, the library is always in the right panel.)
 */
export function NotePicker() {
  const ws = useStore(s => s.ws);
  const thread = useStore(s => s.thread);
  const picker = useStore(s => s.ui.notePicker);
  const setUi = useStore(s => s.setUi);
  const run = useStore(s => s.run);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  if (!ws || !thread || !picker) return null;

  const close = () => setUi({ notePicker: null });
  const where = thread.thread.kind === "template" ? "template" : "thread";
  const placed = new Map(thread.items.map(i => [i.note_id, i]));
  const target = picker.mode === "attach" ? thread.messages.find(m => m.id === picker.messageId) : null;
  const notes = ws.notes.filter(n => n.name.toLowerCase().includes(q.trim().toLowerCase()));
  // Where it is here now, as the choice would change it.
  const status = (noteId: string): { already: boolean; meta: string | null } => {
    const p = placed.get(noteId);
    if (!p) return { already: false, meta: null };
    if (picker.mode === "load") {
      return p.placement === "every_reply" ? { already: true, meta: "Already added" } : { already: false, meta: "moves here from its message" };
    }
    if (p.placement === "with_message" && p.message_id === picker.messageId) return { already: true, meta: "Already with this message" };
    return { already: false, meta: p.placement === "every_reply" ? "moves here from every reply" : "moves here from another message" };
  };

  const choose = async (noteId: string) => {
    const ok = await run("place_item", {
      thread_id: thread.thread.id, note_id: noteId,
      place: picker.mode === "load" ? { placement: "every_reply" } : { placement: "with_message", message_id: picker.messageId },
    });
    if (ok) close();
  };

  // A new item is created right away, added here, and opened.
  const canCreate = picker.mode === "load";
  const createNew = async () => {
    const name = q.trim();
    if (!name) { setCreating(true); return; }
    const r = await run("create_note", { workspace_id: ws.workspace.id, name, load_into_thread_id: thread.thread.id });
    if (r) setUi({ notePicker: null, noteEditor: r.note_id });
  };

  return createPortal(
    <div className="overlay" onMouseDown={close}>
      <div className="dialog note-picker" role="dialog" aria-modal="true"
        aria-label={picker.mode === "load" ? `Add from the library to this ${where}` : "Send a library item with this message"}
        onMouseDown={e => e.stopPropagation()} onKeyDown={e => { if (e.key === "Escape") close(); }}>
        <div className="dialog-head">
          <div>
            <h2 className="dialog-title">{picker.mode === "load" ? `Add from the library to this ${where}` : "Send a library item with this message"}</h2>
            <p className="dialog-sub">
              {picker.mode === "load"
                ? (where === "template" ? "Every run uses it — the same item, not a copy — and sends it with every reply." : "It's sent with every reply in this thread, until you exclude it.")
                : <>It goes with “{clip(target?.content ?? "", 60)}” and nowhere else in this thread: it's sent right after that message whenever the message is sent.</>}
            </p>
          </div>
          <button className="icon-btn" onClick={close} aria-label="Close"><Icon name="close" /></button>
        </div>
        <div className="picker-search">
          <Icon name="search" />
          <input ref={inputRef} value={q} onChange={e => { setQ(e.target.value); setCreating(false); }}
            placeholder={canCreate ? (ws.notes.length ? "Filter the library, or type a name for something new" : "Name the first library item") : "Filter the library"} aria-label="Filter the library"
            onKeyDown={e => { if (e.key === "Enter") e.preventDefault(); }} />
        </div>
        <ul className="picker-list" role="listbox" aria-label="Library">
          {notes.map(n => {
            const { already, meta } = status(n.id);
            return (
              <li key={n.id}>
                <button className="picker-item" disabled={already} onClick={() => choose(n.id)} role="option" aria-selected={false}>
                  <Icon name="note" />
                  <span className="picker-item-name">{n.name}</span>
                  <span className="picker-item-meta">
                    {meta ?? [n.copied_from ? "a copy" : null, n.used_in ? `in ${n.used_in} thread${n.used_in === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ")}
                  </span>
                </button>
              </li>
            );
          })}
          {notes.length === 0 && ws.notes.length > 0 && <li className="picker-empty">Nothing is called that.</li>}
          {ws.notes.length === 0 && !canCreate && <li className="picker-empty">The library is empty. Add to it from the right-hand panel.</li>}
        </ul>
        {canCreate && (
          <div className="dialog-foot">
            {creating && !q.trim() && <span className="dialog-hint">Type a name above first.</span>}
            <span className="spacer" />
            <button className="btn" onClick={createNew}>
              <Icon name="plus" /> {q.trim() ? `New: “${clip(q, 28)}”` : "New"}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
