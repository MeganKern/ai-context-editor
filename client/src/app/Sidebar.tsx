import { useState } from "react";
import { run, useModel, wsPending } from "../data/model.js";
import { layout } from "../session/layout.js";
import { navigate } from "../session/route.js";
import { Button } from "../kit/Button.js";
import { SearchBox } from "../kit/SearchBox.js";
import { InlineForm } from "../kit/InlineForm.js";
import { WorkspaceSwitcher } from "../features/workspace/WorkspaceSwitcher.js";
import { LlmSwitcher } from "../features/llm/LlmSwitcher.js";
import { ThreadTree } from "../features/threads/ThreadTree.js";
import { SearchResults } from "../features/threads/ThreadSearch.js";

/**
 * The left column: which workspace and provider, a way to find things, and the threads — the
 * status board for the ones you aren't looking at. Creating things stays available but quiet.
 */
export function Sidebar() {
  const ws = useModel(s => s.ws);
  const pending = useModel(wsPending);
  const [query, setQuery] = useState("");
  const [newThread, setNewThread] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  if (!ws) return null;

  const clearSearch = () => setQuery("");
  const createThread = async () => {
    const r = await run("create_thread", { workspace_id: ws.workspace.id, name: newThread!.trim() });
    if (r) { setNewThread(null); clearSearch(); navigate({ threadId: r.thread_id }); }
  };

  return (
    <nav className={`sidebar ${pending ? "is-pending" : ""}`} inert={pending} aria-busy={pending || undefined} aria-label="Workspace" data-help-area="area.sidebar">
      <div className="sidebar-resize" title="Drag to resize" aria-hidden
        onMouseDown={e => { e.preventDefault(); layout.startResize("sidebar"); }} />
      <div className="sb-top">
        <WorkspaceSwitcher />
        <LlmSwitcher />
        <SearchBox className="sb-search" id="sidebar-search" value={query} onChange={setQuery} placeholder="Search" label="Search threads and messages" help="sb.search" />
        {newThread === null ? (
          <>
            <Button kind="quiet" block icon="plus" help="create_thread" onClick={() => setNewThread("")}>New thread</Button>
            <Button kind="quiet" block icon="plus" help="create_folder" onClick={() => { clearSearch(); setNewFolder(""); }}>New folder</Button>
          </>
        ) : (
          <InlineForm value={newThread} onChange={setNewThread} onSubmit={() => void createThread()} onCancel={() => setNewThread(null)}
            placeholder="Thread name" label="New thread name" size="sm" help="create_thread" />
        )}
      </div>
      <div className="sb-scroll">
        {query.trim()
          ? <SearchResults query={query.trim()} />
          : <ThreadTree newFolder={newFolder} onNewFolder={setNewFolder} />}
      </div>
    </nav>
  );
}
