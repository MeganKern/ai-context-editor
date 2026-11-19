import { useState } from "react";
import type { OutlineEntry } from "../../derive/cards.js";
import { rows } from "../../session/rows.js";
import { Icon } from "../../kit/Icon.js";

/**
 * A table of contents for the thread, overlaying the left centering gutter so the messages stay
 * exactly where they are. One row per visible card (its first heading, else a snippet); a card's
 * deeper headings nest beneath it, collapsed by default. The chevron only expands/collapses — the
 * label jumps. Card jumps reuse the focus mechanism; heading jumps scroll to the card's Nth <h*>.
 */
export function ThreadOutline({ outline }: { outline: OutlineEntry[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  if (outline.length < 2) return null;

  const toggle = (id: string) => setOpen(s => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const jumpCard = (id: string) => {
    document.getElementById(`msg-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    rows.flash(id);
  };

  const jumpHeading = (cardId: string, index: number) => {
    const card = document.getElementById(`msg-${cardId}`);
    const hs = card?.querySelectorAll<HTMLElement>(
      ".md-body h1, .md-body h2, .md-body h3, .md-body h4, .md-body h5, .md-body h6");
    (hs && hs[index] ? hs[index] : card)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <nav className="thread-outline" aria-label="Thread outline">
      <ul className="to-list">
        {outline.map(entry => {
          const subs = entry.headings.slice(1);
          const isOpen = open.has(entry.id);
          return (
            <li key={entry.id} className={`to-item to-${entry.role}`}>
              <div className="to-row">
                {subs.length ? (
                  <button type="button" className={`to-twisty ${isOpen ? "is-open" : ""}`} aria-expanded={isOpen}
                    aria-label={isOpen ? "Collapse headings" : "Expand headings"} onClick={() => toggle(entry.id)}>
                    <Icon name="chevronRight" />
                  </button>
                ) : <span className="to-twisty is-leaf" />}
                <button type="button" className="to-label to-card-label" title={entry.label}
                  onClick={() => jumpCard(entry.id)}>{entry.label}</button>
              </div>
              {subs.length > 0 && isOpen && (
                <ul className="to-subs">
                  {subs.map(h => (
                    <li key={h.index} className={`to-sub to-h${h.level}`}>
                      <button type="button" className="to-label" title={h.text}
                        onClick={() => jumpHeading(entry.id, h.index)}>{h.text}</button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
