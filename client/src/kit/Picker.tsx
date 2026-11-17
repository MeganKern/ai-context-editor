import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon.js";

/**
 * Choosing one thing from a list: a search box when the list is long, the matches, arrows and
 * Enter to pick, and optionally a way to make a new one from what was typed. Used inline (in a
 * row, a dialog) or inside a layer by its field.
 */
export function Picker<T>({ items, keyOf, render, matches, onPick, placeholder, search = "auto", empty, create, max = 80, className = "", disabled, autoFocus = true, label }: {
  items: T[];
  keyOf: (item: T) => string;
  render: (item: T) => ReactNode;
  /** Whether an item matches what's typed. */
  matches: (item: T, needle: string) => boolean;
  onPick: (item: T) => void;
  placeholder?: string;
  /** "auto": a search box once there are more than a few. */
  search?: boolean | "auto";
  empty?: (query: string) => ReactNode;
  /** Something new from what's typed. */
  create?: { label: (query: string) => ReactNode; onCreate: (query: string) => void; whenEmpty?: boolean };
  max?: number;
  className?: string;
  /** Items that can't be picked (shown, but not chosen). */
  disabled?: (item: T) => boolean;
  autoFocus?: boolean;
  label: string;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const needle = query.trim().toLowerCase();
  const shown = (needle ? items.filter(i => matches(i, needle)) : items).slice(0, max);
  const total = needle ? items.filter(i => matches(i, needle)).length : items.length;
  const showSearch = search === true || (search === "auto" && items.length > 6);
  const canCreate = !!create && (needle.length > 0 || !!create.whenEmpty);

  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(".picker-item.is-active")?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (i: number) => {
    const item = shown[i];
    if (item && !disabled?.(item)) onPick(item);
    else if (!item && canCreate) create!.onCreate(query.trim());
  };
  const onKey = (e: React.KeyboardEvent) => {
    const n = shown.length + (canCreate ? 1 : 0);
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.min(n - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); pick(active); }
    else if (e.key === "Escape" && query) { e.preventDefault(); setQuery(""); }
  };

  return (
    <div className={`picker ${className}`} onKeyDown={onKey}>
      {showSearch && (
        <div className="picker-search">
          <Icon name="search" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder={placeholder} aria-label={label} autoFocus={autoFocus} />
        </div>
      )}
      <ul ref={listRef} className="picker-list" role="listbox" aria-label={label}>
        {shown.map((item, i) => (
          <li key={keyOf(item)}>
            <button type="button" role="option" aria-selected={i === active} disabled={disabled?.(item)}
              className={`picker-item ${i === active ? "is-active" : ""}`}
              onMouseEnter={() => setActive(i)} onClick={() => pick(i)}>
              {render(item)}
            </button>
          </li>
        ))}
        {shown.length === 0 && !canCreate && <li className="picker-empty">{empty ? empty(query) : "Nothing matches"}</li>}
        {total > shown.length && <li className="picker-more">Showing {shown.length} of {total} — type to narrow it down</li>}
        {canCreate && (
          <li>
            <button type="button" role="option" aria-selected={active === shown.length}
              className={`picker-item picker-create ${active === shown.length ? "is-active" : ""}`}
              onMouseEnter={() => setActive(shown.length)} onClick={() => create!.onCreate(query.trim())}>
              <Icon name="plus" />{create!.label(query.trim())}
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}
