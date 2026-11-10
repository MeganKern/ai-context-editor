import { useState } from "react";
import { useStore } from "../../store.js";
import type { ThreadItem, ThreadSnapshot } from "../../../../shared/snapshot.js";
import { endDrag, startDrag, useDrag, type DragItem } from "../../drag.js";
import * as ops from "../../context-ops.js";
import { Icon } from "../Icon.js";
import { Menu, type MenuItem } from "../Menu.js";
import { NameInput, SectionHead } from "./inputs.js";
import { ItemDetail } from "./ItemDetail.js";
import { flash, moved, moveKeys, notSentBecause, setOpen, showMessage, useDropList, useFlash, usePanel, usePendingOrder, useSwitch } from "./panel-state.js";
import { BEHAVIOUR as B } from "../../../../shared/behaviour.js";

/**
 * What this thread uses from the library. Each item is in one place here: with every reply (in
 * order, each with its switch), or with one message (its switch says whether it goes with it).
 * Drop a library item, or one that goes with a message, here to send it with every reply; drop a
 * pinned item here to make it a library item that's still sent here.
 */
export function InThreadSection({ thread }: { thread: ThreadSnapshot }) {
  const setUi = useStore(s => s.setUi);
  const dragging = useDrag(s => s.item);
  const isTemplate = thread.thread.kind === "template";
  const where = isTemplate ? "template" : "thread";
  const tid = thread.thread.id;
  const everyReply = thread.items.filter(i => i.placement === "every_reply");
  const withMessage = thread.items.filter(i => i.placement === "with_message");
  const [order, setOrder] = usePendingOrder(everyReply.map(n => n.note_id));
  const byId = new Map(everyReply.map(n => [n.note_id, n]));
  const items = order.map(id => byId.get(id)).filter((n): n is ThreadItem => !!n);

  const reorder = (next: string[]) => {
    if (next.join() === order.join()) return;
    setOrder(next);
    void ops.reorderItems(tid, next);
  };
  const accepts = (item: DragItem) => item.kind === "thread-note" || item.kind === "pin" || item.kind === "library" || item.kind === "msg-note";
  const drop = useDropList(accepts, items.length, async (item, at) => {
    if (item.kind === "thread-note") { reorder(moved(order, item.id, at)); return; }
    if (item.kind === "pin") {
      const pin = thread.directives.find(d => d.id === item.id);
      const id = pin ? await ops.pinToLibrary(thread, pin, { keep: true, at }) : null;
      if (id) flash(id);
      return;
    }
    if (await ops.addItem(thread, item.id, at)) flash(item.id);
  });
  const incoming = dragging && accepts(dragging) && dragging.kind !== "thread-note";
  const hint = !incoming ? null
    : dragging!.kind === "pin" ? `Drop here to make it a library item, still sent in this ${where}`
    : dragging!.kind === "msg-note" ? "Drop here to send it with every reply instead of with its message"
    : "Drop here to send it with every reply";

  return (
    <section className={`ctxp-section ctxp-dropzone ${incoming ? "is-target" : ""} ${incoming && drop.at !== null ? "is-over" : ""}`}
      aria-label={isTemplate ? "From the library" : "In this thread"} {...drop.zone}>
      <SectionHead title={isTemplate ? "From the library" : "In this thread"} sub={isTemplate ? "shared with every run" : "from the library"}>
        {thread.items.length > 1 && (
          <Menu label={isTemplate ? "All items from the library" : "All items in this thread"} className="act act-more" icon="more" items={[
            { label: "Include all", icon: "eye", disabled: thread.items.every(n => !n.excluded), onSelect: () => void ops.setAll(thread, "items", false) },
            { label: "Exclude all", icon: "eyeOff", disabled: thread.items.every(n => n.excluded), onSelect: () => void ops.setAll(thread, "items", true) },
          ]} />
        )}
      </SectionHead>
      {thread.items.length === 0 && !incoming && (
        <p className="ctxp-empty">
          {isTemplate ? "Nothing from the library. What you add here is used by every run: the same item, not a copy."
            : "Add a library item from below, or drag one here."}
        </p>
      )}
      <ul className="ctxp-list">
        {items.map((n, i) => (
          <EveryReplyRow key={n.note_id} thread={thread} item={n} first={i === 0} last={i === items.length - 1}
            dropLine={drop.at === i ? "before" : i === items.length - 1 && drop.at === items.length ? "after" : null}
            dragOver={drop.row(i)}
            move={items.length > 1 ? delta => { const j = i + delta; if (j >= 0 && j < items.length) reorder(moved(order, n.note_id, delta > 0 ? j + 1 : j)); } : null} />
        ))}
        {withMessage.map(n => <WithMessageRow key={n.note_id} thread={thread} item={n} />)}
      </ul>
      {hint && <p className={`ctxp-drop-hint ${items.length === 0 ? "is-alone" : ""}`}>{hint}</p>}
      {isTemplate && (
        <button className="act ctxp-more-btn" onClick={() => setUi({ mode: { kind: "notePicker", target: "load" } })}>
          <Icon name="plus" /> Add from the library…
        </button>
      )}
    </section>
  );
}

