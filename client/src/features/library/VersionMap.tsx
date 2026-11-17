import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { NoteRow } from "../../../../shared/snapshot.js";
import { run, useModel } from "../../data/model.js";
import { activity } from "../../session/activity.js";
import { rows, useFlash } from "../../session/rows.js";
import { NODE_H, NODE_W, subtreeOf, versionTree, type VersionNode } from "../../derive/versions.js";
import { formatK, plural } from "../../derive/text.js";
import { Icon } from "../../kit/Icon.js";
import { Button } from "../../kit/Button.js";
import { Dialog } from "../../kit/Dialog.js";
import { Layer } from "../../kit/Layer.js";
import { Picker } from "../../kit/Picker.js";

/**
 * An item's versions, drawn as the tree they are. The current version is at the top; every past
 * version hangs under the one that replaced it. Click a version to act on it (the actions sit in
 * one place, under the tree); drag one onto another to change what it was followed by; the + on a
 * version adds an older one under it. The tree always fits the frame.
 */
const MIN_SCALE = 0.5;
const DRAG_START = 5;
/** The handle on a card's bottom edge straddles it by this much; lines from older versions end there. */
const HANDLE_R = 8;

/** A press on a card: a click until it moves, then a drag. `noDrop` is the card and all under it. */
interface Drag { id: string; x: number; y: number; dx: number; dy: number; live: boolean; over: string | null; canDrag: boolean; noDrop: Set<string> }

