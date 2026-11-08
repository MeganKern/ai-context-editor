import { useEffect, useRef, useState, type ReactNode } from "react";
import { useStore } from "../../store.js";
import { read } from "../../api.js";
import type { ThreadSnapshot } from "../../../../shared/snapshot.js";
import { draggedItem, endDrag, startDrag, useDrag, type DragItem } from "../../drag.js";
import * as ops from "../../context-ops.js";
import { Icon } from "../Icon.js";
import { Menu, type MenuItem } from "../Menu.js";
import { NameInput, SectionHead } from "./inputs.js";
import { ItemDetail } from "./ItemDetail.js";
import { flash, setOpen, useFlash, usePanel } from "./panel-state.js";
import { BEHAVIOUR as B } from "../../../../shared/behaviour.js";

const NONE: string[] = [];

/**
 * Searching the library happens on the server, in names and text, as typed. Until its answer for
 * what's typed now arrives, matching names show on their own. `version` changes whenever any
 * item's text does, so an edit is searched again.
 */
function useLibrarySearch(wsId: string | undefined, q: string, version: string): Map<string, string> | null {
  const needle = q.trim();
  const [found, setFound] = useState<{ q: string; hits: Map<string, string> } | null>(null);
  useEffect(() => {
    if (!needle || !wsId) return;
    let live = true;
    const t = setTimeout(() => {
      read.noteSearch(wsId, needle)
        .then(hits => { if (live) setFound({ q: needle, hits: new Map(hits.map(h => [h.note_id, h.snippet])) }); })
        .catch(() => { /* the names still match */ });
    }, 180);
    return () => { live = false; clearTimeout(t); };
  }, [wsId, needle, version]);
  return found && found.q === needle ? found.hits : null;
}

function snippetOf(text: string, needle: string): ReactNode | null {
  const i = text.toLowerCase().indexOf(needle);
  if (i < 0) return null;
  const from = Math.max(0, i - 28);
  const to = Math.min(text.length, i + needle.length + 48);
  const flat = (s: string) => s.replace(/\s+/g, " ");
  return (
    <>
      {from > 0 && "…"}{flat(text.slice(from, i))}<mark>{flat(text.slice(i, i + needle.length))}</mark>{flat(text.slice(i + needle.length, to))}{to < text.length && "…"}
    </>
  );
}

/**
 * The workspace library: reference text written once and used in any thread. Here is everything
 * this thread doesn't use. Find by name or by what's inside; open an item to read or edit it; Add
 * sends it with every reply; drag it into "In this thread" (at a place in the order), onto a
 * message, or onto the message box for your next message. Drop something from this thread here
 * to stop using it here.
 */
