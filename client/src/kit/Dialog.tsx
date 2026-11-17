import type { ReactNode } from "react";
import { IconButton, Button } from "./Button.js";
import { Layer } from "./Layer.js";
import type { HelpKey } from "../help/entries.js";

/**
 * A box in the middle of the screen, over a backdrop. Two shapes: a titled sheet with a header
 * (close button) and footer, for reading and working; and a compact card — title, body, a row of
 * actions — for a question or a short form. `help` names what the help layer says of the whole.
 */
export function Dialog({ title, sub, label, onClose, className = "", width, compact = false, actions, headActions, foot, role = "dialog", help, children }: {
  title?: ReactNode;
  sub?: ReactNode;
  label?: string;
  onClose: () => void;
  className?: string;
  width?: number | string;
  /** The compact card: an h2, the body, and `actions` under it. */
  compact?: boolean;
  actions?: ReactNode;
  /** Controls in the header, before the close button. */
  headActions?: ReactNode;
  foot?: ReactNode;
  role?: "dialog" | "alertdialog";
  help?: HelpKey;
  children?: ReactNode;
}) {
  const name = label ?? (typeof title === "string" ? title : "Dialog");
  return (
    <Layer center role={role} label={name} onClose={onClose} className={`dialog ${compact ? "dialog-compact" : ""} ${className}`}
      style={width !== undefined ? { width } : undefined} helpArea={help}>
      {compact ? (
        <>
          {title && <h2 className="dialog-title">{title}</h2>}
          {sub && <p className="dialog-sub">{sub}</p>}
          {children}
          {actions && <div className="dialog-actions">{actions}</div>}
        </>
      ) : (
        <>
          {title && (
            <div className="dialog-head">
              <div>
                <h2 className="dialog-title">{title}</h2>
                {sub && <p className="dialog-sub">{sub}</p>}
              </div>
              <div className="dialog-head-actions">
                {headActions}
                <IconButton icon="close" label="Close" help="dl.close" onClick={onClose} />
              </div>
            </div>
          )}
          {children}
          {foot && <div className="dialog-foot">{foot}</div>}
        </>
      )}
    </Layer>
  );
}

/** A question before something that can't be undone. The answer that does it takes focus. */
export function Confirm({ title, body, confirmLabel, danger = true, onConfirm, onCancel, help }: {
  title: string; body: ReactNode; confirmLabel: string; danger?: boolean;
  onConfirm: () => void | Promise<void>; onCancel: () => void; help?: HelpKey;
}) {
  return (
    <Dialog compact role="alertdialog" title={title} onClose={onCancel}
      actions={<>
        <Button onClick={onCancel}>Cancel</Button>
        <Button data-autofocus kind={danger ? "danger" : "primary"} help={help} onClick={() => void onConfirm()}>{confirmLabel}</Button>
      </>}>
      <div className="dialog-text">{body}</div>
    </Dialog>
  );
}
