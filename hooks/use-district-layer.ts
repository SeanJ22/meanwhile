"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether the congressional district overlay is showing.
 *
 * A sibling of use-stored-zip.ts and deliberately the same shape: localStorage
 * is an external store, so it is read through useSyncExternalStore with the
 * server rendering `pending`. That distinction is what stops the layer from
 * flashing on — or off — for a returning reader between the server render and
 * hydration.
 *
 * Off by default. District boundaries are context, not the thing the reader
 * came for.
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
    // the overlay starts off, which is where it starts anyway.
    return null;
  }
}

function subscribe(onStoreChange: () => void) {
  listeners.add(onStoreChange);
  // Keeps two tabs in step.
  window.addEventListener("storage", onStoreChange);

  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

function getSnapshot(): DistrictLayerSnapshot {
  const raw = readRaw();

  if (raw !== cachedRaw || cachedSnapshot === PENDING) {
    cachedRaw = raw;
    cachedSnapshot = raw === "1" ? ON : OFF;
  }

  return cachedSnapshot;
}

function getServerSnapshot(): DistrictLayerSnapshot {
  return PENDING;
}

export function useDistrictLayer() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setEnabled = useCallback((next: boolean) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      // Not being able to remember is survivable; failing the toggle is not.
      // Publish the choice anyway so this session still works.
      cachedRaw = next ? "1" : "0";
      cachedSnapshot = next ? ON : OFF;
    }

    for (const listener of listeners) listener();
  }, []);

  return { ...snapshot, setEnabled };
}
