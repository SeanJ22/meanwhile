"use client";

import { useCallback, useSyncExternalStore } from "react";
import { subscribeToStorage } from "@/lib/state/subscribe-to-storage";

/**
 * The zips this device has looked at, most recent first (item 3, 2026-08-15).
 *
 * Device-local and nothing else. This list is the ONLY thing about a reader's
 * location that survives a tab closing — the current location itself is
 * session-scoped now (6f: "reopening the app asks where you are"), and the
 * point behind a narrowed street was never stored at all. A recents list is
 * orientation, exactly like the zip it holds: it makes the second visit one
 * tap instead of eleven, and it can be cleared by clearing site data.
 *
 * It never leaves the device. It is not sent with any request, it is not in
 * any export, and it joins nothing — the collection stores are the three named
 * in CLAUDE.md and this is not one of them: it is a UI convenience living in
 * the browser, the same class of thing as the theme choice.
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
  try {
    window.localStorage.setItem(STORAGE_KEY, raw);
  } catch {
    // Private mode. Keep it for this page's life so the switcher still works.
  }
  cachedRaw = raw;
  cachedList = next;
  for (const listener of listeners) listener();
}

export function clearRecentZips() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do.
  }
  cachedRaw = null;
  cachedList = EMPTY;
  for (const listener of listeners) listener();
}

export function useRecentZips(): string[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
