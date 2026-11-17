import { layout } from "../session/layout.js";
import { Button, IconButton } from "../kit/Button.js";
import type { IconName } from "../kit/Icon.js";

/**
 * On a narrow screen the side columns are drawers, and this bar at the top of the middle opens
 * them: the thread list on the left (under 760px), the panel beside the thread on the right (under
 * 1180px). Wider than that it isn't shown — both columns are already there.
 */
export function NarrowBar({ panel, icon }: { panel: string; icon: IconName }) {
  return (
    <header className="narrow-bar">
      <IconButton icon="menu" label="Show threads" title="Threads" className="nav-toggle" help="nb.threads" onClick={() => layout.sidebarDrawer(true)} />
      <span className="spacer" />
      <Button size="sm" icon={icon} title={panel} help="nb.panel" onClick={() => layout.panelDrawer(true)}>
        <span className="panel-toggle-label">{panel}</span>
      </Button>
    </header>
  );
}
