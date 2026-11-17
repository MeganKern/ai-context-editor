import { create } from "zustand";

/**
 * The library panel's passing state: a combined item being written or waiting for your word (it
 * stays while you look elsewhere), and an order you just set, shown until the server's copy
 * agrees (or a few seconds pass).
 */
interface LibraryState {
  review: { noteId: string; runId: string } | null;
  pendingOrder: string[] | null;
}

export const useLibrary = create<LibraryState>(() => ({ review: null, pendingOrder: null }));

let orderTimer: ReturnType<typeof setTimeout> | null = null;
export const library = {
  review(r: { noteId: string; runId: string } | null): void { useLibrary.setState({ review: r }); },
  pendingOrder(order: string[] | null): void {
    useLibrary.setState({ pendingOrder: order });
    if (orderTimer) clearTimeout(orderTimer);
    if (order) orderTimer = setTimeout(() => useLibrary.setState({ pendingOrder: null }), 4000);
  },
};
