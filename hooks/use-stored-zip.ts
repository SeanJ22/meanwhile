"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

import { recordRecentZip } from "@/hooks/use-recent-zips";
import type { ZctaCentroid } from "@/lib/geo/zcta-core";
import { lookupReaderZip, readyReaderZip } from "@/lib/reader/zip";
import {
  commitStorageWrite,
  publishToListeners,
  subscribeToStorage,
} from "@/lib/state/subscribe-to-storage";

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

function zipOf(raw: string | null): string | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<StoredPayload>;
    return typeof parsed.zip === "string" && /^\d{5}$/.test(parsed.zip) ? parsed.zip : null;
  } catch {
    return null;
  }
}

export async function resolveStoredZip(raw: string | null): Promise<StoredLocation | null> {
  const zip = zipOf(raw);
  if (!zip) return null;
  try {
    return await lookupReaderZip(zip);
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
  const raw = readZipChoice();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    const zip = zipOf(raw), ready = zip ? readyReaderZip(zip) : undefined;
    if (ready) {
      cachedSnapshot = { restored: true, location: ready };
      return cachedSnapshot;
    }
    cachedSnapshot = PENDING;
    void resolveStoredZip(raw).then(location => {
      if (cachedRaw !== raw) return;
      cachedSnapshot = { restored: true, location };
      publishToListeners(listeners);
    });
  }

  return cachedSnapshot;
}

export function useStoredZip() {
  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => PENDING,
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
        cachedRaw = readZipChoice();
        cachedSnapshot = { restored: true, location: next };
      },
    );
  }, []);

  return { ...snapshot, remember };
}
