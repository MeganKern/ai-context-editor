import { useState } from "react";
import { BEHAVIOUR as B } from "../../../../shared/behaviour.js";
import { run, useModel } from "../../data/model.js";
import { draggedItem, endDrag } from "../../data/drag.js";
import { rows, useRows } from "../../session/rows.js";
import { toggleListed, usePrefs } from "../../session/prefs.js";
import { folderChoices, folderSubtree, type LibFolderNode, type LibraryTree as Tree } from "../../derive/library.js";
import { Icon } from "../../kit/Icon.js";
import { IconButton } from "../../kit/Button.js";
import { Menu, type MenuItem } from "../../kit/Menu.js";
import { Picker } from "../../kit/Picker.js";
import { InlineForm } from "../../kit/InlineForm.js";
import { NameInput } from "../../kit/Fields.js";
import { LibraryRow } from "./LibraryRow.js";
import { useLibraryScope } from "./scope.js";
import * as ops from "./ops.js";

/** The items and folders the panel shows, nested as they're filed (flat when searching). */
export function LibraryTree({ tree }: { tree: Tree }) {
  return (
    <ul className="ctxp-list">
      {tree.folders.map(f => <LibraryFolder key={f.folder.id} node={f} />)}
      {tree.roots.map(r => <LibraryRow key={r.note.id} row={r} />)}
    </ul>
  );
}

/** Where to move something: the folders, with the one it's in and anything under it left out. */
export function FolderPicker({ currentFolderId, exclude, onPick, onCancel }: {
  currentFolderId: string | null; exclude?: Set<string>; onPick: (folderId: string | null) => void; onCancel: () => void;
}) {
  const { folders } = useLibraryScope();
  const choices = folderChoices(folders, { current: currentFolderId, exclude });
  return (
    <div className="ctxp-picker" onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCancel(); } }}>
      <div className="ctxp-picker-head">
        <span className="ctxp-picker-title">Move to</span>
        <IconButton icon="close" label="Cancel" onClick={onCancel} />
      </div>
      <Picker className="picker-compact" label="Folders" items={choices} keyOf={c => c.id ?? "top"} search={choices.length > 4}
        matches={(c, q) => c.name.toLowerCase().includes(q)} placeholder="Search folders"
        render={c => <><Icon name={c.id ? "folder" : "note"} /><span style={c.depth ? { paddingLeft: c.depth * 14 } : undefined}>{c.name}</span></>}
        onPick={c => onPick(c.id)} empty={() => "No folders match"} />
    </div>
  );
}

/** A library folder: closed unless you opened it, and that's remembered on this computer. */
function LibraryFolder({ node }: { node: LibFolderNode }) {
  const { folder, folders, rows: items, empty } = node;
  const ws = useModel(s => s.ws)!;
  const scope = useLibraryScope();
  const expanded = usePrefs(s => s.openLibraryFolders.includes(folder.id));
  const renaming = useRows(s => s.renaming === folder.id);
  const moving = useRows(s => s.moving === folder.id);
  const [namingSub, setNamingSub] = useState<string | null>(null);
  const [namingNote, setNamingNote] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const toggle = () => toggleListed("openLibraryFolders", folder.id);
  const openIfClosed = () => { if (!expanded) toggle(); };

  const onDragOver = (e: React.DragEvent) => {
    if (draggedItem(e)?.kind === "library") { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (!over) setOver(true); }
  };
  const onDrop = (e: React.DragEvent) => {
    const item = draggedItem(e);
    setOver(false);
    if (item?.kind === "library") {
      e.preventDefault(); e.stopPropagation(); endDrag();
      void run("move_note", { note_id: item.id, folder_id: folder.id });
      openIfClosed();
    }
  };

  const menu: MenuItem[] = [
    { label: "New item here", icon: "plus", hint: "Created inside this folder", help: "create_note", onSelect: () => { setNamingNote(""); openIfClosed(); } },
    { label: "Rename", icon: "edit", hint: B.rename_folder.tip, help: "rename_folder", onSelect: () => rows.rename(folder.id) },
    { label: "New subfolder", icon: "folder", hint: "A folder inside this folder", help: "create_folder", onSelect: () => { setNamingSub(""); openIfClosed(); } },
    { label: "Move to…", icon: "folder", hint: "Move this folder somewhere else", help: "move_folder", onSelect: () => rows.move(folder.id) },
    { separator: true },
    { label: "Delete folder", icon: "trash", danger: true, hint: B.delete_folder.tip, help: "delete_folder", onSelect: () => void run("delete_folder", { folder_id: folder.id }) },
  ];

  if (moving) {
    return (
      <li className="ctxp-row ctxp-folder is-confirming">
        <FolderPicker currentFolderId={folder.parent_id} exclude={folderSubtree(scope.folders, folder.id)}
          onPick={id => { rows.move(null); void run("move_folder", { folder_id: folder.id, parent_id: id }); }} onCancel={() => rows.move(null)} />
      </li>
    );
  }
  return (
    <li className={`ctxp-row ctxp-folder ${over ? "is-drop-target" : ""}`} data-help="cx.lib-folder">
      <div className="ctxp-row-line ctxp-folder-line" onDragOver={onDragOver} onDrop={onDrop}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }}>
        {renaming ? (
          <NameInput name={folder.name} onDone={name => { rows.rename(null); if (name) void run("rename_folder", { folder_id: folder.id, name }); }} />
        ) : (
          <button className="ctxp-row-text" onClick={toggle} aria-expanded={expanded}>
            <Icon name={expanded ? "chevronDown" : "chevronRight"} className="ctxp-caret" />
            <span className="ctxp-name">{folder.name}</span>
            {empty && <span className="ctxp-tag">empty</span>}
          </button>
        )}
        {!renaming && <span className="ctxp-row-actions"><Menu label={`${folder.name} folder actions`} className="act act-more" icon="more" items={menu} /></span>}
      </div>
      {expanded && (
        <ul className="ctxp-list ctxp-nested">
          {namingSub !== null && (
            <li className="ctxp-row">
              <InlineForm className="ctxp-new-form" value={namingSub} onChange={setNamingSub} placeholder="Subfolder name" label="Name of the subfolder" help="create_folder"
                onSubmit={() => void run("create_folder", { workspace_id: ws.workspace.id, name: namingSub.trim(), parent_id: folder.id, scope: "library" }).then(ok => { if (ok) setNamingSub(null); })}
                onCancel={() => setNamingSub(null)} />
            </li>
          )}
          {namingNote !== null && (
            <li className="ctxp-row">
              <InlineForm className="ctxp-new-form" value={namingNote} onChange={setNamingNote} placeholder="Name" label="Name of the new library item" help="create_note"
                onSubmit={() => void ops.createNote(ws.workspace.id, namingNote.trim(), { folderId: folder.id, threadId: scope.thread?.thread.id }).then(ok => { if (ok) setNamingNote(null); })}
                onCancel={() => setNamingNote(null)} />
            </li>
          )}
          {folders.map(c => <LibraryFolder key={c.folder.id} node={c} />)}
          {items.map(r => <LibraryRow key={r.note.id} row={r} />)}
        </ul>
      )}
    </li>
  );
}
