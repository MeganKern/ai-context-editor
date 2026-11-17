import { Fragment, useMemo, useState } from "react";
import type { FolderRow, ThreadRow } from "../../../../shared/snapshot.js";
import { run, useModel } from "../../data/model.js";
import { usePrefs, toggleListed } from "../../session/prefs.js";
import { useRows, rows } from "../../session/rows.js";
import { navigate, useRoute } from "../../session/route.js";
import { marksOf, threadTree, type Mark, type Marks, type ThreadNode, type ThreadTree as Tree } from "../../derive/threads.js";
import { draggedItem, endDrag, startDrag } from "../../data/drag.js";
import { plural } from "../../derive/text.js";
import type { HelpKey } from "../../help/entries.js";
import { Icon } from "../../kit/Icon.js";
import { Menu } from "../../kit/Menu.js";
import { InlineForm } from "../../kit/InlineForm.js";
import { NameInput } from "../../kit/Fields.js";
import { threadMenu } from "./ThreadMenu.js";

/** Where a dragged thread would land: a folder, or out of every folder. */
type DropTarget = { folderId: string | null } | null;

/**
 * The threads, where the server places them: in folders or none, branches under the thread they
 * came from; templates listed, their runs on their own page. A row is plain when all is well and
 * carries one mark when there's something for you — failed (coral), a summary to review (amber),
 * a result you haven't seen (white) — or a quiet spinner while something is running. A template's
 * row, like a closed folder, rolls up what's inside: its runs' threads and their branches.
 */
export function ThreadTree({ newFolder, onNewFolder }: { newFolder: string | null; onNewFolder: (v: string | null) => void }) {
  const ws = useModel(s => s.ws)!;
  const tree = useMemo(() => threadTree(ws), [ws]);
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);
  const [dragging, setDragging] = useState(false);
  const collapsed = usePrefs(s => s.collapsedFolders);
  const activeId = useRoute(s => s.threadId);
  // The thread being viewed may be on a template's page (those aren't listed); its template stays lit.
  const highlightId = tree.byId.get(activeId ?? "")?.place.template_id ?? activeId;

  const dropProps = (folderId: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      if (draggedItem(e)?.kind !== "thread") return;
      e.preventDefault(); setDropTarget({ folderId });
    },
    onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget(null); },
    onDrop: (e: React.DragEvent) => {
      const item = draggedItem(e);
      setDropTarget(null); setDragging(false);
      if (item?.kind === "thread") { e.preventDefault(); endDrag(); void run("move_thread", { thread_id: item.id, folder_id: folderId }); }
    },
  });

  const hasFolders = tree.folders.length > 0;
  return (
    <>
      {newFolder !== null && (
        <InlineForm className="tree-form-new" value={newFolder} onChange={onNewFolder} placeholder="Folder name" label="New folder name" help="create_folder"
          onSubmit={() => void run("create_folder", { workspace_id: ws.workspace.id, name: newFolder.trim(), scope: "threads" }).then(ok => { if (ok) onNewFolder(null); })}
          onCancel={() => onNewFolder(null)} />
      )}
      {tree.folders.map(({ folder, threads }) => {
        const isCollapsed = collapsed.includes(folder.id);
        const inside = threads.flatMap(tree.descendants);
        return (
          <div key={folder.id} className={`folder ${dropTarget?.folderId === folder.id ? "is-drop" : ""}`} {...dropProps(folder.id)}>
            <FolderRow folder={folder} collapsed={isCollapsed} containsActive={inside.some(t => t.id === highlightId)}
              marks={isCollapsed ? marksOf(inside, activeId) : null} onToggle={() => toggleListed("collapsedFolders", folder.id)} />
            {!isCollapsed && threads.map(n => <ThreadRows key={n.row.id} node={n} tree={tree} nested highlightId={highlightId} onDrag={setDragging} />)}
            {!isCollapsed && threads.length === 0 && <div className="sb-empty is-nested in-folder">Empty — drag threads here</div>}
          </div>
        );
      })}
      {hasFolders && (tree.unfiled.length > 0 || dragging) && (
        <div className={`sb-label sb-drop ${dragging ? "is-dragging" : ""} ${dropTarget && dropTarget.folderId === null ? "is-drop" : ""}`} {...dropProps(null)}>
          {dragging ? "Drop here to take it out of its folder" : "No folder"}
        </div>
      )}
      <div {...(hasFolders ? dropProps(null) : {})}>
        {tree.unfiled.map(n => <ThreadRows key={n.row.id} node={n} tree={tree} nested={false} highlightId={highlightId} onDrag={setDragging} />)}
      </div>
      {ws.threads.length === 0 && <div className="sb-empty sb-empty-start">No threads yet.</div>}
    </>
  );
}

/** The one mark for what needs you, drawn the same way on a thread and on a group. */
const MARK: Record<Mark, { title: string; label: string; help: HelpKey }> = {
  failed: { title: "Something failed here", label: "something failed", help: "sb.failed" },
  review: { title: "A summary is waiting for your review", label: "summary to review", help: "sb.review" },
  unseen: { title: "Finished since you last looked", label: "new result", help: "sb.new" },
};
function MarkDot({ mark, inside }: { mark: Mark; inside?: boolean }) {
  const m = MARK[mark];
  return <span className={`row-mark is-${mark}`} data-help={inside ? "sb.folder-mark" : m.help} title={inside ? `${m.title.replace(" here", " in here")}` : m.title} aria-label={inside ? `${m.label} inside` : m.label} />;
}

