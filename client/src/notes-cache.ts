import { useEffect } from "react";
import { create } from "zustand";
import { read } from "./api.js";
import { useStore } from "./store.js";

/**
 * The text of library items, read on demand: the workspace snapshot carries names and the hash
 * of each item's text. An entry remembers the hash it was read at, so any change to the text
 * (from the panel, the editor or anywhere else) reads it again. Opening an item always reads it
 * fresh; the old text stays on screen meanwhile.
 */
interface Entry { content: string; key: string }
interface NotesState { byId: Record<string, Entry>; loading: Record<string, true>; failed: Record<string, true> }

export const useNotes = create<NotesState>(() => ({ byId: {}, loading: {}, failed: {} }));

function keyFor(id: string): string | null {
  return useStore.getState().ws?.notes.find(n => n.id === id)?.content_hash ?? null;
}

const inflight = new Map<string, Promise<void>>();

/** Fetch an item's text unless the copy here is current (or always, with `fresh`). */
export function ensureNote(id: string, opts: { fresh?: boolean } = {}): Promise<void> {
  const key = keyFor(id);
  if (key === null) return Promise.resolve();
  const have = useNotes.getState().byId[id];
  if (!opts.fresh && have && have.key === key) return Promise.resolve();
  const running = inflight.get(id);
  if (running) return running;
  useNotes.setState(s => ({ loading: { ...s.loading, [id]: true } }));
  const p = read.note(id)
    .then(d => {
      // Stamped with the key from before the request: anything reported since reads again.
      useNotes.setState(s => {
        const failed = { ...s.failed }; delete failed[id];
        return { byId: { ...s.byId, [id]: { content: d.content, key } }, failed };
      });
    })
    .catch(() => { useNotes.setState(s => ({ failed: { ...s.failed, [id]: true } })); })
    .finally(() => {
      inflight.delete(id);
      useNotes.setState(s => { const loading = { ...s.loading }; delete loading[id]; return { loading }; });
    });
  inflight.set(id, p);
  return p;
}

/** Text saved from this browser shows at once; the snapshot's new hash reads it again later. */
export function rememberNote(id: string, content: string): void {
  useNotes.setState(s => ({ byId: { ...s.byId, [id]: { content, key: "" } } }));
}

/** The text of one item: read fresh when it's opened, and again whenever its text changes. */
export function useNoteText(id: string | null): { text: string | null; loading: boolean; failed: boolean } {
  const meta = useStore(s => (id ? s.ws?.notes.find(n => n.id === id) : undefined));
  const entry = useNotes(s => (id ? s.byId[id] : undefined));
  const loading = useNotes(s => (id ? !!s.loading[id] : false));
  const failed = useNotes(s => (id ? !!s.failed[id] : false));
  const key = meta?.content_hash ?? null;
  useEffect(() => { if (id) void ensureNote(id, { fresh: true }); }, [id]);
  useEffect(() => { if (id && key) void ensureNote(id); }, [id, key]);
  return { text: entry?.content ?? null, loading: !entry && loading, failed: !entry && failed };
}
