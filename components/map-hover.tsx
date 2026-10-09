"use client";

import { createContext, useCallback, useContext, useSyncExternalStore } from "react";
import type { HoverStore } from "@/lib/map/hover";

const HoverContext = createContext<HoverStore | null>(null);
export const MapHoverProvider = HoverContext.Provider;
const serverSnapshot = () => null;

function useHoverStore() {
  const store = useContext(HoverContext);
  if (!store) throw new Error("Map hover requires its provider");
  return store;
}

export function useMapHover() {
  const store = useHoverStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, serverSnapshot);
}

export function useFolderHover(folder: string) {
  const store = useHoverStore();
  const snapshot = useCallback(() => store.getFolderSnapshot(folder), [store, folder]);
  return useSyncExternalStore(store.subscribe, snapshot, serverSnapshot);
}