export function LibrarySection({ thread }: { thread: ThreadSnapshot | null }) {
  const ws = useStore(s => s.ws);
  const run = useStore(s => s.run);
  const nextNotes = useStore(s => (thread ? s.nextNotes[thread.thread.id] : undefined));
  const dragging = useDrag(s => s.item);
  const [q, setQ] = useState("");
  const [naming, setNaming] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const creating = useRef(false);
  const hits = useLibrarySearch(ws?.workspace.id, q, ws?.notes.map(n => n.content_hash).join() ?? "");
  if (!ws) return null;

  const used = new Set(thread ? thread.items.map(i => i.note_id) : []);
  const rest = ws.notes.filter(n => !used.has(n.id));
  const needle = q.trim().toLowerCase();
  const matches = (n: { id: string; name: string }) => n.name.toLowerCase().includes(needle) || !!hits?.has(n.id);
  const shown = rest.flatMap(n => {
    if (!needle || n.name.toLowerCase().includes(needle)) return [{ note: n, snippet: null as ReactNode | null }];
    const text = hits?.get(n.id);
    return text !== undefined ? [{ note: n, snippet: snippetOf(text, needle) ?? text }] : [];
  });
  // A search also finds what this thread already uses (listed above): say so, and open it there.
  const usedHits = needle ? ws.notes.filter(n => used.has(n.id) && matches(n)) : [];
  const where = thread?.thread.kind === "template" ? "template" : "thread";

  const create = async () => {
    const name = naming?.trim();
    if (!name || creating.current) return;
    creating.current = true;
    try {
      const r = await run("create_note", { workspace_id: ws.workspace.id, name, load_into_thread_id: thread?.thread.id });
      if (!r) return;
      setNaming(null);
      setOpen(r.note_id, true);
      usePanel.setState({ editing: r.note_id });
      flash(r.note_id);
    } finally { creating.current = false; }
  };

  // Dropped here from this thread: it stops being used here (and stays in the library).
  const accepts = (item: DragItem | null): item is DragItem => !!item && !!thread && (item.kind === "thread-note" || item.kind === "msg-note" || item.kind === "pin");
  const onDrop = (item: DragItem) => {
    if (!thread) return;
    if (item.kind === "thread-note" || item.kind === "msg-note") {
      void ops.removeFromThread(thread, item.id, item.label);
    } else if (item.kind === "pin") {
      const pin = thread.directives.find(d => d.id === item.id);
      if (pin) void ops.pinToLibrary(thread, pin, { keep: false }).then(id => { if (id) flash(id); });
    }
  };
  const incoming = accepts(dragging);

  return (
    <section className={`ctxp-library ctxp-dropzone ${incoming ? "is-target" : ""} ${incoming && over ? "is-over" : ""}`} aria-label="Library"
      onDragOver={e => { if (accepts(draggedItem(e))) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (!over) setOver(true); } }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }}
      onDrop={e => { const item = draggedItem(e); setOver(false); if (accepts(item)) { e.preventDefault(); endDrag(); onDrop(item); } }}>
      <div className="ctxp-library-top">
        <SectionHead title="Library" sub="shared across the workspace">
          {naming === null && (
            <button className="act ctxp-add" onClick={() => setNaming("")} title="Write reference text once, use it in any thread">
              <Icon name="plus" /> New
            </button>
          )}
        </SectionHead>
        {naming !== null && (
          <form className="ctxp-form ctxp-new-form" onSubmit={e => { e.preventDefault(); void create(); }}>
            <input autoFocus value={naming} placeholder="Name" aria-label="Name of the new library item"
              onChange={e => setNaming(e.target.value)} onKeyDown={e => { if (e.key === "Escape") setNaming(null); }} />
            <p className="ctxp-form-hint">{thread ? `Added to this ${where} right away, sent with every reply; write its text in place.` : "Saved to the library; write its text in place."}</p>
            <div className="ctxp-form-actions">
              <button type="submit" className="btn btn-primary btn-xs" disabled={!naming.trim()}>Create</button>
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => setNaming(null)}>Cancel</button>
            </div>
          </form>
        )}
        {ws.notes.length > 0 && (
          <div className="ctxp-filter">
            <Icon name="search" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find by name or text" aria-label="Find in the library"
              onKeyDown={e => { if (e.key === "Escape") setQ(""); }} />
            {q && <button className="icon-btn ctxp-filter-x" onClick={() => setQ("")} aria-label="Clear"><Icon name="close" /></button>}
          </div>
        )}
      </div>
      {incoming && (
        <p className="ctxp-drop-hint is-library">
          {dragging!.kind === "pin" ? `Drop here to move it to the library — no longer sent in this ${where}` : `Drop here to stop using it in this ${where} — it stays in the library`}
        </p>
      )}
      <ul className="ctxp-list">
        {shown.map(({ note, snippet }) => (
          <LibraryRow key={note.id} thread={thread} note={note} snippet={snippet} queued={!!nextNotes?.includes(note.id)} />
        ))}
      </ul>
      {ws.notes.length === 0 && naming === null && (
        <p className="ctxp-empty">Nothing here yet. Write reference text once — a brief, a spec, a style guide — and use it in any thread.</p>
      )}
      {ws.notes.length > 0 && rest.length === 0 && !needle && <p className="ctxp-empty">This {where} uses everything in the library.</p>}
      {needle && shown.length === 0 && usedHits.length === 0 && <p className="ctxp-empty">Nothing in the library mentions that.</p>}
      {usedHits.length > 0 && (
        <p className="ctxp-also">
          {shown.length ? `Also in this ${where}: ` : `Only in this ${where}, above: `}
          {usedHits.map((n, i) => (
            <span key={n.id}>{i > 0 && ", "}<button className="link" onClick={() => { setOpen(n.id, true); flash(n.id); }}>{n.name}</button></span>
          ))}
        </p>
      )}
    </section>
  );
}

