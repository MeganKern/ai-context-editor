import type { ThreadRow, ThreadSnapshot } from "../../../../shared/snapshot.js";
import { setPref } from "../../session/prefs.js";
import { rows } from "../../session/rows.js";
import { activity } from "../../session/activity.js";
import { navigate } from "../../session/route.js";
import type { MenuItem } from "../../kit/Menu.js";
import type { ThreadTree } from "../../derive/threads.js";
import * as ops from "./ops.js";

/** The ⋯ of a thread's row. */
export function threadMenu(t: ThreadRow, tree: ThreadTree, open: ThreadSnapshot | null, hideExcluded: boolean): MenuItem[] {
  const isOpen = open?.thread.id === t.id;
  const isTemplate = t.kind === "template";
  const family = isTemplate ? [] : tree.family(t.id);
  const items: MenuItem[] = [];
  items.push({ label: "Rename", help: "rename_thread", onSelect: () => { navigate({ threadId: t.id }); rows.rename(t.id); } });
  if (isOpen && open && open.messages.some(m => m.excluded)) {
    items.push({ label: hideExcluded ? "Show excluded messages" : "Hide excluded messages", help: "menu.hide-excluded", onSelect: () => setPref("hideExcluded", !hideExcluded) });
  }
  if (family.length > 1) {
    items.push({ label: `${family.length - 1} branch${family.length === 2 ? "" : "es"}`, help: "menu.branches", onSelect: () => { navigate({ threadId: t.id }); activity.open({ kind: "branches" }); } });
  }
  items.push({ label: isTemplate ? "Duplicate template" : "Duplicate", help: isTemplate ? "duplicate_thread:template" : "duplicate_thread", onSelect: () => void ops.duplicateThread(t.id, t.name) });
  if (!isTemplate) items.push({ label: "Make template", help: "make_template", onSelect: () => void ops.makeTemplate(t.id) });
  items.push({ separator: true });
  items.push({
    label: `Delete ${isTemplate ? "template" : "thread"}`, danger: true, help: isTemplate ? "delete_thread:template" : "delete_thread",
    onSelect: () => activity.confirm({
      title: `Delete "${t.name}"?`,
      body: "The thread is deleted, and anything running in it is stopped; branches taken from it stay. This can't be undone from the app.",
      confirmLabel: "Delete",
      onConfirm: () => { activity.closeConfirm(); return ops.deleteThread(t.id, isOpen); },
    }),
  });
  return items;
}
