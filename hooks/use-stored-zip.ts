"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

import { recordRecentZip } from "@/hooks/use-recent-zips";
import { lookupIn, type CentroidTable, type ZctaCentroid } from "@/lib/geo/zcta-core";
import { postalAreaIn, type PostalTable } from "@/lib/geo/postal-core";
import { loadZctaTable } from "@/lib/geo/zcta-table";
import {
  commitStorageWrite,
  publishToListeners,
  subscribeToStorage,
} from "@/lib/state/subscribe-to-storage";

/**
 * The zip the reader is looking at, remembered in `localStorage` as
 * `approximate_location`: orientation, never district truth. A link's `?zip=`
 * wins over what is stored. Read through `useSyncExternalStore` with the
 * server rendering `pending`, so the entry prompt never flashes past a
 * returning reader.
 */

const STORAGE_KEY = "wtp.approximate_location";

export type StoredLocation = ZctaCentroid;

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

export function readZipChoice(): string | null {
  const linkZip = new URLSearchParams(window.location.search).get("zip");
  // A link names the place to open, even in a tab with a previous selection.
  if (linkZip !== null) return JSON.stringify({ zip: linkZip });
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private mode or storage disabled: the entry notice shows.
    return null;
  }
}

/**
 * The centroid table loads asynchronously to keep it out of the initial
 * bundle. Until it arrives the snapshot is `PENDING` (`restored: false`), the
 * same state as before hydration. The stored payload holds only the zip.
 */
let centroids: CentroidTable | null = null;
let postal: PostalTable = {};
let tableRequested = false;

function ensureTable(): void {
  if (tableRequested) return;
  tableRequested = true;
  void loadZctaTable().then((table) => {
    centroids = table.centroids;
    postal = table.postal;
    // Invalidate the identity cache and republish so subscribers move from PENDING.
    cachedRaw = undefined;
    cachedSnapshot = PENDING;
    publishToListeners(listeners);
  });
}

export function resolveStoredZip(table: CentroidTable, raw: string | null, postal: PostalTable = {}): StoredLocation | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<StoredPayload>;
    // Re-resolve rather than trusting stored coordinates: a Census vintage
    // update moves centroids, and the zip is the only durable part.
    return typeof parsed.zip === "string" && /^\d{5}$/.test(parsed.zip) ? lookupIn(table, parsed.zip, postal) : null;
  } catch {
    return null;
  }
}


const subscribe = (onStoreChange: () => void) => {
  const unsubscribe = subscribeToStorage(listeners, onStoreChange);
  window.addEventListener("popstate", onStoreChange);
  return () => {
    unsubscribe();
    window.removeEventListener("popstate", onStoreChange);
  };
};

function getSnapshot(): LocationSnapshot {
  ensureTable();

  // Nothing is restored before the table that resolves it is here.
  if (!centroids) return PENDING;

  const raw = readZipChoice();

  if (raw !== cachedRaw || cachedSnapshot === PENDING) {
    cachedRaw = raw;
    cachedSnapshot = { restored: true, location: resolveStoredZip(centroids, raw, postal) };
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

  /* A zip opened from a link is recorded in recents too. */
  const openedZip = snapshot.location?.zip ?? null;
  useEffect(() => {
    if (openedZip === null) return;
    if (new URLSearchParams(window.location.search).get("zip") !== openedZip) return;
    recordRecentZip(openedZip);
  }, [openedZip]);

  const remember = useCallback((next: StoredLocation) => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("zip")) {
      url.searchParams.set("zip", next.zip);
      window.history.replaceState(window.history.state, "", url);
    }
    const payload: StoredPayload = {
      zip: next.zip,
      savedAt: new Date().toISOString(),
    };

    commitStorageWrite(
      () => window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload)),
      () => {
        // Recorded here so every path that sets a location adds it to recents.
        recordRecentZip(next.zip);
        publishToListeners(listeners);
      },
      () => {
        // Not being able to remember is survivable; failing the search is not.
        // Keep the choice for this page's life; the publish still runs.
        cachedRaw = JSON.stringify(payload);
        const area = postalAreaIn(postal, next.zip);
        cachedSnapshot = { restored: true, location: { ...next, ...(area ? { postal: area } : {}) } };
      },
    );
  }, []);

  return { ...snapshot, remember };
}
