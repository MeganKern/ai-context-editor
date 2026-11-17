import type { ReactNode } from "react";
import { create } from "zustand";

/**
 * The one thing that's open over the page — a dialog, or a mode that changes what clicking means.
 * Opening one closes the last; opening a thread closes any. A confirmation can sit over an
 * activity, and that's as deep as it goes. Each case carries only what identifies it; whatever is
 * shown reads its own data from the read model.
 */
export type Activity =
  | { kind: "summarize"; picked: string[] }
  | { kind: "combine"; picked: string[] }
  | { kind: "insert-after"; cardId: string }
  | { kind: "inspector"; tab: "reply" | "agent" | "run"; runId: string | null }
  | { kind: "note-editor"; noteId: string }
  | { kind: "new-note" }
  /** A library item read where its pill was clicked. */
  | { kind: "note-view"; noteId: string }
  | { kind: "version-map"; noteId: string }
  | { kind: "branches" }
  | { kind: "add-item" }
  /** Setting up the model provider: one from the catalog, a saved connection, a new one, or the choice of them. */
  | { kind: "llm-setup"; target: { provider: string } | { connection: string } | "new" }
  | { kind: "provider-about"; providerId: string }
  | { kind: "new-workspace" };

export interface Confirm {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
}

interface ActivityState { current: Activity | null; confirm: Confirm | null }

export const useActivity = create<ActivityState>(() => ({ current: null, confirm: null }));

export const activity = {
  open(a: Activity): void { useActivity.setState({ current: a, confirm: null }); },
  /** Changes the open activity's details (the inspector's tab, the picked cards). */
  update<K extends Activity["kind"]>(kind: K, patch: Partial<Extract<Activity, { kind: K }>>): void {
    useActivity.setState(s => (s.current?.kind === kind ? { current: { ...s.current, ...patch } as Activity } : s));
  },
  close(): void { useActivity.setState({ current: null, confirm: null }); },
  confirm(c: Confirm): void { useActivity.setState({ confirm: c }); },
  closeConfirm(): void { useActivity.setState({ confirm: null }); },
};

/** The open activity when it's of this kind, else null. */
export function useActivityOf<K extends Activity["kind"]>(kind: K): Extract<Activity, { kind: K }> | null {
  return useActivity(s => (s.current?.kind === kind ? (s.current as Extract<Activity, { kind: K }>) : null));
}
