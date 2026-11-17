import { Fragment, useEffect, useMemo, useState } from "react";
import type { SearchPlace } from "../../../../shared/snapshot.js";
import { read } from "../../data/api.js";
import { useModel } from "../../data/model.js";
import { useResource } from "../../data/resources.js";
import { navigate } from "../../session/route.js";
import { threadTree } from "../../derive/threads.js";
import { plain } from "../../derive/text.js";
import { Marked } from "../../kit/Marked.js";
import { ThreadRowView } from "./ThreadTree.js";

/** The search box's answer: threads whose names match, and every card whose text does. */
export function SearchResults({ query }: { query: string }) {
  const ws = useModel(s => s.ws)!;
  const tree = useMemo(() => threadTree(ws), [ws]);
  const [settled, setSettled] = useState(query);
  useEffect(() => { const t = setTimeout(() => setSettled(query), 250); return () => clearTimeout(t); }, [query]);
  const { data: hits } = useResource(settled ? `search:${ws.workspace.id}:${settled}` : null, () => read.search(ws.workspace.id, settled));
  const needle = query.toLowerCase();
  const nameMatches = ws.threads.filter(t => t.name.toLowerCase().includes(needle));
  const open = (p: { thread_id: string; message_id: string }) => navigate({ threadId: p.thread_id, visit: { focus: p.message_id } });

  return (
    <div className="search-results">
      <div className="sb-label">Thread names</div>
      {nameMatches.length === 0 && <div className="sb-empty">No thread names match</div>}
      {nameMatches.map(t => <ThreadRowView key={t.id} t={t} tree={tree} nested={false} depth={0} active={false} />)}
      <div className="sb-label">In messages</div>
      {!hits && <div className="sb-empty">Searching…</div>}
      {hits?.length === 0 && <div className="sb-empty">No messages match</div>}
      {hits?.map(hit => (
        <div key={hit.message_id} className="search-hit-group">
          <button className="search-hit" data-help="sb.search-hit" onClick={() => open(hit)}>
            <span className="search-hit-thread">
              {hit.thread_name}
              {hit.template_name && <span className="search-hit-tpl"> · run of {hit.template_name}</span>}
            </span>
            <span className="search-hit-snippet"><Marked text={plain(hit.snippet)} /></span>
          </button>
          {hit.also_in.length > 0 && <AlsoIn places={hit.also_in} onOpen={open} />}
        </div>
      ))}
    </div>
  );
}

/** The other threads a found text is in (its copies in branches, mostly), each one click away. */
function AlsoIn({ places, onOpen }: { places: SearchPlace[]; onOpen: (p: SearchPlace) => void }) {
  const [all, setAll] = useState(false);
  const SHOWN = 5;
  const shown = all ? places : places.slice(0, SHOWN);
  return (
    <div className="search-hit-also">
      <span>Also in </span>
      {shown.map((p, i) => (
        <Fragment key={p.message_id}>
          {i > 0 && ", "}
          <button className="search-hit-also-link" data-help="sb.search-hit" onClick={() => onOpen(p)}
            title={p.template_name ? `${p.thread_name} · run of ${p.template_name}` : p.thread_name}>{p.thread_name}</button>
        </Fragment>
      ))}
      {!all && places.length > SHOWN && <>, <button className="search-hit-also-link" onClick={() => setAll(true)}>{places.length - SHOWN} more</button></>}
    </div>
  );
}
