import { useState, useEffect } from "react";
import { useStore } from "../store.js";
import { Icon } from "./Icon.js";
import { homePath } from "../format.js";
import { getSettings, putSettings } from "../api.js";

export function WorkspacePicker() {
  const workspaces = useStore(s => s.workspaces);
  const loadWorkspaces = useStore(s => s.loadWorkspaces);
  const openWorkspace = useStore(s => s.openWorkspace);
  const run = useStore(s => s.run);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    void loadWorkspaces().then(() => { if (useStore.getState().workspaces.length === 0) setCreating(true); });
  }, [loadWorkspaces]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const r = await run("create_workspace", { name: name.trim() });
    if (r) { setName(""); setCreating(false); await loadWorkspaces(); void openWorkspace(r.workspace_id); }
  };

  return (
    <div className="picker-screen">
      <div className="picker-card">
        <div className="picker-header">
          <h1 className="picker-brand">The Desk</h1>
          <button className="btn btn-ghost picker-gear" onClick={() => setShowSettings(!showSettings)} title="Settings">
            <Icon name="gear" />
          </button>
        </div>
        <p className="picker-lede">A context editor for working with Claude. Each thread shows exactly what the model is sent; you shape it by hand, and every reply keeps the prompt it was produced from.</p>

        {showSettings && <SettingsPanel />}

        {workspaces.length > 0 && (
          <>
            <h2 className="picker-h2">Open a workspace</h2>
            <ul className="ws-list">
              {workspaces.map(w => (
                <li key={w.id}>
                  <button className="ws-item" onClick={() => openWorkspace(w.id)}>
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

        {creating ? (
          <form className="ws-create" onSubmit={create}>
            <label className="ws-create-label" htmlFor="ws-name">{workspaces.length ? "New workspace" : "Name your first workspace"}</label>
            <div className="ws-create-row">
              <input id="ws-name" autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Kestrel, Thesis, Personal"
                onKeyDown={e => { if (e.key === "Escape" && workspaces.length) setCreating(false); }} />
              <button type="submit" className="btn btn-primary" disabled={!name.trim()}>Create and open</button>
              {workspaces.length > 0 && <button type="button" className="btn btn-ghost" onClick={() => setCreating(false)}>Cancel</button>}
            </div>
            <p className="ws-create-note">Also creates a folder named after it in <code>~/.thedesk/workspaces</code> on this computer. Agents you start in this workspace start there (they aren't confined to it).</p>
          </form>
        ) : (
          <button className="btn btn-ghost ws-new" onClick={() => setCreating(true)}><Icon name="plus" /> New workspace</button>
        )}
      </div>
    </div>
  );
}

const BACKENDS = [
  { value: "cliproxy", label: "Local proxy (CLIProxy)", detail: "Routes through a local proxy on this machine." },
  { value: "openrouter", label: "OpenRouter", detail: "Routes through OpenRouter's API. Requires an API key." },
] as const;

function SettingsPanel() {
  const [loading, setLoading] = useState(true);
  const [backend, setBackend] = useState<string>("cliproxy");
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    void getSettings().then(s => {
      setBackend(s.llm_backend || "cliproxy");
      setKey(s.openrouter_key || "");
      setLoading(false);
    });
  }, []);

  const save = async () => {
    await putSettings({
      llm_backend: backend,
      openrouter_key: backend === "openrouter" ? key : null,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (loading) return <div className="settings-panel"><p className="settings-loading">Loading settings...</p></div>;

  return (
    <div className="settings-panel">
      <h2 className="picker-h2">Settings</h2>

      <div className="settings-section">
        <label className="settings-label">LLM backend for replies</label>
        <p className="settings-note">Where non-agent model calls go. Agents always use the Claude Code CLI (requires an Anthropic subscription).</p>
        <div className="settings-backends">
          {BACKENDS.map(b => (
            <label key={b.value} className={`settings-backend ${backend === b.value ? "is-selected" : ""}`}>
              <input type="radio" name="llm_backend" value={b.value} checked={backend === b.value}
                onChange={() => setBackend(b.value)} />
              <span className="settings-backend-label">{b.label}</span>
              <span className="settings-backend-detail">{b.detail}</span>
            </label>
          ))}
        </div>
      </div>

      {backend === "openrouter" && (
        <div className="settings-section">
          <label className="settings-label" htmlFor="or-key">OpenRouter API key</label>
          <div className="settings-key-row">
            <input id="or-key" type={showKey ? "text" : "password"} value={key}
              onChange={e => setKey(e.target.value)} placeholder="sk-or-..." className="settings-key-input" />
            <button type="button" className="btn btn-ghost" onClick={() => setShowKey(!showKey)}>
              <Icon name={showKey ? "eyeOff" : "eye"} />
            </button>
          </div>
        </div>
      )}

      <div className="settings-actions">
        <button className="btn btn-primary" onClick={save}
          disabled={backend === "openrouter" && !key.trim()}>
          {saved ? "Saved" : "Save"}
        </button>
      </div>
    </div>
  );
}