function LibraryRow({ thread, note, snippet, queued }: {
  thread: ThreadSnapshot | null; note: { id: string; name: string; used_in: number; copied_from: string | null }; snippet: ReactNode | null; queued: boolean;
}) {
  const run = useStore(s => s.run);
  const setUi = useStore(s => s.setUi);
  const setNextNotes = useStore(s => s.setNextNotes);
  const nextNotes = useStore(s => (thread ? s.nextNotes[thread.thread.id] : undefined)) ?? NONE;
  const open = usePanel(s => !!s.open[note.id]);
  const unsaved = usePanel(s => s.drafts[note.id] !== undefined);
  const flashing = useFlash(note.id);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const chat = !!thread && thread.thread.kind !== "template";
  const where = thread?.thread.kind === "template" ? "template" : "thread";

  const toggleNext = () => {
    if (!thread) return;
    setNextNotes(thread.thread.id, queued ? nextNotes.filter(id => id !== note.id) : [...nextNotes, note.id]);
  };
  const items: MenuItem[] = [];
  if (thread) {
    items.push({ label: `Add to this ${where}`, icon: "plus", hint: B.place_item.tip, onSelect: async () => { if (await ops.addItem(thread, note.id)) flash(note.id); } });
    if (chat) items.push({ label: queued ? "Don't send with my next message" : "Send with my next message", icon: "paperclip", hint: queued ? undefined : "It goes with the message you send next", onSelect: toggleNext });
    items.push({ separator: true });
  }
  items.push(
    { label: open ? "Close" : "Read it here", icon: open ? "collapse" : "expand", onSelect: () => setOpen(note.id, !open) },
    { label: "Edit the text", icon: "edit", onSelect: () => { setOpen(note.id, true); usePanel.setState({ editing: note.id }); } },
    { label: "Rename", icon: "edit", onSelect: () => setRenaming(true) },
    { label: "Open in the editor", icon: "external", onSelect: () => setUi({ noteEditor: note.id }) },
    { label: "Duplicate", icon: "copy", hint: B.duplicate_note.tip, onSelect: async () => { const id = await ops.duplicate(note.id, note.name); if (id) flash(id); } },
    { separator: true },
    { label: "Delete…", icon: "trash", danger: true, hint: B.delete_note.tip, onSelect: () => setDeleting(true) },
  );

  if (deleting) {
    // Focus starts on "Keep it", and Escape keeps it: deleting can't be undone.
    return (
      <li className="ctxp-row ctxp-lib is-confirming">
        <div className="ctxp-confirm" role="alertdialog" aria-label={`Delete ${note.name}`}
          onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setDeleting(false); } }}>
          <p>Delete “{note.name}” for good?{note.used_in > 0 ? ` It's removed from ${note.used_in} thread${note.used_in === 1 ? "" : "s"}.` : ""} This can't be undone.</p>
          <div className="ctxp-form-actions">
            <button className="btn btn-xs" autoFocus onClick={() => setDeleting(false)}>Keep it</button>
            <button className="btn btn-danger btn-xs" disabled={busy} onClick={async () => {
              setBusy(true);
              const ok = await run("delete_note", { note_id: note.id });
              setBusy(false);
              if (ok) setDeleting(false);
            }}>Delete</button>
          </div>
        </div>
      </li>
    );
  }

  return (
    <li className={["ctxp-row", "ctxp-lib", "is-draggable", flashing ? "is-flash" : "", open ? "is-open" : ""].join(" ")}>
      <div className="ctxp-row-line" draggable={!renaming}
        onDragStart={e => startDrag(e, { kind: "library", id: note.id, label: note.name })}
        onDragEnd={endDrag}>
        {renaming ? (
          <NameInput name={note.name} onDone={name => { setRenaming(false); if (name) void ops.rename(note.id, name); }} />
        ) : (
          <button className="ctxp-row-text" aria-expanded={open} onClick={() => setOpen(note.id, !open)}
            title={open ? "Close" : chat ? "Read it here · drag it into this thread, onto a message, or onto the message box" : "Read it here"}>
            <Icon name="note" /><span className="ctxp-name">{note.name}</span>
            {note.copied_from && <span className="ctxp-tag" title="A separate copy of a shared library item, made for a thread with the same name. Edits to it don't change the item it was copied from.">copy</span>}
            {queued && <span className="ctxp-tag is-next" title="It goes with the next message you send">with your next message</span>}
            {unsaved && !open && <span className="ctxp-tag is-unsaved" title="You started editing its text; open it to save or discard">unsaved edit</span>}
            <Icon name={open ? "chevronDown" : "chevronRight"} className="ctxp-caret" />
          </button>
        )}
        {!renaming && (
          <span className="ctxp-row-actions">
            {thread && (
              <button className="act" onClick={async () => { if (await ops.addItem(thread, note.id)) flash(note.id); }}
                title={`Send it with every reply in this ${where}`}>Add</button>
            )}
            <Menu label={`${note.name} actions`} className="act act-more" icon="more" items={items} />
          </span>
        )}
      </div>
      {snippet && !open && <p className="ctxp-snippet">{snippet}</p>}
      {open && <ItemDetail thread={thread} noteId={note.id} kind="library" />}
    </li>
  );
}
