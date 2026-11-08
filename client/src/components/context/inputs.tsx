import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export function SectionHead({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="ctxp-section-head">
      <h3>{title}{sub && <span className="ctxp-sub">{sub}</span>}</h3>
      {children}
    </div>
  );
}

/** A textarea that grows with its text. Enter saves short text; long text saves with ⌘/Ctrl+S or ⌘/Ctrl+Enter. */
export function GrowingText({ value, onChange, onSave, onCancel, label, placeholder, className = "", long = false, saveOnBlur = false, max = 340 }: {
  value: string; onChange: (v: string) => void; onSave: () => void; onCancel: () => void;
  label: string; placeholder?: string; className?: string; long?: boolean; saveOnBlur?: boolean; max?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(max, el.scrollHeight + 2) + "px";
  }, [value, max]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  // Enter (or Escape) and the blur that follows when the box closes count once; if the box
  // stays (a save that failed), it answers again.
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    setTimeout(() => { done.current = false; }, 0);
    if (save) onSave(); else onCancel();
  };
  return (
    <textarea ref={ref} className={`ctxp-text-input ${className}`} value={value} rows={1} aria-label={label} placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
      onBlur={() => { if (saveOnBlur) finish(true); }}
      onKeyDown={e => {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); }
        else if (e.key === "Enter" && !e.nativeEvent.isComposing && (long ? (e.metaKey || e.ctrlKey) : !e.shiftKey)) { e.preventDefault(); finish(true); }
        else if (e.key === "s" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); finish(true); }
      }} />
  );
}

/** Renaming a library item in its row. */
export function NameInput({ name, onDone }: { name: string; onDone: (name: string | null) => void }) {
  const [v, setV] = useState(name);
  const done = useRef(false);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    const t = v.trim();
    onDone(save && t && t !== name ? t : null);
  };
  return (
    <input className="ctxp-name-input" value={v} autoFocus aria-label="Name" onFocus={e => e.currentTarget.select()}
      onChange={e => setV(e.target.value)} onBlur={() => finish(true)}
      onKeyDown={e => {
        if (e.key === "Enter") { e.preventDefault(); finish(true); }
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); }
      }} />
  );
}
