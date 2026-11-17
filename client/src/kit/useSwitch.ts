import { useEffect, useState } from "react";

/**
 * A switch answers at once: what you set shows until the server's copy changes (it then agrees),
 * or for a few seconds if it never does. A refusal (the action yields null) puts it back.
 */
export function useSwitch(server: boolean, send: (on: boolean) => Promise<unknown>): [boolean, () => void] {
  const [local, setLocal] = useState<{ on: boolean; from: boolean } | null>(null);
  useEffect(() => {
    if (!local) return;
    const t = setTimeout(() => setLocal(null), 4000);
    return () => clearTimeout(t);
  }, [local]);
  const on = local && local.from === server ? local.on : server;
  return [on, () => {
    const mine = { on: !on, from: server };
    setLocal(mine);
    void send(!on).then(r => { if (r === null || r === false) setLocal(cur => (cur === mine ? null : cur)); });
  }];
}
