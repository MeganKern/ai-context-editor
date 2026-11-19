import { useRef, useState } from "react";
import { COMBINE_INSTRUCTIONS } from "../../../../shared/summary.js";
import { run, useModel } from "../../data/model.js";
import { rows } from "../../session/rows.js";
import { activity } from "../../session/activity.js";
import { Icon } from "../../kit/Icon.js";
import { Button } from "../../kit/Button.js";
import { Md } from "../../kit/Md.js";
import { useNoteText } from "./ItemDetail.js";
import * as ops from "./ops.js";

/**
 * A combined item as it's written, then the choice: keep it, change it, or throw it away. Where
 * the run is comes from the item itself (the workspace says which run writes it, and how it's going).
 */
export function CombineReview({ noteId, runId, onDone }: { noteId: string; runId: string; onDone: () => void }) {
  const streaming = useModel(s => s.live[runId]?.text ?? "");
  const note = useModel(s => s.ws?.notes.find(n => n.id === noteId));
  const combining = note?.combining?.run_id === runId ? note.combining : null;
  const status = combining?.status ?? (note ? "done" : "queued");
  const { data: content } = useNoteText(status === "done" ? noteId : null);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [nameVal, setNameVal] = useState("");
  const [revising, setRevising] = useState(false);
  const [instr, setInstr] = useState("");
  const [busy, setBusy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const drafting = status === "queued" || status === "running";
  const failed = !drafting && status !== "done";
  const text = drafting ? (streaming || "(combining…)") : content;
  const noteName = note?.name ?? "Combined item";

  // Accept distills: the sources become older versions under this item (server-side); then close the review.
  const accept = async () => {
    if (busy) return;
    setBusy(true);
    try { if (await run("accept_combine", { note_id: noteId })) { rows.flash(noteId); rows.setOpen(noteId, true); onDone(); } }
    finally { setBusy(false); }
  };
  // Rewrite from the same sources with edited instructions; the review returns to drafting as it streams.
  const rewrite = async () => {
    if (busy) return;
    setBusy(true);
    try { if (await run("revise_combine", { note_id: noteId, instructions: instr.trim() || undefined })) setRevising(false); }
    finally { setBusy(false); }
  };
  const discard = async () => { await run("delete_note", { note_id: noteId }); onDone(); };
  const saveEdit = async () => {
    if (!editText.trim()) return;
    if (await ops.saveNote(noteId, { content: editText.trim() })) setEditing(false);
  };
  const saveName = async () => {
    if (!nameVal.trim()) return;
    if (await ops.saveNote(noteId, { name: nameVal.trim() })) setRenaming(false);
  };

  return (
    <section className="ctxp-combine-review" aria-label="Combined item to review" data-help-area="comb.review">
      <header className="ctxp-combine-review-head">
        <span className="ctxp-combine-review-title">
          {drafting ? <><span className="spinner is-inline" aria-hidden />Combining items…</> : failed ? <><Icon name="alert" /> Combining failed</> : "Review combined item"}
        </span>
      </header>
      {failed && <p className="ctxp-combine-review-error">{combining?.error ?? "The run didn't finish."}</p>}
      {!drafting && !failed && (
        <div className="ctxp-combine-review-name">
          {renaming ? (
            <form onSubmit={e => { e.preventDefault(); void saveName(); }} className="ctxp-combine-rename">
              <input autoFocus value={nameVal} onChange={e => setNameVal(e.target.value)} onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); setRenaming(false); } }} placeholder="Name" aria-label="Name" />
              <Button type="submit" size="xs" disabled={!nameVal.trim()}>Save</Button>
              <Button kind="ghost" size="xs" onClick={() => setRenaming(false)}>Cancel</Button>
            </form>
          ) : (
            <span className="ctxp-combine-review-label">
              <strong>{noteName}</strong>
              <Button kind="ghost" size="xs" help="update_note:name" onClick={() => { setNameVal(noteName); setRenaming(true); }}>Rename</Button>
            </span>
          )}
        </div>
      )}
      {editing ? (
        <div className="ctxp-combine-edit">
          <textarea ref={textareaRef} className="field-grow is-body" value={editText} onChange={e => setEditText(e.target.value)} rows={6} aria-label="The combined text"
            onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); setEditing(false); } if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void saveEdit(); }} />
          <div className="inline-form-actions is-under">
            <Button kind="primary" size="xs" help="update_note" onClick={() => void saveEdit()} disabled={!editText.trim()}>Save</Button>
            <Button kind="ghost" size="xs" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      ) : text ? (
        <div className={`ctxp-combine-review-text msg-body is-output ${drafting ? "is-streaming" : ""}`}><Md text={text} /></div>
      ) : !drafting && !failed ? (
        <p className="ctxp-empty">No content yet.</p>
      ) : null}
      {drafting ? (
        <div className="inline-form-actions is-under">
          <Button kind="ghost" size="xs" help="delete_note" onClick={() => void discard()}>Cancel</Button>
        </div>
      ) : failed ? (
        <div className="inline-form-actions is-under">
          <Button kind="ghost" size="xs" help="delete_note" onClick={() => void discard()}>Discard</Button>
        </div>
      ) : (
        <>
          {revising && (
            <div className="ctxp-combine-revise">
              <textarea className="field-grow is-body" value={instr} onChange={e => setInstr(e.target.value)} rows={3} aria-label="Instructions to rewrite with"
                placeholder="How should it combine them?"
                onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); setRevising(false); } if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void rewrite(); }} />
              <div className="inline-form-actions is-under">
                <Button kind="primary" size="xs" icon="regenerate" help="revise_combine" disabled={busy || !instr.trim()} onClick={() => void rewrite()}>Rewrite</Button>
                <Button kind="ghost" size="xs" onClick={() => setRevising(false)}>Cancel</Button>
              </div>
            </div>
          )}
          <div className="inline-form-actions is-under">
            <Button kind="primary" size="xs" icon="check" help="comb.accept" disabled={busy} onClick={() => void accept()}>Accept</Button>
            <Button size="xs" help="update_note" onClick={() => { setEditText(content ?? ""); setEditing(true); requestAnimationFrame(() => textareaRef.current?.focus()); }}>Edit</Button>
            <Button size="xs" help="revise_combine" aria-expanded={revising} onClick={() => { setInstr(note?.combining?.instructions ?? COMBINE_INSTRUCTIONS); setRevising(r => !r); }}>Revise…</Button>
            <Button size="xs" help="menu.full-editor" onClick={() => activity.open({ kind: "note-editor", noteId })}>Full editor</Button>
            <Button kind="ghost" size="xs" help="delete_note" onClick={() => void discard()}>Discard</Button>
          </div>
        </>
      )}
    </section>
  );
}
