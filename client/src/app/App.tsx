import { useEffect, useRef } from "react";
import { useModel } from "../data/model.js";
import { useRoute } from "../session/route.js";
import { layout, useLayout } from "../session/layout.js";
import { useBoot } from "./boot.js";
import { Sidebar } from "./Sidebar.js";
import { ActivityHost } from "./ActivityHost.js";
import { Toasts } from "./Toasts.js";
import { NarrowBar } from "./NarrowBar.js";
import { IconButton } from "../kit/Button.js";
import { WorkspaceScreen } from "../features/workspace/WorkspaceScreen.js";
import { ChatView } from "../features/conversation/ChatView.js";
import { TemplateEditor } from "../features/templates/TemplateEditor.js";
import { TemplatePanel } from "../features/templates/TemplatePanel.js";
import { LibraryPanel } from "../features/library/LibraryPanel.js";

/**
 * The shell: the left column, the conversation (or a template) in the middle, and beside it the
 * library (or the template's panel). On a narrow screen the side columns become drawers, and the
 * panel gets a close button. Whatever is open over the page is mounted once, by the activity host.
 */
export function App() {
  useBoot();
  const app = useModel(s => s.app);
  const ws = useModel(s => s.ws);
  const threadId = useModel(s => s.threadId);
  const thread = useModel(s => s.thread);
  const wsId = useRoute(s => s.wsId);
  const lay = useLayout();
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!lay.resizing) return;
    const onMove = (e: MouseEvent) => {
      const rect = shellRef.current?.getBoundingClientRect();
      if (!rect) return;
      if (lay.resizing === "sidebar") {
        layout.setSidebarW(e.clientX - rect.left);
      } else {
        const sw = useLayout.getState().sidebarW;
        layout.setSplit(((e.clientX - rect.left - sw) / (rect.width - sw)) * 100);
      }
    };
    const onUp = () => layout.stopResize();
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [lay.resizing]);

  if (!app) return null;
  if (!wsId) return app.workspaces.length === 0 ? <><WorkspaceScreen /><ActivityHost /><Toasts /></> : null;
  if (!ws) return null;

  const isTemplate = !!threadId && thread?.thread.kind === "template";

  return (
    <>
      <div ref={shellRef}
        className={`app ${lay.sidebarDrawer ? "has-drawer" : ""} ${lay.resizing ? "is-resizing" : ""}`}
        style={{ "--main-fr": `${lay.splitPct}fr`, "--panel-fr": `${100 - lay.splitPct}fr`, "--sidebar-w": `${lay.sidebarW}px` } as React.CSSProperties}>
        <Sidebar />
        {lay.sidebarDrawer && <div className="sidebar-scrim" onClick={() => layout.sidebarDrawer(false)} aria-hidden />}
        <main className="main" aria-label={isTemplate ? "Template" : "Conversation"}>
          <NarrowBar panel={isTemplate ? "Run this template" : "Library"} icon={isTemplate ? "play" : "panel"} />
          {isTemplate ? <TemplateEditor /> : <ChatView />}
        </main>
        <aside className={`panel ${lay.panelDrawer ? "is-open" : ""}`} aria-label={isTemplate ? "Beside the template" : "Library"}>
          <div className="panel-resize" title="Drag to resize" aria-hidden
            onMouseDown={e => { e.preventDefault(); layout.startResize("split"); }} />
          <IconButton icon="close" label="Hide this panel" className="panel-close" help="dl.close" onClick={() => layout.panelDrawer(false)} />
          {isTemplate ? <TemplatePanel /> : <div className="panel-body"><LibraryPanel /></div>}
        </aside>
        {lay.panelDrawer && <div className="panel-scrim" onClick={() => layout.panelDrawer(false)} aria-hidden />}
      </div>
      <ActivityHost />
      <Toasts />
    </>
  );
}
