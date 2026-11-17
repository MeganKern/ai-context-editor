import { useState } from "react";
import { BEHAVIOUR as B } from "../../../../shared/behaviour.js";
import { run, useModel } from "../../data/model.js";
import { endDrag, startDrag } from "../../data/drag.js";
import { rows, useFlash, useOpen, useRows } from "../../session/rows.js";
import { activity, useActivityOf } from "../../session/activity.js";
import type { LibRow } from "../../derive/library.js";
import { nounOf, plural } from "../../derive/text.js";
import { Icon } from "../../kit/Icon.js";
import { Button } from "../../kit/Button.js";
import { Menu, type MenuItem } from "../../kit/Menu.js";
import { Marked } from "../../kit/Marked.js";
import { NameInput } from "../../kit/Fields.js";
import { useSwitch } from "../../kit/useSwitch.js";
import { ItemDetail } from "./ItemDetail.js";
import { FolderPicker } from "./LibraryTree.js";
import { useLibraryScope } from "./scope.js";
import * as ops from "./ops.js";

/** Alt+↑ / Alt+↓ on a row moves it in the send order. */
const moveKeys = (enabled: boolean, move: (delta: -1 | 1) => void) => (e: React.KeyboardEvent) => {
  if (!enabled || !e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
  if ((e.target as HTMLElement).closest("textarea, input:not([type=checkbox])")) return;
  e.preventDefault();
  move(e.key === "ArrowUp" ? -1 : 1);
};

/**
 * One library item: a switch for the thread beside the panel, its name, and on hover its menu.
 * Opened, it shows its text, to read or edit in place.
 */
export function LibraryRow({ row }: { row: LibRow }) {
  const { note, retired, inThread, canReorder, isCopy, snippet } = row;
  const ws = useModel(s => s.ws)!;
  const { thread, folders, reorder } = useLibraryScope();
  const open = useOpen(note.id);
  const unsaved = useRows(s => s.drafts[note.id] !== undefined);
  const renaming = useRows(s => s.renaming === note.id);
  const confirming = useRows(s => s.confirming === note.id);
  const moving = useRows(s => s.moving === note.id);
  const flashing = useFlash(note.id);
  const combining = useActivityOf("combine");
  const [busy, setBusy] = useState(false);
  const selecting = combining !== null;
  const selected = !!combining?.picked.includes(note.id);
  const where = nounOf(thread);

  const toggleSelected = () => {
    if (!combining) return;
    activity.update("combine", { picked: selected ? combining.picked.filter(id => id !== note.id) : [...combining.picked, note.id] });
  };
  // The switch answers at once; the server's copy takes over when it agrees.
  const [checked, toggleInThread] = useSwitch(inThread, async (on) => {
    if (retired) return false;
    if (!thread) { await ops.addToNewThread(ws.workspace.id, note.id); return true; }
    if (!on) { await ops.removeFromThread(thread, note.id, note.name); return true; }
    return ops.addItem(thread, note.id);
  });

  const items: MenuItem[] = [
    { label: "Full editor", icon: "external", hint: "More space, richer editing — same shared text", help: "menu.full-editor", onSelect: () => activity.open({ kind: "note-editor", noteId: note.id }) },
    { label: "Rename", icon: "edit", hint: B["update_note:name"].tip, help: "update_note:name", onSelect: () => rows.rename(note.id) },
    { separator: true },
    { label: "Versions…", icon: "merge", hint: "Its versions as a tree: which is current, what followed what", help: "menu.versions", onSelect: () => activity.open({ kind: "version-map", noteId: note.id }) },
  ];
  if (folders.length > 0) items.push({ label: "Move to folder…", icon: "folder", hint: B.move_note.tip, help: "move_note", onSelect: () => rows.move(note.id) });
  items.push(
    { separator: true },
    note.is_current
      ? { label: "Retire", icon: "eyeOff", hint: B.retire_note.tip, help: "retire_note", onSelect: () => void run("retire_note", { note_id: note.id }) }
      : { label: "Reactivate", icon: "eye", hint: B.reactivate_note.tip, help: "reactivate_note", onSelect: () => void run("reactivate_note", { note_id: note.id }) },
    { label: "Delete…", icon: "trash", danger: true, hint: B.delete_note.tip, help: "delete_note", onSelect: () => rows.confirm(note.id) },
  );

  if (confirming) {
    return (
      <li className="ctxp-row ctxp-lib is-confirming">
        <div className="ctxp-confirm" role="alertdialog" aria-label={`Delete ${note.name}`}
          onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); rows.confirm(null); } }}>
          <p>Delete "{note.name}" for good?{note.used_in > 0 ? ` It's removed from ${plural(note.used_in, "thread")}.` : ""} This can't be undone.</p>
          <div className="inline-form-actions">
            <Button size="xs" autoFocus onClick={() => rows.confirm(null)}>Keep it</Button>
            <Button kind="danger" size="xs" help="delete_note" disabled={busy} onClick={async () => {
              setBusy(true);
              const ok = await run("delete_note", { note_id: note.id });
              setBusy(false);
              if (ok) rows.confirm(null);
            }}>Delete</Button>
          </div>
        </div>
      </li>
    );
  }
  if (moving) {
    return (
      <li className="ctxp-row ctxp-lib is-confirming">
        <FolderPicker currentFolderId={note.folder_id} onPick={id => { rows.move(null); void run("move_note", { note_id: note.id, folder_id: id }); }} onCancel={() => rows.move(null)} />
      </li>
    );
  }
  return (
    <li className={["ctxp-row", "ctxp-lib", "is-draggable", flashing ? "is-flash" : "", open ? "is-open" : "", retired ? "is-retired" : "", selecting && selected ? "is-selected" : ""].join(" ")}
      data-help="cx.lib-item" onKeyDown={moveKeys(canReorder, d => reorder(note.id, d))}>
      <div className="ctxp-row-line" draggable={!renaming && !selecting}
        onDragStart={e => { if (selecting) return; startDrag(e, { kind: "library", id: note.id, label: note.name }); }} onDragEnd={endDrag}>
        {selecting ? (
          <label className="check ctxp-thread-check" title="Select to combine">
            <input type="checkbox" checked={selected} onChange={toggleSelected} aria-label={`Select ${note.name}`} />
          </label>
        ) : !retired ? (
          <label className="check ctxp-thread-check" title={checked ? `Remove from this ${where}` : `Add to this ${where}`}>
            <input type="checkbox" checked={checked} onChange={toggleInThread} data-help={checked ? "remove_item" : "place_item"}
              aria-label={checked ? `"${note.name}" is in this ${where} — uncheck to remove` : `Add "${note.name}" to this ${where}`} />
          </label>
        ) : null}
        {renaming ? (
          <NameInput name={note.name} onDone={name => { rows.rename(null); if (name) void ops.saveNote(note.id, { name }); }} />
        ) : (
          <button className="ctxp-row-text" aria-expanded={selecting ? undefined : open}
            onClick={() => selecting ? toggleSelected() : rows.setOpen(note.id, !open)}
            title={selecting ? "Select to combine" : open ? "Close" : "Read it here"}>
            <Icon name="note" /><span className="ctxp-name">{note.name}</span>
            {retired && <span className="ctxp-tag is-retired" data-help="cx.tag" title="Retired — not in any thread; reactivate from the menu">retired</span>}
            {isCopy && <span className="ctxp-tag" data-help="cx.tag" title="A separate copy of a shared library item">copy</span>}
            {unsaved && !open && <span className="ctxp-tag is-unsaved" data-help="cx.tag" title="You started editing its text; open it to save or discard">unsaved</span>}
            <Icon name={open ? "chevronDown" : "chevronRight"} className="ctxp-caret" />
          </button>
        )}
        {!renaming && <span className="ctxp-row-actions"><Menu label={`${note.name} actions`} className="act act-more" icon="more" items={items} /></span>}
      </div>
      {snippet && !open && <p className="ctxp-snippet"><Marked text={snippet} /></p>}
      {open && <ItemDetail noteId={note.id} inThread={inThread} />}
    </li>
  );
}
