import { useEffect, useRef, useState } from "react";
import { run, useModel } from "../../data/model.js";
import { Button } from "../../kit/Button.js";

/** The one system message every reply gets, across all workspaces; edited under the box. */
export function SystemMessage() {
  const saved = useModel(s => s.app?.system_message ?? "");
  const [text, setText] = useState(saved);
  const ref = useRef<HTMLTextAreaElement>(null);
  const edited = text !== saved;
  useEffect(() => { setText(saved); }, [saved]);
  useEffect(() => {
    const el = ref.current;
    if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  }, []);
  return (
    <div className="sys-msg-editor">
      <textarea ref={ref} className="field-grow is-body" value={text} onChange={e => setText(e.target.value)} placeholder="Describe any model behavioral preferences" rows={4} aria-label="System message" />
      <div className="inline-form-actions is-under is-end">
        {edited && <Button kind="ghost" size="sm" onClick={() => setText(saved)}>Reset</Button>}
        {edited && <Button kind="primary" size="sm" help="set_system_message" onClick={() => void run("set_system_message", { text: text.trim() })}>Save</Button>}
      </div>
    </div>
  );
}
