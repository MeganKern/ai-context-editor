import { useState } from "react";
import { useStore } from "../store.js";
import { ThreadHeader } from "./ThreadHeader.js";
import { Conversation } from "./Conversation.js";
import { Composer } from "./Composer.js";
import { Icon } from "./Icon.js";
import { clip, homePath } from "../format.js";

const KIND = { reply: "reply", agent: "agent run", template: "template run", summarize: "summary", title: "naming attempt" } as const;

export function ChatView() {
  const thread = useStore(s => s.thread);
  const activeThreadId = useStore(s => s.activeThreadId);

  if (!activeThreadId) return <EmptyWorkspace />;
  if (!thread) return <div className="chat is-loading" aria-busy="true" />;

  return (
    <div className="chat">
      <ThreadHeader />
      {thread.template_origin && <RunOriginBar />}
      <Conversation />
      <AttentionBar />
      <Composer />
    </div>
  );
}

/**
 * Threads a template made: which run this is, a way to step between runs, and — while the run is
 * going — a way to stop it. You can work in the thread meanwhile: each step is added at the end,
 * written from the thread as it is then.
 */
function RunOriginBar() {
  const origin = useStore(s => s.thread?.template_origin);
  const openThread = useStore(s => s.openThread);
  const run = useStore(s => s.run);
  if (!origin) return null;
  const live = origin.status === "running" || origin.status === "queued";
  const statusText = live
    ? origin.cancel_requested ? "Stopping…"
      : `Running${origin.progress ? ` step ${Math.max(1, Math.min(origin.progress.step, origin.progress.total))} of ${origin.progress.total}` : ""}`
    : origin.status === "done" ? "Finished"
    : origin.status === "stopped" ? "Stopped" : origin.status === "failed" ? "Failed" : origin.status.replace("_", " ");

  return (
    <div className={`origin-bar ${live ? "is-live" : ""} status-${origin.status}`}>
      <span className="origin-text">
        This is <strong>run {origin.run_number}</strong> of the template.
      </span>
      <span className={`status-pill status-${origin.status}`}
        title={live ? "Its next steps are added at the end of this thread, written from the thread as it is then" : undefined}>
        {live && <span className="spinner" aria-hidden />}{statusText}
      </span>
      {origin.error && <span className="origin-error" title={origin.error}>{clip(origin.error, 80)}</span>}
      <span className="spacer" />
      {live && !origin.cancel_requested && (
        <button className="btn btn-sm" onClick={() => run("cancel_run", { run_id: origin.run_id })}><Icon name="stop" /> Stop run</button>
      )}
      <div className="origin-nav" role="group" aria-label="Other runs">
        <button className="icon-btn" disabled={!origin.previous_output_thread_id} onClick={() => openThread(origin.previous_output_thread_id!)}
          aria-label="Previous run" title="Previous run"><Icon name="chevronLeft" /></button>
        <button className="icon-btn" disabled={!origin.next_output_thread_id} onClick={() => openThread(origin.next_output_thread_id!)}
          aria-label="Next run" title="Next run"><Icon name="chevronRight" /></button>
      </div>
    </div>
  );
}

/**
 * Failures no card shows: a summary or naming attempt that failed, or a reply written again that
 * failed (its card kept the reply it had). Each stays until you dismiss it.
 */
