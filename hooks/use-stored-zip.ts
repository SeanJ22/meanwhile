"use client";

import { useCallback, useSyncExternalStore } from "react";

import { recordRecentZip } from "@/hooks/use-recent-zips";
import { lookupIn, type CentroidTable } from "@/lib/geo/zcta-core";
import { loadZctaTable } from "@/lib/geo/zcta-table";
import {
  commitStorageWrite,
  publishToListeners,
  subscribeToStorage,
} from "@/lib/state/subscribe-to-storage";

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

export function readZipChoice(): string | null {
  const linkZip = new URLSearchParams(window.location.search).get("zip");
  // A link names the place to open, even in a tab with a previous selection.
  if (linkZip !== null) return JSON.stringify({ zip: linkZip });
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    // Private mode or storage disabled. A forgotten zip just means the entry
    // notice shows — which is now the default anyway.
    return null;
  }
}

/**
 * **P-002 · THE CENTROID TABLE ARRIVES, IT IS NOT ALREADY HERE.**
 * (Performance audit of `336a3eb`, remediated 2026-08-24.)
 *
 * This hook was the last static importer of `lib/geo/zcta.ts` in the client
 * graph, and one static importer is all it takes: 960,770 bytes of centroids —
 * 32.5% of the landing page's initial JavaScript, more than MapLibre — landed
 * in the initial bundle to answer one question on one code path.
 *
 * Converting the three components that resolve a typed zip was not enough, and
 * the measurement said so plainly: the rebuild moved 2,955,835 → 2,956,534 raw
 * bytes. UP. The table had a second async home and its old one, and the change
 * was worth nothing until this line moved too. **A change kept because it
 * sounded right, without the rebuilt number falling, is the thing the audit's
 * measurement law exists to forbid.**
 *
 * ## Why PENDING is the honest answer while it loads, and not a regression
 *
 * `useSyncExternalStore` needs a synchronous snapshot, and the stored payload
 * holds ONLY the zip — deliberately, so a Census vintage update that moves a
 * centroid cannot leave a stale coordinate behind (the comment below is that
 * decision, and it is untouched).
 *
 * So there is a moment where the zip is known and the coordinate is not, and
 * the type already has a state for it: `restored: false`, which is exactly
 * what the SERVER snapshot returns on every render today. The entry notice
 * showing for that moment is the same state a reader already sees between the
 * server render and hydration, and the surfaces downstream handle it because
 * they must handle SSR.
 *
 * The alternative was writing the coordinates into `sessionStorage` and
 * trusting them, which would have removed the pending state by removing the
 * re-resolution — trading a correctness decision somebody made on purpose for
 * a few hundred milliseconds of restore. Not that.
 */
let centroids: CentroidTable | null = null;
let tableRequested = false;

function ensureTable(): void {
  if (tableRequested) return;
  tableRequested = true;
  void loadZctaTable().then((table) => {
    centroids = table.centroids;
    // Invalidate the identity cache and republish: every subscriber's snapshot
    // moves from PENDING to the resolved location in one pass.
    cachedRaw = undefined;
    cachedSnapshot = PENDING;
    publishToListeners(listeners);
  });
}

export function resolveStoredZip(table: CentroidTable, raw: string | null): StoredLocation | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<StoredPayload>;
    // Re-resolve rather than trusting stored coordinates: a Census vintage
    // update moves centroids, and the zip is the only durable part.
    return typeof parsed.zip === "string" && /^\d{5}$/.test(parsed.zip) ? lookupIn(table, parsed.zip) : null;
  } catch {
    return null;
  }
}


/*
 * `sessionStorage` itself is per-tab, so the cross-tab `storage` event this
 * shares only ever fires for the localStorage half (the recents write).
 */
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

  // P-002: nothing can be RESTORED before the table that resolves it is here.
  // Answering `restored: true, location: null` would tell every surface the
  // reader has no stored zip, which is a claim rather than a wait.
  if (!centroids) return PENDING;

  const raw = readZipChoice();

  if (raw !== cachedRaw || cachedSnapshot === PENDING) {
    cachedRaw = raw;
    cachedSnapshot = { restored: true, location: resolveStoredZip(centroids, raw) };
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
      () => window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload)),
      () => {
        // The one thing that outlives the tab (item 3), so the next open is a
        // tap rather than eleven. Written here so every path that sets a
        // location — the welcome card, the switcher, Near me — records it
        // without having to remember to. It publishes its own store.
        recordRecentZip(next.zip);
        publishToListeners(listeners);
      },
      () => {
        // Not being able to remember is survivable; failing the search is not.
        // Keep the choice for this page's life; the publish still runs.
        cachedRaw = JSON.stringify(payload);
        cachedSnapshot = { restored: true, location: next };
      },
    );
  }, []);

  return { ...snapshot, remember };
}
