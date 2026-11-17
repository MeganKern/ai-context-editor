import { threadPending, useModel } from "../../data/model.js";
import { layout, useLayout } from "../../session/layout.js";
import { LibraryPanel } from "../library/LibraryPanel.js";
import { RunPanel } from "./RunPanel.js";

/** Beside a template the panel is one of two things — the run controls, or the library — and the switch at its top says which. */
export function TemplatePanel() {
  const view = useLayout(s => s.templateView);
  const pending = useModel(threadPending);
  return (
    <div className={`panel-body panel-template ${pending ? "is-pending" : ""}`} inert={pending} aria-busy={pending || undefined}>
      <div className="panel-switch">
        <div className="seg is-block" role="tablist" aria-label="Beside the template" data-help="panel.switch">
          <button type="button" role="tab" aria-selected={view === "run"} className={`seg-opt ${view === "run" ? "is-on" : ""}`} onClick={() => layout.templateView("run")}>Run this template</button>
          <button type="button" role="tab" aria-selected={view === "library"} className={`seg-opt ${view === "library" ? "is-on" : ""}`} onClick={() => layout.templateView("library")}>Library</button>
        </div>
      </div>
      {view === "run"
        ? <div className="panel-scroll"><RunPanel /></div>
        : <div className="panel-fill"><LibraryPanel /></div>}
    </div>
  );
}
