import { useEffect, useRef, useState } from "react";
import { SUMMARY_INSTRUCTIONS } from "../../../../shared/summary.js";
import { run } from "../../data/model.js";
import { activity, useActivityOf } from "../../session/activity.js";
import { plural } from "../../derive/text.js";
import { Button } from "../../kit/Button.js";
import { useEscapeToClose } from "../../kit/Layer.js";

/**
 * Picking the messages a summary is written from, then the instructions it's written with. The
 * instructions start as the app's own; left as they are, none are sent and the server uses its
 * own — so only what you changed is kept with the summary.
 */
export function SelectionBar() {
  const picking = useActivityOf("summarize");
  const picked = picking?.picked ?? [];
  const n = picked.length;
  const [ready, setReady] = useState(false);
  const [instructions, setInstructions] = useState(SUMMARY_INSTRUCTIONS);
  const taRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (ready && taRef.current) { taRef.current.focus(); taRef.current.select(); } }, [ready]);
  const cancel = () => activity.close();
  useEscapeToClose(cancel);

  const summarize = async () => {
    const custom = instructions.trim();
    const r = await run("summarize", { message_ids: picked, instructions: custom && custom !== SUMMARY_INSTRUCTIONS ? custom : undefined });
    if (r) activity.close();
  };

  if (ready && n > 0) {
    return (
      <div className="selection-bar" role="status" data-help="sum.pick">
        <div className="selection-row">
          <span className="selection-step">Instructions</span>
          <span className="spacer" />
          <Button kind="ghost" size="sm" onClick={() => setReady(false)}>Back</Button>
          <Button kind="primary" size="sm" icon="summary" help="summarize" onClick={() => void summarize()}>Summarize</Button>
          <Button kind="ghost" size="sm" onClick={cancel}>Cancel</Button>
        </div>
        <textarea ref={taRef} className="field-grow is-body selection-instructions" value={instructions} onChange={e => setInstructions(e.target.value)} rows={3}
          aria-label="Instructions for the summary" onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); setReady(false); } }} />
      </div>
    );
  }
  return (
    <div className="selection-bar" role="status" data-help="sum.pick">
      <div className="selection-row">
        <span className="selection-step">Summarize</span>
        <span className="selection-text">
          {n === 0 ? "Click each message to include — yours, replies, agents' results, in any order."
            : `${plural(n, "message")} picked. Click more, or click one again to leave it out.`}
        </span>
        <span className="spacer" />
        {n > 0 && <Button kind="primary" size="sm" icon="summary" onClick={() => setReady(true)}>Write summary</Button>}
        <Button kind="ghost" size="sm" onClick={cancel}>Cancel</Button>
      </div>
    </div>
  );
}
