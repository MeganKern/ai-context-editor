import { useMemo } from "react";
import { useModel } from "../../data/model.js";
import { activity } from "../../session/activity.js";
import { navigate } from "../../session/route.js";
import { threadTree } from "../../derive/threads.js";
import { clip, timeLabel } from "../../derive/text.js";
import { Icon } from "../../kit/Icon.js";
import { Dialog } from "../../kit/Dialog.js";
import { Picker } from "../../kit/Picker.js";

/** Every branch of this conversation, as a tree — opened from the thread's ⋯ menu. */
export function BranchesDialog() {
  const ws = useModel(s => s.ws)!;
  const thread = useModel(s => s.thread);
  const tree = useMemo(() => threadTree(ws), [ws]);
  if (!thread) return null;
  const close = () => activity.close();
  const family = tree.family(thread.thread.id);
  const here = thread.thread.id;
  return (
    <Dialog className="branches-dialog" title="Branches" sub="This conversation and every branch taken from it. Each is a thread of its own." onClose={close} help="dl.branches">
      <Picker label="Branches" items={family} keyOf={f => f.row.id} search={false} className="branches-list"
        matches={(f, q) => f.row.name.toLowerCase().includes(q)}
        render={({ row: t, depth }) => (
          <span className={`branches-item ${t.id === here ? "is-current" : ""}`} style={{ paddingLeft: depth * 22 }}>
            {depth > 0 && <Icon name="nest" className="branches-nest" />}
            <span className="branches-text">
              <span className="picker-item-name">{t.name}</span>
              {t.branch_at_preview != null && <span className="branches-at">from “{clip(t.branch_at_preview, 90)}”</span>}
            </span>
            <span className="picker-item-meta">{t.id === here ? "Open now" : timeLabel(t.created_at)}</span>
          </span>
        )}
        // A branch opens at the point it was taken; the thread they all came from opens as usual.
        onPick={({ row: t }) => { close(); if (t.id !== here) navigate({ threadId: t.id, visit: t.branch_at ? { anchor: { key: t.branch_at, top: 140 } } : undefined }); }} />
    </Dialog>
  );
}
