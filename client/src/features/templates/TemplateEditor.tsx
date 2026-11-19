import { useRef, useState, type ReactNode } from "react";
import type { StepKind } from "../../../../shared/snapshot.js";
import { AUTO_CATALOG, blanks } from "../../../../shared/template-vars.js";
import { hasAgents, run, threadPending, useModel } from "../../data/model.js";
import { activity } from "../../session/activity.js";
import { layout } from "../../session/layout.js";
import { formatK, MOD, plural } from "../../derive/text.js";
import { Icon } from "../../kit/Icon.js";
import { Act, Button, IconButton } from "../../kit/Button.js";
import { Menu } from "../../kit/Menu.js";
import { useAutoGrow } from "../../kit/Fields.js";
import * as libraryOps from "../library/ops.js";

/* What each step kind really does in the template engine (server/src/domain/template-engine.ts). */
const KIND: Record<StepKind, { label: string; help: string }> = {
  reply: { label: "Message with reply", help: "Posts this message, then waits for the model's reply" },
  post: { label: "Message without reply", help: "Posts this message and moves on" },
  agent: { label: "Agent task", help: "Runs an agent with this task; its report is added to the thread" },
};
const KINDS: StepKind[] = ["reply", "post", "agent"];

/** What a step does. The agent kind is offered only when the server has agents — or when the step already is one, so it can still be changed. */
function KindPicker({ value, onChange, name, kinds }: { value: StepKind; onChange: (k: StepKind) => void; name: string; kinds: StepKind[] }) {
  return (
    <div className="seg" role="radiogroup" aria-label="What this step does" data-help="tp.kind">
      {kinds.map(k => (
        <label key={k} className={`seg-opt ${value === k ? "is-on" : ""} ${k === "agent" ? "is-agent" : ""}`} title={KIND[k].help}>
          <input type="radio" name={name} checked={value === k} onChange={() => onChange(k)} />
          {k === "agent" && <Icon name="agent" />}{KIND[k].label}
        </label>
      ))}
    </div>
  );
}

