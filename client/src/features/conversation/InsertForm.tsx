import { useEffect, useRef, useState } from "react";
import { run, useModel } from "../../data/model.js";
import { activity } from "../../session/activity.js";
import { Button } from "../../kit/Button.js";

/** A message added between two cards; what's below stays where it is. */
export function InsertForm({ afterId }: { afterId: string }) {
  const threadId = useModel(s => s.threadId)!;
  const [text, setText] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, []);
  const close = () => activity.close();
  const go = async (reply: boolean) => {
    if (!text.trim()) return;
    if (await run("insert_message", { thread_id: threadId, after_message_id: afterId, content: text.trim(), reply })) close();
  };
  return (
    <div className="turn ctx-insert" ref={ref}>
      <div className="insert-form" data-help="ins.form">
        <label className="insert-form-label" htmlFor={`ins-${afterId}`}>Add a message here</label>
        <textarea id={`ins-${afterId}`} className="field-grow is-body" autoFocus rows={3} value={text} placeholder="Type the message to add…"
          onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); close(); } }} />
        <div className="inline-form-actions is-under">
          <Button kind="primary" size="sm" help="insert_message" disabled={!text.trim()} onClick={() => void go(false)}
            title="Adds it here. Messages below stay where they are; their replies aren't redone.">Insert</Button>
          <Button size="sm" help="insert_message:reply" disabled={!text.trim()} onClick={() => void go(true)}
            title="Adds it here and the model replies to it right here, from what's above it. Messages below stay; their replies aren't redone.">Insert and get reply</Button>
          <Button kind="ghost" size="sm" onClick={close}>Cancel</Button>
        </div>
        <p className="insert-form-help">
          Everything below stays where it is, and later replies aren't rewritten. To go a different way from here instead, branch from here with the + between messages.
        </p>
      </div>
    </div>
  );
}
