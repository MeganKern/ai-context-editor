const VAR_RE = /\{\{(@?\w+)(?:\|([^}]*))?\}\}/g;

export interface AutoVarDef {
  label: string;
  sample: () => string;
}

export const AUTO_CATALOG: Record<string, AutoVarDef> = {
  "@date_long": { label: "Date (long)", sample: () => new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) },
  "@date_short": { label: "Date (short)", sample: () => new Date().toISOString().split("T")[0] },
  "@time": { label: "Time", sample: () => new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) },
  "@datetime": { label: "Date + time", sample: () => new Date().toLocaleString("en-US") },
  "@year": { label: "Year", sample: () => String(new Date().getFullYear()) },
  "@weekday": { label: "Weekday", sample: () => new Date().toLocaleDateString("en-US", { weekday: "long" }) },
};

export interface ExtractedVar {
  name: string;
  auto: boolean;
  known: boolean;
  required: boolean;
  default: string | null;
}

interface Occurrence { name: string; default: string | null }

function occurrences(stepContents: string[]): Occurrence[] {
  const out: Occurrence[] = [];
  for (const text of stepContents) {
    for (const m of text.matchAll(new RegExp(VAR_RE.source, "g"))) out.push({ name: m[1], default: m[2] ?? null });
  }
  return out;
}

/** Each blank once, as its first use defines it: {{name}} must be filled, {{name|default}} falls back. */
export function extractVariables(stepContents: string[]): ExtractedVar[] {
  const seen = new Map<string, ExtractedVar>();
  for (const o of occurrences(stepContents)) {
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
  for (const o of occurrences(stepContents)) {
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
    else if (v.auto && v.known) out[v.name] = AUTO_CATALOG[v.name].sample();
    else if (v.default !== null) out[v.name] = v.default;
  }
  return out;
}

export function substituteVariables(template: string, resolved: Record<string, string>): string {
  return template.replace(new RegExp(VAR_RE.source, "g"), (match, name: string) => (name in resolved ? resolved[name] : match));
}
