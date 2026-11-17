import { useEffect, useMemo, useState } from "react";
import { COMBINE_INSTRUCTIONS } from "../../../../shared/summary.js";
import { BEHAVIOUR as B } from "../../../../shared/behaviour.js";
import { read } from "../../data/api.js";
import { run, useModel } from "../../data/model.js";
import { useResource } from "../../data/resources.js";
import { activity, useActivityOf } from "../../session/activity.js";
import { library, useLibrary } from "../../session/library.js";
import { libraryTree, moved, type LibraryFilter } from "../../derive/library.js";
import { contextBudget } from "../../derive/budget.js";
import { nounOf } from "../../derive/text.js";
import { Icon } from "../../kit/Icon.js";
import { Button } from "../../kit/Button.js";
import { Menu } from "../../kit/Menu.js";
import { SearchBox } from "../../kit/SearchBox.js";
import { InlineForm } from "../../kit/InlineForm.js";
import { LibraryScopeContext } from "./scope.js";
import { LibraryTree } from "./LibraryTree.js";
import { CombineReview } from "./CombineReview.js";
import * as ops from "./ops.js";

const FILTERS: { key: LibraryFilter; label: (where: string) => string }[] = [
  { key: "all", label: () => "All" },
  { key: "in-thread", label: where => `In ${where}` },
  { key: "available", label: () => "Available" },
  { key: "retired", label: () => "Retired" },
];

/**
 * The right panel: the workspace's library, with what the thread beside it uses marked and in send
 * order. Beside a template it's the items every run starts with.
 */
export function LibraryPanel() {
  const ws = useModel(s => s.ws)!;
  const threadId = useModel(s => s.threadId);
  const thread = useModel(s => s.thread);
  // The thread (or template) beside the panel; on the workspace page, nothing.
  const beside = thread && thread.thread.id === threadId ? thread : null;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [naming, setNaming] = useState<string | null>(null);
  const [namingFolder, setNamingFolder] = useState<string | null>(null);
  const combining = useActivityOf("combine");
  const review = useLibrary(s => s.review);
  const pendingOrder = useLibrary(s => s.pendingOrder);
  const [settled, setSettled] = useState(query);
  useEffect(() => { const t = setTimeout(() => setSettled(query.trim()), 180); return () => clearTimeout(t); }, [query]);
  // A new workspace snapshot (seq) means something may have changed: the search is read again.
  const { data: hits } = useResource(settled ? `notesearch:${ws.workspace.id}:${settled}:${ws.seq}` : null,
    () => read.noteSearch(ws.workspace.id, settled).then(rows => new Map(rows.map(h => [h.note_id, h.snippet]))));

  const serverOrder = (beside?.items ?? []).map(i => i.note_id);
  const order = pendingOrder && pendingOrder.length === serverOrder.length && pendingOrder.every(id => serverOrder.includes(id)) ? pendingOrder : serverOrder;
  const tree = useMemo(() => libraryTree(ws, beside, filter, query, hits), [ws, beside, filter, query, hits]);

  const reorder = (noteId: string, delta: -1 | 1) => {
    if (!beside) return;
    const i = order.indexOf(noteId);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= order.length) return;
    const next = moved(order, noteId, delta > 0 ? j + 1 : j);
    library.pendingOrder(next);
    void run("reorder_items", { thread_id: beside.thread.id, ordered_ids: next });
  };
  const scope = { thread: beside, folders: ws.library_folders, reorder };

  const where = nounOf(beside);
  const isTemplate = beside?.thread.kind === "template";
  const hasContent = ws.notes.length > 0 || ws.library_folders.length > 0;
  const budget = beside && !isTemplate ? contextBudget(beside.context) : null;

  return (
    <LibraryScopeContext.Provider value={scope}>
      <div className={`ctxp ${beside ? "" : "is-library-only"}`} data-help-area="area.context">
        {budget?.over && (
          <div className="ctxp-alert ctxp-budget-alert" role="status" data-help="cx.alert">
            <Icon name="alert" /><p>Context limit reached: this is more than the model can take.</p>
          </div>
        )}
        <section className="ctxp-library" aria-label="Library" data-help-area="cx.library">
          <div className="ctxp-library-top">
            <div className="ctxp-section-head"><h3>Library</h3></div>
            <div className="seg is-block" role="tablist" aria-label="Which items are listed" data-help="cx.lib-filter">
              {FILTERS.map(f => (
                <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} className={`seg-opt ${filter === f.key ? "is-on" : ""}`} onClick={() => setFilter(f.key)}>
                  {f.label(where)}
                </button>
              ))}
            </div>
            {naming !== null && (
              <InlineForm className="ctxp-new-form" value={naming} onChange={setNaming} placeholder="Name" label="Name of the new library item" help="create_note"
                hint={beside ? `Added to this ${where} right away, sent with every reply; write its text in place.` : "Saved to the library; write its text in place."}
                onSubmit={() => void ops.createNote(ws.workspace.id, naming.trim(), { threadId: beside?.thread.id }).then(ok => { if (ok) setNaming(null); })}
                onCancel={() => setNaming(null)} />
            )}
            {namingFolder !== null && (
              <InlineForm className="ctxp-new-form" value={namingFolder} onChange={setNamingFolder} placeholder="Folder name" label="Name of the new folder" submitLabel="Create folder" help="create_folder"
                onSubmit={() => void run("create_folder", { workspace_id: ws.workspace.id, name: namingFolder.trim(), scope: "library" }).then(ok => { if (ok) setNamingFolder(null); })}
                onCancel={() => setNamingFolder(null)} />
            )}
            {hasContent && <SearchBox value={query} onChange={setQuery} placeholder="Find by name or text" label="Find in the library" help="cx.lib-search" />}
            {naming === null && namingFolder === null && !combining && (
              <Menu label="New" className="btn btn-quiet btn-block" icon="plus" text="New item" help="create_note" items={[
                { label: "New item", hint: "Write reference text once, use it in any thread", help: "create_note", onSelect: () => setNaming("") },
                { label: "New folder", hint: "Organize items into folders", help: "create_folder", onSelect: () => setNamingFolder("") },
                ...(ws.notes.length >= 2 ? [{ label: "Combine items…", hint: B.combine_notes.tip, help: "combine_notes" as const, onSelect: () => activity.open({ kind: "combine", picked: [] }) }] : []),
              ]} />
            )}
            {combining && <Button kind="quiet" block onClick={() => activity.close()}>Cancel selection</Button>}
          </div>
          {combining && <CombineBar picked={combining.picked} />}
          {review && <CombineReview noteId={review.noteId} runId={review.runId} onDone={() => library.review(null)} />}
          <LibraryTree tree={tree} />
          {filter === "in-thread" && beside && beside.items.length === 0 && (
            <p className="ctxp-empty">No items in this {where} yet. Check a library item to add it.</p>
          )}
          {isTemplate && filter === "in-thread" && (
            <Button kind="ghost" size="sm" className="ctxp-more-btn" icon="plus" help="place_item" onClick={() => activity.open({ kind: "add-item" })}>Add from the library…</Button>
          )}
          {!hasContent && naming === null && namingFolder === null && (
            <p className="ctxp-empty">Nothing here yet. Write reference text once — a brief, a spec, a style guide — and use it in any thread.</p>
          )}
          {query.trim() && tree.shown === 0 && <p className="ctxp-empty">Nothing in the library mentions that.</p>}
        </section>
      </div>
    </LibraryScopeContext.Provider>
  );
}