function AttentionBar() {
  const thread = useStore(s => s.thread);
  const run = useStore(s => s.run);
  const setUi = useStore(s => s.setUi);
  if (!thread || thread.attention.length === 0) return null;
  const how = (status: string) => (status === "timed_out" ? "timed out" : status === "interrupted" ? "was interrupted" : "failed");
  const said = (error: string | null, n: number) => {
    if (!error) return ".";
    const s = clip(error, n);
    return `: ${s}${/[.!?…]$/.test(s) ? "" : "."}`;
  };

  return (
    <div className="attention" role="region" aria-label="Needs your attention">
      {thread.attention.map(item => (
        <div key={item.run.id} className="attention-item is-failed">
          <Icon name="alert" />
          <div className="attention-text">
            {item.kept ? (
              <strong>Writing a reply again {how(item.run.status)}{said(item.run.error, 110)} The reply is kept as it was.</strong>
            ) : (
              <strong>A {KIND[item.run.kind]} {how(item.run.status)}{said(item.run.error, 120)}</strong>
            )}
          </div>
          {item.kept && item.node_id && (
            <button className="btn btn-sm" onClick={() => setUi({ focus: item.node_id! })}>Show it</button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => run("mark_seen", { run_ids: [item.run.id] })}>Dismiss</button>
        </div>
      ))}
    </div>
  );
}

function EmptyWorkspace() {
  const ws = useStore(s => s.ws);
  const run = useStore(s => s.run);
  const openThread = useStore(s => s.openThread);
  const [name, setName] = useState<string | null>(null);
  if (!ws) return null;
  const create = async () => {
    if (!name?.trim()) return;
    const r = await run("create_thread", { workspace_id: ws.workspace.id, name: name.trim() });
    if (r) { setName(null); openThread(r.thread_id); }
  };
  const path = homePath(ws.workspace.path);
  return (
    <div className="empty-ws">
      <button className="btn btn-ghost nav-toggle empty-ws-nav" onClick={() => useStore.getState().setUi({ sidebarOpen: true })}>
        <Icon name="menu" /> Threads
      </button>
      <button className="btn btn-ghost panel-toggle is-drawer-only empty-ws-library" onClick={() => useStore.getState().togglePanel(true)}>
        <Icon name="panel" /> <span>Library</span>
      </button>
      <div className="empty-ws-inner">
        <h1 className="empty-ws-title">{ws.workspace.name}</h1>
        <p className="empty-ws-lede">
          {ws.threads.length
            ? "Open a thread on the left to pick up where you left off, or start a new one."
            : "Start your first thread. Threads, templates and the library all stay in this workspace."}
        </p>
        {name === null ? (
          <button className="btn btn-lg" onClick={() => setName("")}><Icon name="plus" /> New thread</button>
        ) : (
          <form className="empty-ws-form" onSubmit={e => { e.preventDefault(); void create(); }}>
            <input autoFocus value={name} placeholder="Thread name" aria-label="New thread name"
              onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === "Escape") setName(null); }} />
            <button type="submit" className="btn btn-primary" disabled={!name.trim()}>Create</button>
            <button type="button" className="btn btn-ghost" onClick={() => setName(null)}>Cancel</button>
          </form>
        )}

        <dl className="primer">
          <div>
            <dt>The thread is the prompt</dt>
            <dd>What you pin and what the thread uses from the library come first, then the messages — exactly what the next reply is produced from. Exclude, fold, pin and summarize by hand; nothing is trimmed or summarized behind your back.</dd>
          </div>
          <div>
            <dt>Every reply keeps its prompt</dt>
            <dd>Open <em>Prompt</em> on a reply to read, word for word, what produced it. Fix the context instead of rolling the dice again.</dd>
          </div>
          <div>
            <dt>Edit anything in place; branch on purpose</dt>
            <dd>Every card — yours, a reply, an agent's result — is edited where it is, and Regenerate writes a reply again in the same place. To go another way, branch from a point: the branch is a thread of its own, with everything up to there.</dd>
          </div>
          <div>
            <dt>The library is shared context</dt>
            <dd>Reference text you write once and use in any thread, from the right-hand panel: with every reply, with one message (drag it there), or with your next message (drop it on the box). What you pin stays with one thread.</dd>
          </div>
          <div>
            <dt>Agents take a brief</dt>
            <dd>An agent task hands an agent this thread's context plus your task. It starts in <code>{path}</code> with full permissions, and reports back here.</dd>
          </div>
          <div>
            <dt>Templates repeat a procedure</dt>
            <dd>Make one from a thread (⋯ menu, top right). Each run is a new thread you can keep questioning.</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
