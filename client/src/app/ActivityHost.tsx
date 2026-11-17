import { activity, useActivity } from "../session/activity.js";
import { useModel } from "../data/model.js";
import { Confirm } from "../kit/Dialog.js";
import { Inspector } from "../features/inspector/Inspector.js";
import { FullEditor } from "../features/library/FullEditor.js";
import { VersionMap } from "../features/library/VersionMap.js";
import { AddItem } from "../features/library/AddItem.js";
import { NoteView } from "../features/conversation/NoteView.js";
import { BranchesDialog } from "../features/conversation/BranchesDialog.js";
import { LlmSetup } from "../features/llm/LlmSetup.js";
import { ProviderAbout } from "../features/llm/ProviderAbout.js";
import { NewWorkspace } from "../features/workspace/NewWorkspace.js";

/** The one place anything over the page is mounted: the open activity, and a confirmation over it. */
export function ActivityHost() {
  const current = useActivity(s => s.current);
  const confirm = useActivity(s => s.confirm);
  const hasThread = useModel(s => !!s.thread);
  return (
    <>
      {current?.kind === "inspector" && hasThread && <Inspector />}
      {current?.kind === "note-editor" && <FullEditor key={current.noteId} noteId={current.noteId} />}
      {current?.kind === "new-note" && <FullEditor key="new" noteId={null} />}
      {current?.kind === "note-view" && <NoteView key={current.noteId} noteId={current.noteId} />}
      {current?.kind === "version-map" && <VersionMap key={current.noteId} noteId={current.noteId} />}
      {current?.kind === "add-item" && <AddItem />}
      {current?.kind === "branches" && hasThread && <BranchesDialog />}
      {current?.kind === "llm-setup" && <LlmSetup key={JSON.stringify(current.target)} target={current.target} />}
      {current?.kind === "provider-about" && <ProviderAbout providerId={current.providerId} />}
      {current?.kind === "new-workspace" && <NewWorkspace />}
      {confirm && (
        <Confirm title={confirm.title} body={confirm.body} confirmLabel={confirm.confirmLabel} danger={confirm.danger}
          onConfirm={confirm.onConfirm} onCancel={() => activity.closeConfirm()} />
      )}
    </>
  );
}
