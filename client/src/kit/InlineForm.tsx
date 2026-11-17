import { type ReactNode } from "react";
import { Button } from "./Button.js";
import type { HelpKey } from "../help/entries.js";

/** A name typed in place — a new thread, folder or item, or a rename — with Create and Cancel. */
export function InlineForm({ value, onChange, onSubmit, onCancel, placeholder, label, submitLabel = "Create", hint, size = "xs", className = "", help }: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  placeholder?: string;
  label: string;
  submitLabel?: string;
  hint?: ReactNode;
  size?: "xs" | "sm";
  className?: string;
  help?: HelpKey;
}) {
  return (
    <form className={`inline-form ${className}`} onSubmit={e => { e.preventDefault(); if (value.trim()) onSubmit(); }}>
      <input autoFocus value={value} placeholder={placeholder} aria-label={label}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); onCancel(); } }} />
      {hint && <p className="inline-form-hint">{hint}</p>}
      <div className="inline-form-actions">
        <Button type="submit" kind="primary" size={size} disabled={!value.trim()} help={help}>{submitLabel}</Button>
        <Button kind="ghost" size={size} onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
