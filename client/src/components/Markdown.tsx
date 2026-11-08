import { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const renderer = new marked.Renderer();

renderer.code = ({ text, lang }) => {
  const escaped = escapeHtml(text);
  if (lang?.startsWith("tool:")) {
    const toolName = escapeHtml(lang.slice(5));
    return `<div class="md-tool-call"><span class="md-tool-name">${toolName}</span><pre class="md-tool-body"><code>${escaped}</code></pre></div>`;
  }
  if (lang === "result") {
    return `<div class="md-tool-result"><pre class="md-tool-body"><code>${escaped}</code></pre></div>`;
  }
  return `<pre class="md-pre"><code class="md-codeblock${lang ? ` lang-${escapeHtml(lang)}` : ""}">${escaped}</code></pre>`;
};

renderer.heading = function ({ tokens, depth }) {
  const content = this.parser.parseInline(tokens);
  const tag = `h${depth}` as const;
  const cls = depth === 1 ? "md-h1" : depth === 2 ? "md-h2" : "md-h3";
  return `<${tag} class="${cls}">${content}</${tag}>`;
};

renderer.table = function ({ header, rows, align }) {
  const alignAttr = (i: number) => {
    const a = align[i];
    return a ? ` style="text-align:${a}"` : "";
  };
  let html = '<table class="md-table"><thead><tr>';
  for (let i = 0; i < header.length; i++) {
    html += `<th${alignAttr(i)}>${this.parser.parseInline(header[i].tokens)}</th>`;
  }
  html += "</tr></thead><tbody>";
  for (const row of rows) {
    html += "<tr>";
    for (let i = 0; i < row.length; i++) {
      html += `<td${alignAttr(i)}>${this.parser.parseInline(row[i].tokens)}</td>`;
    }
    html += "</tr>";
  }
  html += "</tbody></table>";
  return html;
};

renderer.list = ({ items, ordered }) => {
  const body = items.map(item => renderer.listitem(item)).join("");
  return ordered
    ? `<ol class="md-ol">${body}</ol>`
    : `<ul class="md-ul">${body}</ul>`;
};

renderer.hr = () => '<hr class="md-hr">';

renderer.codespan = ({ text }) => `<code class="md-code">${escapeHtml(text)}</code>`;

marked.setOptions({ renderer, breaks: true, gfm: true });

DOMPurify.addHook("uponSanitizeAttribute", (_node, data) => {
  if (data.attrName === "class") data.forceKeepAttr = true;
});

function renderMarkdown(src: string): string {
  if (!src) return "";
  const raw = marked.parse(src, { async: false }) as string;
  return DOMPurify.sanitize(raw, {
    ADD_ATTR: ["class", "style"],
    ADD_TAGS: ["code", "pre"],
  });
}

export function Md({ text }: { text: string }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return <div className="md-body" dangerouslySetInnerHTML={{ __html: html }} />;
}
