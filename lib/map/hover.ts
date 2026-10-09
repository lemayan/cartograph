import type { MapSelection } from "./scene";
import type { FoldedFolder } from "./folding";

interface FrameScheduler {
  request: (callback: () => void) => number;
  cancel: (frame: number) => void;
}

function sameTarget(a: MapSelection | null, b: MapSelection | null): boolean {
  return a === b || (a !== null && b !== null && a.type === b.type && a.path === b.path);
}

/** Stable per-folder snapshots keep unrelated canvas nodes out of hover renders. */
export function createHoverStore(folders: readonly FoldedFolder[]) {
  const owners = new Map(folders.flatMap((folder) => folder.files.map((file) => [file.path, folder.path] as const)));
  const paths = new Set(folders.map((folder) => folder.path));
  const listeners = new Set<() => void>();
  let current: MapSelection | null = null;
  let owner: string | null = null;
  return {
    getSnapshot: () => current,
    getFolderSnapshot: (folder: string) => owner === folder ? current : null,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set: (target: MapSelection | null) => {
      if (sameTarget(current, target)) return;
      const nextOwner = target === null ? null : target.type === "file" ? owners.get(target.path)
        : paths.has(target.path) ? target.path : undefined;
      if (nextOwner === undefined) throw new Error(`Cannot hover absent ${target?.type}: ${target?.path}`);
      current = target;
      owner = nextOwner;
      for (const listener of listeners) listener();
    },
  };
}

export type HoverStore = ReturnType<typeof createHoverStore>;

/** Commit the final event in a frame, never a row's intermediate folder/clear. */
export function createHoverController(commit: (target: MapSelection | null) => void, frames: FrameScheduler) {
  let current: MapSelection | null = null;
  let pending: MapSelection | null = null;
  let frame: number | null = null;

  function cancel() {
    if (frame !== null) frames.cancel(frame);
    frame = null;
    pending = current;
  }

  function queue(target: MapSelection | null) {
    pending = target;
    if (sameTarget(current, target)) {
      cancel();
      return;
    }
    if (frame !== null) return;
    frame = frames.request(() => {
      frame = null;
      if (sameTarget(current, pending)) return;
      current = pending;
      commit(current);
    });
  }

  return { queue, cancel };
}
