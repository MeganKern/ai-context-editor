import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { HelpKey } from "../help/entries.js";

/**
 * Anything that floats over the page: a menu by its button, a picker by its field, a dialog in
 * the middle. The one place a portal is made. Open layers form a stack: Escape and a press
 * outside close the innermost first; focus goes in on open and back to where it was — the anchor,
 * or whatever had it — on close. A press the help layer has swallowed (it explains instead of
 * acting) never reaches here.
 */
export type Placement = "below-start" | "below-end" | "above-start";

interface LayerProps {
  /** What it hangs from. Centered over a backdrop when `center`. Nothing shows until the anchor exists. */
  anchor?: HTMLElement | null;
  center?: boolean;
  placement?: Placement;
  matchWidth?: boolean;
  width?: number;
  role: "menu" | "dialog" | "alertdialog" | "listbox";
  label: string;
  className?: string;
  style?: CSSProperties;
  onClose: () => void;
  /** Where focus goes on open: the first control marked autofocus, else the layer itself. */
  focus?: "auto" | "none";
  /** What the help layer says of the whole, when the click inside wasn't on a control of its own. */
  helpArea?: HelpKey;
  children: ReactNode;
}

interface Entry { el: HTMLElement | null; anchor: HTMLElement | null; close: () => void; outside: boolean }
const stack: Entry[] = [];

let listening = false;
function listen(): void {
  if (listening || typeof document === "undefined") return;
  listening = true;
  document.addEventListener("keydown", (e) => {
    // A control inside that handled Escape itself (a search box clearing) prevents default first.
    if (e.key !== "Escape" || e.defaultPrevented || !stack.length) return;
    e.preventDefault();
    stack[stack.length - 1].close();
  });
  document.addEventListener("pointerdown", (e) => {
    if (e.defaultPrevented) return;
    const target = e.target as Node;
    for (let i = stack.length - 1; i >= 0; i--) {
      const entry = stack[i];
      if (!entry.outside) continue;
      if (entry.el?.contains(target) || entry.anchor?.contains(target)) return;
      entry.close();
    }
  }, true);
}

/**
 * A mode you're in that doesn't float (picking the cards for a summary): it takes its turn on the
 * stack so Escape leaves it like anything else, but pressing elsewhere is how it's used, so that
 * never closes it.
 */
export function useEscapeToClose(close: () => void): void {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    listen();
    const e: Entry = { el: null, anchor: null, outside: false, close: () => closeRef.current() };
    stack.push(e);
    return () => { const i = stack.indexOf(e); if (i >= 0) stack.splice(i, 1); };
  }, []);
}

const MENU_W = 248;
const MARGIN = 8;

export function Layer({ anchor, center = false, placement = "below-start", matchWidth = false, width, role, label, className = "", style, onClose, focus = "auto", helpArea, children }: LayerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxH: number; width?: number } | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const entry = useRef<Entry>({ el: null, anchor: null, outside: true, close: () => closeRef.current() });
  entry.current.anchor = anchor ?? null;

  // On the stack while open; focus returns to the anchor, or to where it was.
  useEffect(() => {
    listen();
    const e = entry.current;
    e.el = ref.current;
    stack.push(e);
    const before = document.activeElement as HTMLElement | null;
    if (focus === "auto") {
      const first = ref.current?.querySelector<HTMLElement>("[autofocus], [data-autofocus]");
      (first ?? ref.current)?.focus({ preventScroll: true });
    }
    return () => {
      const i = stack.indexOf(e);
      if (i >= 0) stack.splice(i, 1);
      // Back to where focus was — unless what the layer did has already put it somewhere (a field
      // opened to type in), which would be undone by taking it away again.
      const active = document.activeElement;
      const orphaned = !active || active === document.body || ref.current?.contains(active);
      const back = e.anchor && document.contains(e.anchor) ? e.anchor : before && document.contains(before) ? before : null;
      if (orphaned && back) back.focus({ preventScroll: true });
    };
  }, []);

  // Placed by its anchor: below it, or above when there's more room there (or it's asked for),
  // measured in the same pass so it's placed once.
  useLayoutEffect(() => {
    if (center || !anchor || !ref.current) return;
    const r = anchor.getBoundingClientRect();
    const w = matchWidth ? r.width : width ?? MENU_W;
    const below = window.innerHeight - r.bottom - MARGIN;
    const above = r.top - MARGIN;
    const flip = placement === "above-start" || (below < 220 && above > below);
    const left = placement === "below-end" ? Math.max(MARGIN, r.right - w) : Math.min(r.left, window.innerWidth - w - MARGIN);
    const h = Math.min(ref.current.offsetHeight, above);
    setPos({ top: flip ? Math.max(MARGIN, r.top - 4 - h) : r.bottom + 4, left, maxH: flip ? above : below, width: w });
  }, [anchor, center, placement, matchWidth, width]);

  if (center) {
    return createPortal(
      <div className="layer-backdrop">
        <div ref={ref} className={`layer layer-center ${className}`} role={role} aria-modal="true" aria-label={label} tabIndex={-1} style={style} data-help-area={helpArea}>
          {children}
        </div>
      </div>,
      document.body,
    );
  }
  if (!anchor) return null;
  return createPortal(
    <div
      ref={ref}
      className={`layer layer-anchored ${className}`}
      role={role}
      aria-label={label}
      tabIndex={-1}
      data-help-area={helpArea}
      style={{
        top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? undefined : "hidden",
        maxHeight: pos ? Math.max(160, pos.maxH) : undefined, width: pos?.width, ...style,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