/** What every item row here offers besides where it goes. */
function commonActions(item: ThreadItem, _open: boolean, setRenaming: (on: boolean) => void): MenuItem[] {
  const setUi = useStore.getState().setUi;
  return [
    { label: "Edit the text", icon: "edit", hint: B.update_note.tip, onSelect: () => { setOpen(item.note_id, true); usePanel.setState({ editing: item.note_id }); } },
    { label: "Full editor", icon: "external", hint: "More space, richer editing — same shared text", onSelect: () => setUi({ noteEditor: item.note_id }) },
    { separator: true },
    { label: "Rename", icon: "edit", hint: B["update_note:name"].tip, onSelect: () => setRenaming(true) },
  ];
}

function ownCopyAction(thread: ThreadSnapshot, item: ThreadItem, shared: boolean): MenuItem[] {
  if (!shared) return [];
  const where = thread.thread.kind === "template" ? "template" : "thread";
  return [{
    label: `Use a separate copy in this ${where}`, icon: "copy", hint: B.use_own_copy.tip,
    onSelect: async () => { const id = await ops.useOwnCopy(thread, item); if (id) { setOpen(id, true); flash(id); } },
  }];
}

const removeAction = (thread: ThreadSnapshot, item: ThreadItem): MenuItem => ({
  label: `Remove from this ${thread.thread.kind === "template" ? "template" : "thread"}`, icon: "close", hint: B.remove_item.tip,
  onSelect: () => void ops.removeFromThread(thread, item.note_id, item.name),
});

function CopyTag({ item }: { item: ThreadItem }) {
  if (!item.copied_from) return null;
  return <span className="ctxp-tag" title="A separate copy of a shared library item, made with the same name. Edits to it don't change the item it was copied from.">copy</span>;
}

function UnsavedTag({ id, open }: { id: string; open: boolean }) {
  const unsaved = usePanel(s => s.drafts[id] !== undefined);
  return unsaved && !open
    ? <span className="ctxp-tag is-unsaved" title="You started editing its text; open it to save or discard">unsaved edit</span>
    : null;
}

function NewerVersionTag({ noteId, thread }: { noteId: string; thread: ThreadSnapshot }) {
  const newer = useStore(s => s.ws?.notes.find(n => n.supersedes === noteId && !s.ws?.notes.some(x => x.supersedes === n.id)));
  const run = useStore(s => s.run);
  if (!newer) return null;
  const swap = async () => {
    await run("remove_item", { thread_id: thread.thread.id, note_id: noteId });
    await run("place_item", { thread_id: thread.thread.id, note_id: newer.id, place: { placement: "every_reply" } });
  };
  return (
    <button className="ctxp-tag is-update" title={`"${newer.name}" is a newer version — click to switch`} onClick={e => { e.stopPropagation(); void swap(); }}>
      ↑ update
    </button>
  );
}

