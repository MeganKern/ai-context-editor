import { useEffect, useRef, useState } from "react";
import { run, useModel } from "../../data/model.js";
import { activity } from "../../session/activity.js";
import { notices } from "../../session/notices.js";
import { MOD, nounOf, plural } from "../../derive/text.js";
import { Icon } from "../../kit/Icon.js";
import { Button } from "../../kit/Button.js";
import { Dialog } from "../../kit/Dialog.js";
import { useNoteText } from "./ItemDetail.js";
import * as ops from "./ops.js";

/** Library items are workspace documents; this is where they're written with room, renamed and deleted. `noteId` null: a new one. */
export function FullEditor({ noteId }: { noteId: string | null }) {
  const ws = useModel(s => s.ws)!;
  const thread = useModel(s => s.thread);
  const meta = useModel(s => (noteId ? s.ws?.notes.find(n => n.id === noteId) : undefined));
  const { data: loadedText } = useNoteText(noteId);
  const [name, setName] = useState(meta?.name ?? "");
  const [content, setContent] = useState<string | null>(noteId ? null : "");
  const [confirm, setConfirm] = useState<"discard" | "delete" | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const close = () => activity.close();

  // The text arrives once; typing from then on is yours.
  useEffect(() => { if (content === null && loadedText !== null) setContent(loadedText); }, [loadedText]);
  useEffect(() => {
    if (content === null) return;
    if (!noteId) nameRef.current?.focus(); else bodyRef.current?.focus();
  }, [content === null]);
  if (content === null) return null;

  const origName = meta?.name ?? "";
  const dirty = name !== origName || content !== (loadedText ?? "");
  const here = `this ${nounOf(thread)}`;
  const loadedHere = !!noteId && !!thread?.items.some(n => n.note_id === noteId);

  const save = async () => {
    if (!noteId) {
      if (!name.trim() && !content.trim()) return;
      const finalName = name.trim() || content.split("\n")[0].slice(0, 40) || "Untitled";
      const r = await run("create_note", { workspace_id: ws.workspace.id, name: finalName, content, load_into_thread_id: thread?.thread.id });
      if (r) { close(); if (thread) notices.toast(`“${finalName}” added to the library and to ${here}`); }
    } else if (await ops.saveNote(noteId, { name: name.trim() || undefined, content })) {
      close();
    }
  };
  const requestClose = () => { if (dirty) setConfirm("discard"); else close(); };

  return (
    <Dialog className="note-editor" label={noteId ? `Library item ${origName}` : "New library item"} onClose={requestClose} help="dl.editor"
      title={
        <span className="note-editor-title">
          <Icon name="note" />
          <input ref={nameRef} className="note-name-input" value={name} onChange={e => setName(e.target.value)} placeholder="Name" aria-label="Name" />
        </span>
      }
      foot={
        confirm === "discard" ? (
          <>
            <span className="dialog-hint is-warn">Close without saving your changes?</span>
            <span className="spacer" />
            <Button onClick={() => setConfirm(null)}>Keep editing</Button>
            <Button kind="danger" onClick={close}>Discard changes</Button>
          </>
        ) : confirm === "delete" && noteId ? (
          <>
            <span className="dialog-hint is-ask">
              Delete “{origName}” from the library for good?{meta && meta.used_in > 0 ? ` It's removed from ${plural(meta.used_in, "thread")}.` : ""}
            </span>
            <span className="spacer" />
            <Button onClick={() => setConfirm(null)}>Keep it</Button>
            <Button kind="danger" help="delete_note" onClick={async () => { if (await run("delete_note", { note_id: noteId })) close(); }}>Delete</Button>
          </>
        ) : (
          <>
            {noteId && !loadedHere && <Button kind="ghost" className="is-danger" icon="trash" onClick={() => setConfirm("delete")}>Delete…</Button>}
            {noteId && thread && !loadedHere && (
              <Button kind="ghost" icon="plus" help="place_item" onClick={async () => { if (await ops.addItem(thread, noteId)) notices.toast(`Added to “${thread.thread.name}”`); }}>Add to {here}</Button>
            )}
            <span className="spacer" />
            {dirty && <span className="dialog-hint">Unsaved changes</span>}
            <Button onClick={requestClose}>{dirty ? "Cancel" : "Close"}</Button>
            <Button kind="primary" help="update_note" onClick={() => void save()} disabled={noteId ? !dirty : !(name.trim() || content.trim())}>Save <kbd>{MOD} S</kbd></Button>
          </>
        )
      }>
      <p className="dialog-sub note-editor-sub">
        {!noteId
          ? thread ? `Saved to the library and added to ${here}.` : "Saved to the library."
          : <>In the library{meta && meta.used_in > 0 ? `, used in ${plural(meta.used_in, "thread")}` : ""}{loadedHere ? `, including ${here}` : ""}. Edits reach the model on its next reply in each of them.</>}
      </p>
      <textarea ref={bodyRef} className="note-body" value={content} onChange={e => setContent(e.target.value)}
        placeholder="Paste or write the reference text — a brief, a spec, interview notes…" aria-label="Text"
        onKeyDown={e => { if (e.key === "s" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void save(); } }} />
    </Dialog>
  );
}
