import { createContext, useContext } from "react";
import type { FolderRow, ThreadSnapshot } from "../../../../shared/snapshot.js";

/** What every row of the library panel shares: the thread beside it, the folders, and how to reorder. */
export interface LibraryScope {
  thread: ThreadSnapshot | null;
  folders: FolderRow[];
  reorder: (noteId: string, delta: -1 | 1) => void;
}

export const LibraryScopeContext = createContext<LibraryScope | null>(null);
export function useLibraryScope(): LibraryScope {
  const scope = useContext(LibraryScopeContext);
  if (!scope) throw new Error("LibraryScope missing");
  return scope;
}