function FolderRow({ folder, collapsed, containsActive, marks, onToggle }: {
  folder: FolderRow; collapsed: boolean; containsActive: boolean; marks: Marks | null; onToggle: () => void;
}) {
  const renaming = useRows(s => s.renaming === folder.id);
  if (renaming) {
    return (
      <div className="tree-form tree-form-rename">
        <NameInput name={folder.name} onDone={name => { rows.rename(null); if (name) void run("rename_folder", { folder_id: folder.id, name }); }} />
      </div>
    );
  }
  return (
    <div className="tree-row folder-row">
      <button className="folder-toggle" data-help="sb.folder" onClick={onToggle} aria-expanded={!collapsed} onDoubleClick={() => rows.rename(folder.id)}>
        <Icon name={collapsed ? "chevronRight" : "chevronDown"} className="tree-icon" />
        <span className="tree-label">{folder.name}</span>
        {collapsed && containsActive && <span className="live-dot" data-help="sb.folder-open-thread" title="The thread you have open is in here" aria-label="contains the open thread" />}
        {marks?.running && <span className="spinner" data-help="sb.folder-working" title="Something in here is working — a reply, agent or template run" aria-label="working inside" />}
        {marks?.mark && <MarkDot mark={marks.mark} inside />}
      </button>
      <Menu label={`Folder ${folder.name}`} className="icon-btn row-menu" items={[
        { label: "Rename folder", icon: "edit", help: "rename_folder", onSelect: () => rows.rename(folder.id) },
        { label: "Remove folder", icon: "close", help: "delete_folder", onSelect: () => void run("delete_folder", { folder_id: folder.id }) },
      ]} />
    </div>
  );
}

/** A thread's row, and under it the rows of its branches. */
function ThreadRows({ node, tree, nested, highlightId, onDrag, depth = 0 }: {
  node: ThreadNode; tree: Tree; nested: boolean; highlightId: string | null; onDrag: (on: boolean) => void; depth?: number;
}) {
  return (
    <Fragment>
      <ThreadRowView t={node.row} tree={tree} nested={nested} depth={depth} active={node.row.id === highlightId} onDrag={onDrag} />
      {node.branches.map(b => <ThreadRows key={b.row.id} node={b} tree={tree} nested={nested} highlightId={highlightId} onDrag={onDrag} depth={depth + 1} />)}
    </Fragment>
  );
}

export function ThreadRowView({ t, tree, nested, depth, active, onDrag }: {
  t: ThreadRow; tree: Tree; nested: boolean; depth: number; active: boolean; onDrag?: (on: boolean) => void;
}) {
  const open = useModel(s => s.thread);
  const hideExcluded = usePrefs(s => s.hideExcluded);
  const activeId = useRoute(s => s.threadId);
  const renaming = useRows(s => s.renaming === t.id);
  const isOpen = t.id === activeId;
  // A template's row speaks for its page too; the open thread carries no mark: what it would say is on screen.
  const group = t.kind === "template" ? [t, ...tree.templatePage(t.id).runs.flatMap(tree.descendants)] : [t];
  const marks = marksOf(group, activeId);
  const title = t.kind === "template"
    ? `${t.name} — template${t.template_runs ? `, run ${plural(t.template_runs, "time")}` : ""}`
    : depth ? `${t.name} — a branch` : t.name;
  const help: HelpKey = t.kind === "template" ? "sb.template" : depth ? "sb.branch" : "sb.thread";
  return (
    <div className={`tree-row thread-row ${nested ? "is-nested" : ""} ${depth ? "is-branch" : ""} ${active ? "is-active" : ""} ${renaming ? "is-renaming" : ""}`}
      style={depth ? { ["--branch-depth" as string]: depth } : undefined}>
      {renaming ? (
        <NameInput name={t.name} onDone={name => { rows.rename(null); if (name) void run("rename_thread", { thread_id: t.id, name }); }} />
      ) : (
        <button className="thread-row-btn" data-help={help} onClick={() => navigate({ threadId: t.id })} aria-current={isOpen ? "page" : undefined}
          draggable={!depth}
          onDragStart={e => { startDrag(e, { kind: "thread", id: t.id, label: t.name }); onDrag?.(true); }}
          onDragEnd={() => { endDrag(); onDrag?.(false); }}
          title={title}>
          {t.kind === "template" && <Icon name="template" className="tree-icon is-template" />}
          {depth > 0 && <Icon name="nest" className="tree-icon is-branch" />}
          <span className="tree-label">{t.name}</span>
          {marks.mark && (marks.mark !== "unseen" || !marks.running) ? <MarkDot mark={marks.mark} />
            : marks.running ? <span className="spinner" data-help="sb.working" title="Working — a reply, agent or template run is in progress" aria-label="working" />
            : null}
        </button>
      )}
      <Menu label="Thread actions" className="thread-row-more" icon="more" items={threadMenu(t, tree, open, hideExcluded)} />
    </div>
  );
}
