/**
 * Small stroke icon set (16px grid). Icons always travel with a visible label or an
 * aria-label; they speed up recognition, they never replace words.
 */
const PATHS: Record<string, string> = {
  plus: "M8 3v10M3 8h10",
  search: "M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10zM14 14l-3.5-3.5",
  chevronLeft: "M10 3L5 8l5 5",
  chevronRight: "M6 3l5 5-5 5",
  chevronDown: "M3 6l5 5 5-5",
  more: "M3.5 8h.01M8 8h.01M12.5 8h.01",
  copy: "M5.5 5.5V3.5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M3.5 5.5h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1z",
  regenerate: "M13 3.5v3h-3M3 12.5v-3h3M12.6 6.5A5 5 0 0 0 3.8 5M3.4 9.5a5 5 0 0 0 8.8 1.5",
  edit: "M10.5 3l2.5 2.5L6 12.5H3.5V10L10.5 3z",
  eyeOff: "M2 2l12 12M6.6 6.6a2 2 0 0 0 2.8 2.8M4.2 4.3C2.9 5.2 2 6.5 1.5 8c1 2.9 3.6 5 6.5 5 1.3 0 2.5-.4 3.6-1.1M7 3.1C7.3 3 7.7 3 8 3c2.9 0 5.5 2.1 6.5 5-.3.9-.8 1.7-1.4 2.4",
  eye: "M1.5 8C2.5 5.1 5.1 3 8 3s5.5 2.1 6.5 5c-1 2.9-3.6 5-6.5 5S2.5 10.9 1.5 8zM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  pin: "M6 2.5h4M7 2.5v4l-2.5 2.5h7L9 6.5v-4M8 9v4.5",
  trash: "M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8.5h6l.5-8.5",
  folder: "M2 4.5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4.5z",
  note: "M4 2.5h5.5L12.5 5.5V13a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5zM9 2.5v3.5h3.5M5.5 8.5h5M5.5 11h3.5",
  agent: "M2.5 3.5h11v9h-11zM5 7l2 1.5L5 10M8.5 10.5h2.5",
  template: "M3 3h10v3H3zM3 8h4.5v5H3zM9.5 8H13v5H9.5z",
  panel: "M2.5 3.5h11v9h-11zM10 3.5v9",
  close: "M4 4l8 8M12 4l-8 8",
  stop: "M4.5 4.5h7v7h-7z",
  send: "M8 13V3M3.5 7.5L8 3l4.5 4.5",
  check: "M3 8.5l3 3 7-7",
  nest: "M5 3v4.5A1.5 1.5 0 0 0 6.5 9H12",
  insert: "M3 8h10M8 3v10",
  collapse: "M4 2.5l4 3.5 4-3.5M4 13.5l4-3.5 4 3.5",
  expand: "M4 6l4-3.5 4 3.5M4 10l4 3.5 4-3.5",
  menu: "M2.5 4h11M2.5 8h11M2.5 12h11",
  code: "M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5",
  paperclip: "M12.5 7.5l-4.6 4.6a2.8 2.8 0 0 1-4-4L8.6 3.4a1.9 1.9 0 0 1 2.7 2.7L6.6 10.8a.9.9 0 0 1-1.3-1.3L9.6 5.2",
  alert: "M8 2.5l6 10.5H2L8 2.5zM8 6.5v3M8 11.3v.01",
  play: "M5 3.5v9l7-4.5-7-4.5z",
  summary: "M3 4h10M3 7h10M3 10h6M3 13h4",
  arrowDown: "M8 3v10M4 9l4 4 4-4",
  arrowUp: "M8 13V3M4 7l4-4 4 4",
  chevronUp: "M3 10l5-5 5 5",
  external: "M9 3h4v4M13 3L7.5 8.5M11 9.5V13H3V5h3.5",
  workspace: "M2.5 4.5h11v8h-11zM5.5 4.5V3h5v1.5",
  grip: "M6 4h.01M10 4h.01M6 8h.01M10 8h.01M6 12h.01M10 12h.01",
  dot: "M8 8h.01",
  // A clock face with its hand turned back: earlier texts.
  history: "M2.8 8a5.2 5.2 0 1 0 1.5-3.7M2.5 2.8v2.5H5M8 5.2V8l2 1.5",
  merge: "M4 3v4l4 4M12 3v4l-4 4M8 11v2",
  gear: "M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM13.5 8c0-.3-.2-.6-.5-.7l-1-.5-.2-1 .5-1c.2-.3.1-.6-.1-.8l-.7-.7c-.2-.2-.5-.3-.8-.1l-1 .5-1-.2-.5-1c-.1-.3-.4-.5-.7-.5h-1c-.3 0-.6.2-.7.5l-.5 1-1 .2-1-.5c-.3-.2-.6-.1-.8.1l-.7.7c-.2.2-.3.5-.1.8l.5 1-.2 1-1 .5c-.3.1-.5.4-.5.7v1c0 .3.2.6.5.7l1 .5.2 1-.5 1c-.2.3-.1.6.1.8l.7.7c.2.2.5.3.8.1l1-.5 1 .2.5 1c.1.3.4.5.7.5h1c.3 0 .6-.2.7-.5l.5-1 1-.2 1 .5c.3.2.6.1.8-.1l.7-.7c.2-.2.3-.5.1-.8l-.5-1 .2-1 1-.5c.3-.1.5-.4.5-.7v-1z",
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={`icon ${className ?? ""}`}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === "more" || name === "dot" || name === "grip" ? 2.4 : 1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
