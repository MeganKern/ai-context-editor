import { useState } from "react";
import { useModel } from "../../data/model.js";
import { navigate } from "../../session/route.js";
import { activity } from "../../session/activity.js";
import { homePath } from "../../derive/text.js";
import { Icon } from "../../kit/Icon.js";
import { Button, IconButton } from "../../kit/Button.js";
import { createWorkspace } from "./ops.js";

/** Before any workspace is open: the ones there are, or the first one to make. */
export function WorkspaceScreen() {
  const app = useModel(s => s.app);
  const [creating, setCreating] = useState(true);
  const [name, setName] = useState("");
  if (!app) return null;
  const workspaces = app.workspaces;

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const id = await createWorkspace(name.trim());
    if (id) { setName(""); navigate({ wsId: id }); }
  };

  return (
    <div className="picker-screen">
      <div className="picker-card">
        <div className="picker-header">
          <h1 className="picker-brand">AI Context Editor</h1>
          <IconButton icon="gear" label="Model provider" className="picker-gear" help="sb.provider"
            onClick={() => activity.open({ kind: "llm-setup", target: app.llm ? (app.llm.connection_id ? { connection: app.llm.connection_id } : { provider: app.llm.provider }) : { provider: "kilo" } })} />
        </div>
        <p className="picker-lede">A context editor for working with a model. Each thread shows exactly what the model is sent; you shape it by hand, and every reply keeps the prompt it was produced from.</p>

        {workspaces.length > 0 && (
          <>
            <h2 className="picker-h2">Open a workspace</h2>
            <ul className="ws-list">
              {workspaces.map(w => (
                <li key={w.id}>
                  <button className="ws-item" data-help="ws.item" onClick={() => navigate({ wsId: w.id })}>
                    <Icon name="workspace" />
                    <span className="ws-item-text">
                      <span className="ws-item-name">{w.name}</span>
                      <span className="ws-item-path">Agents start in <code>{homePath(w.path)}</code></span>
                    </span>
                    <Icon name="chevronRight" />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {creating || workspaces.length === 0 ? (
          <form className="ws-create" onSubmit={create}>
            <label className="ws-create-label" htmlFor="ws-name">{workspaces.length ? "New workspace" : "Name your first workspace"}</label>
            <div className="ws-create-row">
              <input id="ws-name" autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Kestrel, Thesis, Personal"
                onKeyDown={e => { if (e.key === "Escape" && workspaces.length) setCreating(false); }} />
              <Button type="submit" kind="primary" help="create_workspace" disabled={!name.trim()}>Create and open</Button>
              {workspaces.length > 0 && <Button kind="ghost" onClick={() => setCreating(false)}>Cancel</Button>}
            </div>
            <p className="ws-create-note">Also creates a folder named after it in <code>~/.thedesk/workspaces</code> on this computer. Agents you start in this workspace start there (they aren't confined to it).</p>
          </form>
        ) : (
          <Button kind="ghost" className="ws-new" icon="plus" help="create_workspace" onClick={() => setCreating(true)}>New workspace</Button>
        )}
      </div>
    </div>
  );
}
