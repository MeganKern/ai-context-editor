import { useState, useEffect, useRef } from "react";
import { useStore } from "../store.js";
import { Icon } from "./Icon.js";
import { conversationOf } from "../branches.js";
import { Menu, ConfirmDialog, type MenuItem } from "./Menu.js";
import { contextBudget } from "../format.js";
import { BEHAVIOUR as B } from "../../../shared/behaviour.js";

/**
 * The title bar of the open thread or template: where it lives, what it's called, and the rare
 * thread-level actions in a menu. On a narrow screen it also opens the context drawer (marked
 * when the thread is getting close to what the model can take); a template's run panel can be
 * shown or hidden.
 */
export function ThreadHeader() {
  const thread = useStore(s => s.thread);
  const ws = useStore(s => s.ws);
  const run = useStore(s => s.run);
  const openThread = useStore(s => s.openThread);
  const toast = useStore(s => s.toast);
  const panelOpen = useStore(s => s.thread?.thread.kind === "template" ? s.ui.panel.template : s.ui.panel.chat);
  const togglePanel = useStore(s => s.togglePanel);
  const setUi = useStore(s => s.setUi);
  const hideExcluded = useStore(s => s.ui.hideExcluded);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isRenaming = renaming !== null;
  useEffect(() => { if (isRenaming) inputRef.current?.select(); }, [isRenaming]);

  if (!thread || !ws) return null;
  const t = thread.thread;
  const isTemplate = t.kind === "template";
  // On a template's page: one of its runs' threads, or a branch of one.
  const templateId = thread.place.template_id;
  const templateName = ws.threads.find(x => x.id === templateId)?.name ?? thread.template_origin?.template_name ?? "Template";
  const folder = ws.folders.find(f => f.id === thread.place.folder_id);
  const naming = !!thread.title_run;
  const budget = !isTemplate ? contextBudget(thread.context) : null;
  const noun = isTemplate ? "template" : "thread";
  // The conversation this thread belongs to: the one everything was branched from, and every branch.
  const family = isTemplate ? [] : conversationOf(ws.threads, t.id);

  const saveName = async () => {
    const v = renaming?.trim();
    if (v && v !== t.name) await run("rename_thread", { thread_id: t.id, name: v });
    setRenaming(null);
  };

  const items: MenuItem[] = [
    { label: "Rename", icon: "edit", hint: B.rename_thread.tip, onSelect: () => setRenaming(t.name) },
  ];
  if (!isTemplate && thread.messages.length > 0) {
    items.push({ label: naming ? "Naming…" : "Name it from the conversation", icon: "regenerate", disabled: naming,
      hint: B.generate_title.tip, onSelect: () => run("generate_title", { thread_id: t.id }) });
  }
  if (family.length > 1) {
    items.push({ label: "Branches…", hint: `This conversation and its ${family.length - 1} branch${family.length === 2 ? "" : "es"}`,
      onSelect: () => setUi({ visit: { branchesOpen: true } }) });
  }
  if (!isTemplate && thread.messages.length > 0) {
    items.push({ label: "Summarize…", icon: "summary", hint: B.summarize.tip,
      onSelect: () => setUi({ mode: { kind: "selection", picked: [] } }) });
  }
  const excludedCount = thread.messages.filter(m => m.excluded || m.context === "excluded").length;
  if (excludedCount > 0) {
    items.push({
      label: hideExcluded ? "Show excluded messages" : "Hide excluded messages",
      icon: hideExcluded ? "eye" : "eyeOff",
      onSelect: () => {
        const next = !hideExcluded;
        setUi({ hideExcluded: next });
        try { localStorage.setItem("desk.hideExcluded", next ? "1" : "0"); } catch { /* private mode */ }
      },
    });
  }
  items.push({
    label: `Duplicate ${noun}`, icon: "copy",
    hint: isTemplate ? B["duplicate_thread:template"].tip : B.duplicate_thread.tip,
    onSelect: async () => {
      const r = await run("duplicate_thread", { thread_id: t.id });
      if (r) toast(`Duplicated as “${t.name} (copy)”`, () => openThread(r.thread_id), "Open copy");
    },
  });
  if (!isTemplate) {
    items.push({
      label: "Make a template from this", icon: "template",
      hint: B.make_template.tip,
      onSelect: async () => {
        const r = await run("make_template", { thread_id: t.id });
        if (r) toast(`Template created: “${t.name} (template)”`, () => openThread(r.thread_id), "Open template");
      },
    });
  }
  // A conversation moves whole: this thread with the one it was branched from and every branch.
  if (!templateId && ws.folders.length > 0) {
    items.push({ separator: true }, { heading: family.length > 1 ? "Move the conversation to" : "Move to folder" });
    for (const f of ws.folders) {
      items.push({ label: f.name, checked: thread.place.folder_id === f.id, onSelect: () => run("move_thread", { thread_id: t.id, folder_id: f.id }) });
    }
    items.push({ label: "No folder", checked: !thread.place.folder_id, onSelect: () => run("move_thread", { thread_id: t.id, folder_id: null }) });
  }
  // A template's run still going has to be stopped first: it would go on writing a thread nothing leads to.
  const runGoing = isTemplate && !!thread.template?.runs.some(r => r.status === "running" || r.status === "queued");
  items.push({ separator: true }, {
    label: `Delete ${noun}…`, icon: "trash", danger: true,
    hint: runGoing ? "Stop its run first" : isTemplate ? B["delete_thread:template"].tip : B.delete_thread.tip, disabled: runGoing,
    onSelect: () => setConfirmDelete(true),
  });

  return (
    <header className="thread-head">
      <button className="icon-btn nav-toggle" onClick={() => setUi({ sidebarOpen: true })} aria-label="Show threads" title="Threads">
        <Icon name="menu" />
      </button>
      <div className="thread-head-main">
        <div className="thread-crumb">
          {templateId ? (
            <button className="crumb-link" onClick={() => openThread(templateId)}>
              <Icon name="template" /> {templateName}
            </button>
          ) : isTemplate ? (
            <>
              <span className="crumb-kind"><Icon name="template" /> Template</span>
              {folder && <span className="crumb-kind"><Icon name="folder" /> {folder.name}</span>}
            </>
          ) : folder ? (
            <span className="crumb-kind"><Icon name="folder" /> {folder.name}</span>
          ) : null}
        </div>
        {renaming !== null ? (
          <form className="thread-rename" onSubmit={e => { e.preventDefault(); void saveName(); }}>
            <input
              ref={inputRef}
              className="thread-title-input"
              value={renaming}
              aria-label={`${noun} name`}
              onChange={e => setRenaming(e.target.value)}
              onKeyDown={e => { if (e.key === "Escape") setRenaming(null); }}
            />
            <button type="submit" className="btn btn-sm">Save name</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRenaming(null)}>Cancel</button>
          </form>
        ) : (
          <h1 className="thread-title">
            <button className="thread-title-btn" onClick={() => setRenaming(t.name)} title="Rename">
              <span>{t.name}</span>
              <Icon name="edit" className="thread-title-pencil" />
            </button>
            {naming && <span className="thread-naming"><span className="spinner is-inline" aria-hidden />Naming…</span>}
          </h1>
        )}
      </div>

      <div className="thread-head-actions">
        <button
          className={`btn btn-ghost panel-toggle ${panelOpen ? "is-on" : ""} ${isTemplate ? "" : "is-drawer-only"}`}
          onClick={() => togglePanel()}
          aria-pressed={panelOpen}
          title={isTemplate ? `${panelOpen ? "Hide" : "Show"} the run panel`
            : budget?.over ? "Pinned, in this thread, the library — and this is more than the model can take"
            : "Pinned, in this thread, the library"}
        >
          <Icon name={isTemplate ? "play" : "panel"} />
          <span>{isTemplate ? "Run" : "Context"}</span>
          {budget?.over && <span className="panel-toggle-dot" aria-label="more than the model can take" />}
        </button>
        <Menu label={`${noun} actions`} className="icon-btn" items={items} />
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete “${t.name}”?`}
          body={isTemplate
            ? "The template is deleted, and so are the threads its runs made and their branches; anything running in them is stopped. This can't be undone from the app."
            : "The thread is deleted, and anything running in it is stopped; branches taken from it stay. This can't be undone from the app."}
          confirmLabel={`Delete ${noun}`}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            // Leave it first, so nothing on this page asks for a thread that's about to be gone.
            setConfirmDelete(false);
            openThread(null);
            await run("delete_thread", { thread_id: t.id });
          }}
        />
      )}
    </header>
  );
}
