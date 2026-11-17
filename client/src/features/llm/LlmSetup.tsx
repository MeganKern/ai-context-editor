import { useEffect, useState, type ReactNode } from "react";
import type { LlmModel, ProviderInfo } from "../../../../shared/snapshot.js";
import { read } from "../../data/api.js";
import { useModel } from "../../data/model.js";
import { activity, type Activity } from "../../session/activity.js";
import { Icon } from "../../kit/Icon.js";
import { Dialog } from "../../kit/Dialog.js";
import { Button } from "../../kit/Button.js";
import { Picker } from "../../kit/Picker.js";
import { addConnection, removeConnection, setLlm } from "./ops.js";

type Target = Extract<Activity, { kind: "llm-setup" }>["target"];

/**
 * Choosing where replies go: a provider, its key when it needs one, and one of the models it
 * lists (or an id typed in, when it lists none). Opened from the model selector in the left column
 * to switch provider or change the model in use. For a custom endpoint of your own: its name and
 * URL, then the models it answers with.
 */
export function LlmSetup({ target }: { target: Target }) {
  const app = useModel(s => s.app)!;
  const close = () => activity.close();

  const frame = (title: ReactNode, sub: ReactNode, body: ReactNode, actions: ReactNode) => (
    <Dialog compact className="dialog-llm" title={title} sub={sub} onClose={close} actions={actions} help="dl.llm">{body}</Dialog>
  );

  if (target === "new") return <ConnectionForm frame={frame} onBack={null} onDone={close} />;
  const providerId = "provider" in target ? target.provider : "custom";
  const provider = app.catalog.find(p => p.id === providerId);
  if (!provider) return null;
  return <ProviderForm key={JSON.stringify(target)} provider={provider} connectionId={"connection" in target ? target.connection : null} frame={frame} onBack={null} onDone={close} />;
}

type Frame = (title: ReactNode, sub: ReactNode, body: ReactNode, actions: ReactNode) => ReactNode;

/** The models a provider lists, read when asked: the list, or the one fact that stops it (a key is needed, or why it failed). */
function useModelList() {
  const [models, setModels] = useState<LlmModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsKey, setNeedsKey] = useState(false);
  const load = async (provider: string, key: string | undefined, url: string | undefined): Promise<LlmModel[]> => {
    setLoading(true);
    setError(null);
    const r = await read.llmModels(provider, key, url);
    setModels(r.models);
    setNeedsKey(r.needs_key);
    setError(r.error);
    setLoading(false);
    return r.models;
  };
  return { models, loading, error, needsKey, load };
}

/** The models a provider lists, with one picked, or an id typed in. */
function ModelChoice({ models, loading, error, value, onChange }: {
  models: LlmModel[]; loading: boolean; error: string | null; value: string; onChange: (id: string) => void;
}) {
  const [typing, setTyping] = useState(false);
  const listed = models.some(m => m.id === value);
  const custom = typing || (!!value && !listed);
  return (
    <div className="dialog-field">
      <span>Model</span>
      {loading && <div className="llm-note">Fetching the models it offers…</div>}
      {!loading && models.length > 0 && !custom && (
        <div data-help="llm.models">
          <Picker className="picker-compact llm-models" label="Models" items={models} keyOf={m => m.id} autoFocus={false}
            matches={(m, q) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)}
            render={m => (
              <>
                {m.id === value && <Icon name="check" />}
                <span className={`llm-model-name ${m.id === value ? "is-picked" : ""}`}>{m.name}</span>
                <span className="llm-model-meta">{m.id !== m.name ? m.id : ""}{m.meta ? ` · ${m.meta}` : ""}{m.window ? ` · ${Math.round(m.window / 1000)}k` : ""}</span>
              </>
            )}
            onPick={m => onChange(m.id)} placeholder="Search models…" />
        </div>
      )}
      {!loading && (models.length === 0 || custom) && (
        <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder="The model's id, e.g. gpt-4o" aria-label="Model id" />
      )}
      {!loading && models.length > 0 && (
        <button type="button" className="link llm-type-toggle" onClick={() => { setTyping(t => !t); if (custom) onChange(models[0]?.id ?? ""); }}>
          {custom ? "Pick from the list instead" : "Type a model id instead"}
        </button>
      )}
      {error && <div className="dialog-error">{error}</div>}
    </div>
  );
}

