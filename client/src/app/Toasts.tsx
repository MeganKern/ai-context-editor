import { notices, useNotices } from "../session/notices.js";
import { Icon } from "../kit/Icon.js";
import { Button, IconButton } from "../kit/Button.js";

/** What the app says in passing: the server's last refusal, and a word about what just happened. */
export function Toasts() {
  const error = useNotices(s => s.error);
  const toast = useNotices(s => s.toast);
  return (
    <div className="toasts" aria-live="polite">
      {error && (
        <div className="toast toast-error" role="alert" data-help="dl.error">
          <Icon name="alert" />
          <span className="toast-text">{error}</span>
          <Button kind="ghost" size="sm" onClick={() => notices.dismiss("error")}>Dismiss</Button>
        </div>
      )}
      {toast && (
        <div className="toast" role="status" data-help="dl.toast">
          <span className="toast-text">{toast.text}</span>
          {toast.action && (
            <Button kind="ghost" size="sm" className="toast-action" onClick={() => { toast.action!(); notices.dismiss("toast"); }}>{toast.label ?? "Open"}</Button>
          )}
          <IconButton icon="close" label="Close" onClick={() => notices.dismiss("toast")} />
        </div>
      )}
    </div>
  );
}
