import { useEffect, useRef, useState } from "react";
import type { SummaryView } from "../../../../shared/snapshot.js";
import { BEHAVIOUR as B } from "../../../../shared/behaviour.js";
import { run, useModel } from "../../data/model.js";
import { plural } from "../../derive/text.js";
import { Button } from "../../kit/Button.js";
import { Menu } from "../../kit/Menu.js";
import { Md } from "../../kit/Md.js";

function SummaryEdit({ summary, onDone }: { summary: SummaryView; onDone: () => void }) {
  const [text, setText] = useState(summary.content ?? "");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const save = async () => {
    if (!text.trim()) return;
    await run("edit_summary", { summary_id: summary.id, content: text.trim() });
    onDone();
  };
  return (
    <div className="summary-edit">
      <textarea ref={ref} className="field-grow is-body" value={text} onChange={e => setText(e.target.value)} rows={4} aria-label="The summary's text"
        onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); onDone(); } if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save(); }} />
      <div className="inline-form-actions is-under">
        <Button kind="primary" size="sm" help="edit_summary" disabled={!text.trim()} onClick={() => void save()}>Save</Button>
        <Button kind="ghost" size="sm" onClick={onDone}>Cancel</Button>
      </div>
    </div>
  );
}

/** A summary being written, or waiting for you: use it, change it, have it written again, or drop it. */
export function SummaryReview({ summary }: { summary: SummaryView }) {
  const live = useModel(s => (summary.run_id ? s.live[summary.run_id] : undefined));
  const [feedback, setFeedback] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const drafting = summary.status === "drafting";
  const text = drafting && summary.run_id ? live?.text ?? "" : summary.content;
  const empty = !drafting && !summary.content;
  const discard = () => void run("discard_summary", { summary_id: summary.id });
  const revise = (fb?: string) => void run("revise_summary", { summary_id: summary.id, feedback: fb });
  const sendFeedback = () => {
    if (!feedback?.trim()) return;
    revise(feedback.trim());
    setFeedback(null);
  };
  return (
    <section className={`summary-review entry src-model ${drafting ? "is-drafting" : "is-review"}`} aria-label="Summary to review" data-help="sum.review">
      <header className="summary-review-head">
        <span className="summary-review-title">
          {drafting ? <><span className="spinner is-inline" aria-hidden />Writing a summary</> : "Summary to review"}
        </span>
        <span className="summary-review-sub">of the {plural(summary.message_ids.length, "message")} below</span>
      </header>
      {editing
        ? <SummaryEdit summary={summary} onDone={() => setEditing(false)} />
        : text && <div className={`summary-review-text msg-body is-output ${drafting ? "is-streaming" : ""}`}><Md text={text} /></div>}
      {!drafting && !editing && summary.copied_while_writing && (
        <p className="summary-review-note">
          {empty ? "Copied while it was being written, before it had any text. Write it again to have one to use."
            : "Copied while it was being written: this is what it had then."}
        </p>
      )}
      {feedback !== null && !editing && (
        <div className="summary-feedback">
          <input autoFocus value={feedback} onChange={e => setFeedback(e.target.value)} aria-label="What should change"
            placeholder="What should change? e.g. keep the exact numbers"
            onKeyDown={e => { if (e.key === "Enter") sendFeedback(); if (e.key === "Escape") { e.preventDefault(); setFeedback(null); } }} />
          <Button size="sm" help="revise_summary" disabled={!feedback.trim()} onClick={sendFeedback}>Revise</Button>
        </div>
      )}
      <div className="summary-review-actions">
        {drafting ? (
          <Button kind="ghost" size="sm" help="discard_summary" onClick={discard}>Cancel</Button>
        ) : empty ? (
          <>
            <Button kind="primary" size="sm" icon="regenerate" help="revise_summary" onClick={() => revise()}>Write it again</Button>
            <Button kind="ghost" size="sm" help="discard_summary" onClick={discard}>Discard</Button>
          </>
        ) : (
          <>
            <Button kind="primary" size="sm" icon="check" help="accept_summary" onClick={() => void run("accept_summary", { summary_id: summary.id })}>Use this summary</Button>
            <Button size="sm" help="edit_summary" onClick={() => setEditing(true)}>Edit</Button>
            <Button size="sm" help="revise_summary" onClick={() => setFeedback(feedback === null ? "" : null)}>Revise…</Button>
            <Menu label="More summary actions" className="act act-more" icon="more" items={[
              { label: "Write it again from scratch", icon: "regenerate", hint: B.revise_summary.tip, help: "revise_summary", onSelect: () => revise() },
              { label: "Discard", icon: "trash", danger: true, hint: B.discard_summary.tip, help: "discard_summary", onSelect: discard },
            ]} />
          </>
        )}
      </div>
    </section>
  );
}
