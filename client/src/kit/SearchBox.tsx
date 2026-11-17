import { Icon } from "./Icon.js";
import { IconButton } from "./Button.js";
import type { HelpKey } from "../help/entries.js";

/** A box to type a search in, with a way to clear it (the button, or Escape). */
export function SearchBox({ value, onChange, placeholder, label, id, help, className = "" }: {
  value: string; onChange: (v: string) => void; placeholder?: string; label: string; id?: string; help?: HelpKey; className?: string;
}) {
  return (
    <div className={`search ${className}`} data-help={help}>
      <Icon name="search" />
      <input id={id} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} aria-label={label}
        onKeyDown={e => { if (e.key === "Escape" && value) { e.preventDefault(); onChange(""); } }} />
      {value && <IconButton icon="close" label="Clear" onClick={() => onChange("")} />}
    </div>
  );
}