/** The template itself: what every run starts with, then the steps it plays in order. */
export function TemplateEditor() {
  const thread = useModel(s => s.thread);
  const pending = useModel(threadPending);
  const agents = useModel(hasAgents);
  // The agent kind is offered only when agents are on — or when a step already is one, so it stays changeable.
  const stepKinds = (current: StepKind): StepKind[] => KINDS.filter(k => k !== "agent" || agents || k === current);
  const [editing, setEditing] = useState<{ id: string; content: string; kind: StepKind } | null>(null);
  const [draft, setDraft] = useState("");
  const [draftKind, setDraftKind] = useState<StepKind>("reply");
  const addRef = useRef<HTMLTextAreaElement>(null);
  const editRef = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(addRef, draft, 360);
  useAutoGrow(editRef, editing?.content ?? "", 360);
  if (!thread?.template) return <div className="chat" aria-busy="true" />;
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
    <div className={`chat tpl ${pending ? "is-pending" : ""}`} inert={pending} aria-busy={pending || undefined} data-help-area="area.template">
      <div className="tpl-scroll">
        <div className="tpl-inner">
          <p className="tpl-lede">
            Each run starts a new thread and plays these steps in order. Write <code>{"{{name}}"}</code> where a run should fill in a blank,
            or <code>{"{{name|default}}"}</code> to give it a default.
          </p>
          <section className="tpl-start" aria-label="Every run starts with" data-help-area="tp.start">
            <h2 className="tpl-h2">Every run starts with</h2>
            {thread.items.length === 0
              ? <p className="tpl-empty">No library items yet. Each one you add here is sent with every reply in every run's thread.</p>
              : (
                <ul className="tpl-items" aria-label="Library items in this template">
                  {thread.items.map(item => (
                    <li key={item.note_id} className="tpl-item">
                      <Icon name="note" className="tpl-item-icon" />
                      <span className="tpl-item-name">{item.name}</span>
                      <span className="tpl-item-meta">{formatK(item.tokens)} tokens</span>
                      <IconButton icon="close" label={`Take "${item.name}" out of this template`} help="remove_item"
                        onClick={() => void libraryOps.removeFromThread(thread, item.note_id, item.name)} />
                    </li>
                  ))}
                </ul>
              )}
            <div className="tpl-items-actions">
              <Button size="sm" icon="plus" help="place_item" onClick={() => activity.open({ kind: "add-item" })}>Add an item</Button>
              <Button size="sm" kind="ghost" icon="panel" help="panel.switch" onClick={() => layout.showTemplateView("library")}>Open the library</Button>
            </div>
          </section>
          <section aria-label="Steps">
            <h2 className="tpl-h2">{steps.length ? `Then plays ${plural(steps.length, "step")}, in order` : "Steps"}</h2>
            {steps.length === 0 && <p className="tpl-empty">No steps yet. Write the first message the run should post, below.</p>}
            <ol className="steps">
              {steps.map((step, i) => (
                <li key={step.id} className={`step kind-${step.kind}`} data-help-area="tp.step">
                  <span className="step-num" aria-hidden>{i + 1}</span>
                  <div className="step-main">
                    {editing?.id === step.id ? (
                      <div className="step-edit">
                        <textarea ref={editRef} autoFocus value={editing.content} aria-label={`Step ${i + 1} text`} onChange={e => setEditing({ ...editing, content: e.target.value })} />
                        <div className="step-edit-bar">
                          <KindPicker value={editing.kind} onChange={k => setEditing({ ...editing, kind: k })} name={`kind-${step.id}`} kinds={stepKinds(editing.kind)} />
                          <span className="spacer" />
                          <Button kind="ghost" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
                          <Button kind="primary" size="sm" help="update_step" onClick={() => void saveEdit()}>Save step</Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="step-head">
                          <span className={`step-kind kind-${step.kind}`} data-help="tp.kind" title={KIND[step.kind].help}>{step.kind === "agent" && <Icon name="agent" />}{KIND[step.kind].label}</span>
                          <span className="step-kind-help">{step.kind === "agent" && !agents ? "Agents are off on this server, so this template can't run until the step is changed" : KIND[step.kind].help}</span>
                          <span className="spacer" />
                          <div className="step-actions">
                            <Act icon="edit" help="update_step" onClick={() => setEditing({ id: step.id, content: step.content, kind: step.kind })}>Edit</Act>
                            <Menu label={`Step ${i + 1} actions`} className="act act-more" icon="more" items={[
                              { label: "Move up", icon: "chevronLeft", disabled: i === 0, help: "reorder_steps", onSelect: () => move(i, -1) },
                              { label: "Move down", icon: "chevronRight", disabled: i === steps.length - 1, help: "reorder_steps", onSelect: () => move(i, 1) },
                              { separator: true },
                              { label: "Delete step", icon: "trash", danger: true, help: "remove_step", onSelect: () => void run("remove_step", { step_id: step.id }) },
                            ]} />
                          </div>
                        </div>
                        <button className="step-text entry src-you" data-help="update_step" onClick={() => setEditing({ id: step.id, content: step.content, kind: step.kind })} title="Edit step">{highlightVariables(step.content)}</button>
                        {step.kind !== "post" && (
                          <div className="step-outcome"><Icon name="chevronRight" />{step.kind === "reply" ? "The model replies" : "The agent works, then reports back"}</div>
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
                  <KindPicker value={draftKind} onChange={setDraftKind} name="kind-new" kinds={stepKinds(draftKind)} />
                  <span className="spacer" />
                  <Button kind="primary" size="sm" icon="plus" help="add_step" onClick={() => void add()} disabled={!draft.trim()}>Add step <kbd>{MOD} ⏎</kbd></Button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/** A step's text with its blanks drawn as chips — the one blank syntax, from shared/template-vars.ts. */
function highlightVariables(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const b of blanks(text)) {
    if (b.index > last) parts.push(text.slice(last, b.index));
    const auto = b.name.startsWith("@");
    parts.push(
      <span key={b.index} className={`var-chip ${auto ? "is-auto" : ""}`} data-help="tp.blank" title={b.default !== null ? `Default: ${b.default}` : auto ? "Filled in automatically" : "Filled in at run time"}>
        {auto ? (AUTO_CATALOG[b.name]?.label ?? b.name.slice(1)) : b.name.replace(/_/g, " ")}{b.default !== null && <span className="var-default"> = {b.default}</span>}
      </span>,
    );
    last = b.index + b.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
