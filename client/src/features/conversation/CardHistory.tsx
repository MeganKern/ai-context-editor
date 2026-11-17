import { useState } from "react";
import type { CutOff, Revision, Role } from "../../../../shared/snapshot.js";
import { read } from "../../data/api.js";
import { useResource } from "../../data/resources.js";
import { activity } from "../../session/activity.js";
import { clip, fullTime, timeLabel } from "../../derive/text.js";
import { Act } from "../../kit/Button.js";
import { Md } from "../../kit/Md.js";

/** Why an unfinished text ends where it does. */
const CUT: Record<CutOff, string> = {
  stopped: "Stopped", interrupted: "Interrupted", failed: "Failed part-way", timed_out: "Timed out", copied: "Copied part-way",
};

function maker(r: Revision, role: Role): string {
  const writer = role === "agent" ? "The agent" : "The model";
  const by = r.run ? writer : "You";
  if (r.made_by === "copy") return `${by}, copied from “${r.copied_from_thread ?? r.run?.thread_name ?? "another thread"}”`;
  return by;
}

/**
 * Every text a card has had, newest first: who wrote each one (you, or the run that wrote it, with
 * its prompt), whether it was finished, and which one the card shows now.
 */
export function CardHistory({ cardId, role, count }: { cardId: string; role: Role; count: number }) {
  const { data } = useResource(`history:${cardId}:${count}`, () => read.history(cardId).then(r => r.slice().reverse()));
  const [open, setOpen] = useState<string | null>(null);
  if (!data) return <div className="card-history" aria-busy="true"><span className="spinner is-inline" aria-hidden /> Reading its history…</div>;
  return (
    <ol className="card-history" aria-label="Every text this card has had, newest first" data-help-area="msg.history">
      {data.map(r => (
        <li key={r.id} className={`history-item ${r.current ? "is-current" : ""}`}>
          <div className="history-head">
            <span className="history-who">{maker(r, role)}</span>
            <time className="history-when" dateTime={r.created_at} title={fullTime(r.created_at)}>{timeLabel(r.created_at)}</time>
            {r.current && <span className="history-tag">Shown now</span>}
            {r.cut_off && <span className="history-tag is-cut" title="It ends part-way, and this says why">{CUT[r.cut_off]}</span>}
            <span className="spacer" />
            {r.run?.has_prompt && (
              <Act icon="code" help="msg.prompt" title={role === "agent" ? "The exact brief the agent was handed for this text" : "The exact prompt this text was written from"}
                onClick={() => activity.open({ kind: "inspector", tab: "run", runId: r.run!.id })}>
                {role === "agent" ? "Brief" : "Prompt"}
              </Act>
            )}
            <Act help="msg.history-read" aria-expanded={open === r.id} onClick={() => setOpen(o => o === r.id ? null : r.id)}>{open === r.id ? "Hide" : "Read"}</Act>
          </div>
          {open === r.id
            ? <div className="history-text"><Md text={r.text || "(nothing)"} /></div>
            : <p className="history-preview">{clip(r.text, 160) || "(nothing)"}</p>}
        </li>
      ))}
    </ol>
  );
}
