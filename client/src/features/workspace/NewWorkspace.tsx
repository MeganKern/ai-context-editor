import { useState } from "react";
import { activity } from "../../session/activity.js";
import { navigate } from "../../session/route.js";
import { Dialog } from "../../kit/Dialog.js";
import { Button } from "../../kit/Button.js";
import { createWorkspace } from "./ops.js";

export function NewWorkspace() {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const close = () => activity.close();
  const submit = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    const id = await createWorkspace(name.trim());
    setSaving(false);
    if (id) { close(); navigate({ wsId: id }); }
  };
  return (
    <Dialog compact title="New workspace" onClose={close}
      actions={<>
        <Button onClick={close}>Cancel</Button>
        <Button kind="primary" help="create_workspace" disabled={saving || !name.trim()} onClick={() => void submit()}>{saving ? "Creating…" : "Create"}</Button>
      </>}>
      <div className="dialog-fields">
        <label className="dialog-field">
          Name
          <input type="text" value={name} onChange={e => setName(e.target.value)} autoFocus placeholder="e.g. Research, Personal"
            onKeyDown={e => { if (e.key === "Enter") void submit(); }} />
        </label>
      </div>
    </Dialog>
  );
}
