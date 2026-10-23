"use client";

import { useSyncExternalStore } from "react";
import {
  commitStorageWrite,
  publishToListeners,
  subscribeToStorage,
} from "@/lib/state/subscribe-to-storage";

/**
 * The zips this device has looked at, most recent first. Device-local only:
 * never sent with any request, exported or joined.
 */

const STORAGE_KEY = "wtp.recent_zips";

/** Enough to cover a life — home, work, a parent's town — and no more. */
export const RECENT_ZIP_LIMIT = 6;

const listeners = new Set<() => void>();

let cachedRaw: string | null | undefined;
let cachedList: string[] = [];

const EMPTY: string[] = [];

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Five digits or it does not go in the list. */
function clean(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  for (const v of values) {
    if (typeof v === "string" && /^\d{5}$/.test(v) && !out.includes(v)) {
      out.push(v);
    }
  }
  return out.slice(0, RECENT_ZIP_LIMIT);
}

function getSnapshot(): string[] {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      cachedList = raw ? clean(JSON.parse(raw)) : EMPTY;
    } catch {
      cachedList = EMPTY;
    }
  }
  return cachedList;
}

function getServerSnapshot(): string[] {
  return EMPTY;
}

const subscribe = (onStoreChange: () => void) =>
  subscribeToStorage(listeners, onStoreChange);

/** Write outside React, so the zip store can record a visit as it happens. */
export function recordRecentZip(zip: string) {
  if (!/^\d{5}$/.test(zip)) return;
  const next = [zip, ...getSnapshot().filter((z) => z !== zip)].slice(
    0,
    RECENT_ZIP_LIMIT,
  );
  const raw = JSON.stringify(next);
  // Private mode refuses the write; the cache below keeps it for this page's
  // life so the switcher still works, and the publish runs either way.
  commitStorageWrite(
    () => window.localStorage.setItem(STORAGE_KEY, raw),
    () => {
      cachedRaw = raw;
      cachedList = next;
      publishToListeners(listeners);
    },
  );
}

export function useRecentZips(): string[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
