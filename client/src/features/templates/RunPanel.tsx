import { useMemo } from "react";
import type { RunView } from "../../../../shared/snapshot.js";
import { AUTO_CATALOG, validate } from "../../../../shared/template-vars.js";
import { hasAgents, run, useModel } from "../../data/model.js";
import { navigate, useRoute } from "../../session/route.js";
import { threadTree, type ThreadNode } from "../../derive/threads.js";
import { clip, fullTime, RUN_STATUS_LABEL, timeLabel } from "../../derive/text.js";
import { Icon } from "../../kit/Icon.js";
import { Button } from "../../kit/Button.js";
import { setRunValue, useRunValues } from "./runValues.js";

/** Beside a template: fill in the blanks, run it, and find past runs. */
export function RunPanel() {
  const thread = useModel(s => s.thread);
  const ws = useModel(s => s.ws);
  const agents = useModel(hasAgents);
  const templateId = thread?.thread.id ?? "";
  const values = useRunValues(templateId);
  const tree = useMemo(() => (ws ? threadTree(ws) : null), [ws]);
  if (!thread?.template || !tree) return null;
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
  const page = tree.templatePage(templateId);
  const runRow = new Map(page.runs.map(n => [n.row.id, n]));

  const start = async () => {
    const r = await run("run_template", { thread_id: templateId, variables: filled });
    if (r) navigate({ threadId: r.output_thread_id });
  };
  const blocked = steps.length === 0 ? "Add a step first."
    : !agents && steps.some(st => st.kind === "agent") ? "This template has an agent step, and agents are off on this server."
    : missing.length ? `Fill in ${missing.join(", ")} first.`
    : unknown.length ? `${unknown.map(n => `{{${n}}}`).join(", ")} isn't a known automatic value — fix the step first.`
    : conflicting.length ? `“${conflicting.join("”, “")}” has different defaults in different steps — make them the same.`
    : null;

  return (
    <div className="manifest run-panel">
      <header className="manifest-head">
        <div className="manifest-title-row">
          <h2 className="manifest-title">Run this template</h2>
        </div>
        <p className="manifest-lede">{steps.length
          ? `Starts a new thread, plays the ${steps.length === 1 ? "step" : `${steps.length} steps`}, and opens it so you can watch.`
          : "Add at least one step, then run it from here."}</p>
      </header>

      {userVars.length > 0 && (
        <section className="mf-section" aria-label="Fill in the blanks" data-help="tp.blanks">
          <div className="mf-section-head"><h3>Fill in the blanks</h3></div>
          <div className="var-fields">
            {userVars.map(v => (
              <label key={v.name} className="var-field">
                <span className="var-name">{v.name.replace(/_/g, " ")}{v.required ? <em className="var-req">required</em> : <em className="var-opt">optional</em>}</span>
                <input value={values[v.name] ?? ""} onChange={e => setRunValue(templateId, v.name, e.target.value)}
                  placeholder={v.default !== null ? `Leave empty for “${v.default}”` : `What goes in “${v.name.replace(/_/g, " ")}”`} />
              </label>
            ))}
          </div>
        </section>
      )}
      {autoVars.length > 0 && (
        <p className="mf-help run-auto" data-help="tp.auto">
          Filled in automatically when the run starts: {autoVars.map((v, i) => (
            <span key={v.name}>{i > 0 && ", "}<span className={v.known ? "run-auto-name" : "run-auto-name is-bad"}>{AUTO_CATALOG[v.name]?.label ?? `{{${v.name}}} (unknown)`}</span></span>
          ))}.
          {unknownAuto.length > 0 && <span className="run-auto-name is-bad"> {unknownAuto.map(v => `{{${v.name}}}`).join(", ")} isn't a known automatic value — the run will be refused.</span>}
        </p>
      )}

      <div className="run-go">
        {live ? (
          <>
            <div className="run-live" data-help="tp.live"><span className="spinner" aria-hidden /> {live.cancel_requested ? "Stopping" : `Running${live.progress ? ` step ${Math.max(1, Math.min(live.progress.step, live.progress.total))} of ${live.progress.total}` : ""}`}…</div>
            <div className="run-live-actions">
              {live.output_thread_id && <Button size="sm" onClick={() => navigate({ threadId: live.output_thread_id! })}>Watch it</Button>}
              {!live.cancel_requested && <Button size="sm" icon="stop" help="cancel_run" onClick={() => void run("cancel_run", { run_id: live.id })}>Stop</Button>}
            </div>
          </>
        ) : (
          <>
            <Button kind="primary" block size="lg" icon="play" help="run_template" onClick={() => void start()} disabled={!!blocked}>Run template</Button>
            {blocked && <p className="run-blocked">{blocked}</p>}
          </>
        )}
      </div>

      <section className="mf-section" aria-label="Past runs" data-help="tp.past">
        <div className="mf-section-head"><h3>Past runs</h3>{runs.length > 0 && <span className="mf-meta">{runs.length}</span>}</div>
        {runs.length === 0 && page.loose.length === 0 ? <p className="mf-help">Nothing yet. Each run's thread will be listed here.</p> : runs.length > 0 && (
          <ul className="run-list">
            {runs.map((r: RunView, i: number) => {
              const vars = r.variables ? Object.entries(r.variables).filter(([k]) => !k.startsWith("@")) : [];
              const own = r.output_thread_id ? runRow.get(r.output_thread_id) : undefined;
              return (
                <li key={r.id}>
                  <button className="run-item" data-help="tp.run" disabled={!r.output_thread_id} onClick={() => r.output_thread_id && navigate({ threadId: r.output_thread_id })}>
                    <span className="run-item-top">
                      <span className="run-item-n">Run {own?.row.template_run_number ?? runs.length - i}</span>
                      <span className={`status-pill status-${r.status}`}>
                        {(r.status === "running" || r.status === "queued") && <span className="spinner" aria-hidden />}
                        {RUN_STATUS_LABEL[r.status]}
                      </span>
                      <span className="spacer" />
                      <time title={fullTime(r.created_at)}>{timeLabel(r.created_at)}</time>
                      {r.output_thread_id && <Icon name="chevronRight" className="run-item-go" />}
                    </span>
                    {vars.length > 0 && <span className="run-item-vars">{vars.map(([k, v]) => <span key={k}><b>{k.replace(/_/g, " ")}:</b> {v ? clip(v, 48) : "(default)"}</span>)}</span>}
                    {r.error && <span className="run-item-error">{clip(r.error, 90)}</span>}
                  </button>
                  {own && own.branches.length > 0 && <BranchList nodes={own.branches} depth={1} />}
                </li>
              );
            })}
          </ul>
        )}
        {page.loose.length > 0 && (
          <>
            <p className="mf-help run-loose-head">Branches whose run's thread was deleted</p>
            <BranchList nodes={page.loose} depth={1} />
          </>
        )}
      </section>
      <p className="mf-help run-foot">These threads, and branches taken from them, only appear here, not in the thread list. Steps are copied when a run starts, so editing them never changes a run already made; library items are shared with every run.</p>
    </div>
  );
}

/** Branches taken from a run's thread (and from those), under it. */
function BranchList({ nodes, depth }: { nodes: ThreadNode[]; depth: number }) {
  const activeId = useRoute(s => s.threadId);
  const flat: { node: ThreadNode; depth: number }[] = [];
  const walk = (n: ThreadNode, d: number) => { flat.push({ node: n, depth: d }); n.branches.forEach(b => walk(b, d + 1)); };
  nodes.forEach(n => walk(n, depth));
  if (flat.length === 0) return null;
  return (
    <ul className="run-branches" aria-label="Branches">
      {flat.map(({ node, depth }) => (
        <li key={node.row.id}>
          <button className={`run-branch ${node.row.id === activeId ? "is-active" : ""}`} style={{ ["--branch-depth" as string]: depth }} data-help="tp.branch"
            onClick={() => navigate({ threadId: node.row.id })} title={`${node.row.name} — a branch`}>
            <Icon name="nest" className="tree-icon is-branch" />
            <span className="run-branch-name">{node.row.name}</span>
            {node.row.flags.running && <span className="spinner" aria-label="working" />}
          </button>
        </li>
      ))}
    </ul>
  );
}
