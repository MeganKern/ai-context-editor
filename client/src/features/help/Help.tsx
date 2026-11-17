import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { create } from "zustand";
import { BEHAVIOUR as B, type Said } from "../../../../shared/behaviour.js";
import { usePrefs, setPref } from "../../session/prefs.js";
import { SCREEN, type ScreenEntry } from "../../help/entries.js";

/**
 * Alt-click (⌥-click) help. Holding Alt turns the cursor into the help cursor and outlines what
 * you'd get help on; clicking then explains that control instead of doing it. An Alt-click never
 * does the thing, even where there's no card for it, so nothing happens by accident. The ? button
 * in the bottom-left corner says how, searches every explanation, and has a "next click explains"
 * mode for touch screens.
 *
 * One mechanism: an element names what it is with data-help=<key> — the action it runs (its card is
 * what shared/behaviour.ts says that action does, so the help can't drift from the tooltips) or a
 * thing on the screen (help/entries.ts). A region names itself with data-help-area, shown only when
 * the click wasn't on a control of its own. The help knows no class names and no on-screen copy.
 */

interface Card { n: number; title: string; text: string; x: number; y: number }
interface HelpState {
  card: Card | null;
  armed: boolean;      // Alt is held
  once: boolean;       // the next click explains (from the ? panel)
  panel: boolean;
  outline: DOMRect | null;
}
const useHelp = create<HelpState>(() => ({ card: null, armed: false, once: false, panel: false, outline: null }));
const set = (patch: Partial<HelpState>) => useHelp.setState(patch);
let seq = 0;   // each card gets its own number, so a new card starts fresh instead of sliding from the last
const newCard = (title: string, text: string, x: number, y: number): Card => ({ n: ++seq, title, text, x, y });

const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const KEY = MAC ? "⌥ Option" : "Alt";

// ── Finding the explanation for what was clicked ────────────────────────────────────────────

const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
/** What a control is called on screen, for the title of an action's card. */
function controlName(el: Element): string {
  const name = norm(el.getAttribute("aria-label")) || norm(el.querySelector(".menu-item-label")?.textContent) || norm(el.textContent) || norm(el.getAttribute("title")) || norm(el.getAttribute("placeholder"));
  return !name ? "This control" : name.length > 48 ? `${name.slice(0, 47)}…` : name;
}
const CONTROL = "button, a[href], input, select, textarea, [role='button'], [role='menuitem'], [role='menuitemradio'], [role='tab'], [role='switch'], [role='checkbox'], [role='separator'][tabindex]";

/** The entry a key names: an action's own words (titled by the control), or a thing on the screen. */
function entryFor(key: string, el: Element): ScreenEntry | null {
  const said = (B as Record<string, Said | undefined>)[key];
  if (said) return { title: controlName(el), text: said.help };
  const screen = (SCREEN as Record<string, ScreenEntry | undefined>)[key];
  return screen ?? null;
}

/**
 * The entry for what was clicked: the nearest element naming its help, or the area it sits in. A
 * control with no entry of its own gets `entry: null` rather than a description of the area around it.
 */
function find(target: EventTarget | null): { entry: ScreenEntry | null; el: Element } | null {
  let control: Element | null = null;
  for (let el = target instanceof Element ? target : null; el && el !== document.body; el = el.parentElement) {
    const key = el.getAttribute("data-help");
    if (key) {
      const entry = entryFor(key, el);
      if (entry) return { entry, el };
    }
    const area = el.getAttribute("data-help-area");
    if (area) {
      const entry = entryFor(area, el);
      if (entry) return control ? { entry: null, el: control } : { entry, el };
    }
    if (!control && el.matches(CONTROL)) control = el;
  }
  return control ? { entry: null, el: control } : null;
}
function cardFor(target: EventTarget | null, x: number, y: number): Card {
  const found = find(target);
  if (found?.entry) return newCard(found.entry.title, found.entry.text, x, y);
  if (found) return newCard(controlName(found.el), "Nothing to add beyond what it says.", x, y);
  return newCard("Nothing to explain here", `${KEY}-click a button or another control.`, x, y);
}
const isOurs = (t: EventTarget | null) => t instanceof Element && !!t.closest(".help-ui");

