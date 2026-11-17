import { useEffect, useRef, useState } from "react";
import { read } from "../../data/api.js";
import { useModel } from "../../data/model.js";
import { useResource } from "../../data/resources.js";
import { rows, useRows } from "../../session/rows.js";
import { activity } from "../../session/activity.js";
import { MOD, nounOf, plural } from "../../derive/text.js";
import { Act, Button } from "../../kit/Button.js";
import { GrowingText } from "../../kit/Fields.js";
import { useLibraryScope } from "./scope.js";
import * as ops from "./ops.js";

/** The text of one item, read on demand and again whenever the workspace says it changed. */
export function useNoteText(noteId: string | null) {
  const hash = useModel(s => (noteId ? s.ws?.notes.find(n => n.id === noteId)?.content_hash ?? null : null));
  return useResource(noteId && hash ? `note:${noteId}:${hash}` : null, () => read.note(noteId!).then(d => d.content));
}

/**
 * An item opened in place: its text (read, or edited right here), and what you can do next.
 * Edits to an item reach every thread that uses it.
 */
export function ItemDetail({ noteId, inThread }: { noteId: string; inThread: boolean }) {
  const { thread } = useLibraryScope();
  const meta = useModel(s => s.ws?.notes.find(n => n.id === noteId));
  const editNow = useRows(s => s.editing === noteId);
  const typed = useRows(s => s.drafts[noteId] ?? null);
  const { data: text, loading, failed } = useNoteText(noteId);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const others = Math.max(0, (meta?.used_in ?? 0) - (inThread ? 1 : 0));
  const draft = typed ?? (editNow && text !== null ? text : null);
  const dirty = draft !== null && text !== null && draft !== text;
  const setDraft = (v: string | null) => {
    rows.draft(noteId, v);
    if (v === null) { setConfirmDiscard(false); if (editNow) rows.edit(null); }
  };
  const cancel = () => { if (dirty) setConfirmDiscard(true); else setDraft(null); };
  const box = useRef<HTMLDivElement>(null);
  const ready = text !== null || failed;
  useEffect(() => { if (ready) box.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [ready]);

  const save = async () => {
    if (draft === null) return;
    if (draft === text) { setDraft(null); return; }
    if (await ops.saveNote(noteId, { content: draft })) setDraft(null);
  };

  return (
    <div className="ctxp-detail" ref={box} data-help="cx.item-detail">
      {draft === null ? (
        <div className={`ctxp-detail-text ${loading ? "is-loading" : ""}`} onDoubleClick={() => { if (text !== null) setDraft(text); }}
          title={text !== null ? "Double-click to edit" : undefined}>
          {loading ? "Loading…" : failed ? "Couldn't load it." : text?.trim() ? text : <em>Empty. Only its name is sent.</em>}
        </div>
      ) : (
        <>
          <GrowingText value={draft} onChange={setDraft} onSave={() => void save()} onCancel={cancel}
            label={`Text of ${meta?.name ?? "the item"}`} long className="is-body" max={360}
            placeholder="The text the model should see — a brief, a spec, notes…" />
          {others > 0 && (
            <p className="ctxp-detail-warn" data-help="cx.item-detail-warn">
              {inThread ? `Also used in ${plural(others, "other thread")}` : `Used in ${plural(others, "thread")}`} — saving changes it there too.
            </p>
          )}
        </>
      )}
      <div className="ctxp-detail-actions">
        {draft === null ? (
          <>
            <Act icon="edit" help="update_note" disabled={text === null} onClick={() => setDraft(text ?? "")}>Edit</Act>
            <Act icon="external" help="menu.full-editor" title="A bigger editor, with rename and delete" onClick={() => activity.open({ kind: "note-editor", noteId })}>Full editor</Act>
            {!inThread && thread && (
              <Act icon="plus" help="place_item" title={`Send it with every reply in this ${nounOf(thread)}`} onClick={() => void ops.addItem(thread, noteId)}>Add</Act>
            )}
          </>
        ) : confirmDiscard ? (
          <div className="ctxp-discard" role="alertdialog" aria-label="Discard your changes?"
            onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setConfirmDiscard(false); } }}>
            <span>Discard your changes?</span>
            <Button size="xs" autoFocus onClick={() => setConfirmDiscard(false)}>Keep editing</Button>
            <Button kind="danger" size="xs" onClick={() => setDraft(null)}>Discard</Button>
          </div>
        ) : (
          <>
            <Button kind="primary" size="xs" help="update_note" onMouseDown={e => e.preventDefault()} onClick={() => void save()} disabled={!dirty}>Save</Button>
            <Button kind="ghost" size="xs" onClick={cancel}>Cancel</Button>
            <span className="ctxp-form-keys">{MOD} S</span>
          </>
        )}
      </div>
    </div>
  );
}
