"use client";

import { useCallback, useSyncExternalStore } from "react";

import { recordRecentZip } from "@/hooks/use-recent-zips";
import { lookupZcta } from "@/lib/geo/zcta";
import { subscribeToStorage } from "@/lib/state/subscribe-to-storage";

/**
 * The zip the reader is currently looking at.
 *
 * Stored as `approximate_location` — orientation, not identity, and never
 * treated as district truth.
 *
 * **It is SESSION-scoped as of 2026-08-15 (6f, the author's ruling): "fresh
 * open prompts for zip. Reopening the app does NOT restore the last map
 * position/zip — it asks where you are."** So this lives in `sessionStorage`,
 * which dies with the tab, rather than in `localStorage`, which does not. Two
 * things follow, and both are the point:
 *
 * - A returning reader is ASKED where they are instead of being dropped into
 *   an answer about somewhere they were last week. A stale location is the one
 *   kind of wrong answer this product cannot notice on its own — every number
 *   under it is correct for a place the reader is not.
 * - Less about a reader survives on their device, not more. The only thing
 *   that outlives the tab is the recents list
 *   (`hooks/use-recent-zips.ts`), which exists so the re-ask costs one tap.
 *   Picks and device-local reactions are untouched: they are the reader's own
 *   work and were never location.
 *
 * `sessionStorage` is an external store, so it is read through
 * `useSyncExternalStore`: the server renders `pending`, and the first client
 * pass resolves it. That distinction is what keeps the entry prompt from
 * flashing past a reader mid-session before their zip loads.
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
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    // Private mode or storage disabled. A forgotten zip just means the entry
    // notice shows — which is now the default anyway.
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


/*
 * `sessionStorage` itself is per-tab, so the cross-tab `storage` event this
 * shares only ever fires for the localStorage half (the recents write).
 */
const subscribe = (onStoreChange: () => void) =>
  subscribeToStorage(listeners, onStoreChange);

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
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Not being able to remember is survivable; failing the search is not.
      // Publish the choice anyway so this session still works.
      cachedRaw = JSON.stringify(payload);
      cachedSnapshot = { restored: true, location: next };
    }

    // The one thing that outlives the tab (item 3), so the next open is a tap
    // rather than eleven. Written here so every path that sets a location —
    // the welcome card, the switcher, Near me — records it without having to
    // remember to.
    recordRecentZip(next.zip);

    for (const listener of listeners) listener();
  }, []);

  return { ...snapshot, remember };
}
