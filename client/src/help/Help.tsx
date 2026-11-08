import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { ENTRIES, type Entry } from "./entries.js";
import "./help.css";

/**
 * Alt-click (⌥-click) help. Holding Alt turns the cursor into the help cursor and outlines what
 * you'd get help on; clicking then explains that control instead of doing it. An Alt-click never
 * does the thing, even where there's no card for it, so nothing happens by accident. The ? button in the
 * bottom-left corner says how, searches every explanation, and has a "next click explains" mode
 * for touch screens. What it says lives in entries.ts, which takes what each action does from
 * shared/behaviour.ts (where the controls' tooltips come from too); the components know nothing of it.
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

const HINT_KEY = "desk.help.hinted";
const markHinted = () => { try { localStorage.setItem(HINT_KEY, "1"); } catch { /* private mode */ } };
const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const KEY = MAC ? "⌥ Option" : "Alt";

// ── Finding the explanation for what was clicked ────────────────────────────────────────────

const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
function labels(el: Element): string[] {
  const own = el.querySelector(".menu-item-label");
  return [norm(el.getAttribute("aria-label")), norm(own?.textContent), norm(el.textContent)].filter(Boolean);
}
function entryFor(el: Element): Entry | null {
  for (const entry of ENTRIES) {
    for (const m of entry.match) {
      let hit = false;
      try { hit = el.matches(m.css); } catch { hit = false; }
      if (hit && (!m.label || labels(el).some(l => m.label!.test(l)))) return entry;
    }
  }
  return null;
}
const CONTROL = "button, a[href], input, select, textarea, [role='button'], [role='menuitem'], [role='menuitemradio'], [role='tab'], [role='switch'], [role='checkbox'], [role='separator'][tabindex]";
/** The entry for what was clicked: its own, or a part of the screen it sits in. A control with
 *  no entry of its own gets `entry: null` rather than a description of the whole area around it. */
function find(target: EventTarget | null): { entry: Entry | null; el: Element } | null {
  let control: Element | null = null;
  for (let el = target instanceof Element ? target : null; el && el !== document.body; el = el.parentElement) {
    const entry = entryFor(el);
    if (entry) return entry.area && control ? { entry: null, el: control } : { entry, el };
    if (!control && el.matches(CONTROL)) control = el;
  }
  return control ? { entry: null, el: control } : null;
}
function controlName(el: Element): string {
  const name = norm(el.getAttribute("aria-label")) || norm(el.textContent) || norm(el.getAttribute("title")) || norm(el.getAttribute("placeholder"));
  return !name ? "This control" : name.length > 48 ? `${name.slice(0, 47)}…` : name;
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
    //
    // `swallow` keeps the rest of such a press (mouseup, click, double-click, context menu) from
    // the app too, until the next press. A drag that started without Alt still ends normally if
    // Alt is pressed on the way, but its click, with Alt held, explains instead of acting.
    let swallow = false;
    // Alt was held for help; its release is cancelled so the browser doesn't treat it as a lone Alt
    // tap (which shows Firefox's menu bar on Windows and Linux).
    let altUsed = false;
    let frame = 0;
    const stop = (e: Event) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };

    const explain = (e: MouseEvent) => {
      stop(e);
      swallow = true;
      if (e.altKey) altUsed = true;
      let x = e.clientX, y = e.clientY;
      if (e.type === "click" && e.detail === 0 && e.target instanceof Element) {
        // A click from the keyboard has no pointer position: put the card by the control.
        const r = e.target.getBoundingClientRect();
        x = r.left + Math.min(r.width / 2, 40); y = r.bottom;
      }
      let card: Card;
      try { card = cardFor(e.target, x, y); }
      catch { card = newCard("Nothing to explain here", `${KEY}-click a button or another control.`, x, y); }
      set({ card, once: false, outline: null, panel: false });
      document.body.classList.toggle("help-armed", e.altKey);
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
      document.body.classList.toggle("help-armed", on || useHelp.getState().once);
      set({ armed: on, ...(on ? {} : { outline: useHelp.getState().once ? useHelp.getState().outline : null }) });
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Alt") { if (!e.repeat) altUsed = false; arm(true); }
      if (e.key === "Escape") {
        const s = useHelp.getState();
        if (s.card || s.panel || s.once) { set({ card: null, panel: false, once: false, outline: null }); document.body.classList.remove("help-armed"); }
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
  const panel = useHelp(s => s.panel);
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

function HelpCard({ card }: { card: Card }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: card.x + 14, top: card.y + 14, ready: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight, m = 12;
    const left = card.x + 14 + w + m > window.innerWidth ? Math.max(m, card.x - 14 - w) : card.x + 14;
    const top = card.y + 14 + h + m > window.innerHeight ? Math.max(m, window.innerHeight - h - m) : card.y + 14;
    const raf = requestAnimationFrame(() => setPos({ left, top, ready: true }));
    return () => cancelAnimationFrame(raf);
  }, [card]);
  return (
    <div ref={ref} className={`help-ui help-card ${pos.ready ? "is-ready" : ""}`} role="dialog" aria-label={card.title} style={{ left: pos.left, top: pos.top }}>
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
  const [hint, setHint] = useState(() => { try { return localStorage.getItem(HINT_KEY) !== "1"; } catch { return false; } });
  const dismiss = () => { setHint(false); markHinted(); };
  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => { setHint(false); markHinted(); }, 14000);
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

function HelpPanel() {
  const [q, setQ] = useState("");
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = words.length
    ? ENTRIES.map(e => {
        const title = e.title.toLowerCase(), body = e.text.toLowerCase();
        if (!words.every(w => title.includes(w) || body.includes(w))) return null;
        return { e, score: words.reduce((n, w) => n + (title.includes(w) ? 10 : 1), 0) };
      }).filter(x => x !== null).sort((a, b) => b.score - a.score).slice(0, 30)
    : [];
  const show = (entry: Entry, ev: { clientX: number; clientY: number }) => set({ card: newCard(entry.title, entry.text, ev.clientX + 40, ev.clientY - 40) });
  return (
    <div className="help-ui help-panel" role="dialog" aria-label="Help">
      <p className="help-panel-lede">Hold <kbd>{KEY}</kbd> and click any button or control. Instead of doing it, the app tells you what it does behind the scenes: what it changes, what it keeps safe, and whether it can be undone.</p>
      <button className="help-btn is-primary" onClick={() => { set({ once: true, panel: false }); document.body.classList.add("help-armed"); }}>
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
