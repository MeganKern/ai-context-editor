import { useEffect, useRef, useState } from "react";
import { useStore } from "../../store.js";
import type { ThreadSnapshot } from "../../../../shared/snapshot.js";
import { useNoteText } from "../../notes-cache.js";
import * as ops from "../../context-ops.js";
import { MOD, clip } from "../../format.js";
import { Icon } from "../Icon.js";
import { GrowingText } from "./inputs.js";
import { flash, notSentBecause, setDraftFor, showMessage, usePanel } from "./panel-state.js";

export type DetailKind = "every_reply" | "with_message" | "library";

/**
 * An item opened in place: its text (read, or edited right here), the message it goes with, and
 * what you can do next. Edits to an item reach every thread that uses it.
 */
export function ItemDetail({ thread, noteId, kind }: { thread: ThreadSnapshot | null; noteId: string; kind: DetailKind }) {
  const setUi = useStore(s => s.setUi);
  const meta = useStore(s => s.ws?.notes.find(n => n.id === noteId));
  // Asked to open straight into editing (Edit the text, or a new item): the editor shows once
  // the text is here.
  const editNow = usePanel(s => s.editing === noteId);
  const { text, loading, failed } = useNoteText(noteId);
  const typed = usePanel(s => s.drafts[noteId] ?? null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const others = Math.max(0, (meta?.used_in ?? 0) - (kind === "library" ? 0 : 1));
  const draft = typed ?? (editNow && text !== null ? text : null);
  const dirty = draft !== null && text !== null && draft !== text;
  // (The request to edit stays until the editor is saved, cancelled or closed: a new item can
  // show up in the library a moment before the thread says it uses it, and then moves.)
  const setDraft = (v: string | null) => {
    setDraftFor(noteId, v);
    if (v === null) {
      setConfirmDiscard(false);
      if (usePanel.getState().editing === noteId) usePanel.setState({ editing: null });
    }
  };
  // Leaving the editor with changes asks first.
  const cancel = () => { if (dirty) setConfirmDiscard(true); else setDraft(null); };
  // Opened near the bottom of its list: bring it into view once its text is in.
  const box = useRef<HTMLDivElement>(null);
  const ready = text !== null || failed;
  useEffect(() => { if (ready) box.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [ready]);

  const save = async () => {
    if (draft === null) return;
    if (draft === text) { setDraft(null); return; }
    if (await ops.saveText(noteId, draft)) setDraft(null);
  };
  const toEveryReply = async () => { if (thread && await ops.addItem(thread, noteId)) flash(noteId); };

  return (
    <div className="ctxp-detail" ref={box}>
      {draft === null ? (
        <div className={`ctxp-detail-text ${loading ? "is-loading" : ""}`} onDoubleClick={() => { if (text !== null) setDraft(text); }}
          title={text !== null ? "Double-click to edit" : undefined}>
          {loading ? "Loading…" : failed ? "Couldn't load it." : text?.trim() ? text : <em>Empty. Only its name is sent.</em>}
        </div>
      ) : (
        <>
          <GrowingText value={draft} onChange={setDraft} onSave={() => void save()} onCancel={cancel}
            label={`Text of ${meta?.name ?? "the item"}`} long className="is-body" max={360}
            placeholder="The text the model should see — a brief, a spec, notes…" />
          {others > 0 && (
            <p className="ctxp-detail-warn">
              {kind === "library" ? `Used in ${others} thread${others === 1 ? "" : "s"}` : `Also used in ${others} other thread${others === 1 ? "" : "s"}`} — saving changes it there too.
            </p>
          )}
        </>
      )}

      {kind === "with_message" && thread && <GoesWith thread={thread} noteId={noteId} />}

      <div className="ctxp-detail-actions">
        {draft === null ? (
          <>
            <button className="act" onClick={() => setDraft(text ?? "")} disabled={text === null}><Icon name="edit" /> Edit</button>
            <button className="act" onClick={() => setUi({ noteEditor: noteId })} title="A bigger editor, with rename and delete"><Icon name="external" /> Full editor</button>
            {kind === "with_message" && thread && (
              <button className="act" onClick={() => void toEveryReply()}
                title="Send it with every reply instead of with its message"><Icon name="plus" /> Every reply</button>
            )}
            {kind === "library" && thread && (
              <button className="act" onClick={() => void toEveryReply()}
                title={`Send it with every reply in this ${thread.thread.kind === "template" ? "template" : "thread"}`}><Icon name="plus" /> Add</button>
            )}
          </>
        ) : confirmDiscard ? (
          <div className="ctxp-discard" role="alertdialog" aria-label="Discard your changes?"
            onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setConfirmDiscard(false); } }}>
            <span>Discard your changes?</span>
            <button className="btn btn-xs" autoFocus onClick={() => setConfirmDiscard(false)}>Keep editing</button>
            <button className="btn btn-danger btn-xs" onClick={() => setDraft(null)}>Discard</button>
          </div>
        ) : (
          <>
            <button className="btn btn-primary btn-xs" onMouseDown={e => e.preventDefault()} onClick={() => void save()} disabled={!dirty}>Save</button>
            <button className="btn btn-ghost btn-xs" onClick={cancel}>Cancel</button>
            <span className="ctxp-form-keys">{MOD} S</span>
          </>
        )}
      </div>
    </div>
  );
}

/** The one message an item goes with: where it is, and why the item isn't sent there if it isn't. */
function GoesWith({ thread, noteId }: { thread: ThreadSnapshot; noteId: string }) {
  const setUi = useStore(s => s.setUi);
  const item = thread.items.find(i => i.note_id === noteId && i.placement === "with_message");
  const message = item?.message_id ? thread.messages.find(m => m.id === item.message_id) : undefined;
  const mid = message?.id ?? null;
  // Pointing at the line marks its message in the conversation; leaving (or the line going) clears it.
  const unmark = () => { if (mid && useStore.getState().ui.visit.highlight?.first === mid) setUi({ visit: { highlight: null } }); };
  useEffect(() => () => {
    const st = useStore.getState();
    if (mid && st.ui.visit.highlight?.first === mid) st.setUi({ visit: { highlight: null } });
  }, [mid]);
  if (!item || !message) return null;
  const why = notSentBecause(item, message);
  return (
    <div className="ctxp-goes">
      <p className="ctxp-goes-head">Goes with</p>
      <ul>
        <li className={`ctxp-goes-line ${item.sent ? "" : "is-notsent"}`}
          onMouseEnter={() => setUi({ visit: { highlight: { first: message.id, last: message.id } } })} onMouseLeave={unmark}>
          <button className="ctxp-goes-msg" onClick={() => showMessage(message.id)} title="Show the message">
            <span>“{clip(message.content, 70) || "(no text yet)"}”</span>
            {why && <span className="ctxp-goes-why">Not sent: {why}</span>}
          </button>
        </li>
      </ul>
    </div>
  );
}
