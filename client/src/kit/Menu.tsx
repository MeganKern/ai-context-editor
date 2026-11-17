import { useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon.js";
import { Layer } from "./Layer.js";
import type { HelpKey } from "../help/entries.js";

export type MenuItem =
  | {
      label: string; onSelect: () => void;
      icon?: IconName; danger?: boolean; disabled?: boolean; hint?: string; checked?: boolean;
      /** What the help layer explains for it: the action it runs, or what it opens. */
      help?: HelpKey;
      /** A second, smaller control at the row's end — "about this", say. */
      trailing?: { icon: IconName; label: string; onClick: () => void; help?: HelpKey };
    }
  | { heading: string }
  | { separator: true };

/**
 * A menu for rare or destructive actions. The trigger always shows a visible label or an icon
 * with an accessible name; the menu itself floats in a layer, so scroll containers never clip it.
 * Focus goes back to the trigger when it closes (the layer does that).
 */
export function Menu({
  items, label, icon = "more", text, className = "", align = "end", title, onOpen, matchWidth = false, help = "menu.trigger",
}: {
  items: MenuItem[];
  label: string;
  icon?: IconName | null;
  text?: ReactNode;
  className?: string;
  align?: "start" | "end";
  title?: string;
  /** Bring what the items depend on up to date. */
  onOpen?: () => void;
  matchWidth?: boolean;
  help?: HelpKey;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const openedByKey = useRef(false);
  const close = () => setOpen(false);

  const onMenuKey = (e: React.KeyboardEvent) => {
    const buttons = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>(".menu-item:not(:disabled)") ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") { e.preventDefault(); buttons[(i + 1) % buttons.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); buttons[(i - 1 + buttons.length) % buttons.length]?.focus(); }
    else if (e.key === "Home") { e.preventDefault(); buttons[0]?.focus(); }
    else if (e.key === "End") { e.preventDefault(); buttons[buttons.length - 1]?.focus(); }
    else if (e.key === "Tab") close();
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
        data-help={help}
        onClick={() => { openedByKey.current = false; if (!open) onOpen?.(); setOpen(o => !o); }}
        onKeyDown={e => {
          if ((e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") && !open) {
            e.preventDefault(); openedByKey.current = true; onOpen?.(); setOpen(true);
          }
        }}
      >
        {icon && <Icon name={icon} />}
        {text}
      </button>
      {open && (
        <Layer anchor={btnRef.current} placement={align === "end" ? "below-end" : "below-start"} matchWidth={matchWidth}
          role="menu" label={label} className="menu" onClose={close} focus={openedByKey.current ? "auto" : "none"}>
          <div ref={menuRef} onKeyDown={onMenuKey}>
            {items.map((item, i) => {
              if ("separator" in item) return <div key={i} className="menu-sep" role="separator" />;
              if ("heading" in item) return <div key={i} className="menu-heading">{item.heading}</div>;
              return (
                <div key={i} className="menu-row">
                  <button
                    type="button"
                    role={item.checked !== undefined ? "menuitemradio" : "menuitem"}
                    aria-checked={item.checked}
                    className={`menu-item ${item.danger ? "is-danger" : ""}`}
                    disabled={item.disabled}
                    data-help={item.help}
                    data-autofocus={i === items.findIndex(x => !("separator" in x) && !("heading" in x)) || undefined}
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
                  {item.trailing && (
                    <button type="button" className="menu-item-trailing" aria-label={item.trailing.label} title={item.trailing.label} data-help={item.trailing.help}
                      onClick={() => { close(); item.trailing!.onClick(); }}>
                      <Icon name={item.trailing.icon} size={14} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </Layer>
      )}
    </>
  );
}
