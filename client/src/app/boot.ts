import { useEffect } from "react";
import { loadApp, onModelEvents, openThread, openWorkspace } from "../data/model.js";
import { navigate, startRouting, useRoute } from "../session/route.js";
import { activity } from "../session/activity.js";
import { rows } from "../session/rows.js";
import { composer } from "../session/composer.js";
import { layout } from "../session/layout.js";
import { notices } from "../session/notices.js";
import { prefs, setPref } from "../session/prefs.js";

/**
 * Wires the pieces together once: the address bar decides what's open; the read model follows
 * it; a change of thread closes whatever was open over the page; a change of workspace starts
 * the message box afresh. A thread named under a workspace that isn't its own (an address typed
 * or edited by hand) is opened in its own: the address is corrected, not refused.
 */
export function useBoot(): void {
  useEffect(() => {
    let wsId: string | null = null;
    let threadId: string | null = null;
    const follow = () => {
      const r = useRoute.getState();
      const wsChanged = r.wsId !== wsId;
      if (wsChanged) {
        wsId = r.wsId;
        openWorkspace(wsId);
        composer.resetAll();
        if (wsId) setPref("lastWs", wsId);
      }
      // Opening a workspace closes the thread with it, so the one named is opened again after one.
      if (wsChanged || r.threadId !== threadId) {
        threadId = r.threadId;
        openThread(threadId);
        activity.close();
        rows.closeAll();
        composer.reset();
        layout.sidebarDrawer(false);
        layout.panelDrawer(false);
      }
    };
    startRouting();
    follow();
    const unfollow = useRoute.subscribe(follow);

    void loadApp().then(app => {
      // No workspace in the address bar: the last one used, else the first there is.
      if (!app || useRoute.getState().wsId || !app.workspaces.length) return;
      const last = prefs().lastWs;
      navigate({ wsId: app.workspaces.find(w => w.id === last)?.id ?? app.workspaces[0].id });
    });

    onModelEvents({
      threadGone() {
        navigate({ threadId: null });
        notices.toast("Thread no longer exists");
      },
      threadElsewhere(threadId, wsId) {
        // Once the read that noticed has returned: going there reads the thread again, in its workspace.
        queueMicrotask(() => navigate({ wsId, threadId }));
      },
    });
    return unfollow;
  }, []);
}
