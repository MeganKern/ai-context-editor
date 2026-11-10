import { useEffect, useRef, useState, type ReactNode } from "react";
import { useStore } from "../../store.js";
import { read } from "../../api.js";
import { liveText } from "../../view-model.js";
import type { ThreadSnapshot, WorkspaceSnapshot } from "../../../../shared/snapshot.js";
import { draggedItem, endDrag, startDrag, useDrag, type DragItem } from "../../drag.js";
import * as ops from "../../context-ops.js";
import { Icon } from "../Icon.js";
import { Menu, type MenuItem } from "../Menu.js";
import { Md } from "../Markdown.js";
import { NameInput, SectionHead } from "./inputs.js";
import { ItemDetail } from "./ItemDetail.js";
import { flash, setOpen, useFlash, usePanel } from "./panel-state.js";
import { BEHAVIOUR as B } from "../../../../shared/behaviour.js";
import { COMBINE_INSTRUCTIONS } from "../../../../shared/summary.js";

const NONE: string[] = [];

type WsNote = WorkspaceSnapshot["notes"][number];
type WsFolder = WorkspaceSnapshot["folders"][number];

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

function folderMoveItemsForFolder(run: ReturnType<typeof useStore.getState>["run"], folderId: string, currentParentId: string | null, folders: WsFolder[]): MenuItem[] {
  const items: MenuItem[] = [];
  const descendants = new Set<string>();
  const collect = (id: string) => { for (const f of folders) if (f.parent_id === id && !descendants.has(f.id)) { descendants.add(f.id); collect(f.id); } };
  collect(folderId);
  const excluded = new Set([folderId, ...descendants, ...(currentParentId ? [currentParentId] : [])]);
  const eligible = folders.filter(f => !excluded.has(f.id));
  if (eligible.length === 0 && !currentParentId) return [];
  items.push({ heading: "Move to" });
  if (currentParentId) {
    items.push({ label: "Top level", icon: "folder", onSelect: () => { void run("move_folder", { folder_id: folderId, parent_id: null }); } });
  }
  const addFolder = (f: WsFolder, depth: number) => {
    if (excluded.has(f.id)) return;
    const prefix = "  ".repeat(depth);
    items.push({ label: `${prefix}${f.name}`, icon: "folder", onSelect: () => { void run("move_folder", { folder_id: folderId, parent_id: f.id }); } });
    for (const child of folders.filter(c => c.parent_id === f.id)) addFolder(child, depth + 1);
  };
  for (const f of folders.filter(f => !f.parent_id)) addFolder(f, 0);
  return items;
}

/** Is this note superseded by another? (i.e. it's an older version, not the head of its chain) */
function isSuperseded(note: WsNote, allNotes: WsNote[]): boolean {
  return allNotes.some(n => n.supersedes === note.id);
}

