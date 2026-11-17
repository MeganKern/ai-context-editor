import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon.js";
import type { HelpKey } from "../help/entries.js";

/**
 * The buttons. `help` names what the help layer explains for the control — the action it runs
 * (shared/behaviour.ts) or a thing on the screen (help/entries.ts). A commit button (primary,
 * agent) only takes its colour once there's something to commit — that's in the stylesheet, from
 * `disabled`.
 */
type Base = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & { help?: HelpKey; type?: "button" | "submit" };

export const Button = forwardRef<HTMLButtonElement, Base & {
  kind?: "default" | "primary" | "ghost" | "danger" | "agent" | "quiet";
  size?: "md" | "sm" | "xs" | "lg";
  block?: boolean;
  icon?: IconName;
  children?: ReactNode;
}>(function Button({ kind = "default", size = "md", block, icon, help, className = "", type = "button", children, ...rest }, ref) {
  const kindClass = kind === "default" ? "" : kind === "agent" ? "btn-agent-primary" : `btn-${kind}`;
  const sizeClass = size === "md" ? "" : `btn-${size}`;
  return (
    <button ref={ref} type={type} className={`btn ${kindClass} ${sizeClass} ${block ? "btn-block" : ""} ${className}`} data-help={help} {...rest}>
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
});

/** A square button that is only an icon; its name is spoken, and shown on hover. */
export function IconButton({ icon, label, help, className = "", title, ...rest }: Base & { icon: IconName; label: string }) {
  return (
    <button type="button" className={`icon-btn ${className}`} aria-label={label} title={title ?? label} data-help={help} {...rest}>
      <Icon name={icon} />
    </button>
  );
}

/** A small text action on a card or a row ("Edit", "Exclude"): quiet until pointed at. */
export function Act({ icon, help, danger, className = "", children, ...rest }: Base & { icon?: IconName; danger?: boolean; children?: ReactNode }) {
  return (
    <button type="button" className={`act ${danger ? "is-danger" : ""} ${className}`} data-help={help} {...rest}>
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}
