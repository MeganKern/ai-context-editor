import { useEffect, useState } from "react";
import type { CutOff, Revision, Role } from "../../../shared/snapshot.js";
import { read } from "../api.js";
import { useStore } from "../store.js";
import { Md } from "./Markdown.js";
import { Icon } from "./Icon.js";
import { clip, fullTime, timeLabel } from "../format.js";

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
 * its prompt), whether it was finished, and which one the card shows now. Nothing is lost when a
 * card is edited or written again.
 */
export function CardHistory({ cardId, role, count }: { cardId: string; role: Role; count: number }) {
  const setUi = useStore(s => s.setUi);
  const [list, setList] = useState<Revision[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void read.history(cardId).then(r => { if (live) setList(r.slice().reverse()); }, () => { if (live) setList([]); });
    return () => { live = false; };
  }, [cardId, count]);
  if (!list) return <div className="card-history" aria-busy="true"><span className="spinner is-inline" aria-hidden /> Reading its history…</div>;
  return (
    <ol className="card-history" aria-label="Every text this card has had, newest first">
      {list.map(r => (
        <li key={r.id} className={`history-item ${r.current ? "is-current" : ""}`}>
          <div className="history-head">
            <span className="history-who">{maker(r, role)}</span>
            <time className="history-when" dateTime={r.created_at} title={fullTime(r.created_at)}>{timeLabel(r.created_at)}</time>
            {r.current && <span className="history-tag">Shown now</span>}
            {!r.complete && <span className="history-tag is-cut" title="It ends part-way, and this says why">{r.cut_off ? CUT[r.cut_off] : "Unfinished"}</span>}
            <span className="spacer" />
            {r.run?.has_prompt && (
              <button className="act" onClick={() => setUi({ mode: { kind: "inspector", tab: "run", runId: r.run!.id } })}
                title={role === "agent" ? "The exact brief the agent was handed for this text" : "The exact prompt this text was written from"}>
                <Icon name="code" /> {role === "agent" ? "Brief" : "Prompt"}
              </button>
            )}
            <button className="act" aria-expanded={open === r.id} onClick={() => setOpen(o => o === r.id ? null : r.id)}>
              {open === r.id ? "Hide" : "Read"}
            </button>
          </div>
          {open === r.id
            ? <div className="history-text"><Md text={r.text || "(nothing)"} /></div>
            : <p className="history-preview">{clip(r.text, 160) || "(nothing)"}</p>}
        </li>
      ))}
    </ol>
  );
}
