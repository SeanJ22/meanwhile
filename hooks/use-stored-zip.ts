"use client";

import { useCallback, useSyncExternalStore } from "react";

import { lookupZcta } from "@/lib/geo/zcta";

/**
 * The remembered zip.
 *
 * Stored as `approximate_location` — orientation, not identity, and never
 * treated as district truth. It lives in localStorage rather than on an account
 * because the entry screen has no accounts and does not need one.
 *
 * localStorage is an external store, so it is read through
 * useSyncExternalStore: the server renders `pending`, and the first client pass
 * resolves it. That distinction is what keeps the entry notice from flashing at
 * a returning reader before their zip loads.
 */

const STORAGE_KEY = "wtp.approximate_location";

export interface StoredLocation {
  zip: string;
  lat: number;
  lng: number;
}

interface StoredPayload {
  zip: string;
  savedAt: string;
}

export type LocationSnapshot =
  | { restored: false; location: null }
  | { restored: true; location: StoredLocation | null };

const PENDING: LocationSnapshot = Object.freeze({
  restored: false,
  location: null,
});

const listeners = new Set<() => void>();

// useSyncExternalStore compares snapshots by identity and will loop forever if
// a fresh object comes back every call. Cache against the raw stored string.
let cachedRaw: string | null | undefined;
let cachedSnapshot: LocationSnapshot = PENDING;

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private mode or storage disabled. A forgotten zip just means the entry
    // notice shows.
    return null;
  }
}

function parse(raw: string | null): StoredLocation | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<StoredPayload>;
    // Re-resolve rather than trusting stored coordinates: a Census vintage
    // update moves centroids, and the zip is the only durable part.
    return parsed.zip ? lookupZcta(parsed.zip) : null;
  } catch {
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

function getSnapshot(): LocationSnapshot {
  const raw = readRaw();

  if (raw !== cachedRaw || cachedSnapshot === PENDING) {
    cachedRaw = raw;
    cachedSnapshot = { restored: true, location: parse(raw) };
  }

  return cachedSnapshot;
}

function getServerSnapshot(): LocationSnapshot {
  return PENDING;
}

export function useStoredZip() {
  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const remember = useCallback((next: StoredLocation) => {
    const payload: StoredPayload = {
      zip: next.zip,
      savedAt: new Date().toISOString(),
    };

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Not being able to remember is survivable; failing the search is not.
      // Publish the choice anyway so this session still works.
      cachedRaw = JSON.stringify(payload);
      cachedSnapshot = { restored: true, location: next };
    }

    for (const listener of listeners) listener();
  }, []);

  return { ...snapshot, remember };
}
