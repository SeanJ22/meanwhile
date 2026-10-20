"use client";

import { useSyncExternalStore } from "react";
import { copy, type CopyKey, type CopyValues } from "@/lib/design/copy";
import { fetchReaderResponse, readReaderJson } from "@/lib/reader/bootstrap";

const EMPTY: CopyValues = {};
let values = EMPTY;
let revision = -1;
let inFlight: Promise<void> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let lastReadAt = 0;
const listeners = new Set<() => void>();

async function refresh() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const response = await fetchReaderResponse("/api/reader/settings", { cache: "no-cache" });
      if (!response.ok) return;
      const data = await readReaderJson<{ available?: boolean; values?: CopyValues; revision?: number }>(response);
      if (!data.available || !data.values || typeof data.revision !== "number" || data.revision <= revision) return;
      values = data.values;
      revision = data.revision;
      listeners.forEach(listener => listener());
    } catch { /* Keep the last good copy on a failed settings read. */ }
    finally { lastReadAt = Date.now(); inFlight = null; }
  })();
  return inFlight;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1 && Date.now() - lastReadAt >= 60_000) void refresh();
  if (!timer) {
    // The page owns one clock; moving its controls or opening a panel must not
    // restart the clock or fetch an unchanged snapshot again.
    timer = setInterval(() => { if (listeners.size && document.visibilityState === "visible") void refresh(); }, 60_000);
    window.addEventListener("focus", () => { if (listeners.size) void refresh(); });
  }
  return () => {
    listeners.delete(listener);
  };
}

/** All gap components in one page share one settings read and one subscription. */
export function useReaderCopy() {
  const current = useSyncExternalStore(subscribe, () => values, () => EMPTY);
  return (key: CopyKey, vars?: Readonly<Record<string, string>>) => copy(key, current, vars);
}
