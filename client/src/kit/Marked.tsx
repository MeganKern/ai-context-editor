import { Fragment, type ReactNode } from "react";

/** Text the server marked with << >> around what it found, the marks drawn. */
export function Marked({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let rest = text;
  let i = 0;
  while (rest.length > 0) {
    const start = rest.indexOf("<<");
    if (start === -1) { parts.push(rest); break; }
    if (start > 0) parts.push(rest.slice(0, start));
    const end = rest.indexOf(">>", start);
    if (end === -1) { parts.push(rest.slice(start)); break; }
    parts.push(<mark key={i++}>{rest.slice(start + 2, end)}</mark>);
    rest = rest.slice(end + 2);
  }
  return <>{parts.map((p, j) => <Fragment key={j}>{p}</Fragment>)}</>;
}
