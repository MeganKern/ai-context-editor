/** The blank syntax, once: {{name}} to fill in, {{name|default}} with a fallback, {{@name}} filled in for you. */
export const VAR_RE = /\{\{(@?\w+)(?:\|([^}]*))?\}\}/g;

export interface Blank { name: string; default: string | null; index: number; length: number }

/** Every blank in a text, in order, with where it sits. */
export function blanks(text: string): Blank[] {
  const out: Blank[] = [];
  for (const m of text.matchAll(VAR_RE)) out.push({ name: m[1], default: m[2] ?? null, index: m.index, length: m[0].length });
  return out;
}

export interface AutoVarDef {
  label: string;
  /** Its value right now. */
  value: () => string;
}

export const AUTO_CATALOG: Record<string, AutoVarDef> = {
  "@date_long": { label: "Date (long)", value: () => new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) },
  "@date_short": { label: "Date (short)", value: () => new Date().toISOString().split("T")[0] },
  "@time": { label: "Time", value: () => new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) },
  "@datetime": { label: "Date + time", value: () => new Date().toLocaleString("en-US") },
  "@year": { label: "Year", value: () => String(new Date().getFullYear()) },
  "@weekday": { label: "Weekday", value: () => new Date().toLocaleDateString("en-US", { weekday: "long" }) },
};

export interface ExtractedVar {
  name: string;
  auto: boolean;
  known: boolean;
  required: boolean;
  default: string | null;
}

/** Each blank once, as its first use defines it: {{name}} must be filled, {{name|default}} falls back. */
export function extractVariables(stepContents: string[]): ExtractedVar[] {
  const seen = new Map<string, ExtractedVar>();
  for (const o of stepContents.flatMap(blanks)) {
    if (seen.has(o.name)) continue;
    const auto = o.name.startsWith("@");
    seen.set(o.name, {
      name: o.name,
      auto,
      known: auto && o.name in AUTO_CATALOG,
      required: !auto && o.default === null,
      default: o.default,
    });
  }
  return [...seen.values()];
}

export interface VarProblem {
  name: string;
  issue: "unknown_auto" | "missing_required" | "conflicting_defaults";
}

/** What stops a run from starting. The client offers Run only when this finds nothing. */
export function validate(values: Record<string, string>, stepContents: string[]): VarProblem[] {
  const problems: VarProblem[] = [];
  const defaults = new Map<string, Set<string>>();
  for (const o of stepContents.flatMap(blanks)) {
    if (o.default !== null) defaults.set(o.name, (defaults.get(o.name) ?? new Set<string>()).add(o.default));
  }
  for (const [name, set] of defaults) {
    if (set.size > 1) problems.push({ name, issue: "conflicting_defaults" });
  }
  for (const v of extractVariables(stepContents)) {
    if (v.auto && !v.known) problems.push({ name: v.name, issue: "unknown_auto" });
    if (v.required && !values[v.name]?.trim()) problems.push({ name: v.name, issue: "missing_required" });
  }
  return problems;
}

/** Every blank's value for one run: what you typed, else (for an @ blank) its value right now,
 *  else its first use's default. Every use of a name gets the same value. */
export function resolveValues(values: Record<string, string>, stepContents: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of extractVariables(stepContents)) {
    if (values[v.name]?.trim()) out[v.name] = values[v.name];
    else if (v.auto && v.known) out[v.name] = AUTO_CATALOG[v.name].value();
    else if (v.default !== null) out[v.name] = v.default;
  }
  return out;
}

export function substituteVariables(template: string, resolved: Record<string, string>): string {
  return template.replace(VAR_RE, (match, name: string) => (name in resolved ? resolved[name] : match));
}