export function LibrarySection({ thread }: { thread: ThreadSnapshot | null }) {
  const ws = useStore(s => s.ws);
  const run = useStore(s => s.run);
  const nextNotes = useStore(s => (thread ? s.nextNotes[thread.thread.id] : undefined));
  const dragging = useDrag(s => s.item);
  const [q, setQ] = useState("");
  const [naming, setNaming] = useState<string | null>(null);
  const [namingFolder, setNamingFolder] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [combineReady, setCombineReady] = useState(false);
  const [combineInstr, setCombineInstr] = useState(COMBINE_INSTRUCTIONS);
  const [combining, setCombining] = useState(false);
  const [combineReview, setCombineReview] = useState<{ noteId: string; runId: string } | null>(null);
  const [versioningNote, setVersioningNote] = useState<string | null>(null);
  const creating = useRef(false);
  const instrRef = useRef<HTMLTextAreaElement>(null);
  const hits = useLibrarySearch(ws?.workspace.id, q, ws?.notes.map(n => n.content_hash).join() ?? "");
  if (!ws) return null;

  const used = new Set(thread ? thread.items.map(i => i.note_id) : []);
  const rest = ws.notes.filter(n => !used.has(n.id));
  const needle = q.trim().toLowerCase();
  const matches = (n: { id: string; name: string }) => n.name.toLowerCase().includes(needle) || !!hits?.has(n.id);
  const searching = !!needle;

  const shown = rest.flatMap(n => {
    if (!needle && isSuperseded(n, rest)) return [];
    if (!needle || n.name.toLowerCase().includes(needle)) return [{ note: n, snippet: null as ReactNode | null }];
    const text = hits?.get(n.id);
    return text !== undefined ? [{ note: n, snippet: snippetOf(text, needle) ?? text }] : [];
  });
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

  const createFolder = async () => {
    const name = namingFolder?.trim();
    if (!name) return;
    const r = await run("create_folder", { workspace_id: ws.workspace.id, name });
    if (r) setNamingFolder(null);
  };

  const toggleSelected = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const doCombine = async () => {
    if (selected.size < 2 || combining) return;
    setCombining(true);
    try {
      const r = await run("combine_notes", {
        workspace_id: ws.workspace.id,
        note_ids: [...selected],
        instructions: combineInstr.trim() || undefined,
      });
      if (r) {
        setSelecting(false);
        setSelected(new Set());
        setCombineReady(false);
        setCombineReview({ noteId: r.note_id, runId: r.run_id });
      }
    } finally { setCombining(false); }
  };

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

  const rootNotes = searching ? shown : shown.filter(({ note }) => !note.folder_id);
  const rootFolders = ws.folders.filter(f => !f.parent_id);
  const notesByFolder = new Map<string, typeof shown>();
  if (!searching) {
    for (const entry of shown) {
      const fid = entry.note.folder_id;
      if (fid) {
        const arr = notesByFolder.get(fid) ?? [];
        arr.push(entry);
        notesByFolder.set(fid, arr);
      }
    }
  }

  const hasContent = ws.notes.length > 0 || ws.folders.length > 0;

  return (
    <section className={`ctxp-library ctxp-dropzone ${incoming ? "is-target" : ""} ${incoming && over ? "is-over" : ""}`} aria-label="Library"
      onDragOver={e => { if (accepts(draggedItem(e))) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (!over) setOver(true); } }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }}
      onDrop={e => { const item = draggedItem(e); setOver(false); if (accepts(item)) { e.preventDefault(); endDrag(); onDrop(item); } }}>
      <div className="ctxp-library-top">
        <SectionHead title="Library" sub="shared across the workspace">
          {naming === null && namingFolder === null && !selecting && (
            <Menu label="New" className="act ctxp-add" icon="plus" text="New" items={[
              { label: "New item", icon: "plus", hint: "Write reference text once, use it in any thread", onSelect: () => setNaming("") },
              { label: "New folder", icon: "folder", hint: "Organize items into folders", onSelect: () => setNamingFolder("") },
              ...(ws.notes.length >= 2 ? [{ label: "Combine items…", icon: "merge", hint: B.combine_notes.tip, onSelect: () => { setSelecting(true); setSelected(new Set()); } }] : []),
            ]} />
          )}
          {selecting && (
            <button className="act ctxp-add" onClick={() => { setSelecting(false); setSelected(new Set()); setCombineReady(false); }}>
              Cancel
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
        {namingFolder !== null && (
          <form className="ctxp-form ctxp-new-form" onSubmit={e => { e.preventDefault(); void createFolder(); }}>
            <input autoFocus value={namingFolder} placeholder="Folder name" aria-label="Name of the new folder"
              onChange={e => setNamingFolder(e.target.value)} onKeyDown={e => { if (e.key === "Escape") setNamingFolder(null); }} />
            <div className="ctxp-form-actions">
              <button type="submit" className="btn btn-primary btn-xs" disabled={!namingFolder.trim()}>Create folder</button>
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => setNamingFolder(null)}>Cancel</button>
            </div>
          </form>
        )}
        {hasContent && (
          <div className="ctxp-filter">
            <Icon name="search" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find by name or text" aria-label="Find in the library"
              onKeyDown={e => { if (e.key === "Escape") setQ(""); }} />
            {q && <button className="icon-btn ctxp-filter-x" onClick={() => setQ("")} aria-label="Clear"><Icon name="close" /></button>}
          </div>
        )}
      </div>
      {selecting && (
        <div className="ctxp-combine-bar">
          {combineReady ? (
            <>
              <div className="ctxp-combine-bar-row">
                <span className="ctxp-combine-step">Instructions</span>
                <span className="spacer" />
                <button className="btn btn-ghost btn-xs" onClick={() => setCombineReady(false)}>Back</button>
                <button className="btn btn-primary btn-xs" disabled={combining}
                  onClick={() => void doCombine()}>
                  {combining ? "Combining…" : <><Icon name="merge" /> Combine</>}
                </button>
                <button className="btn btn-ghost btn-xs" onClick={() => { setSelecting(false); setSelected(new Set()); setCombineReady(false); }}>Cancel</button>
              </div>
              <textarea ref={instrRef} className="ctxp-combine-instr" value={combineInstr}
                onChange={e => setCombineInstr(e.target.value)} rows={3}
                onKeyDown={e => { if (e.key === "Escape") setCombineReady(false); }} />
            </>
          ) : (
            <>
              <span className="ctxp-combine-count">{selected.size} selected</span>
              <button className="btn btn-primary btn-xs" disabled={selected.size < 2}
                onClick={() => { setCombineReady(true); requestAnimationFrame(() => { instrRef.current?.focus(); instrRef.current?.select(); }); }}>
                Combine{selected.size >= 2 ? ` (${selected.size})` : ""}
              </button>
              <button className="btn btn-ghost btn-xs" onClick={() => { setSelecting(false); setSelected(new Set()); }}>Cancel</button>
            </>
          )}
        </div>
      )}
      {combineReview && (
        <CombineReview noteId={combineReview.noteId} runId={combineReview.runId}
          onDone={() => setCombineReview(null)} />
      )}
      {versioningNote && (
        <VersionDialog noteId={versioningNote} allNotes={ws.notes} onClose={() => setVersioningNote(null)} />
      )}
      {incoming && (
        <p className="ctxp-drop-hint is-library">
          {dragging!.kind === "pin" ? `Drop here to move it to the library — no longer sent in this ${where}` : `Drop here to stop using it in this ${where} — it stays in the library`}
        </p>
      )}
      <ul className="ctxp-list">
        {!searching && rootFolders.map(f => (
          <LibraryFolder key={f.id} folder={f} allFolders={ws.folders} notesByFolder={notesByFolder}
            allNotes={ws.notes} thread={thread} nextNotes={nextNotes} depth={0}
            selecting={selecting} selected={selected} toggleSelected={toggleSelected} onVersions={setVersioningNote} />
        ))}
        {rootNotes.map(({ note, snippet }) => (
          <LibraryRow key={note.id} thread={thread} note={note} snippet={snippet}
            queued={!!nextNotes?.includes(note.id)} folders={ws.folders} allNotes={ws.notes}
            selecting={selecting} selected={selected.has(note.id)} toggleSelected={toggleSelected}
            onVersions={setVersioningNote} />
        ))}
      </ul>
      {!hasContent && naming === null && namingFolder === null && (
        <p className="ctxp-empty">Nothing here yet. Write reference text once — a brief, a spec, a style guide — and use it in any thread.</p>
      )}
      {hasContent && rest.length === 0 && rootFolders.length === 0 && !needle && <p className="ctxp-empty">This {where} uses everything in the library.</p>}
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

function CombineReview({ noteId, runId, onDone }: { noteId: string; runId: string; onDone: () => void }) {
  const live = useStore(s => s.live);
  const run = useStore(s => s.run);
  const setUi = useStore(s => s.setUi);
  const note = useStore(s => s.ws?.notes.find(n => n.id === noteId));
  const [content, setContent] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [nameVal, setNameVal] = useState("");
  const [done, setDone] = useState(false);
  const initialHash = useRef<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const streaming = liveText(live, runId);

  useEffect(() => {
    if (!note) return;
    if (initialHash.current === null) {
      initialHash.current = note.content_hash;
    } else if (note.content_hash !== initialHash.current && !done) {
      setDone(true);
      read.note(noteId).then(d => setContent(d.content)).catch(() => {});
    }
  }, [noteId, note?.content_hash, done]);

  const drafting = !done;

  const text = drafting ? (streaming || "(combining…)") : content;
  const noteName = note?.name ?? "Combined item";
  const isPlaceholder = noteName.startsWith("Combining ");

  const accept = () => {
    flash(noteId);
    setOpen(noteId, true);
    onDone();
  };
  const discard = async () => {
    await run("delete_note", { note_id: noteId });
    onDone();
  };
  const saveEdit = async () => {
    if (!editText.trim()) return;
    await run("update_note", { note_id: noteId, content: editText.trim() });
    setEditing(false);
    setContent(editText.trim());
  };
  const saveName = async () => {
    if (!nameVal.trim()) return;
    await run("update_note", { note_id: noteId, name: nameVal.trim() });
    setRenaming(false);
  };

  return (
    <section className="ctxp-combine-review" aria-label="Combined item to review">
      <header className="ctxp-combine-review-head">
        <span className="ctxp-combine-review-title">
          {drafting ? <><span className="spinner is-inline" aria-hidden />Combining items…</> : "Review combined item"}
        </span>
      </header>
      {!drafting && (
        <div className="ctxp-combine-review-name">
          {renaming ? (
            <form onSubmit={e => { e.preventDefault(); void saveName(); }} className="ctxp-combine-rename">
              <input autoFocus value={nameVal} onChange={e => setNameVal(e.target.value)}
                onKeyDown={e => { if (e.key === "Escape") setRenaming(false); }}
                placeholder="Name" aria-label="Name" />
              <button type="submit" className="btn btn-xs" disabled={!nameVal.trim()}>Save</button>
              <button type="button" className="btn btn-ghost btn-xs" onClick={() => setRenaming(false)}>Cancel</button>
            </form>
          ) : (
            <span className="ctxp-combine-review-label">
              <strong>{noteName}</strong>
              <button className="btn btn-ghost btn-xs" onClick={() => { setNameVal(isPlaceholder ? "" : noteName); setRenaming(true); }}>Rename</button>
            </span>
          )}
        </div>
      )}
      {editing ? (
        <div className="ctxp-combine-edit">
          <textarea ref={textareaRef} value={editText} onChange={e => setEditText(e.target.value)} rows={6}
            onKeyDown={e => { if (e.key === "Escape") setEditing(false); if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void saveEdit(); }} />
          <div className="ctxp-form-actions">
            <button className="btn btn-primary btn-xs" onClick={() => void saveEdit()} disabled={!editText.trim()}>Save</button>
            <button className="btn btn-ghost btn-xs" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : text ? (
        <div className={`ctxp-combine-review-text msg-body is-output ${drafting ? "is-streaming" : ""}`}>
          <Md text={text} />
        </div>
      ) : !drafting ? (
        <p className="ctxp-empty">No content yet.</p>
      ) : null}
      {!drafting && (
        <div className="ctxp-combine-review-actions">
          <button className="btn btn-primary btn-xs" onClick={accept}><Icon name="check" /> Accept</button>
          <button className="btn btn-xs" onClick={() => { setEditText(content ?? ""); setEditing(true); requestAnimationFrame(() => textareaRef.current?.focus()); }}>Edit</button>
          <button className="btn btn-xs" onClick={() => setUi({ noteEditor: noteId })}>Full editor</button>
          <button className="btn btn-ghost btn-xs" onClick={() => void discard()}>Discard</button>
        </div>
      )}
      {drafting && (
        <div className="ctxp-combine-review-actions">
          <button className="btn btn-ghost btn-xs" onClick={() => void discard()}>Cancel</button>
        </div>
      )}
    </section>
  );
}

function LibraryFolder({ folder, allFolders, notesByFolder, allNotes, thread, nextNotes, depth, selecting, selected, toggleSelected, onVersions }: {
  folder: WsFolder; allFolders: WsFolder[]; allNotes: WsNote[];
  notesByFolder: Map<string, { note: WsNote; snippet: ReactNode | null }[]>;
  thread: ThreadSnapshot | null; nextNotes: string[] | undefined; depth: number;
  selecting: boolean; selected: Set<string>; toggleSelected: (id: string) => void;
  onVersions: (noteId: string) => void;
}) {
  const run = useStore(s => s.run);
  const expanded = usePanel(s => !!s.open[`folder:${folder.id}`]);
  const [renaming, setRenaming] = useState(false);
  const [namingSub, setNamingSub] = useState<string | null>(null);
  const [namingNote, setNamingNote] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const creatingNote = useRef(false);

  const toggle = () => setOpen(`folder:${folder.id}`, !expanded);
  const children = allFolders.filter(f => f.parent_id === folder.id);
  const notes = notesByFolder.get(folder.id) ?? [];
  const hasContent = children.length > 0 || notes.length > 0;

  const onDragOver = (e: React.DragEvent) => {
    const item = draggedItem(e);
    if (item?.kind === "library") { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (!over) setOver(true); }
  };
  const onDragLeave = (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); };
  const onFolderDrop = (e: React.DragEvent) => {
    const item = draggedItem(e);
    setOver(false);
    if (item?.kind === "library") {
      e.preventDefault(); e.stopPropagation(); endDrag();
      void run("move_note", { note_id: item.id, folder_id: folder.id });
      if (!expanded) toggle();
    }
  };

  const createSub = async () => {
    const name = namingSub?.trim();
    if (!name) return;
    const ws = useStore.getState().ws;
    if (!ws) return;
    const r = await run("create_folder", { workspace_id: ws.workspace.id, name, parent_id: folder.id });
    if (r) { setNamingSub(null); if (!expanded) toggle(); }
  };

  const createNote = async () => {
    const name = namingNote?.trim();
    if (!name || creatingNote.current) return;
    creatingNote.current = true;
    try {
      const ws = useStore.getState().ws;
      if (!ws) return;
      const r = await run("create_note", { workspace_id: ws.workspace.id, name, folder_id: folder.id, load_into_thread_id: thread?.thread.id });
      if (!r) return;
      setNamingNote(null);
      setOpen(r.note_id, true);
      usePanel.setState({ editing: r.note_id });
      flash(r.note_id);
    } finally { creatingNote.current = false; }
  };

  const menuItems: MenuItem[] = [
    { label: "New item here", icon: "plus", hint: "Created inside this folder", onSelect: () => { setNamingNote(""); if (!expanded) toggle(); } },
    { label: "Rename", icon: "edit", hint: B.rename_folder.tip, onSelect: () => setRenaming(true) },
    { label: "New subfolder", icon: "folder", hint: "A folder inside this folder", onSelect: () => { setNamingSub(""); if (!expanded) toggle(); } },
    ...folderMoveItemsForFolder(run, folder.id, folder.parent_id, allFolders),
    { separator: true },
    { label: "Delete folder", icon: "trash", danger: true, hint: B.delete_folder.tip, onSelect: async () => { await run("delete_folder", { folder_id: folder.id }); } },
  ];

  return (
    <li className={`ctxp-row ctxp-folder ${over ? "is-drop-target" : ""}`}>
      <div className="ctxp-row-line ctxp-folder-line" style={{ paddingLeft: depth * 12 }}
        onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onFolderDrop}>
        {renaming ? (
          <NameInput name={folder.name} onDone={name => { setRenaming(false); if (name) void run("rename_folder", { folder_id: folder.id, name }); }} />
        ) : (
          <button className="ctxp-row-text" onClick={toggle} aria-expanded={expanded}>
            <Icon name={expanded ? "chevronDown" : "chevronRight"} className="ctxp-caret" />
            <Icon name="folder" /><span className="ctxp-name">{folder.name}</span>
            {!hasContent && <span className="ctxp-tag">empty</span>}
          </button>
        )}
        {!renaming && (
          <span className="ctxp-row-actions">
            <Menu label={`${folder.name} folder actions`} className="act act-more" icon="more" items={menuItems} />
          </span>
        )}
      </div>
      {expanded && (
        <ul className="ctxp-list ctxp-nested">
          {namingSub !== null && (
            <li className="ctxp-row">
              <form className="ctxp-form ctxp-new-form" style={{ paddingLeft: (depth + 1) * 12 }} onSubmit={e => { e.preventDefault(); void createSub(); }}>
                <input autoFocus value={namingSub} placeholder="Subfolder name" aria-label="Name of the subfolder"
                  onChange={e => setNamingSub(e.target.value)} onKeyDown={e => { if (e.key === "Escape") setNamingSub(null); }} />
                <div className="ctxp-form-actions">
                  <button type="submit" className="btn btn-primary btn-xs" disabled={!namingSub.trim()}>Create</button>
                  <button type="button" className="btn btn-ghost btn-xs" onClick={() => setNamingSub(null)}>Cancel</button>
                </div>
              </form>
            </li>
          )}
          {namingNote !== null && (
            <li className="ctxp-row">
              <form className="ctxp-form ctxp-new-form" style={{ paddingLeft: (depth + 1) * 12 }} onSubmit={e => { e.preventDefault(); void createNote(); }}>
                <input autoFocus value={namingNote} placeholder="Name" aria-label="Name of the new library item"
                  onChange={e => setNamingNote(e.target.value)} onKeyDown={e => { if (e.key === "Escape") setNamingNote(null); }} />
                <div className="ctxp-form-actions">
                  <button type="submit" className="btn btn-primary btn-xs" disabled={!namingNote.trim()}>Create</button>
                  <button type="button" className="btn btn-ghost btn-xs" onClick={() => setNamingNote(null)}>Cancel</button>
                </div>
              </form>
            </li>
          )}
          {children.map(c => (
            <LibraryFolder key={c.id} folder={c} allFolders={allFolders} notesByFolder={notesByFolder}
              allNotes={allNotes} thread={thread} nextNotes={nextNotes} depth={depth + 1}
              selecting={selecting} selected={selected} toggleSelected={toggleSelected} onVersions={onVersions} />
          ))}
          {notes.map(({ note, snippet }) => (
            <LibraryRow key={note.id} thread={thread} note={note} snippet={snippet}
              queued={!!nextNotes?.includes(note.id)} folders={allFolders} allNotes={allNotes} depth={depth + 1}
              selecting={selecting} selected={selected.has(note.id)} toggleSelected={toggleSelected}
              onVersions={onVersions} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Compute the full version chain (newest→oldest) that a given note belongs to. */
function getVersionChain(noteId: string, allNotes: WsNote[]): WsNote[] {
  let head = allNotes.find(n => n.id === noteId);
  if (!head) return [];
  while (true) {
    const newer = allNotes.find(n => n.supersedes === head!.id);
    if (!newer) break;
    head = newer;
  }
  const chain: WsNote[] = [head];
  let cur = head;
  while (cur.supersedes) {
    const older = allNotes.find(n => n.id === cur.supersedes);
    if (!older) break;
    chain.push(older);
    cur = older;
  }
  return chain;
}

function VersionDialog({ noteId, allNotes, onClose }: {
  noteId: string; allNotes: WsNote[]; onClose: () => void;
}) {
  const run = useStore(s => s.run);
  const storeChain = getVersionChain(noteId, allNotes);
  const [optimistic, setOptimistic] = useState<WsNote[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  // Show optimistic chain during mutations; sync from store when idle
  const chain = optimistic ?? storeChain;
  useEffect(() => { if (!busy) setOptimistic(null); }, [busy, storeChain]);

  const inChain = new Set(chain.map(n => n.id));
  const available = allNotes.filter(n => !inChain.has(n.id));

  const relink = async (ordered: WsNote[]) => {
    setOptimistic(ordered);
    setBusy(true);
    try {
      // Clear all pointers first to avoid transient cycles, then set the new chain.
      const clears = ordered.filter(n => n.supersedes !== null);
      if (clears.length) await Promise.all(clears.map(n => run("link_note_version", { note_id: n.id, supersedes: null })));
      const links = ordered.slice(0, -1).map((n, i) => ({ note_id: n.id, supersedes: ordered[i + 1].id }));
      if (links.length) await Promise.all(links.map(op => run("link_note_version", op)));
    } finally { setBusy(false); }
  };

  const moveUp = (i: number) => {
    if (i <= 0 || busy) return;
    const next = [...chain];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    void relink(next);
  };

  const moveDown = (i: number) => {
    if (i >= chain.length - 1 || busy) return;
    const next = [...chain];
    [next[i], next[i + 1]] = [next[i + 1], next[i]];
    void relink(next);
  };

  const unlink = async (unlinkId: string) => {
    if (busy) return;
    const idx = chain.findIndex(n => n.id === unlinkId);
    if (idx < 0) return;
    setOptimistic(chain.filter(n => n.id !== unlinkId));
    setBusy(true);
    try {
      const successor = idx < chain.length - 1 ? chain[idx + 1].id : null;
      if (chain[idx].supersedes) {
        await run("link_note_version", { note_id: unlinkId, supersedes: null });
      }
      if (idx > 0) {
        await run("link_note_version", { note_id: chain[idx - 1].id, supersedes: successor });
      }
    } finally { setBusy(false); }
  };

  const addToChain = async (addId: string) => {
    if (busy) return;
    const added = allNotes.find(n => n.id === addId);
    if (added) setOptimistic([...chain, added]);
    setBusy(true);
    try {
      const tail = chain[chain.length - 1];
      await run("link_note_version", { note_id: tail.id, supersedes: addId });
      setAdding(false);
    } finally { setBusy(false); }
  };

  const hasChain = chain.length > 1;

  return (
    <div className="ctxp-version-dialog" onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } }}>
      <div className="ctxp-version-dialog-head">
        <span className="ctxp-version-dialog-title">Versions</span>
        <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
      </div>
      {hasChain ? (
        <>
          <p className="ctxp-version-dialog-hint">Newest on top. The top item is visible in the library; the rest are hidden.</p>
          <ul className="ctxp-version-chain">
            {chain.map((n, i) => (
              <li key={n.id} className={`ctxp-version-chain-item ${n.id === noteId ? "is-current" : ""}`}>
                <span className="ctxp-version-chain-pos">{i === 0 ? "newest" : i === chain.length - 1 ? "oldest" : ""}</span>
                <Icon name="note" />
                <span className="ctxp-version-chain-name" title={n.name}>{n.name}</span>
                <span className="ctxp-version-chain-actions">
                  <button className="icon-btn" disabled={i === 0 || busy} onClick={() => moveUp(i)} title="Move newer" aria-label="Move newer"><Icon name="arrowUp" /></button>
                  <button className="icon-btn" disabled={i === chain.length - 1 || busy} onClick={() => moveDown(i)} title="Move older" aria-label="Move older"><Icon name="arrowDown" /></button>
                  <button className="icon-btn" disabled={busy} onClick={() => void unlink(n.id)} title="Remove from chain" aria-label="Unlink"><Icon name="close" /></button>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="ctxp-version-dialog-empty">This item isn't linked to any other versions.</p>
      )}
      {adding ? (
        <div className="ctxp-version-add">
          <VersionNotePicker notes={available} onPick={id => void addToChain(id)} onCancel={() => setAdding(false)} />
        </div>
      ) : (
        <button className="btn btn-xs ctxp-version-add-btn" disabled={available.length === 0} onClick={() => setAdding(true)}>
          <Icon name="plus" /> {hasChain ? "Add another version" : "Link an item as a version"}
        </button>
      )}
    </div>
  );
}

function VersionNotePicker({ notes, onPick, onCancel }: {
  notes: WsNote[]; onPick: (id: string) => void; onCancel: () => void;
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const filtered = needle ? notes.filter(n => n.name.toLowerCase().includes(needle)) : notes;

  return (
    <div className="ctxp-picker" onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCancel(); } }}>
      <div className="ctxp-picker-head">
        <span className="ctxp-picker-title">Pick an item</span>
        <button className="icon-btn" onClick={onCancel} aria-label="Cancel"><Icon name="close" /></button>
      </div>
      {notes.length > 4 && (
        <input className="ctxp-picker-search" autoFocus value={q} onChange={e => setQ(e.target.value)}
          placeholder="Search items" aria-label="Search items" />
      )}
      <ul className="ctxp-picker-list">
        {filtered.map(n => (
          <li key={n.id}>
            <button className="ctxp-picker-item" onClick={() => onPick(n.id)}>
              <Icon name="note" />
              {n.name}
            </button>
          </li>
        ))}
        {filtered.length === 0 && <li className="ctxp-picker-empty">{notes.length === 0 ? "No other items available" : "No items match"}</li>}
      </ul>
    </div>
  );
}

function LibraryRow({ thread, note, snippet, queued, folders, depth = 0, selecting, selected, toggleSelected, onVersions }: {
  thread: ThreadSnapshot | null; note: WsNote; snippet: ReactNode | null; queued: boolean;
  folders: WsFolder[]; allNotes?: WsNote[]; depth?: number;
  selecting: boolean; selected: boolean; toggleSelected: (id: string) => void;
  onVersions: (noteId: string) => void;
}) {
  const run = useStore(s => s.run);
  const setUi = useStore(s => s.setUi);
  const setNextNotes = useStore(s => s.setNextNotes);
  const nextNotes = useStore(s => (thread ? s.nextNotes[thread.thread.id] : undefined)) ?? NONE;
  const wsNotes = useStore(s => s.ws?.notes) ?? [];
  const open = usePanel(s => !!s.open[note.id]);
  const unsaved = usePanel(s => s.drafts[note.id] !== undefined);
  const flashing = useFlash(note.id);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [moving, setMoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const chat = !!thread && thread.thread.kind !== "template";
  const where = thread?.thread.kind === "template" ? "template" : "thread";

  const hasVersions = wsNotes.some(n => n.supersedes === note.id || n.id === note.supersedes);

  const toggleNext = () => {
    if (!thread) return;
    setNextNotes(thread.thread.id, queued ? nextNotes.filter(id => id !== note.id) : [...nextNotes, note.id]);
  };

  // Menu: cognitive groups — Use / Change / Organize / Delete
  const items: MenuItem[] = [];
  if (thread) {
    items.push({ label: `Add to this ${where}`, icon: "plus", hint: B.place_item.tip, onSelect: async () => { if (await ops.addItem(thread, note.id)) flash(note.id); } });
    if (chat) items.push({ label: queued ? "Don't send with my next message" : "Send with my next message", icon: "paperclip", hint: queued ? "It stays in the library — just won't go with your next message" : "It goes with the message you send next", onSelect: toggleNext });
    items.push({ separator: true });
  }
  items.push(
    { label: "Edit the text", icon: "edit", hint: B.update_note.tip, onSelect: () => { setOpen(note.id, true); usePanel.setState({ editing: note.id }); } },
    { label: "Rename", icon: "edit", hint: B["update_note:name"].tip, onSelect: () => setRenaming(true) },
    { label: "Full editor", icon: "external", hint: "More space, richer editing — same shared text", onSelect: () => setUi({ noteEditor: note.id }) },
    { separator: true },
    { label: "Versions…", icon: "merge", hint: B.link_note_version.tip, onSelect: () => onVersions(note.id) },
  );
  if (folders.length > 0) {
    items.push({ label: "Move to…", icon: "folder", hint: B.move_note.tip, onSelect: () => setMoving(true) });
  }
  items.push(
    { label: "Duplicate", icon: "copy", hint: B.duplicate_note.tip, onSelect: async () => { const id = await ops.duplicate(note.id, note.name); if (id) flash(id); } },
    { separator: true },
    { label: "Delete…", icon: "trash", danger: true, hint: B.delete_note.tip, onSelect: () => setDeleting(true) },
  );

  // -- Inline dialogs (replace the row when active) --

  if (deleting) {
    return (
      <li className="ctxp-row ctxp-lib is-confirming">
        <div className="ctxp-confirm" role="alertdialog" aria-label={`Delete ${note.name}`}
          onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setDeleting(false); } }}>
          <p>Delete "{note.name}" for good?{note.used_in > 0 ? ` It's removed from ${note.used_in} thread${note.used_in === 1 ? "" : "s"}.` : ""} This can't be undone.</p>
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

  if (moving) {
    return (
      <li className="ctxp-row ctxp-lib is-confirming">
        <FolderPicker folders={folders} currentFolderId={note.folder_id} onPick={folderId => {
          setMoving(false);
          void run("move_note", { note_id: note.id, folder_id: folderId });
        }} onCancel={() => setMoving(false)} />
      </li>
    );
  }

  return (
    <li className={["ctxp-row", "ctxp-lib", "is-draggable", flashing ? "is-flash" : "", open ? "is-open" : "", selecting && selected ? "is-selected" : ""].join(" ")}>
      <div className="ctxp-row-line" style={depth ? { paddingLeft: depth * 12 } : undefined} draggable={!renaming && !selecting}
        onDragStart={e => { if (selecting) return; startDrag(e, { kind: "library", id: note.id, label: note.name }); }}
        onDragEnd={endDrag}>
        {selecting && (
          <input type="checkbox" className="ctxp-select-check" checked={selected}
            onChange={() => toggleSelected(note.id)} aria-label={`Select ${note.name}`} />
        )}
        {renaming ? (
          <NameInput name={note.name} onDone={name => { setRenaming(false); if (name) void ops.rename(note.id, name); }} />
        ) : (
          <button className="ctxp-row-text" aria-expanded={selecting ? undefined : open}
            onClick={() => selecting ? toggleSelected(note.id) : setOpen(note.id, !open)}
            title={selecting ? "Select to combine" : open ? "Close" : "Read it here"}>
            <Icon name="note" /><span className="ctxp-name">{note.name}</span>
            {note.copied_from && <span className="ctxp-tag" title="A separate copy of a shared library item">copy</span>}
            {hasVersions && <span className="ctxp-tag is-version" title="Has linked versions">versions</span>}
            {queued && <span className="ctxp-tag is-next" title="It goes with the next message you send">next message</span>}
            {unsaved && !open && <span className="ctxp-tag is-unsaved" title="You started editing its text; open it to save or discard">unsaved</span>}
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

/** Searchable folder picker dialog — replaces menu-vomit folder lists. */
function FolderPicker({ folders, currentFolderId, onPick, onCancel }: {
  folders: WsFolder[]; currentFolderId: string | null;
  onPick: (folderId: string | null) => void; onCancel: () => void;
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const flat: { id: string | null; name: string; depth: number }[] = [];
  if (currentFolderId) flat.push({ id: null, name: "Top level", depth: 0 });
  const addFolder = (f: WsFolder, depth: number) => {
    if (f.id === currentFolderId) return;
    flat.push({ id: f.id, name: f.name, depth });
    for (const child of folders.filter(c => c.parent_id === f.id)) addFolder(child, depth + 1);
  };
  for (const f of folders.filter(f => !f.parent_id)) addFolder(f, 0);
  const filtered = needle ? flat.filter(f => f.name.toLowerCase().includes(needle)) : flat;

  return (
    <div className="ctxp-picker" onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCancel(); } }}>
      <div className="ctxp-picker-head">
        <span className="ctxp-picker-title">Move to</span>
        <button className="icon-btn" onClick={onCancel} aria-label="Cancel"><Icon name="close" /></button>
      </div>
      {flat.length > 4 && (
        <input className="ctxp-picker-search" autoFocus value={q} onChange={e => setQ(e.target.value)}
          placeholder="Search folders" aria-label="Search folders" />
      )}
      <ul className="ctxp-picker-list">
        {filtered.map((f) => (
          <li key={f.id ?? "top"}>
            <button className="ctxp-picker-item" style={f.depth && !needle ? { paddingLeft: f.depth * 14 + 8 } : undefined}
              onClick={() => onPick(f.id)}>
              <Icon name={f.id ? "folder" : "note"} />
              {f.name}
            </button>
          </li>
        ))}
        {filtered.length === 0 && <li className="ctxp-picker-empty">No folders match</li>}
      </ul>
    </div>
  );
}
