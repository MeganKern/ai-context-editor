import { create } from "zustand";

/** What's remembered on this computer between visits: how the screen is arranged, and small habits. */
export interface Prefs {
  lastWs: string | null;
  sidebarW: number;
  splitPct: number;
  /** Thread folders start open; these are closed. */
  collapsedFolders: string[];
  /** Library folders start closed; these are open. */
  openLibraryFolders: string[];
  hideExcluded: boolean;
  /** How many messages have been sent: the key hint under the box retires after a few. */
  composerTaught: number;
  helpHinted: boolean;
}

const DEFAULTS: Prefs = {
  lastWs: null, sidebarW: 264, splitPct: 70, collapsedFolders: [], openLibraryFolders: [], hideExcluded: true,
  composerTaught: 0, helpHinted: false,
};
const KEY = "desk.prefs";

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Prefs>) } : DEFAULTS;
  } catch { return DEFAULTS; }
}

export const usePrefs = create<Prefs>(() => load());

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
  usePrefs.setState({ [key]: value } as Pick<Prefs, K>);
  try { localStorage.setItem(KEY, JSON.stringify(usePrefs.getState())); } catch { /* private mode */ }
}
export const prefs = (): Prefs => usePrefs.getState();

/** A folder's open/closed state flipped, in whichever list it's in. */
export function toggleListed(key: "collapsedFolders" | "openLibraryFolders", id: string): void {
  const list = prefs()[key];
  setPref(key, list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
}
