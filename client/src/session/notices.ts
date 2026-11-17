import { create } from "zustand";

/**
 * What the app says in passing: the server's last refusal (the error strip), and a word about
 * something that just happened, with at most one thing to do about it (a toast). Each shows until
 * dismissed or its time is up.
 */
export interface Toast { text: string; action: (() => void) | null; label: string | null }
interface Notices { error: string | null; toast: Toast | null }

export const useNotices = create<Notices>(() => ({ error: null, toast: null }));

const timers: Partial<Record<keyof Notices, ReturnType<typeof setTimeout>>> = {};
function show<K extends keyof Notices>(key: K, value: Notices[K], ms: number): void {
  clearTimeout(timers[key]);
  useNotices.setState({ [key]: value } as Pick<Notices, K>);
  timers[key] = setTimeout(() => useNotices.setState({ [key]: null } as Pick<Notices, K>), ms);
}

export const notices = {
  fail(text: string): void { show("error", text, 12_000); },
  toast(text: string, action?: () => void, label?: string): void { show("toast", { text, action: action ?? null, label: label ?? null }, 8000); },
  dismiss(key: keyof Notices): void { clearTimeout(timers[key]); useNotices.setState({ [key]: null } as Pick<Notices, typeof key>); },
};
