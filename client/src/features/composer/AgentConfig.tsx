import { useEffect, useRef, useState } from "react";
import { AGENT_PERMISSIONS, AGENT_PERMISSION_LABELS, permissionArgs } from "../../../../shared/agent.js";
import { run, useModel } from "../../data/model.js";
import { composer, useComposer } from "../../session/composer.js";
import { MOD } from "../../derive/text.js";
import { Icon } from "../../kit/Icon.js";
import { Button } from "../../kit/Button.js";
import { Dial } from "../../kit/Fields.js";

/**
 * The agent's permission level and standing instructions, and its start button. What's shown is
 * the workspace's default unless you've changed it here; a change can be saved as the new default.
 */
export function AgentConfig({ onStart, disabled }: { onStart: () => void; disabled: boolean }) {
  const ws = useModel(s => s.ws)!;
  const continueId = useComposer(s => s.continueCardId);
  const agent = useComposer(s => s.agent);
  const defaults = ws.agent_defaults;
  const permission = agent.permission ?? defaults.permission;
  const standing = agent.standingInstructions ?? defaults.standing_instructions;
  const edited = agent.standingInstructions !== null && agent.standingInstructions !== defaults.standing_instructions;
  const permChanged = agent.permission !== null && agent.permission !== defaults.permission;
  const [showStanding, setShowStanding] = useState(false);
  const [showCli, setShowCli] = useState(false);
  const standingRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = standingRef.current;
    if (showStanding && el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  }, [showStanding]);

  const saveDefaults = async () => {
    if (await run("set_agent_defaults", { workspace_id: ws.workspace.id, standing_instructions: standing, permission })) composer.clearOverrides();
  };

  return (
    <div className="agent-config" data-help-area="cb.agent-area">
      <div className="agent-config-row">
        <Button kind="ghost" size="sm" help="cb.standing" onClick={() => setShowStanding(s => !s)}>Standing instructions</Button>
        <span className="spacer" />
        <div className="agent-config-perm-group">
          <div className="agent-config-perm-head">
            <Dial className="agent-config-perm" label="Permissions" value={permission} help="cb.agent-perm"
              options={AGENT_PERMISSIONS.map(p => ({ value: p, label: AGENT_PERMISSION_LABELS[p] }))}
              onChange={p => composer.patchAgent({ permission: p })} />
            <button type="button" className={`agent-config-detail-toggle ${showCli ? "is-open" : ""}`} onClick={() => setShowCli(s => !s)} data-help="cb.agent-cli"
              aria-label="Show the exact command" title={showCli ? "Hide the exact command" : "Show the exact command"}><Icon name="chevronDown" /></button>
          </div>
          {showCli && <div className="agent-config-cli"><code className="agent-config-flag">{permissionArgs(permission).join(" ")}</code></div>}
        </div>
        <Button kind="agent" className="btn-send" icon="play" help={continueId ? "agent_follow_up" : "dispatch_agent"} disabled={disabled} onClick={onStart}>
          {continueId ? "Send to agent" : "Start agent"} <kbd>{MOD} ⏎</kbd>
        </Button>
      </div>
      {showStanding && (
        <div className="agent-config-standing">
          <textarea ref={standingRef} className="field-grow is-body" value={standing} rows={5} aria-label="Standing instructions"
            onChange={e => composer.patchAgent({ standingInstructions: e.target.value })} />
          <div className="inline-form-actions is-under is-end">
            {edited && <Button kind="ghost" size="sm" onClick={() => composer.patchAgent({ standingInstructions: null })}>Reset</Button>}
            {(edited || permChanged) && (
              <Button kind="primary" size="sm" help="set_agent_defaults" onClick={() => void saveDefaults()}
                title="Save these standing instructions and this permission level as the workspace's defaults">Save as new default</Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
