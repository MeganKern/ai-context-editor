import { useRef, useState } from "react";
import { useStore } from "../../store.js";
import type { ThreadSnapshot } from "../../../../shared/snapshot.js";
import { endDrag, startDrag } from "../../drag.js";
import * as ops from "../../context-ops.js";
import { clip } from "../../format.js";
import { Icon } from "../Icon.js";
import { Menu, type MenuItem } from "../Menu.js";
import { GrowingText, SectionHead } from "./inputs.js";
import { flash, moved, moveKeys, useDropList, useFlash, usePendingOrder, useSwitch } from "./panel-state.js";
import { BEHAVIOUR as B } from "../../../../shared/behaviour.js";

type Pin = ThreadSnapshot["directives"][number];

/**
 * Pinned items ("directives" in the API) belong to one thread — or one template, whose runs each
 * start with a copy. Made with Pin on a message, or written here. They're sent at the top of
 * every reply, in this order.
 */
export function PinnedSection({ thread }: { thread: ThreadSnapshot }) {
  const run = useStore(s => s.run);
  const [adding, setAdding] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const isTemplate = thread.thread.kind === "template";
  const tid = thread.thread.id;
  const [order, setOrder] = usePendingOrder(thread.directives.map(d => d.id));
  const byId = new Map(thread.directives.map(d => [d.id, d]));
  const pins = order.map(id => byId.get(id)).filter((d): d is Pin => !!d);

  const reorder = (next: string[]) => {
    if (next.join() === order.join()) return;
    setOrder(next);
    void ops.reorderPins(tid, next);
  };
  const drop = useDropList(item => item.kind === "pin", pins.length, (item, at) => reorder(moved(order, item.id, at)));

  const busy = useRef(false);
  const add = async () => {
    const text = adding?.trim();
    if (!text || busy.current) return;
    busy.current = true;
    try {
      const r = await run("pin_directive", { thread_id: tid, text });
      if (r) { setAdding(null); flash(r.directive_id); }
    } finally { busy.current = false; }
  };

  return (
    <section className="ctxp-section" aria-label="Pinned">
      <SectionHead title="Pinned" sub={isTemplate ? "copied into every run" : "this thread only"}>
        {pins.length > 1 && (
          <Menu label="All pinned items" className="act act-more" icon="more" items={[
            { label: "Include all", icon: "eye", disabled: pins.every(p => !p.excluded), onSelect: () => void ops.setAll(thread, "pins", false) },
            { label: "Exclude all", icon: "eyeOff", disabled: pins.every(p => p.excluded), onSelect: () => void ops.setAll(thread, "pins", true) },
          ]} />
        )}
        {adding === null && (
          <button className="act ctxp-add" onClick={() => setAdding("")} title={`Write something to keep in front of the model in this ${isTemplate ? "template" : "thread"}`}>
            <Icon name="plus" /> Pin
          </button>
        )}
      </SectionHead>
      {pins.length === 0 && adding === null && (
        <p className="ctxp-empty">
          {isTemplate ? "Nothing pinned. What's pinned here is copied into every run." : "Pin facts from a message, or write one here."}
        </p>
      )}
      <ul className="ctxp-list" {...drop.zone}>
        {pins.map((d, i) => (
          <PinRow key={d.id} thread={thread} pin={d} first={i === 0} last={i === pins.length - 1}
            editing={editing === d.id} setEditing={on => setEditing(on ? d.id : null)}
            dropLine={drop.at === i ? "before" : i === pins.length - 1 && drop.at === pins.length ? "after" : null}
            dragOver={drop.row(i)}
            move={pins.length > 1 ? delta => { const j = i + delta; if (j >= 0 && j < pins.length) reorder(moved(order, d.id, delta > 0 ? j + 1 : j)); } : null} />
        ))}
      </ul>
      {adding !== null && (
        <div className="ctxp-pin-form">
          <GrowingText value={adding} onChange={setAdding} onSave={() => void add()} onCancel={() => setAdding(null)}
            label="Text to pin" placeholder="A decision or fact to keep in front of the model" />
          <div className="ctxp-form-actions">
            <button className="btn btn-primary btn-xs" onMouseDown={e => e.preventDefault()} onClick={() => void add()} disabled={!adding.trim()}>Pin</button>
            <button className="btn btn-ghost btn-xs" onClick={() => setAdding(null)}>Cancel</button>
            <span className="ctxp-form-keys">⏎ pins · Shift ⏎ new line</span>
          </div>
        </div>
      )}
    </section>
  );
}

function PinRow({ thread, pin, first, last, editing, setEditing, dropLine, dragOver, move }: {
  thread: ThreadSnapshot; pin: Pin; first: boolean; last: boolean; editing: boolean; setEditing: (on: boolean) => void;
  dropLine: "before" | "after" | null; dragOver: { onDragOver: (e: React.DragEvent<HTMLElement>) => void };
  move: ((delta: -1 | 1) => void) | null;
}) {
  const run = useStore(s => s.run);
  const [text, setText] = useState(pin.text);
  const flashing = useFlash(pin.id);
  const startEdit = () => { setText(pin.text); setEditing(true); };
  const save = async () => {
    const v = text.trim();
    setEditing(false);
    if (v && v !== pin.text) await run("update_directive", { directive_id: pin.id, text: v });
  };
  const [sent, toggle] = useSwitch(!pin.excluded, on => run("set_excluded", { target: "directive", directive_id: pin.id, excluded: !on }));

  const items: MenuItem[] = [
    { label: "Edit", icon: "edit", hint: B.update_directive.tip, onSelect: startEdit },
    ...(move ? [
      { label: "Move up", icon: "arrowUp" as const, hint: "Alt ↑ · or drag it", disabled: first, onSelect: () => move(-1) },
      { label: "Move down", icon: "arrowDown" as const, hint: "Alt ↓", disabled: last, onSelect: () => move(1) },
    ] : []),
    { label: "Move to the library", icon: "note", hint: B.convert_directive_to_note.tip, onSelect: () => void ops.pinToLibrary(thread, pin, { keep: true }) },
    { separator: true },
    { label: "Unpin", icon: "trash", danger: true, hint: B.unpin_directive.tip, onSelect: () => void ops.unpin(pin) },
  ];

  return (
    <li className={["ctxp-row", "ctxp-pin", sent ? "" : "is-notsent", !editing ? "is-draggable" : "",
      dropLine ? `is-drop-${dropLine}` : "", flashing ? "is-flash" : "", editing ? "is-editing" : ""].join(" ")}
      {...dragOver}
      onKeyDown={moveKeys(!!move, d => move?.(d))}>
      <div className="ctxp-row-line" draggable={!editing}
        onDragStart={e => startDrag(e, { kind: "pin", id: pin.id, label: clip(pin.text, 60) })}
        onDragEnd={endDrag}>
        <label className="check" title={sent ? "Sent with every reply — untick to stop sending it" : "Not sent — tick to send it with every reply"}>
          <input type="checkbox" checked={sent} onChange={toggle}
            aria-label={`Send “${clip(pin.text, 40)}” with every reply`} />
        </label>
        {editing ? (
          <GrowingText value={text} onChange={setText} onSave={() => void save()} onCancel={() => setEditing(false)}
            label="Pinned text" saveOnBlur className="is-pin" />
        ) : (
          <button className="ctxp-row-text ctxp-pin-text" onClick={startEdit} title="Click to edit · drag to reorder">
            {pin.text}
          </button>
        )}
        {!editing && (
          <span className="ctxp-row-actions">
            <Menu label="Pinned item actions" className="act act-more" icon="more" items={items} />
          </span>
        )}
      </div>
    </li>
  );
}
