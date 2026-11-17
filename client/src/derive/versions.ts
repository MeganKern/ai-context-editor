import type { NoteRow } from "../../../shared/snapshot.js";

/**
 * An item's versions as the tree they are: the current version at the top, each past version
 * under the one that replaced it, beside the others that were. Positions come from the pointers
 * alone, computed once here; nothing is placed by hand.
 */
export const NODE_W = 232;
export const NODE_H = 60;
const GAP_X = 40;
const GAP_Y = 64;
const PAD = 28;

export interface VersionNode {
  note: NoteRow;
  /** Centre, in stage pixels. */
  x: number;
  y: number;
  parent: string | null;
  children: string[];
}

export interface VersionTree {
  nodes: VersionNode[];
  byId: Map<string, VersionNode>;
  current: string | null;
  width: number;
  height: number;
}

const byName = (a: NoteRow, b: NoteRow) => a.name.localeCompare(b.name);

export function versionTree(notes: NoteRow[], noteId: string): VersionTree {
  const note = notes.find(n => n.id === noteId);
  if (!note) return { nodes: [], byId: new Map(), current: null, width: 0, height: 0 };
  const members = note.tree_id ? notes.filter(n => n.tree_id === note.tree_id) : [note];
  const memberIds = new Set(members.map(n => n.id));
  const parentOf = (n: NoteRow) => (n.replaced_by && memberIds.has(n.replaced_by) ? n.replaced_by : null);
  const children = new Map<string, NoteRow[]>();
  for (const n of members) {
    const p = parentOf(n);
    if (p) children.set(p, [...(children.get(p) ?? []), n]);
  }
  for (const list of children.values()) list.sort(byName);
  const current = members.find(n => n.is_current)?.id ?? null;
  // The current version is the root. Any other root (its successor was retired or taken out)
  // sits one level below it, beside the rest, with no line: nothing is known to have followed it.
  const roots = members.filter(n => !parentOf(n)).sort((a, b) => (a.id === current ? -1 : b.id === current ? 1 : byName(a, b)));

  // Each subtree is as wide as its children side by side; a parent is centred over them.
  const span = new Map<string, number>();
  const measure = (n: NoteRow): number => {
    const kids = children.get(n.id) ?? [];
    const w = kids.length ? Math.max(NODE_W, kids.reduce((s, k) => s + measure(k), 0) + GAP_X * (kids.length - 1)) : NODE_W;
    span.set(n.id, w);
    return w;
  };
  for (const r of roots) measure(r);

  const nodes: VersionNode[] = [];
  const place = (n: NoteRow, left: number, depth: number): number => {
    const kids = children.get(n.id) ?? [];
    const w = span.get(n.id)!;
    let x: number;
    if (kids.length) {
      let cursor = left + (w - (kids.reduce((s, k) => s + span.get(k.id)!, 0) + GAP_X * (kids.length - 1))) / 2;
      const xs: number[] = [];
      for (const k of kids) { xs.push(place(k, cursor, depth + 1)); cursor += span.get(k.id)! + GAP_X; }
      x = (xs[0] + xs[xs.length - 1]) / 2;
    } else {
      x = left + w / 2;
    }
    nodes.push({ note: n, x: PAD + x, y: PAD + NODE_H / 2 + depth * (NODE_H + GAP_Y), parent: parentOf(n), children: kids.map(k => k.id) });
    return x;
  };
  let cursor = 0;
  for (const r of roots) {
    place(r, cursor, current && r.id !== current ? 1 : 0);
    cursor += span.get(r.id)! + GAP_X;
  }
  const width = Math.max(cursor - GAP_X, NODE_W) + PAD * 2;
  const maxY = nodes.reduce((m, n) => Math.max(m, n.y), 0);
  return { nodes, byId: new Map(nodes.map(n => [n.note.id, n])), current, width, height: maxY + NODE_H / 2 + PAD };
}

/** Everything under a version, itself included: where it can't be dropped. */
export function subtreeOf(tree: VersionTree, id: string): Set<string> {
  const out = new Set<string>();
  const walk = (k: string) => { out.add(k); for (const c of tree.byId.get(k)?.children ?? []) walk(c); };
  walk(id);
  return out;
}