export function VersionMap({ noteId }: { noteId: string }) {
  const notes = useModel(s => s.ws?.notes ?? []);
  const tree = versionTree(notes, noteId);
  const origin = notes.find(n => n.id === noteId);
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ id: string; el: HTMLElement } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [scale, setScale] = useState(1);
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const close = () => activity.close();
  // The version it was opened from lights for a moment, like any row you're taken to.
  const flashing = useFlash(noteId);
  useEffect(() => { rows.flash(noteId); }, [noteId]);

  // The frame grows with the tree up to its CSS max-height; past that the tree shrinks (only so
  // far), then scrolls. Refits when the frame, the window or the tree changes.
  useLayoutEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const fit = () => {
      const vw = el.clientWidth - 2, vh = parseFloat(getComputedStyle(el).maxHeight) - 2;
      if (vw <= 0 || !(vh > 0) || !tree.width) return;
      setScale(Math.max(MIN_SCALE, Math.min(1, vw / tree.width, vh / tree.height)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    window.addEventListener("resize", fit);
    return () => { ro.disconnect(); window.removeEventListener("resize", fit); };
  }, [tree.width, tree.height]);

  if (!origin) return null;
  const sel = selected ? tree.byId.get(selected) ?? null : null;
  const act = async (fn: () => Promise<unknown>) => { if (busy) return; setBusy(true); try { await fn(); } finally { setBusy(false); } };
  const candidates = notes.filter(n => !n.tree_id && n.id !== noteId);

  // Every card is pressed the same way: release without moving selects it; moving drags it onto
  // another card to change what it was followed by. The current card is the top, so it won't drag.
  const onPointerDown = (n: VersionNode, e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || busy) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ id: n.note.id, x: e.clientX, y: e.clientY, dx: 0, dy: 0, live: false, over: null, canDrag: n.note.id !== tree.current, noDrop: subtreeOf(tree, n.note.id) });
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag || !drag.canDrag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    const live = drag.live || Math.hypot(dx, dy) > DRAG_START;
    const under = live ? document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-version]")?.dataset.version ?? null : null;
    const over = under && !drag.noDrop.has(under) ? under : null;
    setDrag({ ...drag, dx, dy, live, over });
  };
  const onPointerUp = () => {
    if (!drag) return;
    const { id, live, over } = drag;
    setDrag(null);
    if (!live) { setSelected(s => (s === id ? null : id)); return; }
    if (over) void act(() => run("version_set_newer", { note_id: id, newer_id: over }));
  };

  const edge = (n: VersionNode) => {
    const p = n.parent ? tree.byId.get(n.parent) : null;
    if (!p) return null;
    // From the child's top edge into the handle on the parent's bottom edge.
    const x1 = n.x, y1 = n.y - NODE_H / 2, x2 = p.x, y2 = p.y + NODE_H / 2 + HANDLE_R;
    const bend = (y1 - y2) / 2;
    return <path key={n.note.id} className="vm-edge" d={`M ${x1} ${y1} C ${x1} ${y1 - bend} ${x2} ${y2 + bend} ${x2} ${y2}`} markerEnd="url(#vm-arrow)" />;
  };

  const meta = (n: NoteRow) => (n.used_in ? `${plural(n.used_in, "thread")} · ` : "") + `${formatK(n.tokens)} tokens`;

  return (
    <Dialog className="version-map-dialog" title={`Versions of ${origin.name}`} help="ver.dialog"
      sub={tree.current ? "The current version is the one threads use." : "No current version: make one current to use it in threads."} onClose={close}
      foot={
        <div className="vm-foot">
          {sel ? (
            <>
              <span className="vm-foot-name" title={sel.note.name}>{sel.note.name}</span>
              <span className="spacer" />
              {sel.note.id !== tree.current && (
                <Button size="sm" help="version_set_current" disabled={busy} onClick={() => void act(() => run("version_set_current", { note_id: sel.note.id }))}>Make current</Button>
              )}
              <Button size="sm" kind="ghost" help="version_detach" disabled={busy || !sel.note.tree_id}
                onClick={() => void act(async () => { await run("version_detach", { note_id: sel.note.id }); setSelected(null); })}>Take out of the tree</Button>
              <Button size="sm" kind="ghost" icon="external" help="menu.full-editor" onClick={() => activity.open({ kind: "note-editor", noteId: sel.note.id })}>Open in editor</Button>
            </>
          ) : (
            <span className="vm-foot-hint">Click a version for its actions · drag one onto another to change what it was followed by · + adds an older version under it</span>
          )}
        </div>
      }>
      <div ref={canvasRef} className={`vm-canvas ${drag?.live ? "is-dragging" : ""}`}>
        <div className="vm-frame" style={{ width: tree.width * scale, height: tree.height * scale }}>
          <div className="vm-stage" style={{ width: tree.width, height: tree.height, transform: `scale(${scale})` }}>
            <svg className="vm-edges" width={tree.width} height={tree.height} aria-hidden>
              <defs>
                <marker id="vm-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                  <path d="M 2 1 L 8 5 L 2 9" fill="none" stroke="rgba(255,255,255,.55)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </marker>
              </defs>
              {tree.nodes.map(edge)}
            </svg>
            {tree.nodes.map(n => {
              const id = n.note.id;
              const isCurrent = id === tree.current;
              const dragging = drag?.live && drag.id === id;
              const cls = ["vm-node", isCurrent ? "is-current" : "", selected === id ? "is-selected" : "", flashing && id === noteId ? "is-flash" : "",
                dragging ? "is-dragging" : "", drag?.live && drag.noDrop.has(id) && !dragging ? "is-not-target" : "", drag?.over === id ? "is-target" : ""].join(" ");
              return (
                <div key={id} className={cls} data-version={id} data-help="vm.node" role="button" tabIndex={0} aria-pressed={selected === id}
                  aria-label={`${n.note.name}${isCurrent ? ", current version" : ""}`}
                  style={{ left: n.x - NODE_W / 2, top: n.y - NODE_H / 2, width: NODE_W, height: NODE_H, transform: dragging ? `translate(${drag.dx / scale}px, ${drag.dy / scale}px)` : undefined }}
                  onPointerDown={e => onPointerDown(n, e)} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => setDrag(null)}
                  onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(s => (s === id ? null : id)); } }}>
                  <div className="vm-node-name"><span>{n.note.name}</span>{isCurrent && <span className="vm-node-current">current</span>}</div>
                  <div className="vm-node-meta">{meta(n.note)}</div>
                  <button type="button" className={`vm-node-add ${adding?.id === id ? "is-open" : ""}`} aria-label={`Add an older version under ${n.note.name}`}
                    title="Add an older version under this one" data-help="version_add_older"
                    onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); setAdding({ id, el: e.currentTarget }); }}>
                    <Icon name="plus" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {adding && (
        <Layer anchor={adding.el} placement="below-start" width={300} role="listbox" label="Add an older version" className="vm-add" helpArea="vm.add" onClose={() => setAdding(null)}>
          <Picker className="picker-compact" label="Library items" items={candidates} keyOf={n => n.id} search
            matches={(n, q) => n.name.toLowerCase().includes(q)} placeholder="Which item was this a newer version of?"
            render={n => <><Icon name="note" /><span className="picker-item-name">{n.name}</span></>}
            onPick={n => { const under = adding.id; setAdding(null); void act(() => run("version_add_older", { note_id: n.id, newer_id: under })); }}
            empty={q => (q ? "No items match" : "Every other item already has versions")} />
        </Layer>
      )}
    </Dialog>
  );
}
