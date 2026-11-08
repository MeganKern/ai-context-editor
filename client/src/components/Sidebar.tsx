import React, { useState, useRef, useEffect, useCallback, Fragment } from "react";
import { useStore } from "../store.js";
import { read } from "../api.js";
import type { SearchHit, SearchPlace, WorkspaceSnapshot } from "../../../shared/snapshot.js";
import { Icon } from "./Icon.js";
import { Menu } from "./Menu.js";
import { homePath, plain } from "../format.js";
import { BEHAVIOUR as B } from "../../../shared/behaviour.js";

type ThreadRow = WorkspaceSnapshot["threads"][number];

function renderSnippet(snippet: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let rest = snippet;
  let i = 0;
  while (rest.length > 0) {
    const start = rest.indexOf("<<");
    if (start === -1) { parts.push(rest); break; }
    if (start > 0) parts.push(rest.slice(0, start));
    const end = rest.indexOf(">>", start);
    if (end === -1) { parts.push(rest.slice(start)); break; }
    parts.push(<mark key={i++}>{rest.slice(start + 2, end)}</mark>);
    rest = rest.slice(end + 2);
  }
  return parts;
}

/** The other threads a found text is in (its copies in branches, mostly), each one click away. */
function AlsoIn({ places, onOpen }: { places: SearchPlace[]; onOpen: (p: SearchPlace) => void }) {
  const [all, setAll] = useState(false);
  const SHOWN = 5;
  const shown = all ? places : places.slice(0, SHOWN);
  return (
    <div className="search-hit-also">
      <span>Also in </span>
      {shown.map((p, i) => (
        <Fragment key={p.message_id}>
          {i > 0 && ", "}
          <button className="search-hit-also-link" onClick={() => onOpen(p)}
            title={p.template_name ? `${p.thread_name} · run of ${p.template_name}` : p.thread_name}>{p.thread_name}</button>
        </Fragment>
      ))}
      {!all && places.length > SHOWN && (
        <>, <button className="search-hit-also-link" onClick={() => setAll(true)}>{places.length - SHOWN} more</button></>
      )}
    </div>
  );
}

/**
 * Left column: where things live, and the status board for the threads you aren't looking
 * at. A row is plain when all is well; it gets one mark when there's something for you —
 * failed (coral), a summary to review (amber), a result you haven't seen (white) — or a quiet
 * spinner while something is running. Creating things stays available but quiet. The
 * library lives in the right panel, with the rest of the context.
 */
