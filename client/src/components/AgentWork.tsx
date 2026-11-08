import { useEffect, useState } from "react";
import type { AgentStep, AgentChange, CardRun } from "../../../shared/snapshot.js";
import { loadChanges } from "../agent-data.js";
import { Icon } from "./Icon.js";

function formatToolInput(text: string | undefined): string {
  if (!text) return "";
  try {
    const j = JSON.parse(text);
    if (j && typeof j === "object") {
      const v = j.command ?? j.file_path ?? j.notebook_path ?? j.pattern ?? j.path ?? j.url ?? j.query;
      if (typeof v === "string") return v;
    }
  } catch { /* not JSON */ }
  return text;
}

/**
 * An agent's steps as Claude Code reported them: what it said, each tool it used with what came
 * back, and a mark where a tool reported that it failed.
 */
export function AgentLog({ steps, live = false, full = false }: { steps: AgentStep[]; live?: boolean; full?: boolean }) {
  const shown = steps.filter(s => s.type === "text" || s.type === "tool" || s.type === "result");
  const visible = full ? shown : shown.slice(-8);
  return (
    <div className={`agent-log ${live ? "is-live" : ""}`} role="log" aria-label="Agent steps">
      {!full && shown.length > visible.length && <div className="agent-log-more">{shown.length - visible.length} earlier steps</div>}
      {visible.map((s, i) => (
        <div key={i} className={`agent-ev agent-ev-${s.type} ${s.failed ? "is-failed" : ""}`}>
          <span className="agent-ev-kind">{s.type === "tool" ? (s.tool || "tool") : s.type === "result" ? "result" : "note"}</span>
          <span className="agent-ev-text">
            {s.type === "tool" ? formatToolInput(s.input) : s.text}
            {s.type === "tool" && s.output !== undefined && (
              <span className="agent-ev-out">
                {s.failed && <span className="agent-ev-failed"><Icon name="alert" /> Failed</span>}
                {s.output.split("\n").slice(0, full ? 12 : 2).join("\n")}
              </span>
            )}
          </span>
        </div>
      ))}
      {live && <div className="agent-ev agent-ev-cursor"><span className="agent-ev-kind" /><span className="agent-ev-text"><span className="spinner is-inline" aria-hidden />working…</span></div>}
    </div>
  );
}

const CHANGE_LABEL: Record<AgentChange["change"], string> = {
  added: "Added", modified: "Changed", deleted: "Deleted", outside: "Named by its tools, outside the folder",
};

/** The lines that differ: what's the same at the start and the end is left out. */
function changedRegion(before: string, after: string): { removed: string[]; added: string[]; at: number } {
  const a = before.split("\n"), b = after.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  return { removed: a.slice(start, endA), added: b.slice(start, endB), at: start + 1 };
}

const bytes = (n: number) => (n < 1024 ? `${n} bytes` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

function ChangeBody({ c }: { c: AgentChange }) {
  if (c.change === "outside") {
    return <p className="change-note">Its tools named this path. Outside the workspace folder nothing is scanned, so what changed there isn't known — and its commands may have changed more.</p>;
  }
  if (c.change === "modified" && c.before !== null && c.after !== null) {
    const d = changedRegion(c.before, c.after);
    return (
      <pre className="change-diff" aria-label={`Lines changed from line ${d.at}`}>
        <span className="change-at">from line {d.at}</span>
        {d.removed.map((l, i) => <span key={`r${i}`} className="change-line is-removed"><span aria-hidden>−</span> {l}</span>)}
        {d.added.map((l, i) => <span key={`a${i}`} className="change-line is-added"><span aria-hidden>+</span> {l}</span>)}
      </pre>
    );
  }
  const text = c.change === "deleted" ? c.before : c.after;
  if (text !== null) return <pre className="change-text">{text}</pre>;
  const size = c.change === "deleted" ? c.before_size : c.after_size;
  return <p className="change-note">Its text wasn't kept{size !== null ? ` (${bytes(size)})` : ""}: too large, or not text.</p>;
}

/**
 * What an agent changed: the files in the workspace folder, from a scan before it started and one
 * after it ended, and the paths outside the folder its tools named.
 */
export function AgentChanges({ run, steps }: { run: CardRun; steps: AgentStep[] | null }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<AgentChange[] | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    if (!open || list) return;
    let live = true;
    void loadChanges(run.id).then(r => { if (live) setList(r ?? []); });
    return () => { live = false; };
  }, [open, list, run.id]);
  const inside = run.changes?.inside ?? 0;
  const outside = run.changes?.outside ?? 0;
  const commands = steps ? steps.filter(s => s.type === "tool" && s.tool === "Bash").length : null;
  if (run.changes && !run.changes.recorded) {
    // There's no scan from after it ended, so there's nothing to compare: say so rather than "none".
    return (
      <div className="agent-changes-box">
        <div className="agent-changes is-unrecorded">
          <Icon name="alert" />
          <span>What it changed in the workspace folder wasn't recorded: the server stopped suddenly while it ran</span>
          {commands !== null && commands > 0 && <span className="agent-changes-cmds">· ran {commands} command{commands === 1 ? "" : "s"}</span>}
        </div>
      </div>
    );
  }
  return (
    <div className="agent-changes-box">
      <button className="act agent-changes" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <Icon name={inside ? "edit" : "check"} />
        <span>{inside ? `Changed ${inside} file${inside === 1 ? "" : "s"} in the workspace folder` : "Changed no files in the workspace folder"}</span>
        {outside > 0 && <span className="agent-changes-cmds">· its tools named {outside} path{outside === 1 ? "" : "s"} outside it</span>}
        {commands !== null && commands > 0 && <span className="agent-changes-cmds">· ran {commands} command{commands === 1 ? "" : "s"}</span>}
        {(inside > 0 || outside > 0) && <Icon name={open ? "chevronDown" : "chevronRight"} />}
      </button>
      {open && list && list.length > 0 && (
        <ul className="change-list">
          {list.map(c => (
            <li key={`${c.change}:${c.path}`} className={`change-item is-${c.change}`}>
              <button className="change-head" aria-expanded={shown === c.path} onClick={() => setShown(s => s === c.path ? null : c.path)}>
                <span className="change-kind">{CHANGE_LABEL[c.change]}</span>
                <code className="change-path">{c.path}</code>
              </button>
              {shown === c.path && <ChangeBody c={c} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
