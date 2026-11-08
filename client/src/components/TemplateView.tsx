import { useState, useRef, useLayoutEffect, useEffect } from "react";
import { create } from "zustand";
import { useStore } from "../store.js";
import type { StepKind, RunView, WorkspaceSnapshot } from "../../../shared/snapshot.js";

type ThreadRow = WorkspaceSnapshot["threads"][number];
import { ThreadHeader } from "./ThreadHeader.js";
import { TemplatePinned, TemplateLibraryItems } from "./ContextPanel.js";
import { Icon } from "./Icon.js";
import { Menu } from "./Menu.js";
import { clip, timeLabel, fullTime, MOD } from "../format.js";
import { AUTO_CATALOG, validate } from "../../../shared/template-vars.js";

/* What each step kind really does in the template engine (server/src/domain/template-engine.ts). */
const KIND: Record<StepKind, { label: string; help: string }> = {
  reply: { label: "Message with reply", help: "Posts this message, then waits for the model's reply" },
  post: { label: "Message without reply", help: "Posts this message and moves on" },
  agent: { label: "Agent task", help: "Runs an agent with this task; its report is added to the thread" },
};
const KINDS: StepKind[] = ["reply", "post", "agent"];

function KindPicker({ value, onChange, name }: { value: StepKind; onChange: (k: StepKind) => void; name: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label="What this step does">
      {KINDS.map(k => (
        <label key={k} className={`seg-opt ${value === k ? "is-on" : ""} ${k === "agent" ? "is-agent" : ""}`} title={KIND[k].help}>
          <input type="radio" name={name} checked={value === k} onChange={() => onChange(k)} />
          {k === "agent" && <Icon name="agent" />}{KIND[k].label}
        </label>
      ))}
    </div>
  );
}

function useGrow(ref: React.RefObject<HTMLTextAreaElement | null>, v: string) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(360, el.scrollHeight) + "px";
  }, [ref, v]);
}

/* Blanks typed for a run. They live as long as a template is open — like the original, where
   they sat in the template view — so hiding the run panel doesn't throw them away. */
const useRunValues = create<{ values: Record<string, string> }>(() => ({ values: {} }));

