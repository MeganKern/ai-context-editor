import { useRef } from "react";
import type { ThreadRow } from "../../../../shared/snapshot.js";
import { navigate } from "../../session/route.js";
import { Menu } from "../../kit/Menu.js";
import { IconButton } from "../../kit/Button.js";

/**
 * Where a branch was taken, under that card: "‹ 1/3 › name". The choices are the thread itself and
 * each branch taken at this card — threads of their own, so anything in them may have been edited
 * since. Swapping opens the other one with this point where it was on screen.
 * `pointKey` is the card's id in the thread the branches were taken from (the same in every one of them).
 */
export function BranchPoint({ choices, current, pointKey }: { choices: ThreadRow[]; current: string; pointKey: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const idx = Math.max(0, choices.findIndex(c => c.id === current));
  const go = (id: string) => {
    if (id === current) return;
    const el = ref.current;
    const convo = el?.closest(".convo");
    const top = el && convo ? el.getBoundingClientRect().top - convo.getBoundingClientRect().top : 120;
    navigate({ threadId: id, visit: { anchor: { key: pointKey, top } } });
  };
  const n = choices.length;
  return (
    <div className="branch-point" ref={ref} data-branch-point={pointKey} data-help="msg.branch-point">
      <div className="branch-switch" role="group" aria-label="Branches from here">
        <IconButton icon="chevronLeft" label="Previous branch" className="branch-step" help="msg.branch-point" disabled={idx === 0} onClick={() => go(choices[idx - 1].id)} />
        <Menu label={`Branch ${idx + 1} of ${n} — all of them`} className="branch-label" icon={null} align="start" help="msg.branch-point"
          text={<>{`${idx + 1}/${n}`}<span className="branch-name">{choices[idx].name}</span></>}
          title="Threads branched at this card — each is a thread of its own"
          items={[{ heading: "Branched at this card" }, ...choices.map(c => ({ label: c.name, checked: c.id === current, help: "msg.branch-point" as const, onSelect: () => go(c.id) }))]} />
        <IconButton icon="chevronRight" label="Next branch" className="branch-step" help="msg.branch-point" disabled={idx === n - 1} onClick={() => go(choices[idx + 1].id)} />
      </div>
    </div>
  );
}