/** Everything after the press that could make the app act. */
const REST = ["mousedown", "mouseup", "pointerup", "click", "dblclick", "auxclick", "contextmenu"] as const;
/** Of those, the ones that act: with Alt held they explain, even if the press began without Alt. */
const ACTS = new Set(["click", "dblclick", "auxclick", "contextmenu"]);

// ── Listening ───────────────────────────────────────────────────────────────────────────────

function useListeners() {
  useEffect(() => {
    // The rule: with Alt held (or after "Explain the next thing I click"), a click never reaches
    // the app — with any mouse button, on anything, whether or not there's a card for it. The
    // click is stopped first; only then is the card looked up.
    let swallow = false;
    let altUsed = false;
    let frame = 0;
    const stop = (e: Event) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };

    const explain = (e: MouseEvent) => {
      stop(e);
      swallow = true;
      if (e.altKey) altUsed = true;
      let x = e.clientX, y = e.clientY;
      if (e.type === "click" && e.detail === 0 && e.target instanceof Element) {
        const r = e.target.getBoundingClientRect();
        x = r.left + Math.min(r.width / 2, 40); y = r.bottom;
      }
      let card: Card;
      try { card = cardFor(e.target, x, y); }
      catch { card = newCard("Nothing to explain here", `${KEY}-click a button or another control.`, x, y); }
      set({ card, once: false, outline: null, panel: false });
    };
    const onPointerDown = (e: PointerEvent) => {
      swallow = false;
      if (isOurs(e.target)) return;
      const { once, card: open } = useHelp.getState();
      if (open) set({ card: null });
      if (e.altKey || once) explain(e);
    };
    const onRest = (e: MouseEvent) => {
      if (isOurs(e.target)) return;
      if (swallow) stop(e);
      else if (e.altKey && ACTS.has(e.type)) explain(e);
    };
    const onDragStart = (e: DragEvent) => { if (e.altKey || swallow) e.preventDefault(); };
    const onMove = (e: PointerEvent) => {
      const { armed, once } = useHelp.getState();
      if (!armed && !once) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const found = isOurs(e.target) ? null : find(e.target);
        set({ outline: found ? found.el.getBoundingClientRect() : null });
      });
    };
    const arm = (on: boolean) => {
      if (useHelp.getState().armed === on) return;
      set({ armed: on, ...(on ? {} : { outline: useHelp.getState().once ? useHelp.getState().outline : null }) });
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Alt") { if (!e.repeat) altUsed = false; arm(true); }
      if (e.key === "Escape") {
        const s = useHelp.getState();
        if (s.card || s.panel || s.once) set({ card: null, panel: false, once: false, outline: null });
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Alt" && altUsed) { e.preventDefault(); altUsed = false; }
      if (e.key === "Alt" || !e.altKey) arm(false);
    };
    const onBlur = () => { altUsed = false; arm(false); };

    const opts = { capture: true };
    window.addEventListener("pointerdown", onPointerDown, opts);
    for (const t of REST) window.addEventListener(t, onRest as EventListener, opts);
    window.addEventListener("dragstart", onDragStart, opts);
    window.addEventListener("pointermove", onMove, { capture: true, passive: true });
    window.addEventListener("keydown", onKeyDown, opts);
    window.addEventListener("keyup", onKeyUp, opts);
    window.addEventListener("blur", onBlur);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", onPointerDown, opts);
      for (const t of REST) window.removeEventListener(t, onRest as EventListener, opts);
      window.removeEventListener("dragstart", onDragStart, opts);
      window.removeEventListener("pointermove", onMove, { capture: true });
      window.removeEventListener("keydown", onKeyDown, opts);
      window.removeEventListener("keyup", onKeyUp, opts);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
}

// ── What's on screen ────────────────────────────────────────────────────────────────────────

export function HelpRoot() {
  useListeners();
  const card = useHelp(s => s.card);
  const outline = useHelp(s => s.outline);
  const once = useHelp(s => s.once);
  const armed = useHelp(s => s.armed);
  const panel = useHelp(s => s.panel);
  // The help cursor follows the one fact: a click would explain rather than act.
  useEffect(() => { document.body.classList.toggle("help-armed", armed || once); }, [armed, once]);
  return (
    <>
      {outline && <div className="help-ui help-outline" style={{ top: outline.top - 3, left: outline.left - 3, width: outline.width + 6, height: outline.height + 6 }} />}
      {card && <HelpCard key={card.n} card={card} />}
      {once && <div className="help-ui help-once">Click anything to explain it · Esc to cancel</div>}
      {panel && <HelpPanel />}
      <HelpButton />
    </>
  );
}

