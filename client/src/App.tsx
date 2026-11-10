import { useEffect, useRef, useState } from "react";
import { useStore, readHashRoute } from "./store.js";
import { WorkspacePicker } from "./components/WorkspacePicker.js";
import { Sidebar } from "./components/Sidebar.js";
import { ChatView } from "./components/ChatView.js";
import { TemplateView, TemplatePanel } from "./components/TemplateView.js";
import { ContextPanel } from "./components/ContextPanel.js";
import { NoteEditor } from "./components/NoteEditor.js";
import { NotePicker } from "./components/NotePicker.js";
import { PromptInspector } from "./components/PromptInspector.js";
import { BranchesDialog } from "./components/Branches.js";
import { Icon } from "./components/Icon.js";
import { SIDEBAR_PX } from "./constants.js";

async function followHash() {
  const route = readHashRoute();
  const st = useStore.getState();
  if (!route.wsId) return;
  if (st.ws?.workspace.id !== route.wsId) await st.openWorkspace(route.wsId);
  if (route.threadId !== useStore.getState().activeThreadId) useStore.getState().openThread(route.threadId);
}

export function App() {
  const ws = useStore(s => s.ws);
  const thread = useStore(s => s.thread);
  const activeThreadId = useStore(s => s.activeThreadId);
  const error = useStore(s => s.error);
  const clearError = useStore(s => s.clearError);
  const ui = useStore(s => s.ui);
  const setUi = useStore(s => s.setUi);
  const togglePanel = useStore(s => s.togglePanel);

  // The conversation/panel split can be dragged, as before; the share is remembered per browser.
  const [splitPct, setSplitPct] = useState(() => {
    try { return Number(localStorage.getItem("desk.splitPct")) || 70; } catch { return 70; }
  });
  const [resizing, setResizing] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) => {
      const rect = shellRef.current?.getBoundingClientRect();
      if (!rect) return;
      const available = rect.width - SIDEBAR_PX;
      const x = e.clientX - rect.left - SIDEBAR_PX;
      setSplitPct(Math.max(25, Math.min(80, (x / available) * 100)));
    };
    const onUp = () => {
      setResizing(false);
      setSplitPct(p => { try { localStorage.setItem("desk.splitPct", String(p)); } catch { /* private mode */ } return p; });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [resizing]);

  useEffect(() => {
    void followHash();
    // Back/forward and pasted links change only the hash; follow them.
    const onHash = () => { void followHash(); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (!ws) return <WorkspacePicker />;

  const isTemplate = !!activeThreadId && thread?.thread.kind === "template";
  // Beside a thread (and on the workspace page) the panel is the context, always there on a
  // wide screen and a drawer on a narrow one. A template's run panel can be hidden.
  const showPanel = isTemplate ? ui.panel.template : true;
  const drawerOpen = isTemplate ? showPanel : ui.panel.chat;

  return (
    <>
      <div ref={shellRef}
        className={`app ${showPanel ? "has-panel" : ""} ${ui.sidebarOpen ? "has-drawer" : ""} ${resizing ? "is-resizing" : ""}`}
        style={{ "--main-fr": `${splitPct}fr`, "--panel-fr": `${100 - splitPct}fr` } as React.CSSProperties}>
        <Sidebar />
        {ui.sidebarOpen && <div className="sidebar-scrim" onClick={() => setUi({ sidebarOpen: false })} aria-hidden />}
        <main className="main" aria-label={isTemplate ? "Template" : "Conversation"}>
          {isTemplate ? <TemplateView /> : <ChatView />}
        </main>
        {showPanel && (
          <aside className={`panel ${isTemplate ? "is-run" : "is-context"} ${drawerOpen ? "is-open" : ""}`}
            aria-label={isTemplate ? "Run this template" : "Context"}>
            <div className="panel-resize" title="Drag to resize" aria-hidden
              onMouseDown={e => { e.preventDefault(); setResizing(true); }} />
            {isTemplate
              ? <div className="panel-scroll">{thread && <TemplatePanel />}</div>
              : <div className="panel-body"><ContextPanel /></div>}
          </aside>
        )}
        {showPanel && drawerOpen && <div className="panel-scrim" onClick={() => togglePanel(false)} aria-hidden />}
      </div>

      {ui.noteEditor && <NoteEditor noteId={ui.noteEditor} onClose={() => setUi({ noteEditor: null })} />}
      {ui.mode?.kind === "notePicker" && <NotePicker />}
      <PromptInspector />
      <BranchesDialog />

      <div className="toasts" aria-live="polite">
        {error && (
          <div className="toast toast-error" role="alert">
            <Icon name="alert" />
            <span className="toast-text">{error}</span>
            <button className="btn btn-ghost btn-sm" onClick={clearError}>Dismiss</button>
          </div>
        )}
        {ui.toast && (
          <div className="toast" role="status">
            <span className="toast-text">{ui.toast.text}</span>
            {ui.toast.action && (
              <button className="btn btn-ghost btn-sm toast-action" onClick={e => { e.stopPropagation(); ui.toast!.action!(); setUi({ toast: null }); }}>
                {ui.toast.label ?? "Open"}
              </button>
            )}
            <button className="icon-btn" onClick={() => setUi({ toast: null })} aria-label="Close"><Icon name="close" /></button>
          </div>
        )}
      </div>
    </>
  );
}
