import { useRef, useEffect, useState } from "react";
import { useStore } from "../store.js";
import { liveText } from "../view-model.js";
import type { SummaryView, SummarySource } from "../../../shared/snapshot.js";
import { read } from "../api.js";
import { Icon } from "./Icon.js";
import { Menu, type MenuItem } from "./Menu.js";
import { Md } from "./Markdown.js";
import { BEHAVIOUR as B } from "../../../shared/behaviour.js";

function useIsSourceOfAnother(summaryId: string): boolean {
  return useStore(s => !!s.thread?.summaries.some(o => o.id !== summaryId && o.cards.some(c => c.summary_id === summaryId)));
}

function SummarySourceList({ summary }: { summary: SummaryView }) {
  const thread = useStore(s => s.thread);
  const [source, setSource] = useState<SummarySource | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    read.summarySource(summary.id).then(r => { if (live) setSource(r); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [summary.id, summary.written_by]);
  const here = new Set(thread?.messages.map(m => m.id) ?? []);
  return (
    <div className="summary-originals is-notsent">
      <p className="notsent-note"><span className="notsent-label">Not sent</span> It was written from these texts, exactly as they were then; it's sent in place of their cards.</p>
      {failed && <p className="summary-original-gone">Couldn't read them just now.</p>}
      {!source && !failed && <p className="msg-waiting"><span className="spinner is-inline" aria-hidden />Reading them…</p>}
      {source?.parts.map((p, i) => p.kind === "summary" ? (
        <div key={`s${i}`} className="summary-original is-summary">
          <span className="msg-row-author">A summary in use then</span>
          <div className="msg-body is-output"><Md text={p.text} /></div>
        </div>
      ) : p.kind === "item" ? (
        <div key={`n${i}`} className="summary-original is-item">
          <span className="msg-row-author">Library item "{p.name}", with the message above</span>
          <div className="msg-body is-output"><Md text={p.text} /></div>
        </div>
      ) : (
        <div key={`c${i}`} id={here.has(p.card_id) ? `msg-${p.card_id}` : undefined} className={`summary-original msg-${p.role}`}>
          <span className="msg-row-author">{p.role === "user" ? "You" : p.role === "agent" ? "Agent" : "Model"}</span>
          <div className="msg-body is-output"><Md text={p.text} /></div>
        </div>
      ))}
      {source && source.parts.length === 0 && <p className="summary-original-gone">Its run kept no record of them.</p>}
    </div>
  );
}

function SummaryEdit({ summary, onDone }: { summary: SummaryView; onDone: () => void }) {
  const run = useStore(s => s.run);
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
      <textarea ref={ref} value={text} onChange={e => setText(e.target.value)} rows={4}
        onKeyDown={e => { if (e.key === "Escape") onDone(); if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save(); }} />
      <div className="summary-edit-actions">
        <button className="btn btn-primary btn-sm" onClick={save} disabled={!text.trim()}>Save</button>
        <button className="btn btn-ghost btn-sm" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}

export function SummaryBlock({ summary, highlighted, picked, onPick }: {
  summary: SummaryView;
  highlighted: boolean;
  picked: boolean;
  onPick?: () => void;
}) {
  const run = useStore(s => s.run);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const isSource = useIsSourceOfAnother(summary.id);
  const n = summary.message_ids.length;
  const gone = summary.cards.filter(c => c.deleted).length;
  return (
    <section className={`turn summary-turn ${highlighted ? "is-highlighted" : ""} ${picked ? "is-selected is-range-start is-range-end" : ""} ${onPick ? "is-pickable" : ""}`}
      id={`summary-${summary.id}`} aria-label="Summary in use"
      onClickCapture={onPick ? e => { e.preventDefault(); e.stopPropagation(); onPick(); } : undefined}>
      <div className="summary-block">
        <header className="summary-head">
          <span className="summary-title"><Icon name="summary" /> Summary of {n} message{n === 1 ? "" : "s"}</span>
          <span className="summary-sub">sent instead of them{gone ? ` · ${gone} deleted since` : ""}</span>
          <span className="spacer" />
          <button className="act" aria-expanded={open} onClick={() => setOpen(!open)}>
            <Icon name={open ? "chevronDown" : "chevronRight"} /> {open ? "Hide what it's from" : "Show what it's from"}
          </button>
          <Menu label="Summary actions" className="act act-more" icon="more" items={[
            { label: "Edit", icon: "edit", hint: B.edit_summary.tip, onSelect: () => setEditing(true) },
            { label: "Write it again", icon: "regenerate", hint: "From the same cards; you review it first", onSelect: () => run("revise_summary", { summary_id: summary.id }) },
            { label: "Exclude — send its cards instead", icon: "eyeOff", hint: B["set_summary_status:inactive"].tip, onSelect: () => run("set_summary_status", { summary_id: summary.id, status: "inactive" }) },
            { label: "Discard summary", icon: "trash", danger: true, disabled: isSource,
              hint: isSource ? "Another summary was written from it" : "Its cards are sent again",
              onSelect: () => run("set_summary_status", { summary_id: summary.id, status: "discarded" }) },
          ]} />
        </header>
        {editing
          ? <SummaryEdit summary={summary} onDone={() => setEditing(false)} />
          : summary.content && <div className="summary-body msg-body is-output"><Md text={summary.content} /></div>}
        {open && <SummarySourceList summary={summary} />}
      </div>
    </section>
  );
}

export function SummaryLine({ summary }: { summary: SummaryView }) {
  const run = useStore(s => s.run);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const isSource = useIsSourceOfAnother(summary.id);
  const count = summary.message_ids.length;
  const set = (status: "active" | "inactive" | "discarded") => run("set_summary_status", { summary_id: summary.id, status });
  const why = summary.not_sent === "overlaps" ? "another summary in use stands in for some of the same messages"
    : "excluded — its cards are sent instead";

  const more: MenuItem[] = [];
  more.push({ label: "Edit", icon: "edit", hint: B.edit_summary.tip, onSelect: () => { setOpen(true); setEditing(true); } });
  more.push({ label: "Write it again", icon: "regenerate", hint: "From the same cards; you review it first", onSelect: () => run("revise_summary", { summary_id: summary.id }) });
  if (summary.status === "active") more.push({ label: "Exclude", icon: "eyeOff", hint: B["set_summary_status:inactive"].tip, onSelect: () => set("inactive") });
  more.push({ label: "Discard summary", icon: "trash", danger: true, disabled: isSource,
              hint: isSource ? "Another summary was written from it" : B["set_summary_status:discarded"].tip, onSelect: () => set("discarded") });

  return (
    <section className="turn summary-line is-notsent" id={`summary-${summary.id}`} aria-label="Summary not sent">
      <div className="summary-line-row">
        <button className="summary-line-btn" onClick={() => setOpen(!open)} aria-expanded={open} title={open ? "Hide it" : "Read it"}>
          <Icon name="summary" />
          <span className="summary-line-title">Summary of {count} message{count === 1 ? "" : "s"}</span>
          <span className="notsent-label">Not sent</span>
          <span className="summary-line-why">{why}</span>
          <Icon name={open ? "chevronDown" : "chevronRight"} className="summary-line-caret" />
        </button>
        <button className="act act-include" onClick={() => set("active")}
          title={summary.not_sent === "overlaps" ? "Use this one instead: the other is set aside" : "Send the summary in place of its cards"}>Include</button>
        <Menu label="Summary actions" className="act act-more" icon="more" items={more} />
      </div>
      {open && (editing
        ? <SummaryEdit summary={summary} onDone={() => setEditing(false)} />
        : summary.content && <div className="summary-line-body msg-body is-output"><Md text={summary.content} /></div>)}
    </section>
  );
}

export function SummaryReview({ summary }: { summary: SummaryView }) {
  const live = useStore(s => s.live);
  const run = useStore(s => s.run);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const count = summary.message_ids.length;
  const drafting = summary.status === "drafting";
  const text = drafting && summary.run_id ? liveText(live, summary.run_id) : summary.content;
  const empty = !drafting && !summary.content;
  const set = (status: "active" | "inactive" | "discarded") => run("set_summary_status", { summary_id: summary.id, status });
  const sendFeedback = () => {
    if (!feedback?.trim()) return;
    void run("revise_summary", { summary_id: summary.id, feedback: feedback.trim() });
    setFeedback(null);
  };

  return (
    <section className={`summary-review ${drafting ? "is-drafting" : "is-review"}`} id={`summary-card-${summary.id}`} aria-label="Summary to review">
      <header className="summary-review-head">
        <span className="summary-review-title">
          {drafting ? <><span className="spinner is-inline" aria-hidden />Writing a summary</> : "Summary to review"}
        </span>
        <span className="summary-review-sub">
          of {summary.cards.length} card{summary.cards.length === 1 ? "" : "s"} below ({count} message{count === 1 ? "" : "s"})
        </span>
      </header>
      {editing
        ? <SummaryEdit summary={summary} onDone={() => setEditing(false)} />
        : text && <div className={`summary-review-text msg-body is-output ${drafting ? "is-streaming" : ""}`}><Md text={text} /></div>}
      {!drafting && !editing && summary.cut_off && (
        <p className="summary-review-note">
          {empty ? "Copied while it was being written, before it had any text. Write it again to have one to use."
            : "Copied while it was being written: this is what it had then."}
        </p>
      )}
      {feedback !== null && !editing && (
        <div className="summary-feedback">
          <input autoFocus value={feedback} onChange={e => setFeedback(e.target.value)} aria-label="What should change"
            placeholder="What should change? e.g. keep the exact numbers"
            onKeyDown={e => { if (e.key === "Enter") sendFeedback(); if (e.key === "Escape") setFeedback(null); }} />
          <button className="btn btn-sm" onClick={sendFeedback} disabled={!feedback.trim()}>Revise</button>
        </div>
      )}
      <div className="summary-review-actions">
        {drafting ? (
          <button className="btn btn-ghost btn-sm" onClick={() => set("discarded")}>Cancel</button>
        ) : empty ? (
          <>
            <button className="btn btn-primary btn-sm" onClick={() => run("revise_summary", { summary_id: summary.id })}><Icon name="regenerate" /> Write it again</button>
            <button className="btn btn-ghost btn-sm" onClick={() => set("discarded")}>Discard</button>
          </>
        ) : (
          <>
            <button className="btn btn-primary btn-sm" onClick={() => set("active")}><Icon name="check" /> Use this summary</button>
            <button className="btn btn-sm" onClick={() => setEditing(true)}>Edit</button>
            <button className="btn btn-sm" onClick={() => setFeedback(feedback === null ? "" : null)}>Revise…</button>
            <Menu label="More summary actions" className="act act-more" icon="more" items={[
              { label: "Write it again from scratch", icon: "regenerate", hint: B.revise_summary.tip, onSelect: () => run("revise_summary", { summary_id: summary.id }) },
              { label: "Discard", icon: "trash", danger: true, hint: B["set_summary_status:discarded"].tip, onSelect: () => set("discarded") },
            ]} />
          </>
        )}
      </div>
    </section>
  );
}
