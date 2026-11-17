import { read } from "../../data/api.js";
import { useModel } from "../../data/model.js";
import { useResource } from "../../data/resources.js";
import { activity } from "../../session/activity.js";
import { Dialog } from "../../kit/Dialog.js";
import { Md } from "../../kit/Md.js";

/** A library item, read where its pill was clicked. */
export function NoteView({ noteId }: { noteId: string }) {
  const note = useModel(s => s.ws?.notes.find(n => n.id === noteId));
  const { data } = useResource(note ? `note:${noteId}:${note.content_hash}` : null, () => read.note(noteId).then(d => d.content));
  return (
    <Dialog className="note-view" label={note?.name ?? "Note"} onClose={() => activity.close()} help="dl.note"
      title={<span className="note-view-name">{note?.name ?? "Note"}{note && !note.is_current && <span className="note-view-retired"> retired</span>}</span>}>
      <div className="note-view-body">
        {data !== null ? <Md text={data} /> : <span className="msg-waiting"><span className="spinner is-inline" aria-hidden />Loading…</span>}
      </div>
    </Dialog>
  );
}