function EveryReplyRow({ thread, item, first, last, dropLine, dragOver, move }: {
  thread: ThreadSnapshot; item: ThreadItem; first: boolean; last: boolean; dropLine: "before" | "after" | null;
  dragOver: { onDragOver: (e: React.DragEvent<HTMLElement>) => void }; move: ((delta: -1 | 1) => void) | null;
}) {
  const meta = useStore(s => s.ws?.notes.find(n => n.id === item.note_id));
  const open = usePanel(s => !!s.open[item.note_id]);
  const flashing = useFlash(item.note_id);
  const [renaming, setRenaming] = useState(false);
  const [sent, toggle] = useSwitch(!item.excluded, on => ops.setItemSwitch(thread, item.note_id, !on));

  const items: MenuItem[] = commonActions(item, open, setRenaming);
  if (move) items.push(
    { label: "Move up", icon: "arrowUp", hint: "Alt ↑ · or drag it", disabled: first, onSelect: () => move(-1) },
    { label: "Move down", icon: "arrowDown", hint: "Alt ↓", disabled: last, onSelect: () => move(1) },
  );
  items.push(...ownCopyAction(thread, item, (meta?.used_in ?? 1) > 1), { separator: true }, removeAction(thread, item));

  return (
    <li className={["ctxp-row", "ctxp-item", sent ? "" : "is-notsent", !renaming ? "is-draggable" : "",
      dropLine ? `is-drop-${dropLine}` : "", flashing ? "is-flash" : "", open ? "is-open" : ""].join(" ")}
      {...dragOver}
      onKeyDown={moveKeys(!!move, d => move?.(d))}>
      <div className="ctxp-row-line" draggable={!renaming}
        onDragStart={e => startDrag(e, { kind: "thread-note", id: item.note_id, label: item.name })}
        onDragEnd={endDrag}>
        <label className="check" title={sent ? "Sent with every reply — untick to stop sending it" : "Not sent — tick to send it with every reply"}>
          <input type="checkbox" checked={sent} onChange={toggle} aria-label={`Send “${item.name}” with every reply`} />
        </label>
        {renaming ? (
          <NameInput name={item.name} onDone={name => { setRenaming(false); if (name) void ops.rename(item.note_id, name); }} />
        ) : (
          <button className="ctxp-row-text" aria-expanded={open} onClick={() => setOpen(item.note_id, !open)}
            title={open ? "Close" : "Read it here · drag to reorder, or onto a message"}>
            <Icon name="note" /><span className="ctxp-name">{item.name}</span>
            <CopyTag item={item} />
            <UnsavedTag id={item.note_id} open={open} />
            <NewerVersionTag noteId={item.note_id} thread={thread} />
            <Icon name={open ? "chevronDown" : "chevronRight"} className="ctxp-caret" />
          </button>
        )}
        {!renaming && (
          <span className="ctxp-row-actions">
            <Menu label={`${item.name} actions`} className="act act-more" icon="more" items={items} />
          </span>
        )}
      </div>
      {open && <ItemDetail thread={thread} noteId={item.note_id} kind="every_reply" />}
    </li>
  );
}

/**
 * A library item that goes with one message: sent right after that message whenever the message
 * is sent. Its switch is on the row.
 */
function WithMessageRow({ thread, item }: { thread: ThreadSnapshot; item: ThreadItem }) {
  const meta = useStore(s => s.ws?.notes.find(n => n.id === item.note_id));
  const open = usePanel(s => !!s.open[item.note_id]);
  const flashing = useFlash(item.note_id);
  const [renaming, setRenaming] = useState(false);
  const message = thread.messages.find(m => m.id === item.message_id);
  const [on, toggle] = useSwitch(!item.excluded, next => ops.setItemSwitch(thread, item.note_id, !next));
  // Switched on but not sent: the message itself isn't (the switch can't change that).
  const why = on ? notSentBecause({ ...item, excluded: false }, message) : null;
  const sent = on && !why;

  const items: MenuItem[] = commonActions(item, open, setRenaming);
  items.splice(1, 0, { label: "Show the message", icon: "arrowDown", onSelect: () => { if (item.message_id) showMessage(item.message_id); } });
  items.push(
    { label: "Send with every reply", icon: "plus", hint: "Instead of with its message", onSelect: async () => { if (await ops.addItem(thread, item.note_id)) flash(item.note_id); } },
    ...ownCopyAction(thread, item, (meta?.used_in ?? 1) > 1),
    { separator: true },
    removeAction(thread, item),
  );

  return (
    <li className={["ctxp-row", "ctxp-item", "is-on-message", sent ? "" : "is-notsent", !renaming ? "is-draggable" : "",
      flashing ? "is-flash" : "", open ? "is-open" : ""].join(" ")}>
      <div className="ctxp-row-line" draggable={!renaming}
        onDragStart={e => startDrag(e, { kind: "msg-note", id: item.note_id, label: item.name })}
        onDragEnd={endDrag}>
        <label className="check" title={why ? `Not sent — ${why}` : on ? "Sent with its message — untick to stop" : "Not sent — tick to send it with its message"}>
          <input type="checkbox" checked={on} onChange={toggle} aria-label={`Send “${item.name}” with its message`} />
        </label>
        {renaming ? (
          <NameInput name={item.name} onDone={name => { setRenaming(false); if (name) void ops.rename(item.note_id, name); }} />
        ) : (
          <button className="ctxp-row-text" aria-expanded={open} onClick={() => setOpen(item.note_id, !open)} title={open ? "Close" : "Read it, and see the message it goes with"}>
            <Icon name="paperclip" /><span className="ctxp-name">{item.name}</span>
            <span className="ctxp-tag">with one message</span>
            <CopyTag item={item} />
            <UnsavedTag id={item.note_id} open={open} />
            <NewerVersionTag noteId={item.note_id} thread={thread} />
            <Icon name={open ? "chevronDown" : "chevronRight"} className="ctxp-caret" />
          </button>
        )}
        {!renaming && (
          <span className="ctxp-row-actions">
            <Menu label={`${item.name} actions`} className="act act-more" icon="more" items={items} />
          </span>
        )}
      </div>
      {open && <ItemDetail thread={thread} noteId={item.note_id} kind="with_message" />}
    </li>
  );
}
