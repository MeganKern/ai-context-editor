import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { Markdown } from "tiptap-markdown";
import { Act } from "./Button.js";
import { useAutoGrow } from "./Fields.js";

/**
 * Editing a card's markdown: as rich text (its elements styled under .md-body like the card
 * itself), or as the markdown source. The toolbar appears only where the caret is in something
 * with choices — a table, a heading.
 */
const extensions = [
  StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
  Table,
  TableRow,
  TableCell,
  TableHeader,
  Markdown.configure({ html: false, transformCopiedText: false, transformPastedText: true }),
];

export function RichEditor({ content, onChange, onCancel }: {
  content: string;
  onChange: (md: string) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<"rich" | "markdown">("rich");
  return (
    <div className="rich-editor">
      {mode === "rich"
        ? <RichMode content={content} onChange={onChange} onCancel={onCancel} />
        : <MarkdownMode content={content} onChange={onChange} onCancel={onCancel} />}
      <div className="seg rich-editor-mode" role="tablist" aria-label="How to edit">
        <button type="button" role="tab" aria-selected={mode === "rich"} className={`seg-opt ${mode === "rich" ? "is-on" : ""}`} onClick={() => setMode("rich")}>Rich</button>
        <button type="button" role="tab" aria-selected={mode === "markdown"} className={`seg-opt ${mode === "markdown" ? "is-on" : ""}`} onClick={() => setMode("markdown")}>Markdown</button>
      </div>
    </div>
  );
}

type Context = { in: "table" } | { in: "heading"; level: 1 | 2 | 3 } | null;

function RichMode({ content, onChange, onCancel }: { content: string; onChange: (md: string) => void; onCancel: () => void }) {
  const initial = useRef(content);
  const latestContent = useRef(content);
  const [ctx, setCtx] = useState<Context>(null);

  const updateCtx = (e: { isActive: (n: string) => boolean; getAttributes: (n: string) => Record<string, any> }) => {
    if (e.isActive("tableCell") || e.isActive("tableHeader")) setCtx({ in: "table" });
    else if (e.isActive("heading")) setCtx({ in: "heading", level: e.getAttributes("heading").level ?? 1 });
    else setCtx(null);
  };

  const editor = useEditor({
    extensions,
    content: initial.current,
    autofocus: "end",
    editorProps: {
      handleKeyDown(_view, event) {
        if (event.key === "Escape") { onCancel(); return true; }
        return false;
      },
      attributes: { class: "rich-edit md-body", "aria-label": "Edit message" },
    },
    onUpdate({ editor: e }) {
      const md = (e.storage as any).markdown.getMarkdown();
      latestContent.current = md;
      onChange(md);
      updateCtx(e);
    },
    onSelectionUpdate({ editor: e }) { updateCtx(e); },
  });

  // When content changes outside (switching back from the markdown source), the editor follows.
  useEffect(() => {
    if (editor && content !== latestContent.current) {
      latestContent.current = content;
      editor.commands.setContent(content);
    }
  }, [editor, content]);

  useEffect(() => () => editor?.destroy(), [editor]);

  const level = ctx?.in === "heading" ? ctx.level : 1;
  return (
    <>
      {editor && ctx?.in === "table" && (
        <div className="rich-editor-tools">
          <Act danger onClick={() => editor.chain().focus().deleteColumn().run()} title="Delete column">✕ Col</Act>
          <Act danger onClick={() => editor.chain().focus().deleteRow().run()} title="Delete row">✕ Row</Act>
          <span className="rich-editor-sep" />
          <Act danger onClick={() => editor.chain().focus().deleteTable().run()} title="Delete entire table">✕ Table</Act>
        </div>
      )}
      {editor && ctx?.in === "heading" && (
        <div className="rich-editor-tools">
          <Act disabled={level <= 1} onClick={() => editor.chain().focus().setHeading({ level: (level - 1) as 1 | 2 | 3 }).run()} title="Promote heading (smaller number)">H↑</Act>
          <Act disabled={level >= 3} onClick={() => editor.chain().focus().setHeading({ level: (level + 1) as 1 | 2 | 3 }).run()} title="Demote heading (larger number)">H↓</Act>
          <Act onClick={() => editor.chain().focus().toggleHeading({ level }).run()} title="Convert to paragraph">→ ¶</Act>
          <Act danger onClick={() => editor.chain().focus().selectParentNode().deleteSelection().run()} title="Delete heading">✕</Act>
        </div>
      )}
      <EditorContent editor={editor} />
    </>
  );
}

function MarkdownMode({ content, onChange, onCancel }: { content: string; onChange: (md: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(ref, content, 2000);
  useEffect(() => {
    const el = ref.current;
    if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  }, []);
  return (
    <textarea ref={ref} className="field-grow is-body rich-editor-markdown" value={content} aria-label="Edit markdown"
      onChange={e => onChange(e.target.value)} onKeyDown={e => { if (e.key === "Escape") onCancel(); }} spellCheck={false} />
  );
}
