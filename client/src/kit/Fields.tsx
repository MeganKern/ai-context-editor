import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon.js";
import type { HelpKey } from "../help/entries.js";

/** A textarea that grows with its text, for the boxes that keep their own text. */
export function useAutoGrow(ref: React.RefObject<HTMLTextAreaElement | null>, value: string, max = 320): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(max, el.scrollHeight) + "px";
  }, [ref, value, max]);
}

/** A textarea that grows with its text. Enter saves short text; long text saves with ⌘/Ctrl+S or ⌘/Ctrl+Enter. */
export function GrowingText({ value, onChange, onSave, onCancel, label, placeholder, className = "", long = false, max = 340 }: {
  value: string; onChange: (v: string) => void; onSave: () => void; onCancel: () => void;
  label: string; placeholder?: string; className?: string; long?: boolean; max?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(ref, value, max);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  return (
    <textarea ref={ref} className={`field-grow ${className}`} value={value} rows={1} aria-label={label} placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
      onKeyDown={e => {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCancel(); }
        else if (e.key === "Enter" && !e.nativeEvent.isComposing && (long ? (e.metaKey || e.ctrlKey) : !e.shiftKey)) { e.preventDefault(); onSave(); }
        else if (e.key === "s" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSave(); }
      }} />
  );
}

/** Renaming something in its row: Enter or leaving saves, Escape leaves it as it was. */
export function NameInput({ name, onDone, className = "" }: { name: string; onDone: (name: string | null) => void; className?: string }) {
  const [v, setV] = useState(name);
  const done = useRef(false);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    const t = v.trim();
    onDone(save && t && t !== name ? t : null);
  };
  return (
    <input className={`field-name ${className}`} value={v} autoFocus aria-label="Name" onFocus={e => e.currentTarget.select()}
      onChange={e => setV(e.target.value)} onBlur={() => finish(true)}
      onKeyDown={e => {
        if (e.key === "Enter") { e.preventDefault(); finish(true); }
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); }
      }} />
  );
}

/** A labelled choice from a short list, in a row: "Model ▾". The one dial for the agent's settings. */
export function Dial<V extends string>({ label, value, options, onChange, title, help, className = "", children }: {
  label: string; value: V; options: { value: V; label: string }[]; onChange: (v: V) => void;
  title?: string; help?: HelpKey; className?: string; children?: ReactNode;
}) {
  return (
    <label className={`dial ${className}`} title={title} data-help={help}>
      <span className="dial-label">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value as V)}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <Icon name="chevronDown" />
      {children}
    </label>
  );
}