const MARGIN = 12;

/** The card, beside the click, kept inside the window: placed once, as soon as it has a size. */
function HelpCard({ card }: { card: Card }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    const left = card.x + 14 + w + MARGIN > window.innerWidth ? Math.max(MARGIN, card.x - 14 - w) : card.x + 14;
    const top = card.y + 14 + h + MARGIN > window.innerHeight ? Math.max(MARGIN, window.innerHeight - h - MARGIN) : card.y + 14;
    setPos({ left, top });
  }, [card]);
  return (
    <div ref={ref} className={`help-ui help-card ${pos ? "is-ready" : ""}`} role="dialog" aria-label={card.title} style={{ left: pos?.left ?? card.x + 14, top: pos?.top ?? card.y + 14 }}>
      <div className="help-card-head">
        <span className="help-card-title">{card.title}</span>
        <button className="help-x" onClick={() => set({ card: null })} aria-label="Close">×</button>
      </div>
      <p className="help-text">{card.text}</p>
    </div>
  );
}

function HelpButton() {
  const panel = useHelp(s => s.panel);
  const hinted = usePrefs(s => s.helpHinted);
  const [hint, setHint] = useState(!hinted);
  const dismiss = () => { setHint(false); setPref("helpHinted", true); };
  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(dismiss, 14000);
    return () => clearTimeout(t);
  }, [hint]);
  return (
    <>
      {hint && !panel && (
        <div className="help-ui help-hint" role="status">
          <span>Hold <kbd>{KEY}</kbd> and click anything to see what it does behind the scenes.</span>
          <button className="help-btn" onClick={dismiss}>Got it</button>
        </div>
      )}
      <button className="help-ui help-q" onClick={() => { dismiss(); set({ panel: !panel, card: null }); }}
        aria-label="Help" title={`Help: hold ${KEY} and click anything`}>?</button>
    </>
  );
}

/** Everything the help can say, searchable: what each action does, and what each mark or area is. */
const SEARCHABLE: { id: string; title: string; text: string }[] = [
  ...Object.entries(B).map(([key, said]) => ({ id: key, title: said.name, text: said.help })),
  ...Object.entries(SCREEN).map(([key, e]) => ({ id: key, title: e.title, text: e.text })),
];

function HelpPanel() {
  const [q, setQ] = useState("");
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = words.length
    ? SEARCHABLE.map(e => {
        const title = e.title.toLowerCase(), body = e.text.toLowerCase();
        if (!words.every(w => title.includes(w) || body.includes(w))) return null;
        return { e, score: words.reduce((n, w) => n + (title.includes(w) ? 10 : 1), 0) };
      }).filter(x => x !== null).sort((a, b) => b.score - a.score).slice(0, 30)
    : [];
  const show = (entry: { title: string; text: string }, ev: { clientX: number; clientY: number }) => set({ card: newCard(entry.title, entry.text, ev.clientX + 40, ev.clientY - 40) });
  return (
    <div className="help-ui help-panel" role="dialog" aria-label="Help">
      <p className="help-panel-lede">Hold <kbd>{KEY}</kbd> and click any button or control. Instead of doing it, the app tells you what it does behind the scenes: what it changes, what it keeps safe, and whether it can be undone.</p>
      <button className="help-btn is-primary" onClick={() => set({ once: true, panel: false })}>
        Explain the next thing I click
      </button>
      <input className="help-search" placeholder="Search the help" value={q} onChange={e => setQ(e.target.value)} aria-label="Search the help" autoFocus />
      {words.length > 0 && (
        <div className="help-results">
          {hits.length === 0 && <p className="help-none">Nothing matches “{q}”.</p>}
          {hits.map(({ e }) => (
            <button key={e.id} className="help-result" onClick={ev => show(e, ev)}>
              <span className="help-result-title">{e.title}</span>
              <span className="help-result-text">{e.text}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
