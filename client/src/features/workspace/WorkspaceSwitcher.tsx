import { useModel } from "../../data/model.js";
import { navigate } from "../../session/route.js";
import { activity } from "../../session/activity.js";
import { homePath } from "../../derive/text.js";
import { Icon } from "../../kit/Icon.js";
import { Menu } from "../../kit/Menu.js";

/** The open workspace's name, and the others to switch to. */
export function WorkspaceSwitcher() {
  const app = useModel(s => s.app);
  const ws = useModel(s => s.ws);
  if (!app || !ws) return null;
  const others = app.workspaces.filter(w => w.id !== ws.workspace.id);
  return (
    <Menu
      label="Switch workspace" className="ws-switch" align="start" icon={null} help="sb.workspace"
      text={<><span className="ws-name">{ws.workspace.name}</span><Icon name="chevronDown" /></>}
      title={`Agents in this workspace start in ${homePath(ws.workspace.path)}`}
      items={[
        ...others.map(w => ({ label: w.name, icon: "workspace" as const, help: "ws.item" as const, onSelect: () => navigate({ wsId: w.id }) })),
        ...(others.length ? [{ separator: true as const }] : []),
        { label: "New workspace…", icon: "plus" as const, help: "create_workspace" as const, onSelect: () => activity.open({ kind: "new-workspace" }) },
      ]}
    />
  );
}