export function Sidebar() {
  const ws = useStore(s => s.ws);
  const workspaces = useStore(s => s.workspaces);
  const loadWorkspaces = useStore(s => s.loadWorkspaces);
  const activeThreadId = useStore(s => s.activeThreadId);
  const openThread = useStore(s => s.openThread);
  const openWorkspace = useStore(s => s.openWorkspace);
  const run = useStore(s => s.run);
  const setUi = useStore(s => s.setUi);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[] | null>(null);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [newThread, setNewThread] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("desk.collapsedFolders") ?? "[]")); } catch { return new Set(); }
  });
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { void loadWorkspaces(); }, [loadWorkspaces]);

  const wsId = ws?.workspace.id;
  const doSearch = useCallback(async (q: string) => {
    if (!q.trim() || !wsId) { setResults(null); return; }
    try { setResults(await read.search(wsId, q.trim())); } catch { setResults([]); }
  }, [wsId]);
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  if (!ws) return null;

  const persistCollapsed = (next: Set<string>) => {
    setCollapsed(next);
    try { localStorage.setItem("desk.collapsedFolders", JSON.stringify([...next])); } catch { /* private mode */ }
  };
  const toggleFolder = (id: string) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id); else next.add(id);
    persistCollapsed(next);
  };

  const folders = ws.folders;
  const threads = ws.threads;
  // Where each thread is shown comes from the server: a template's runs (and their branches) are
  // on its page; a branch sits under the thread it came from; the rest are in a folder or none.
  const listed = threads.filter(t => t.place.template_id === null);
  const branchesOf = new Map<string, ThreadRow[]>();
  for (const t of listed) if (t.place.parent_id) branchesOf.set(t.place.parent_id, [...(branchesOf.get(t.place.parent_id) ?? []), t]);
  for (const list of branchesOf.values()) list.sort((a, b) => a.created_at.localeCompare(b.created_at));
  const withBranches = (t: ThreadRow): ThreadRow[] => [t, ...(branchesOf.get(t.id) ?? []).flatMap(withBranches)];
  const topLevel = listed.filter(t => !t.place.parent_id);
  const unfiled = topLevel.filter(t => !t.place.folder_id);
  const byFolder = new Map<string, ThreadRow[]>();
  for (const t of topLevel) {
    if (t.place.folder_id) byFolder.set(t.place.folder_id, [...(byFolder.get(t.place.folder_id) ?? []), t]);
  }

  const onSearch = (q: string) => {
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(q), 250);
  };
  const clearSearch = () => { setQuery(""); setResults(null); };

  const createThread = async () => {
    const name = newThread?.trim();
    if (!name) return;
    const r = await run("create_thread", { workspace_id: ws.workspace.id, name });
    if (r) { setNewThread(null); clearSearch(); openThread(r.thread_id); setUi({ sidebarOpen: false }); }
  };

  // The thread being viewed may be on a template's page (those aren't listed); keep its template lit.
  const highlightId = threads.find(t => t.id === activeThreadId)?.place.template_id ?? activeThreadId;

  const dropProps = (folderId: string | null) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes("application/x-thread")) return;
      e.preventDefault(); setDropTarget(folderId ?? "__none__");
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget(null);
    },
    onDrop: (e: React.DragEvent) => {
      setDropTarget(null); setDragging(false);
      const tid = e.dataTransfer.getData("application/x-thread");
      if (tid) void run("move_thread", { thread_id: tid, folder_id: folderId });
    },
  });

  // The open thread carries no mark: what it would say is on screen.
  const marker = (t: ThreadRow) => {
    const st = t.id === activeThreadId ? null : t.flags;
    if (st?.failed) return <span className="row-mark is-failed" title="Something failed here" aria-label="something failed" />;
    if (st?.review) return <span className="row-mark is-review" title="A summary is waiting for your review" aria-label="summary to review" />;
    if (t.flags.running) return <span className="spinner" title="Working — a reply, agent or template run is in progress" aria-label="working" />;
    if (st?.unseen) return <span className="row-mark is-new" title="Finished since you last looked" aria-label="new result" />;
    return null;
  };

  const renderThread = (t: ThreadRow, nested: boolean, depth = 0, withBranchRows = true): React.ReactNode => (
    <Fragment key={t.id}>
      <button
        className={`tree-row thread-row ${nested ? "is-nested" : ""} ${depth ? "is-branch" : ""} ${t.id === highlightId ? "is-active" : ""}`}
        style={depth ? { ["--branch-depth" as string]: depth } : undefined}
        onClick={() => { openThread(t.id); setUi({ sidebarOpen: false }); }}
        aria-current={t.id === activeThreadId ? "page" : undefined}
        draggable={!depth}
        onDragStart={e => {
          e.dataTransfer.setData("application/x-thread", t.id);
          e.dataTransfer.effectAllowed = "move";
          setDragging(true);
        }}
        onDragEnd={() => { setDragging(false); setDropTarget(null); }}
        title={t.kind === "template"
          ? `${t.name} — template${t.template_runs ? `, run ${t.template_runs} time${t.template_runs === 1 ? "" : "s"}` : ""}`
          : depth ? `${t.name} — a branch` : t.name}
      >
        {t.kind === "template" && <Icon name="template" className="tree-icon is-template" />}
        {depth > 0 && <Icon name="nest" className="tree-icon is-branch" />}
        <span className="tree-label">{t.name}</span>
        {marker(t)}
      </button>
      {withBranchRows && (branchesOf.get(t.id) ?? []).map(b => renderThread(b, nested, depth + 1))}
    </Fragment>
  );

  const nameMatches = query.trim()
    ? threads.filter(t => t.name.toLowerCase().includes(query.trim().toLowerCase()))
    : [];

  const otherWorkspaces = workspaces.filter(w => w.id !== ws.workspace.id);

  return (
    <nav className="sidebar" aria-label="Workspace">
      <div className="sb-top">
        <Menu
          label="Switch workspace"
          className="ws-switch"
          align="start"
          icon={null}
          text={<><span className="ws-name">{ws.workspace.name}</span><Icon name="chevronDown" /></>}
          title={`Agents in this workspace start in ${ws.workspace.path}`}
          items={[
            { heading: `Agents start in ${homePath(ws.workspace.path)}` },
            ...otherWorkspaces.map(w => ({ label: w.name, icon: "workspace" as const, onSelect: () => openWorkspace(w.id) })),
            ...(otherWorkspaces.length ? [{ separator: true as const }] : []),
            { label: "All workspaces…", icon: "chevronLeft" as const, onSelect: () => openWorkspace("") },
          ]}
        />
        <div className="sb-search">
          <Icon name="search" />
          <input
            id="sidebar-search"
            value={query}
            onChange={e => onSearch(e.target.value)}
            onKeyDown={e => { if (e.key === "Escape") clearSearch(); }}
            placeholder="Search"
            aria-label="Search threads and messages"
          />
          {query && (
            <button className="icon-btn" onClick={clearSearch} aria-label="Clear search"><Icon name="close" /></button>
          )}
        </div>
        {newThread === null ? (
          <button className="sb-more-btn sb-new-thread" onClick={() => setNewThread("")}>
            <Icon name="plus" /> New thread
          </button>
        ) : (
          <form className="sb-new-form" onSubmit={e => { e.preventDefault(); void createThread(); }}>
            <input autoFocus value={newThread} placeholder="Thread name" aria-label="New thread name"
              onChange={e => setNewThread(e.target.value)}
              onKeyDown={e => { if (e.key === "Escape") setNewThread(null); }} />
            <div className="sb-new-form-actions">
              <button type="submit" className="btn btn-primary btn-sm" disabled={!newThread.trim()}>Create</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNewThread(null)}>Cancel</button>
            </div>
          </form>
        )}
      </div>

      <div className="sb-scroll">
        {query.trim() ? (
          <div className="search-results">
            <div className="sb-label">Thread names</div>
            {nameMatches.length === 0 && <div className="sb-empty">No thread names match</div>}
            {nameMatches.map(t => renderThread(t, false, 0, false))}
            <div className="sb-label">In messages</div>
            {results === null && <div className="sb-empty">Searching…</div>}
            {results?.length === 0 && <div className="sb-empty">No messages match</div>}
            {results?.map(hit => (
              <div key={hit.message_id} className="search-hit-group">
                <button className="search-hit" onClick={() => openThread(hit.thread_id, { focus: hit.message_id })}>
                  <span className="search-hit-thread">
                    {hit.thread_name}
                    {hit.template_name && <span className="search-hit-tpl"> · run of {hit.template_name}</span>}
                  </span>
                  <span className="search-hit-snippet">{renderSnippet(plain(hit.snippet))}</span>
                </button>
                {hit.also_in.length > 0 && (
                  <AlsoIn places={hit.also_in} onOpen={p => openThread(p.thread_id, { focus: p.message_id })} />
                )}
              </div>
            ))}
          </div>
        ) : (
          <>
            {newFolder !== null && (
              <form className="tree-form tree-form-rename" onSubmit={async e => {
                e.preventDefault();
                if (!newFolder.trim()) return;
                await run("create_folder", { workspace_id: ws.workspace.id, name: newFolder.trim() });
                setNewFolder(null);
              }}>
                <input autoFocus value={newFolder} placeholder="Folder name" aria-label="New folder name"
                  onChange={e => setNewFolder(e.target.value)}
                  onKeyDown={e => { if (e.key === "Escape") setNewFolder(null); }} />
                <div className="tree-form-actions">
                  <button type="submit" className="btn btn-primary btn-xs" disabled={!newFolder.trim()}>Create</button>
                  <button type="button" className="btn btn-ghost btn-xs" onClick={() => setNewFolder(null)}>Cancel</button>
                </div>
              </form>
            )}

            {folders.map(f => {
              const inFolder = byFolder.get(f.id) ?? [];
              // A closed folder's marks count the branches of what's in it too.
              const family = inFolder.flatMap(withBranches);
              const isCollapsed = collapsed.has(f.id);
              const containsActive = family.some(t => t.id === highlightId);
              // Closed, the folder carries the most urgent mark inside, in that mark's own colour.
              const inside = family.filter(t => t.id !== activeThreadId).map(t => t.flags);
              const waiting = inside.some(st => st?.failed) ? "failed" : inside.some(st => st?.review) ? "review" : inside.some(st => st?.unseen) ? "new" : null;
              return (
                <div key={f.id} className={`folder ${dropTarget === f.id ? "is-drop" : ""}`} {...dropProps(f.id)}>
                  {renaming?.id === f.id ? (
                    <form className="tree-form tree-form-rename" onSubmit={async e => {
                      e.preventDefault();
                      if (renaming.name.trim()) await run("rename_folder", { folder_id: f.id, name: renaming.name.trim() });
                      setRenaming(null);
                    }}>
                      <input autoFocus value={renaming.name} aria-label="Folder name"
                        onChange={e => setRenaming({ id: f.id, name: e.target.value })}
                        onKeyDown={e => { if (e.key === "Escape") setRenaming(null); }} />
                      <div className="tree-form-actions">
                        <button type="submit" className="btn btn-primary btn-xs" disabled={!renaming.name.trim()}>Save</button>
                        <button type="button" className="btn btn-ghost btn-xs" onClick={() => setRenaming(null)}>Cancel</button>
                      </div>
                    </form>
                  ) : (
                    <div className="tree-row folder-row">
                      <button className="folder-toggle" onClick={() => toggleFolder(f.id)} aria-expanded={!isCollapsed}
                        onDoubleClick={() => setRenaming({ id: f.id, name: f.name })}>
                        <Icon name={isCollapsed ? "chevronRight" : "chevronDown"} className="tree-icon" />
                        <span className="tree-label">{f.name}</span>
                        {isCollapsed && containsActive && <span className="live-dot is-quiet" title="The thread you have open is in here" aria-label="contains the open thread" />}
                        {isCollapsed && family.some(t => t.flags.running) &&
                          <span className="spinner" title="Something in here is working — a reply, agent or template run" aria-label="working inside" />}
                        {isCollapsed && waiting === "failed" &&
                          <span className="row-mark is-failed" title="Something in here failed" aria-label="something failed inside" />}
                        {isCollapsed && waiting === "review" &&
                          <span className="row-mark is-review" title="A summary in here is waiting for your review" aria-label="summary to review inside" />}
                        {isCollapsed && waiting === "new" &&
                          <span className="row-mark is-new" title="Something in here finished since you last looked" aria-label="new result inside" />}
                      </button>
                      <Menu label={`Folder ${f.name}`} className="icon-btn row-menu" items={[
                        { label: "Rename folder", icon: "edit", onSelect: () => setRenaming({ id: f.id, name: f.name }) },
                        { label: "Remove folder", icon: "close", hint: B.delete_folder.tip,
                          onSelect: () => run("delete_folder", { folder_id: f.id }) },
                      ]} />
                    </div>
                  )}
                  {!isCollapsed && inFolder.map(t => renderThread(t, true))}
                  {!isCollapsed && inFolder.length === 0 && <div className="sb-empty is-nested in-folder">Empty — drag threads here</div>}
                </div>
              );
            })}

            {folders.length > 0 && (unfiled.length > 0 || dragging) && (
              <div className={`sb-label sb-drop ${dragging ? "is-dragging" : ""} ${dropTarget === "__none__" ? "is-drop" : ""}`} {...dropProps(null)}>
                {dragging ? "Drop here to take it out of its folder" : "No folder"}
              </div>
            )}
            <div {...(folders.length > 0 ? dropProps(null) : {})}>
              {unfiled.map(t => renderThread(t, false))}
            </div>
            {threads.length === 0 && (
              <div className="sb-empty sb-empty-start">No threads yet.</div>
            )}
            <div className="sb-more">
              <button className="sb-more-btn" onClick={() => { clearSearch(); setNewFolder(""); }}><Icon name="plus" /> New folder</button>
            </div>
          </>
        )}
      </div>
    </nav>
  );
}
