import { useModel } from "../../data/model.js";
import { activity } from "../../session/activity.js";
import { nounOf, plural } from "../../derive/text.js";
import { Icon } from "../../kit/Icon.js";
import { Dialog } from "../../kit/Dialog.js";
import { Picker } from "../../kit/Picker.js";
import * as ops from "./ops.js";

/** Pick from the workspace library — to send an item with every reply in a template (or thread). */
export function AddItem() {
  const ws = useModel(s => s.ws)!;
  const thread = useModel(s => s.thread);
  const close = () => activity.close();
  if (!thread) return null;
  const where = nounOf(thread);
  const placed = new Set(thread.items.map(i => i.note_id));
  return (
    <Dialog className="note-picker" title={`Add from the library to this ${where}`} onClose={close}
      sub={where === "template" ? "Every run uses it — the same item, not a copy — and sends it with every reply." : "It's sent with every reply in this thread, until you remove it."}>
      <Picker label="Library" items={ws.notes.filter(n => n.is_current)} keyOf={n => n.id} search
        placeholder={ws.notes.length ? "Filter the library, or type a name for something new" : "Name the first library item"}
        matches={(n, q) => n.name.toLowerCase().includes(q)} disabled={n => placed.has(n.id)}
        render={n => (
          <>
            <Icon name="note" />
            <span className="picker-item-name">{n.name}</span>
            <span className="picker-item-meta">
              {placed.has(n.id) ? "Already added" : [n.copied_from ? "a copy" : null, n.used_in ? `in ${plural(n.used_in, "thread")}` : null].filter(Boolean).join(" · ")}
            </span>
          </>
        )}
        onPick={async n => { if (await ops.addItem(thread, n.id)) close(); }}
        empty={() => (ws.notes.length ? "Nothing is called that." : "The library is empty. Add to it from the right-hand panel.")}
        create={{ label: q => `New: "${q}"`, onCreate: async q => { if (await ops.createNote(ws.workspace.id, q, { threadId: thread.thread.id })) close(); } }} />
    </Dialog>
  );
}
