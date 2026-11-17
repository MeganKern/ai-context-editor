import { useEffect } from "react";
import { create } from "zustand";

/**
 * Server data that isn't in a snapshot, read when something on screen needs it: a library item's
 * text, a card's history, an agent's steps, a prompt preview, a search. The snapshot is the index
 * and the key carries what would make the body stale (a content hash, a count, the thread's seq),
 * so nothing decides when to read again: a new key is a new read, an old key is still good.
 */
interface Entry { data: unknown; failed: boolean }
interface Resources { byKey: Record<string, Entry>; loading: Record<string, true> }

const useResources = create<Resources>(() => ({ byKey: {}, loading: {} }));
const inflight = new Map<string, Promise<void>>();

function ensure<T>(key: string, load: () => Promise<T>): Promise<void> {
  if (useResources.getState().byKey[key]) return Promise.resolve();
  const running = inflight.get(key);
  if (running) return running;
  useResources.setState(s => ({ loading: { ...s.loading, [key]: true } }));
  const p = load()
    .then(data => useResources.setState(s => ({ byKey: { ...s.byKey, [key]: { data, failed: false } } })))
    .catch(() => useResources.setState(s => ({ byKey: { ...s.byKey, [key]: { data: null, failed: true } } })))
    .finally(() => {
      inflight.delete(key);
      useResources.setState(s => { const loading = { ...s.loading }; delete loading[key]; return { loading }; });
    });
  inflight.set(key, p);
  return p;
}

/** Something known already (text just saved from here) stands in until the server's copy arrives. */
export function prime<T>(key: string, data: T): void {
  useResources.setState(s => ({ byKey: { ...s.byKey, [key]: { data, failed: false } } }));
}

export function useResource<T>(key: string | null, load: () => Promise<T>): { data: T | null; loading: boolean; failed: boolean } {
  const entry = useResources(s => (key ? s.byKey[key] : undefined));
  const loading = useResources(s => (key ? !!s.loading[key] : false));
  useEffect(() => { if (key) void ensure(key, load); }, [key]);
  return { data: (entry?.data as T | undefined) ?? null, loading: !entry && loading, failed: !!entry?.failed };
}
