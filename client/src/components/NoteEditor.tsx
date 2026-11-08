import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useStore } from "../store.js";
import { read } from "../api.js";
import { Icon } from "./Icon.js";
import { MOD } from "../format.js";
import { rememberNote } from "../notes-cache.js";

/** Library items are workspace documents; this is where they're written, renamed and deleted. */
export function NoteEditor({ noteId, onClose }: { noteId: string | "new"; onClose: () => void }) {
  const run = useStore(s => s.run);
  const ws = useStore(s => s.ws);
  const thread = useStore(s => s.thread);
  const toast = useStore(s => s.toast);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [orig, setOrig] = useState({ name: "", content: "" });
  const [loaded, setLoaded] = useState(false);
  const [confirm, setConfirm] = useState<"discard" | "delete" | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const stableClose = useCallback(() => onCloseRef.current(), []);

  useEffect(() => {
    if (noteId === "new") { setName(""); setContent(""); setOrig({ name: "", content: "" }); setLoaded(true); return; }
    read.note(noteId).then(d => {
      setName(d.name); setContent(d.content); setOrig({ name: d.name, content: d.content }); setLoaded(true);
    }).catch(() => stableClose());
  }, [noteId, stableClose]);

  useEffect(() => {
    if (!loaded) return;
    if (noteId === "new") nameRef.current?.focus(); else bodyRef.current?.focus();
  }, [loaded, noteId]);

  if (!loaded || !ws) return null;

  const meta = noteId === "new" ? null : ws.notes.find(n => n.id === noteId);
  const dirty = name !== orig.name || content !== orig.content;
  const canLoadHere = !!thread;
  const here = thread?.thread.kind === "template" ? "this template" : "this thread";
  const loadedHere = !!thread?.items.some(n => n.note_id === noteId);

  const save = async () => {
    if (noteId === "new") {
      if (!name.trim() && !content.trim()) return;
      const finalName = name.trim() || content.split("\n")[0].slice(0, 40) || "Untitled";
      const r = await run("create_note", { workspace_id: ws.workspace.id, name: finalName, content,
        load_into_thread_id: canLoadHere ? thread!.thread.id : undefined });
      if (r) { rememberNote(r.note_id, content); onClose(); if (canLoadHere) toast(`“${finalName}” added to the library and to ${here}`); }
    } else {
      const ok = await run("update_note", { note_id: noteId, name: name.trim() || undefined, content });
      if (ok) { rememberNote(noteId, content); onClose(); }
    }
  };
  const requestClose = () => { if (dirty) setConfirm("discard"); else onClose(); };

  return createPortal(
    <div className="overlay" onMouseDown={requestClose}>
      <div className="dialog note-editor" role="dialog" aria-modal="true" aria-label={noteId === "new" ? "New library item" : `Library item ${orig.name}`}
        onMouseDown={e => e.stopPropagation()}
        onKeyDown={e => {
          if (e.key === "Escape") { e.preventDefault(); if (confirm) setConfirm(null); else requestClose(); }
          if (e.key === "s" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void save(); }
        }}>
        <div className="dialog-head">
          <div className="note-editor-title">
            <Icon name="note" />
            <input ref={nameRef} className="note-name-input" value={name} onChange={e => setName(e.target.value)}
              placeholder="Name" aria-label="Name" />
          </div>
          <button className="icon-btn" onClick={requestClose} aria-label="Close"><Icon name="close" /></button>
        </div>
        <p className="dialog-sub note-editor-sub">
          {noteId === "new"
            ? canLoadHere ? `Saved to the library and added to ${here}.` : "Saved to the library."
            : <>In the library{meta && meta.used_in > 0 ? `, used in ${meta.used_in} thread${meta.used_in === 1 ? "" : "s"}` : ""}{loadedHere ? `, including ${here}` : ""}. Edits reach the model on its next reply in each of them.</>}
        </p>
        <textarea ref={bodyRef} className="note-body" value={content} onChange={e => setContent(e.target.value)}
          placeholder="Paste or write the reference text — a brief, a spec, interview notes…" aria-label="Text" />
        <div className="dialog-foot">
          {confirm === "discard" ? (
            <>
              <span className="dialog-hint is-warn">Close without saving your changes?</span>
              <span className="spacer" />
              <button className="btn" onClick={() => setConfirm(null)}>Keep editing</button>
              <button className="btn btn-danger" onClick={onClose}>Discard changes</button>
            </>
          ) : confirm === "delete" ? (
            <>
              <span className="dialog-hint is-ask">
                Delete “{orig.name}” from the library for good?{meta && meta.used_in > 0 ? ` It's removed from ${meta.used_in} thread${meta.used_in === 1 ? "" : "s"}.` : ""}
              </span>
              <span className="spacer" />
              <button className="btn" onClick={() => setConfirm(null)}>Keep it</button>
              <button className="btn btn-danger" onClick={async () => { const ok = await run("delete_note", { note_id: noteId }); if (ok) onClose(); }}>Delete</button>
            </>
          ) : (
            <>
              {noteId !== "new" && !loadedHere && (
                <button className="btn btn-ghost is-danger" onClick={() => setConfirm("delete")}><Icon name="trash" /> Delete…</button>
              )}
              {noteId !== "new" && canLoadHere && !loadedHere && (
                <button className="btn btn-ghost" onClick={async () => {
                  const ok = await run("place_item", { thread_id: thread!.thread.id, note_id: noteId, place: { placement: "every_reply" } });
                  if (ok) toast(`Added to “${thread!.thread.name}”`);
                }}><Icon name="plus" /> Add to {here}</button>
              )}
              <span className="spacer" />
              {dirty && <span className="dialog-hint">Unsaved changes</span>}
              <button className="btn" onClick={requestClose}>{dirty ? "Cancel" : "Close"}</button>
              <button className="btn btn-primary" onClick={save} disabled={noteId !== "new" ? !dirty : !(name.trim() || content.trim())}>
                Save <kbd>{MOD} S</kbd>
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
