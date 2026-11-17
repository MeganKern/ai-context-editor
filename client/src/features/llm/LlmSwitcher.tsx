import { useModel } from "../../data/model.js";
import { activity } from "../../session/activity.js";
import { Menu, type MenuItem } from "../../kit/Menu.js";
import { setLlm } from "./ops.js";

/**
 * The provider every reply goes to, and the others to switch to. A provider that needs nothing
 * from you switches at once; the rest open their setup. The one in use opens its setup too, to
 * change the model.
 */
export function LlmSwitcher() {
  const app = useModel(s => s.app);
  if (!app?.llm) return null;
  const { llm, catalog } = app;
  const builtIn = catalog.filter(p => p.id !== "custom");

  const choose = (providerId: string) => {
    const p = catalog.find(x => x.id === providerId)!;
    const current = llm.provider === providerId;
    if (!current && p.default_model && !p.needs_key) { void setLlm(providerId, p.default_model); return; }
    activity.open({ kind: "llm-setup", target: { provider: providerId } });
  };

  const items: MenuItem[] = [
    ...builtIn.map((p): MenuItem => ({
      label: p.label, checked: llm.provider === p.id, help: "set_llm",
      onSelect: () => choose(p.id),
      trailing: p.about ? { icon: "info", label: `About ${p.label}`, help: "llm.about", onClick: () => activity.open({ kind: "provider-about", providerId: p.id }) } : undefined,
    })),
    ...(llm.connections.length ? [{ separator: true as const }] : []),
    ...llm.connections.map((c): MenuItem => ({
      label: c.name, checked: llm.provider === "custom" && llm.connection_id === c.id, help: "set_llm",
      onSelect: () => activity.open({ kind: "llm-setup", target: { connection: c.id } }),
    })),
    { separator: true },
    { label: "New connection…", icon: "plus", help: "add_connection", onSelect: () => activity.open({ kind: "llm-setup", target: "new" }) },
  ];

  return <Menu label="Select provider" className="sb-provider" align="start" icon={null} matchWidth text={<span>Model provider</span>} items={items} help="sb.provider" />;
}
