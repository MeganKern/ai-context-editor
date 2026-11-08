import { read } from "./api.js";

/** A run's steps and changes, read once each. A failed read isn't kept, so it's tried again next time. */
const cache = new Map<string, Promise<unknown>>();
function once<T>(key: string, load: () => Promise<T>): Promise<T | null> {
  let p = cache.get(key) as Promise<T | null> | undefined;
  if (!p) {
    p = load().catch(() => { cache.delete(key); return null; });
    cache.set(key, p);
  }
  return p;
}
export const loadSteps = (runId: string) => once(`steps:${runId}`, () => read.steps(runId));
export const loadChanges = (runId: string) => once(`changes:${runId}`, () => read.changes(runId));
