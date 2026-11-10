import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { Markdown } from "tiptap-markdown";

const extensions = [
  StarterKit.configure({
    codeBlock: { HTMLAttributes: { class: "md-pre" } },
    code: { HTMLAttributes: { class: "md-code" } },
    heading: { levels: [1, 2, 3] },
    horizontalRule: { HTMLAttributes: { class: "md-hr" } },
    bulletList: { HTMLAttributes: { class: "md-ul" } },
    orderedList: { HTMLAttributes: { class: "md-ol" } },
  }),
  Table.configure({ HTMLAttributes: { class: "md-table" } }),
  TableRow,
  TableCell,
  TableHeader,
  Markdown.configure({
    html: false,
    transformCopiedText: false,
    transformPastedText: true,
  }),
];

type Context = "table" | "heading" | null;

export function RichEditor({ content, onChange, onCancel }: {
  content: string;
  onChange: (md: string) => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<"rich" | "markdown">("rich");
  const [ctx, setCtx] = useState<Context>(null);
  const [headingLevel, setHeadingLevel] = useState(1);

  return (
    <div className="rich-editor-wrap">
      {mode === "rich"
        ? <RichMode content={content} onChange={onChange} onCancel={onCancel} ctx={ctx} setCtx={setCtx} headingLevel={headingLevel} setHeadingLevel={setHeadingLevel} />
        : <MarkdownMode content={content} onChange={onChange} onCancel={onCancel} />}
      <div className="re-mode-toggle">
        <button className={`re-mode-btn ${mode === "rich" ? "active" : ""}`} onClick={() => setMode("rich")}>Rich</button>
        <button className={`re-mode-btn ${mode === "markdown" ? "active" : ""}`} onClick={() => setMode("markdown")}>Markdown</button>
      </div>
    </div>
  );
}

function RichMode({ content, onChange, onCancel, ctx, setCtx, headingLevel, setHeadingLevel }: {
  content: string;
  onChange: (md: string) => void;
  onCancel: () => void;
  ctx: Context;
  setCtx: (c: Context) => void;
  headingLevel: number;
  setHeadingLevel: (l: number) => void;
}) {
  const initial = useRef(content);
  const latestContent = useRef(content);

  const editor = useEditor({
    extensions,
    content: initial.current,
    autofocus: "end",
    editorProps: {
      handleKeyDown(_view, event) {
        if (event.key === "Escape") {
          onCancel();
          return true;
        }
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
    onSelectionUpdate({ editor: e }) {
      updateCtx(e);
    },
  });

  // When content changes externally (e.g. switching back from markdown mode), update the editor.
  useEffect(() => {
    if (editor && content !== latestContent.current) {
      latestContent.current = content;
      editor.commands.setContent(content);
    }
  }, [editor, content]);

  function updateCtx(e: NonNullable<typeof editor>) {
    if (e.isActive("tableCell") || e.isActive("tableHeader")) {
      setCtx("table");
    } else if (e.isActive("heading")) {
      setCtx("heading");
      setHeadingLevel(e.getAttributes("heading").level ?? 1);
    } else {
      setCtx(null);
    }
  }

  useEffect(() => () => editor?.destroy(), [editor]);

  return (
    <>
      {editor && ctx === "table" && (
        <div className="re-toolbar">
          <button className="re-btn re-danger" onClick={() => editor.chain().focus().deleteColumn().run()} title="Delete column">✕ Col</button>
          <button className="re-btn re-danger" onClick={() => editor.chain().focus().deleteRow().run()} title="Delete row">✕ Row</button>
          <span className="re-sep" />
          <button className="re-btn re-danger" onClick={() => editor.chain().focus().deleteTable().run()} title="Delete entire table">✕ Table</button>
        </div>
      )}
      {editor && ctx === "heading" && (
        <div className="re-toolbar">
          <button className="re-btn" disabled={headingLevel <= 1} onClick={() => {
            if (headingLevel > 1) editor.chain().focus().setHeading({ level: (headingLevel - 1) as 1|2|3 }).run();
          }} title="Promote heading (smaller number)">H↑</button>
          <button className="re-btn" disabled={headingLevel >= 3} onClick={() => {
            if (headingLevel < 3) editor.chain().focus().setHeading({ level: (headingLevel + 1) as 1|2|3 }).run();
          }} title="Demote heading (larger number)">H↓</button>
          <button className="re-btn" onClick={() => editor.chain().focus().toggleHeading({ level: headingLevel as 1|2|3 }).run()} title="Convert to paragraph">→ ¶</button>
          <button className="re-btn re-danger" onClick={() => {
            editor.chain().focus().selectParentNode().deleteSelection().run();
          }} title="Delete heading">✕</button>
        </div>
      )}
      <EditorContent editor={editor} />
    </>
  );
}

function MarkdownMode({ content, onChange, onCancel }: {
  content: string;
  onChange: (md: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.focus();
      ref.current.setSelectionRange(ref.current.value.length, ref.current.value.length);
    }
  }, []);

  // Auto-resize
  useEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
  }, [content]);

  return (
    <textarea
      ref={ref}
      className="re-markdown-ta"
      value={content}
      onChange={e => onChange(e.target.value)}
      onKeyDown={e => {
        if (e.key === "Escape") onCancel();
      }}
      spellCheck={false}
    />
  );
}
