import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useModel } from "../../data/model.js";
import { setVisit, useRoute } from "../../session/route.js";
import { rows } from "../../session/rows.js";

const NEAR_BOTTOM_PX = 80;
const nearBottom = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;

/**
 * Where the conversation is scrolled: to the bottom as things arrive (while you're near it), to
 * the "new since" divider on arrival, to a card you asked for (a search hit, a notice), or with a
 * branch point kept where it was when you swapped branches. Where new results start is decided
 * here too, from the first snapshot of a thread: the first card whose run you hadn't seen.
 */
export function useConvoScroll() {
  const thread = useModel(s => s.thread);
  const live = useModel(s => s.live);
  const visit = useRoute(s => s.visit);

  const scrollRef = useRef<HTMLDivElement>(null);
  const prevLen = useRef(0);
  const prevId = useRef<string | undefined>(undefined);
  const stick = useRef(true);

  // Latched on the thread's first snapshot: later ones say "seen", and the divider would vanish.
  const newSinceId = useMemo(() => {
    if (!thread) return null;
    const unseen = new Set(thread.unseen_run_ids);
    const firstUnseen = thread.messages.findIndex(m => m.run && unseen.has(m.run.id));
    if (firstUnseen < 0) return null;
    // If no earlier reply was one you'd already seen, the whole thread is new to you — so the mark
    // belongs at the very top, keeping the first message in view rather than scrolled past.
    const sawEarlierReply = thread.messages.slice(0, firstUnseen).some(m => m.run && !unseen.has(m.run.id));
    return (sawEarlierReply ? thread.messages[firstUnseen] : thread.messages[0]).id;
  }, [thread?.thread.id]);

  // Before paint: a thread that replaces another is first seen where it should be, never where the last one was.
  useLayoutEffect(() => {
    const changed = thread?.thread.id !== prevId.current;
    const added = (thread?.messages.length ?? 0) > prevLen.current;
    prevLen.current = thread?.messages.length ?? 0;
    prevId.current = thread?.thread.id;
    if (!scrollRef.current || visit.focus || visit.anchor || !(changed || added)) return;
    const divider = changed && newSinceId ? document.getElementById("new-since") : null;
    if (divider) {
      divider.scrollIntoView({ block: "start" });
      stick.current = false;
    } else {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      stick.current = true;
    }
  }, [thread?.messages.length, thread?.thread.id]);

  useLayoutEffect(() => {
    if (!visit.anchor || !thread || !scrollRef.current) return;
    const el = scrollRef.current.querySelector<HTMLElement>(`[data-branch-point="${CSS.escape(visit.anchor.key)}"]`);
    if (el) {
      const box = scrollRef.current;
      box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - visit.anchor.top;
      stick.current = nearBottom(box);
    } else {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      stick.current = true;
    }
    setVisit({ anchor: null });
  }, [visit.anchor, thread]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [live]);

  useEffect(() => {
    if (!visit.focus || !thread) return;
    const target = thread.messages.find(m => m.id === visit.focus);
    if (target) {
      document.getElementById(`msg-${target.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      rows.flash(target.id);
    }
    setVisit({ focus: null });
  }, [visit.focus, thread?.messages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => { if (stick.current) el.scrollTop = el.scrollHeight; });
    ro.observe(el);
    return () => ro.disconnect();
  }, [thread?.thread.id]);

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => { stick.current = nearBottom(e.currentTarget); };

  return { scrollRef, onScroll, newSinceId };
}
