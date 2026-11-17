import { create } from "zustand";

/**
 * Rows in a passing state — a thread, folder or library item being renamed, asked about, moved;
 * library items opened in place, one opened straight into editing, unsaved text typed into one,
 * one that just landed (it flashes). Kept by id, so a row keeps its state when the list re-sorts,
 * and so only one row is renamed (or asked about) at a time.
 */
interface Rows {
  renaming: string | null;
  confirming: string | null;
  moving: string | null;
  /** Library items opened in place, in the thread beside the panel. */
  open: Record<string, true>;
  editing: string | null;
  drafts: Record<string, string>;
  flash: string | null;
}

export const useRows = create<Rows>(() => ({
  renaming: null, confirming: null, moving: null, open: {}, editing: null, drafts: {}, flash: null,
}));

const FLASH_MS = 1600;

export const rows = {
  rename(id: string | null): void { useRows.setState({ renaming: id, confirming: null, moving: null }); },
  confirm(id: string | null): void { useRows.setState({ confirming: id, renaming: null, moving: null }); },
  move(id: string | null): void { useRows.setState({ moving: id, renaming: null, confirming: null }); },
  setOpen(id: string, open: boolean): void {
    useRows.setState(s => {
      const next = { ...s.open };
      if (open) next[id] = true; else delete next[id];
      return { open: next, editing: !open && s.editing === id ? null : s.editing };
    });
  },
  /** Opens an item straight into editing its text. */
  edit(id: string | null): void {
    useRows.setState(s => ({ editing: id, open: id ? { ...s.open, [id]: true } : s.open }));
  },
  draft(id: string, text: string | null): void {
    useRows.setState(s => {
      const drafts = { ...s.drafts };
      if (text === null) delete drafts[id]; else drafts[id] = text;
      return { drafts };
    });
  },
  /** The one way a row is lit for a moment: it just landed, or you were taken to it. */
  flash(id: string): void {
    useRows.setState({ flash: id });
    setTimeout(() => { if (useRows.getState().flash === id) useRows.setState({ flash: null }); }, FLASH_MS);
  },
  /** Another thread: nothing is open in place any more. */
  closeAll(): void { useRows.setState({ open: {}, editing: null }); },
};

export const useOpen = (id: string) => useRows(s => !!s.open[id]);
export const useFlash = (id: string) => useRows(s => s.flash === id);
