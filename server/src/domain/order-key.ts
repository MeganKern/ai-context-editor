/**
 * Order keys: strings that sort in list order (byte order, so the database column is COLLATE "C").
 * A key can always be made between two others, so putting something into a list writes one row
 * and nothing around it moves. Fractional indexing after David Greenspan's description
 * (observablehq.com/@dgreensp/implementing-fractional-indexing, public domain): an integer part
 * whose first character says its length, then a fraction that never ends in "0".
 */

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ZERO = DIGITS[0];
const SMALLEST_INTEGER = "A" + ZERO.repeat(26);

function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) throw new Error(`order key ${a} >= ${b}`);
  if (a.slice(-1) === ZERO || (b && b.slice(-1) === ZERO)) throw new Error("order key fraction ends in 0");
  if (b) {
    let n = 0;
    while ((a[n] || ZERO) === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a ? DIGITS.indexOf(a[0]) : 0;
  const digitB = b !== null ? DIGITS.indexOf(b[0]) : DIGITS.length;
  if (digitB - digitA > 1) return DIGITS[Math.round(0.5 * (digitA + digitB))];
  if (b && b.length > 1) return b.slice(0, 1);
  return DIGITS[digitA] + midpoint(a.slice(1), null);
}

function integerLength(head: string): number {
  if (head >= "a" && head <= "z") return head.charCodeAt(0) - 97 + 2;
  if (head >= "A" && head <= "Z") return 90 - head.charCodeAt(0) + 2;
  throw new Error(`invalid order key head: ${head}`);
}

function integerPart(key: string): string {
  const n = integerLength(key[0]);
  if (n > key.length) throw new Error(`invalid order key: ${key}`);
  return key.slice(0, n);
}

function validate(key: string): void {
  if (key === SMALLEST_INTEGER) throw new Error(`invalid order key: ${key}`);
  const i = integerPart(key);
  if (key.slice(i.length).slice(-1) === ZERO) throw new Error(`invalid order key: ${key}`);
}

function incrementInteger(x: string): string | null {
  const [head, ...digs] = x.split("");
  let carry = true;
  for (let i = digs.length - 1; carry && i >= 0; i--) {
    const d = DIGITS.indexOf(digs[i]) + 1;
    if (d === DIGITS.length) digs[i] = ZERO;
    else { digs[i] = DIGITS[d]; carry = false; }
  }
  if (!carry) return head + digs.join("");
  if (head === "Z") return "a" + ZERO;
  if (head === "z") return null;
  const h = String.fromCharCode(head.charCodeAt(0) + 1);
  if (h > "a") digs.push(ZERO); else digs.pop();
  return h + digs.join("");
}

function decrementInteger(x: string): string | null {
  const [head, ...digs] = x.split("");
  let borrow = true;
  for (let i = digs.length - 1; borrow && i >= 0; i--) {
    const d = DIGITS.indexOf(digs[i]) - 1;
    if (d === -1) digs[i] = DIGITS.slice(-1);
    else { digs[i] = DIGITS[d]; borrow = false; }
  }
  if (!borrow) return head + digs.join("");
  if (head === "a") return "Z" + DIGITS.slice(-1);
  if (head === "A") return null;
  const h = String.fromCharCode(head.charCodeAt(0) - 1);
  if (h < "Z") digs.push(DIGITS.slice(-1)); else digs.pop();
  return h + digs.join("");
}

/** A key that sorts after `a` and before `b` (null: the start or the end of the list). */
export function keyBetween(a: string | null, b: string | null): string {
  if (a !== null) validate(a);
  if (b !== null) validate(b);
  if (a !== null && b !== null && a >= b) throw new Error(`order key ${a} >= ${b}`);
  if (a === null) {
    if (b === null) return "a" + ZERO;
    const ib = integerPart(b);
    const fb = b.slice(ib.length);
    if (ib === SMALLEST_INTEGER) return ib + midpoint("", fb);
    if (ib < b) return ib;
    const res = decrementInteger(ib);
    if (res === null) throw new Error("order key can't go lower");
    return res;
  }
  if (b === null) {
    const ia = integerPart(a);
    const i = incrementInteger(ia);
    return i === null ? ia + midpoint(a.slice(ia.length), null) : i;
  }
  const ia = integerPart(a);
  const fa = a.slice(ia.length);
  const ib = integerPart(b);
  if (ia === ib) return ia + midpoint(fa, b.slice(ib.length));
  const i = incrementInteger(ia);
  if (i === null) throw new Error("order key can't go higher");
  if (i < b) return i;
  return ia + midpoint(fa, null);
}

/** `n` keys in order between `a` and `b`. */
export function keysBetween(a: string | null, b: string | null, n: number): string[] {
  const out: string[] = [];
  let prev = a;
  for (let i = 0; i < n; i++) {
    prev = keyBetween(prev, b);
    out.push(prev);
  }
  return out;
}

/**
 * A list put in a new order, changing as few keys as possible: the longest run of items already in
 * the right relative order keeps its keys, and only the others get new ones between their new
 * neighbours. Moving one item changes one key. Returns only the keys that change.
 */
export function rekey(ordered: string[], current: Map<string, string>): Map<string, string> {
  const keys = ordered.map(id => current.get(id)!);
  // Longest increasing subsequence of the current keys, in the new order.
  const tails: number[] = [];
  const prevIdx = new Array<number>(keys.length).fill(-1);
  for (let i = 0; i < keys.length; i++) {
    let lo = 0, hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (keys[tails[mid]] < keys[i]) lo = mid + 1; else hi = mid;
    }
    if (lo > 0) prevIdx[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const keep = new Set<number>();
  for (let i = tails.length ? tails[tails.length - 1] : -1; i >= 0; i = prevIdx[i]) keep.add(i);

  const changed = new Map<string, string>();
  let before: string | null = null;
  for (let i = 0; i < ordered.length; i++) {
    if (keep.has(i)) { before = keys[i]; continue; }
    let after: string | null = null;
    for (let j = i + 1; j < ordered.length; j++) if (keep.has(j)) { after = keys[j]; break; }
    const k = keyBetween(before, after);
    changed.set(ordered[i], k);
    before = k;
  }
  return changed;
}
