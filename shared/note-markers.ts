/** Inline note references: {{note:UUID}} markers stored in message content. */

const UUID_RE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export const MARKER_RE = new RegExp(`\\{\\{note:(${UUID_RE})\\}\\}`, "g");

export function marker(noteId: string): string {
  return `{{note:${noteId}}}`;
}

export function extractNoteIds(text: string): string[] {
  const ids: string[] = [];
  for (const m of text.matchAll(MARKER_RE)) ids.push(m[1]);
  return ids;
}