/**
 * Picking items to combine, then the name and instructions for the combined one. The instructions
 * start as the app's own; left as they are, none are sent and the server uses its own.
 */
function CombineBar({ picked }: { picked: string[] }) {
  const ws = useModel(s => s.ws)!;
  const [ready, setReady] = useState(false);
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState(COMBINE_INSTRUCTIONS);
  const [busy, setBusy] = useState(false);
  const cancel = () => activity.close();
  const go = async () => {
    if (picked.length < 2 || busy || !name.trim()) return;
    setBusy(true);
    const custom = instructions.trim();
    const ok = await ops.combine(ws.workspace.id, picked, name.trim(), custom && custom !== COMBINE_INSTRUCTIONS ? custom : undefined);
    setBusy(false);
    if (ok) activity.close();
  };
  return (
    <div className="ctxp-combine-bar" data-help-area="comb.bar">
      {ready ? (
        <>
          <div className="ctxp-combine-bar-row">
            <span className="ctxp-combine-step">Name & instructions</span>
            <span className="spacer" />
            <Button kind="ghost" size="xs" onClick={() => setReady(false)}>Back</Button>
            <Button kind="primary" size="xs" icon={busy ? undefined : "merge"} help="combine_notes" disabled={busy || !name.trim()} onClick={() => void go()}>{busy ? "Combining…" : "Combine"}</Button>
            <Button kind="ghost" size="xs" onClick={cancel}>Cancel</Button>
          </div>
          <input className="ctxp-combine-name" value={name} onChange={e => setName(e.target.value)} placeholder="Name for the combined item" aria-label="Name for the combined item" autoFocus
            onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); setReady(false); } }} />
          <textarea className="field-grow is-body" value={instructions} onChange={e => setInstructions(e.target.value)} rows={3} placeholder="Instructions for how to combine them" aria-label="Instructions for combining" />
        </>
      ) : (
        <>
          <span className="ctxp-combine-count">{picked.length} selected</span>
          <Button kind="primary" size="xs" disabled={picked.length < 2} onClick={() => setReady(true)}>Combine{picked.length >= 2 ? ` (${picked.length})` : ""}</Button>
          <Button kind="ghost" size="xs" onClick={cancel}>Cancel</Button>
        </>
      )}
    </div>
  );
}