/** The template itself: what every run starts with, then the steps it plays in order. */
export function TemplateView() {
  const thread = useStore(s => s.thread);
  const run = useStore(s => s.run);
  const [editing, setEditing] = useState<{ id: string; content: string; kind: StepKind } | null>(null);
  const [draft, setDraft] = useState("");
  const [draftKind, setDraftKind] = useState<StepKind>("reply");
  const addRef = useRef<HTMLTextAreaElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  useGrow(addRef, draft);
  useGrow(editRef, editing?.content ?? "");
  useEffect(() => () => useRunValues.setState({ values: {} }), []);

  if (!thread || !thread.template) return <div className="chat is-loading" aria-busy="true" />;
  const { steps } = thread.template;

  const add = async () => {
    if (!draft.trim()) return;
    const r = await run("add_step", { thread_id: thread.thread.id, kind: draftKind, content: draft.trim() });
    if (r) { setDraft(""); setDraftKind("reply"); addRef.current?.focus(); }
  };
  const move = (i: number, dir: -1 | 1) => {
    const ids = steps.map(s => s.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void run("reorder_steps", { thread_id: thread.thread.id, ordered_ids: ids });
  };
  const saveEdit = async () => {
    if (!editing) return;
    if (editing.content.trim()) await run("update_step", { step_id: editing.id, kind: editing.kind, content: editing.content.trim() });
    setEditing(null);
  };

  return (
    <div className="chat tpl">
      <ThreadHeader />
      <div className="tpl-scroll">
        <div className="tpl-inner">
          <p className="tpl-lede">
            Each run starts a new thread and plays these steps in order. Write <code>{"{{name}}"}</code> where a run should fill in a blank,
            or <code>{"{{name|default}}"}</code> to give it a default.
          </p>

          <section className="tpl-start" aria-label="Every run starts with">
            <h2 className="tpl-h2">Every run starts with</h2>
            <div className="tpl-start-grid">
              <TemplatePinned />
              <TemplateLibraryItems />
            </div>
          </section>

          <section aria-label="Steps">
            <h2 className="tpl-h2">{steps.length ? `Then plays ${steps.length} step${steps.length === 1 ? "" : "s"}, in order` : "Steps"}</h2>
            {steps.length === 0 && <p className="tpl-empty">No steps yet. Write the first message the run should post, below.</p>}
            <ol className="steps">
              {steps.map((step, i) => (
                <li key={step.id} className={`step kind-${step.kind}`}>
                  <span className="step-num" aria-hidden>{i + 1}</span>
                  <div className="step-main">
                    {editing?.id === step.id ? (
                      <div className="step-edit">
                        <textarea ref={editRef} autoFocus value={editing.content} aria-label={`Step ${i + 1} text`}
                          onChange={e => setEditing({ ...editing, content: e.target.value })} />
                        <div className="step-edit-bar">
                          <KindPicker value={editing.kind} onChange={k => setEditing({ ...editing, kind: k })} name={`kind-${step.id}`} />
                          <span className="spacer" />
                          <button className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>Cancel</button>
                          <button className="btn btn-primary btn-sm" onClick={saveEdit}>Save step</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="step-head">
                          <span className={`step-kind kind-${step.kind}`} title={KIND[step.kind].help}>
                            {step.kind === "agent" && <Icon name="agent" />}{KIND[step.kind].label}
                          </span>
                          <span className="step-kind-help">{KIND[step.kind].help}</span>
                          <span className="spacer" />
                          <div className="step-actions">
                            <button className="act" onClick={() => setEditing({ id: step.id, content: step.content, kind: step.kind })}><Icon name="edit" /> Edit</button>
                            <Menu label={`Step ${i + 1} actions`} className="act act-more" icon="more" items={[
                              { label: "Move up", icon: "chevronLeft", disabled: i === 0, onSelect: () => move(i, -1) },
                              { label: "Move down", icon: "chevronRight", disabled: i === steps.length - 1, onSelect: () => move(i, 1) },
                              { separator: true },
                              { label: "Delete step", icon: "trash", danger: true, onSelect: () => run("remove_step", { step_id: step.id }) },
                            ]} />
                          </div>
                        </div>
                        <button className="step-text" onClick={() => setEditing({ id: step.id, content: step.content, kind: step.kind })} title="Edit step">
                          {highlightVariables(step.content)}
                        </button>
                        {step.kind !== "post" && (
                          <div className="step-outcome">
                            <Icon name="chevronRight" />
                            {step.kind === "reply" ? "The model replies" : "The agent works, then reports back"}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ol>

            <div className="step-add">
              <span className="step-num is-new" aria-hidden>{steps.length + 1}</span>
              <div className="step-main">
                <textarea ref={addRef} value={draft} onChange={e => setDraft(e.target.value)} rows={2} aria-label="New step"
                  placeholder={draftKind === "agent" ? "The agent's task…" : steps.length ? "The next message the run should post…" : "The first message the run should post…"}
                  onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void add(); } }} />
                <div className="step-edit-bar">
                  <KindPicker value={draftKind} onChange={setDraftKind} name="kind-new" />
                  <span className="spacer" />
                  <button className="btn btn-primary btn-sm" onClick={add} disabled={!draft.trim()}><Icon name="plus" /> Add step <kbd>{MOD} ⏎</kbd></button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/** Right panel for templates: fill in the blanks, run it, and find past runs. */
export function TemplatePanel() {
  const thread = useStore(s => s.thread);
  const run = useStore(s => s.run);
  const openThread = useStore(s => s.openThread);
  const togglePanel = useStore(s => s.togglePanel);
  const ws = useStore(s => s.ws);
  const values = useRunValues(s => s.values);
  const setValues = (v: Record<string, string>) => useRunValues.setState({ values: v });

  if (!thread?.template) return null;
  const { steps, variables, runs } = thread.template;
  const userVars = variables.filter(v => !v.auto);
  const autoVars = variables.filter(v => v.auto);
  const unknownAuto = autoVars.filter(v => !v.known);
  const filled: Record<string, string> = {};
  for (const v of userVars) filled[v.name] = values[v.name] || "";
  // The same check the server makes before it starts a run, so Run is only offered when it will work.
  const problems = validate(filled, steps.map(st => st.content));
  const missing = [...new Set(problems.filter(p => p.issue === "missing_required").map(p => p.name))];
  const unknown = [...new Set(problems.filter(p => p.issue === "unknown_auto").map(p => p.name))];
  const conflicting = [...new Set(problems.filter(p => p.issue === "conflicting_defaults").map(p => p.name))];
  const live = runs.find((r: RunView) => r.status === "running" || r.status === "queued");
  // Everything on this template's page, as the server places it: its runs' threads, and the
  // branches taken from them (under the one each came from; a branch whose run's thread was
  // deleted is listed after the runs).
  const onPage = (ws?.threads ?? []).filter(t => t.place.template_id === thread.thread.id);
  const runRow = new Map(onPage.filter(t => t.template_run).map(t => [t.id, t]));
  const branchesOf = new Map<string, ThreadRow[]>();
  for (const t of onPage) if (t.place.parent_id) branchesOf.set(t.place.parent_id, [...(branchesOf.get(t.place.parent_id) ?? []), t]);
  for (const list of branchesOf.values()) list.sort((a, b) => a.created_at.localeCompare(b.created_at));
  const branchRows = (id: string, depth = 1): { t: ThreadRow; depth: number }[] =>
    (branchesOf.get(id) ?? []).flatMap(b => [{ t: b, depth }, ...branchRows(b.id, depth + 1)]);
  const loose = onPage.filter(t => !t.place.parent_id && !t.template_run);

  const start = async () => {
    const r = await run("run_template", { thread_id: thread.thread.id, variables: filled });
    if (r) openThread(r.output_thread_id);
  };

  const blocked = steps.length === 0 ? "Add a step first."
    : missing.length ? `Fill in ${missing.join(", ")} first.`
    : unknown.length ? `${unknown.map(n => `{{${n}}}`).join(", ")} isn't a known automatic value — fix the step first.`
    : conflicting.length ? `“${conflicting.join("”, “")}” has different defaults in different steps — make them the same.`
    : null;

  return (
    <div className="manifest run-panel">
      <header className="manifest-head">
        <div className="manifest-title-row">
          <h2 className="manifest-title">Run this template</h2>
          <button className="icon-btn panel-close" onClick={() => togglePanel(false)} aria-label="Hide this panel"><Icon name="close" /></button>
        </div>
        <p className="manifest-lede">{steps.length
          ? `Starts a new thread, plays the ${steps.length === 1 ? "step" : `${steps.length} steps`}, and opens it so you can watch.`
          : "Add at least one step, then run it from here."}</p>
      </header>

      {userVars.length > 0 && (
        <section className="mf-section" aria-label="Fill in the blanks">
          <div className="mf-section-head"><h3>Fill in the blanks</h3></div>
          <div className="var-fields">
            {userVars.map(v => (
              <label key={v.name} className="var-field">
                <span className="var-name">
                  {v.name.replace(/_/g, " ")}
                  {v.required ? <em className="var-req">required</em> : <em className="var-opt">optional</em>}
                </span>
                <input value={values[v.name] ?? ""} onChange={e => setValues({ ...values, [v.name]: e.target.value })}
                  placeholder={v.default !== null ? `Leave empty for “${v.default}”` : `What goes in “${v.name.replace(/_/g, " ")}”`} />
              </label>
            ))}
          </div>
        </section>
      )}
      {autoVars.length > 0 && (
        <p className="mf-help run-auto">
          Filled in automatically when the run starts: {autoVars.map((v, i) => (
            <span key={v.name}>{i > 0 && ", "}<span className={v.known ? "run-auto-name" : "run-auto-name is-bad"}>{AUTO_CATALOG[v.name]?.label ?? `{{${v.name}}} (unknown)`}</span></span>
          ))}.
          {unknownAuto.length > 0 && <span className="run-auto-name is-bad"> {unknownAuto.map(v => `{{${v.name}}}`).join(", ")} isn't a known automatic value — the run will be refused.</span>}
        </p>
      )}

      <div className="run-go">
        {live ? (
          <>
            <div className="run-live"><span className="spinner" aria-hidden /> {live.cancel_requested ? "Stopping" : `Running${live.progress ? ` step ${Math.max(1, Math.min(live.progress.step, live.progress.total))} of ${live.progress.total}` : ""}`}…</div>
            <div className="run-live-actions">
              {live.output_thread_id && <button className="btn btn-sm" onClick={() => openThread(live.output_thread_id!)}>Watch it</button>}
              {!live.cancel_requested && <button className="btn btn-sm" onClick={() => run("cancel_run", { run_id: live.id })}><Icon name="stop" /> Stop</button>}
            </div>
          </>
        ) : (
          <>
            <button className="btn btn-primary btn-block btn-lg" onClick={start} disabled={!!blocked}><Icon name="play" /> Run template</button>
            {blocked && <p className="run-blocked">{blocked}</p>}
          </>
        )}
      </div>

      <section className="mf-section" aria-label="Past runs">
        <div className="mf-section-head"><h3>Past runs</h3>{runs.length > 0 && <span className="mf-meta">{runs.length}</span>}</div>
        {runs.length === 0 && loose.length === 0 ? <p className="mf-help">Nothing yet. Each run's thread will be listed here.</p> : runs.length > 0 && (
          <ul className="run-list">
            {runs.map((r: RunView, i: number) => {
              const vars = r.variables ? Object.entries(r.variables).filter(([k]) => !k.startsWith("@")) : [];
              const own = r.output_thread_id ? runRow.get(r.output_thread_id) : undefined;
              return (
                <li key={r.id}>
                  <button className="run-item" disabled={!r.output_thread_id} onClick={() => r.output_thread_id && openThread(r.output_thread_id)}>
                    <span className="run-item-top">
                      <span className="run-item-n">Run {own?.template_run?.number ?? runs.length - i}</span>
                      <span className={`status-pill status-${r.status}`}>
                        {(r.status === "running" || r.status === "queued") && <span className="spinner" aria-hidden />}
                        {r.status === "done" ? "Finished" : r.status.replace("_", " ")}
                      </span>
                      <span className="spacer" />
                      <time title={fullTime(r.created_at)}>{timeLabel(r.created_at)}</time>
                      {r.output_thread_id && <Icon name="chevronRight" className="run-item-go" />}
                    </span>
                    {vars.length > 0 && (
                      <span className="run-item-vars">{vars.map(([k, v]) => <span key={k}><b>{k.replace(/_/g, " ")}:</b> {v ? clip(v, 48) : "(default)"}</span>)}</span>
                    )}
                    {r.error && <span className="run-item-error">{clip(r.error, 90)}</span>}
                  </button>
                  {r.output_thread_id && <BranchList rows={branchRows(r.output_thread_id)} />}
                </li>
              );
            })}
          </ul>
        )}
        {loose.length > 0 && (
          <>
            <p className="mf-help run-loose-head">Branches whose run's thread was deleted</p>
            <BranchList rows={loose.flatMap(t => [{ t, depth: 1 }, ...branchRows(t.id, 2)])} />
          </>
        )}
      </section>
      <p className="mf-help run-foot">These threads, and branches taken from them, only appear here, not in the thread list. Steps and pins are copied when a run starts, so editing them never changes a run already made; library items are shared with every run.</p>
    </div>
  );
}

/** Branches taken from a run's thread (and from those), under it. */
function BranchList({ rows }: { rows: { t: ThreadRow; depth: number }[] }) {
  const openThread = useStore(s => s.openThread);
  const activeThreadId = useStore(s => s.activeThreadId);
  if (rows.length === 0) return null;
  return (
    <ul className="run-branches" aria-label="Branches">
      {rows.map(({ t, depth }) => (
        <li key={t.id}>
          <button className={`run-branch ${t.id === activeThreadId ? "is-active" : ""}`} style={{ ["--branch-depth" as string]: depth }}
            onClick={() => openThread(t.id)} title={`${t.name} — a branch`}>
            <Icon name="nest" className="tree-icon is-branch" />
            <span className="run-branch-name">{t.name}</span>
            {t.flags.running && <span className="spinner" aria-label="working" />}
          </button>
        </li>
      ))}
    </ul>
  );
}

function highlightVariables(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let last = 0;
  const re = /\{\{(@?\w+)(?:\|([^}]*))?\}\}/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(
      <span key={m.index} className={`var-chip ${m[1].startsWith("@") ? "is-auto" : ""}`} title={m[2] !== undefined ? `Default: ${m[2]}` : m[1].startsWith("@") ? "Filled in automatically" : "Filled in at run time"}>
        {m[1].startsWith("@") ? (AUTO_CATALOG[m[1]]?.label ?? m[1].slice(1)) : m[1].replace(/_/g, " ")}{m[2] !== undefined && <span className="var-default"> = {m[2]}</span>}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