function ProviderForm({ provider, connectionId, frame, onBack, onDone }: {
  provider: ProviderInfo; connectionId: string | null; frame: Frame; onBack: (() => void) | null; onDone: () => void;
}) {
  const app = useModel(s => s.app)!;
  const llm = app.llm;
  const isCustom = provider.id === "custom";
  const connection = isCustom ? llm?.connections.find(c => c.id === connectionId) ?? null : null;
  const keyed = llm?.keyed_providers.includes(provider.id) ?? false;
  const current = llm?.provider === provider.id && (!isCustom || llm.connection_id === connectionId);
  const [key, setKey] = useState("");
  const list = useModelList();
  const [model, setModel] = useState(current ? llm!.model_id : "");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  const load = async (withKey: string) => {
    const models = await list.load(provider.id, withKey || undefined, connection?.url);
    if (!model && models.length) setModel(models[0].id);
  };
  // Listed at once; a provider that lists only with a key says so, and lists once one is typed.
  useEffect(() => { if (provider.lists_models) void load(""); }, [provider.id]);

  const save = async () => {
    if (!model.trim() || saving) return;
    setSaving(true);
    const picked = list.models.find(m => m.id === model.trim());
    const ok = await setLlm(provider.id, model.trim(), { apiKey: key.trim() || undefined, connectionId: connectionId ?? undefined, window: picked?.window });
    setSaving(false);
    if (ok) onDone();
  };
  const remove = async () => {
    if (!connectionId || removing) return;
    setRemoving(true);
    const ok = await removeConnection(connectionId);
    setRemoving(false);
    if (ok) onDone();
  };

  const title = isCustom ? connection?.name ?? "Endpoint" : `${keyed || current ? "Configure" : "Set up"} ${provider.label}`;
  const sub = isCustom ? connection?.url : provider.needs_key ? "Its key is kept in this computer's database." : null;
  return frame(title, sub,
    <div className="dialog-fields">
      {provider.needs_key && (
        <label className="dialog-field">
          API key
          <div className="llm-key-row">
            <input type="password" value={key} onChange={e => setKey(e.target.value)} autoFocus={!keyed} data-help="llm.key"
              placeholder={keyed ? "Kept — leave empty to keep it" : "sk-…"} />
            {list.needsKey && (
              <Button size="sm" help="llm.load" disabled={!key.trim() || list.loading} onClick={() => void load(key.trim())}>{list.loading ? "Loading…" : "Load models"}</Button>
            )}
          </div>
          {list.needsKey && list.models.length === 0 && <span className="llm-note">Its models are listed once there's a key.</span>}
        </label>
      )}
      <ModelChoice models={list.models} loading={list.loading} error={list.error} value={model} onChange={setModel} />
    </div>,
    <>
      {onBack && <Button kind="ghost" onClick={onBack}>Back</Button>}
      {connection && !current && <Button kind="ghost" className="is-danger" help="remove_connection" disabled={removing} onClick={() => void remove()}>Remove</Button>}
      <span className="spacer" />
      {!onBack && <Button onClick={onDone}>Cancel</Button>}
      <Button kind="primary" help="set_llm" disabled={saving || !model.trim() || (provider.needs_key && !keyed && !key.trim())}
        onClick={() => void save()}>{saving ? "Saving…" : current ? "Save" : "Save & switch"}</Button>
    </>);
}

function ConnectionForm({ frame, onBack, onDone }: { frame: Frame; onBack: (() => void) | null; onDone: () => void }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const list = useModelList();
  const [model, setModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = async () => {
    if (!url.trim()) return;
    const models = await list.load("custom", key.trim() || undefined, url.trim());
    if (!model && models.length) setModel(models[0].id);
  };
  const save = async () => {
    if (!name.trim()) { setFormError("A name is needed"); return; }
    if (!/^https?:\/\//.test(url.trim())) { setFormError("A URL is needed, starting with http:// or https://"); return; }
    if (!model.trim()) { setFormError("A model is needed"); return; }
    setSaving(true);
    setFormError(null);
    const picked = list.models.find(m => m.id === model.trim());
    const ok = await addConnection(name.trim(), url.trim(), key.trim(), model.trim(), picked?.window ?? null);
    setSaving(false);
    if (ok) onDone();
  };

  return frame("New connection", "An OpenAI-compatible chat endpoint of your own: a local proxy, a server you run.",
    <div className="dialog-fields">
      <label className="dialog-field">Name<input type="text" value={name} onChange={e => setName(e.target.value)} autoFocus placeholder="My server" /></label>
      <label className="dialog-field">
        URL
        <div className="llm-key-row">
          <input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="http://localhost:8080/v1/chat/completions" onBlur={() => void load()} />
          <Button size="sm" help="llm.load" disabled={!url.trim() || list.loading} onClick={() => void load()}>{list.loading ? "Loading…" : "Load models"}</Button>
        </div>
      </label>
      <label className="dialog-field">API key (optional)<input type="password" value={key} onChange={e => setKey(e.target.value)} placeholder="sk-…" data-help="llm.key" /></label>
      <ModelChoice models={list.models} loading={list.loading} error={list.error} value={model} onChange={setModel} />
      {formError && <div className="dialog-error">{formError}</div>}
    </div>,
    <>
      {onBack && <Button kind="ghost" onClick={onBack}>Back</Button>}
      <span className="spacer" />
      {!onBack && <Button onClick={onDone}>Cancel</Button>}
      <Button kind="primary" help="add_connection" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save & connect"}</Button>
    </>);
}
