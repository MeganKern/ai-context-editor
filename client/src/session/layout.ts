import { create } from "zustand";
import { prefs, setPref } from "./prefs.js";

/**
 * How the screen is arranged: the left column's width, the split between the middle and the
 * panel beside it, and, on a narrow screen, which drawer is out. Widths are remembered; a drawer
 * is a moment's view and closes when the thread changes.
 */
export type TemplateView = "run" | "library";

interface LayoutState {
  sidebarW: number;
  splitPct: number;
  sidebarDrawer: boolean;
  panelDrawer: boolean;
  /** Beside a template, the panel shows the run controls or the library. */
  templateView: TemplateView;
  resizing: "sidebar" | "split" | null;
}

export const useLayout = create<LayoutState>(() => ({
  sidebarW: prefs().sidebarW,
  splitPct: prefs().splitPct,
  sidebarDrawer: false,
  panelDrawer: false,
  templateView: "run",
  resizing: null,
}));

export const layout = {
  setSidebarW(px: number): void { useLayout.setState({ sidebarW: Math.max(200, Math.min(420, px)) }); },
  setSplit(pct: number): void { useLayout.setState({ splitPct: Math.max(25, Math.min(80, pct)) }); },
  startResize(what: "sidebar" | "split"): void { useLayout.setState({ resizing: what }); },
  stopResize(): void {
    const s = useLayout.getState();
    setPref("sidebarW", s.sidebarW);
    setPref("splitPct", s.splitPct);
    useLayout.setState({ resizing: null });
  },
  sidebarDrawer(open: boolean): void { useLayout.setState({ sidebarDrawer: open }); },
  panelDrawer(open: boolean): void { useLayout.setState({ panelDrawer: open }); },
  templateView(view: TemplateView): void { useLayout.setState({ templateView: view }); },
  /** Brings the panel into view showing `view`: on a narrow window that means sliding it in. */
  showTemplateView(view: TemplateView): void {
    useLayout.setState({ templateView: view });
    if (window.matchMedia("(max-width: 1180px)").matches) useLayout.setState({ panelDrawer: true });
  },
};
