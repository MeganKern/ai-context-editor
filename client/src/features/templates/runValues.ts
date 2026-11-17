import { create } from "zustand";

/** Blanks typed for a run, by template, kept while the page lives: each template keeps its own, whatever's shown. */
const useStore = create<{ byTemplate: Record<string, Record<string, string>> }>(() => ({ byTemplate: {} }));

const NONE: Record<string, string> = {};

export function useRunValues(templateId: string): Record<string, string> {
  return useStore(s => s.byTemplate[templateId] ?? NONE);
}

export function setRunValue(templateId: string, name: string, value: string): void {
  useStore.setState(s => ({ byTemplate: { ...s.byTemplate, [templateId]: { ...(s.byTemplate[templateId] ?? {}), [name]: value } } }));
}
