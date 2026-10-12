"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  commitStorageWrite,
  publishToListeners,
  subscribeToStorage,
} from "@/lib/state/subscribe-to-storage";

/**
 * Whether the district overlay is showing, read from localStorage through
 * useSyncExternalStore with the server rendering `pending`, so it never flashes
 * on hydration. On by default; only an explicit "0" turns it off.
 */

const STORAGE_KEY = "wtp.show_districts";

export type DistrictLayerSnapshot =
  | { restored: false; enabled: false }
  | { restored: true; enabled: boolean };

const PENDING: DistrictLayerSnapshot = Object.freeze({
  restored: false,
  enabled: false,
});

const ON: DistrictLayerSnapshot = Object.freeze({ restored: true, enabled: true });
const OFF: DistrictLayerSnapshot = Object.freeze({ restored: true, enabled: false });

const listeners = new Set<() => void>();

// useSyncExternalStore compares snapshots by identity and loops forever if a
// fresh object comes back every call, so the three snapshots above are frozen
// singletons and this caches which one the current raw value maps to.
let cachedRaw: string | null | undefined;
let cachedSnapshot: DistrictLayerSnapshot = PENDING;

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private mode or storage disabled. Forgetting the preference just means
    // the overlay starts on, which is where it starts anyway.
    return null;
  }
}

const subscribe = (onStoreChange: () => void) =>
  subscribeToStorage(listeners, onStoreChange);

function getSnapshot(): DistrictLayerSnapshot {
  const raw = readRaw();

  if (raw !== cachedRaw || cachedSnapshot === PENDING) {
    cachedRaw = raw;
    // Never-stored (null) defaults ON; only an explicit "0" turns it off.
    cachedSnapshot = raw === "0" ? OFF : ON;
  }

  return cachedSnapshot;
}

function getServerSnapshot(): DistrictLayerSnapshot {
  return PENDING;
}

export function useDistrictLayer() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setEnabled = useCallback((next: boolean) => {
    commitStorageWrite(
      () => window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0"),
      () => publishToListeners(listeners),
      () => {
        // Not being able to remember is survivable; failing the toggle is not.
        // Keep the choice for this session; the publish still runs.
        cachedRaw = next ? "1" : "0";
        cachedSnapshot = next ? ON : OFF;
      },
    );
  }, []);

  return { ...snapshot, setEnabled };
}
