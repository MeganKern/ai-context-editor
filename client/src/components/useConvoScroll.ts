import { useRef, useEffect } from "react";
import { useStore } from "../store.js";

export function useConvoScroll() {
  const thread = useStore(s => s.thread);
  const live = useStore(s => s.live);
  const ui = useStore(s => s.ui);
  const setUi = useStore(s => s.setUi);

  const scrollRef = useRef<HTMLDivElement>(null);
  const prevLen = useRef(0);
  const prevId = useRef<string | undefined>(undefined);
  const stick = useRef(true);

  const newSinceId = ui.visit.newSince && ui.visit.newSince.threadId === thread?.thread.id ? ui.visit.newSince.messageId : null;

  useEffect(() => {
    const changed = thread?.thread.id !== prevId.current;
    const added = (thread?.messages.length ?? 0) > prevLen.current;
    prevLen.current = thread?.messages.length ?? 0;
    prevId.current = thread?.thread.id;
    if (!scrollRef.current || ui.visit.focus || ui.visit.anchor || !(changed || added)) return;
    const divider = changed && newSinceId ? document.getElementById("new-since") : null;
    if (divider) {
      divider.scrollIntoView({ block: "start" });
      stick.current = false;
    } else {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      stick.current = true;
    }
  }, [thread?.messages.length, thread?.thread.id]);

  useEffect(() => {
    if (!ui.visit.anchor || !thread || !scrollRef.current) return;
    const el = scrollRef.current.querySelector<HTMLElement>(`[data-branch-point="${CSS.escape(ui.visit.anchor.key)}"]`);
    if (el) {
      const box = scrollRef.current;
      box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - ui.visit.anchor.top;
      stick.current = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    } else {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      stick.current = true;
    }
    setUi({ visit: { anchor: null } });
  }, [ui.visit.anchor, thread, setUi]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [live]);

  useEffect(() => {
    if (!ui.visit.focus || !thread) return;
    const target = thread.messages.find(m => m.id === ui.visit.focus);
    if (!target) { setUi({ visit: { focus: null } }); return; }
    const el = document.getElementById(`msg-${ui.visit.focus}`)
      ?? (target.summary_id ? document.getElementById(`summary-${target.summary_id}`) : null);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("is-flash");
      setTimeout(() => el.classList.remove("is-flash"), 1600);
    }
    setUi({ visit: { focus: null } });
  }, [ui.visit.focus, thread?.messages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => { if (stick.current) el.scrollTop = el.scrollHeight; });
    ro.observe(el);
    return () => ro.disconnect();
  }, [thread?.thread.id]);

  return { scrollRef, stick, newSinceId };
}
