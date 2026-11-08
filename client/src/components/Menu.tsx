import { useState, useRef, useEffect, useLayoutEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./Icon.js";

export type MenuItem =
  | { label: string; onSelect: () => void; icon?: IconName; danger?: boolean; disabled?: boolean; hint?: string; checked?: boolean }
  | { heading: string }
  | { separator: true };

/**
 * Menu for rare or destructive actions. The trigger always shows a visible label or icon
 * with an accessible name; the menu itself is rendered in a portal so scroll containers
 * never clip it.
 */
export function Menu({
  items, label, icon = "more", text, className = "", align = "end", title, onOpen,
}: {
  items: MenuItem[];
  label: string;            // accessible name of the trigger
  icon?: IconName | null;
  text?: ReactNode;          // optional visible text on the trigger
  className?: string;
  align?: "start" | "end";
  title?: string;
  onOpen?: () => void;      // e.g. to bring what the items depend on up to date
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; maxH: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const openedByKey = useRef(false);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const menuW = 248;
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    const flip = below < 220 && above > below;
    const left = align === "end" ? Math.max(8, r.right - menuW) : Math.min(r.left, window.innerWidth - menuW - 8);
    setPos({ top: flip ? -1 : r.bottom + 4, left, maxH: flip ? above : below });
    if (flip) {
      requestAnimationFrame(() => {
        const h = menuRef.current?.offsetHeight ?? 0;
        setPos({ top: Math.max(8, r.top - 4 - h), left, maxH: above });
      });
    }
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node) || btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    // Close only when the trigger itself moves: a scroll in another column (the conversation
    // keeping to its end while the panel's menu is open) leaves the menu where it belongs.
    const onScroll = (e: Event) => {
      const target = e.target as Node | null;
      if (menuRef.current?.contains(target)) return;
      if (target && target !== document && btnRef.current && !target.contains(btnRef.current)) return;
      setOpen(false);
    };
    // Escape closes the menu even when it was opened with the mouse (focus is still on the trigger).
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); setOpen(false); btnRef.current?.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", () => setOpen(false), { once: true });
    if (openedByKey.current) {
      requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus());
    }
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) btnRef.current?.focus();
  };

  const onMenuKey = (e: React.KeyboardEvent) => {
    const buttons = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); buttons[(i + 1) % buttons.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); buttons[(i - 1 + buttons.length) % buttons.length]?.focus(); }
    else if (e.key === "Home") { e.preventDefault(); buttons[0]?.focus(); }
    else if (e.key === "End") { e.preventDefault(); buttons[buttons.length - 1]?.focus(); }
    else if (e.key === "Tab") { close(false); }
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`menu-trigger ${className} ${open ? "is-open" : ""}`}
        aria-label={text ? undefined : label}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title ?? (text ? undefined : label)}
        onClick={() => { openedByKey.current = false; if (!open) onOpen?.(); setOpen(o => !o); }}
        onKeyDown={e => {
          if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
            if (!open) { e.preventDefault(); openedByKey.current = true; onOpen?.(); setOpen(true); }
          }
        }}
      >
        {icon && <Icon name={icon} />}
        {text}
      </button>
      {open && pos && createPortal(
        <div
          ref={menuRef}
          className="menu"
          role="menu"
          aria-label={label}
          style={{ top: pos.top < 0 ? -9999 : pos.top, left: pos.left, maxHeight: Math.max(160, pos.maxH) }}
          onKeyDown={onMenuKey}
        >
          {items.map((item, i) => {
            if ("separator" in item) return <div key={i} className="menu-sep" role="separator" />;
            if ("heading" in item) return <div key={i} className="menu-heading">{item.heading}</div>;
            return (
              <button
                key={i}
                type="button"
                role={item.checked !== undefined ? "menuitemradio" : "menuitem"}
                aria-checked={item.checked}
                className={`menu-item ${item.danger ? "is-danger" : ""}`}
                disabled={item.disabled}
                onClick={() => { close(); item.onSelect(); }}
              >
                <span className="menu-item-icon">
                  {item.checked ? <Icon name="check" /> : item.icon ? <Icon name={item.icon} /> : null}
                </span>
                <span className="menu-item-text">
                  <span className="menu-item-label">{item.label}</span>
                  {item.hint && <span className="menu-item-hint">{item.hint}</span>}
                </span>
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}

/** Confirmation dialog for irreversible actions. */
export function ConfirmDialog({
  title, body, confirmLabel, onConfirm, onCancel,
}: {
  title: string; body: ReactNode; confirmLabel: string; onConfirm: () => void; onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { confirmRef.current?.focus(); }, []);
  return createPortal(
    <div className="overlay" onMouseDown={onCancel}>
      <div className="dialog dialog-confirm" role="alertdialog" aria-modal="true" aria-label={title}
        onMouseDown={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === "Escape") onCancel(); }}>
        <h2 className="dialog-title">{title}</h2>
        <div className="dialog-text">{body}</div>
        <div className="dialog-actions">
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button ref={confirmRef} className="btn btn-danger" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
