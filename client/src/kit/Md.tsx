import { useCallback, useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { MARKER_RE } from "../../../shared/note-markers.js";

/**
 * Markdown as the cards show it. Styled by element under .md-body (kit.css), so the editor's
 * rendering and this one match by construction. The only thing added to the markup is the note
 * pill a {{note:…}} marker becomes.
 */

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface NoteRefInfo { name: string; is_current: boolean }

marked.setOptions({ breaks: true, gfm: true });

DOMPurify.addHook("uponSanitizeAttribute", (_node, data) => {
  if (data.attrName === "class" || data.attrName === "data-note-id" || data.attrName === "data-help") data.forceKeepAttr = true;
});

function renderMarkdown(src: string): string {
  if (!src) return "";
  const raw = marked.parse(src, { async: false }) as string;
  return DOMPurify.sanitize(raw, { ADD_ATTR: ["class", "data-note-id", "data-help"] });
}

function preProcessNoteMarkers(text: string, notes: Map<string, NoteRefInfo>): string {
  return text.replace(MARKER_RE, (_, id: string) => {
    const note = notes.get(id);
    if (!note) return "`[deleted note]`";
    const cls = note.is_current ? "note-pill" : "note-pill is-retired";
    return `<span class="${cls}" data-note-id="${escapeHtml(id)}" data-help="msg.note-pill">${escapeHtml(note.name)}</span>`;
  });
}

export function Md({ text, notes, onNotePill }: {
  text: string;
  notes?: Map<string, NoteRefInfo>;
  onNotePill?: (noteId: string) => void;
}) {
  const processed = useMemo(() => notes?.size ? preProcessNoteMarkers(text, notes) : text, [text, notes]);
  const html = useMemo(() => renderMarkdown(processed), [processed]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    const pill = (e.target as HTMLElement).closest<HTMLElement>(".note-pill");
    if (pill && onNotePill) {
      const noteId = pill.dataset.noteId;
      if (noteId) onNotePill(noteId);
    }
  }, [onNotePill]);

  return <div className="md-body" dangerouslySetInnerHTML={{ __html: html }} onClick={onNotePill ? handleClick : undefined} />;
}
