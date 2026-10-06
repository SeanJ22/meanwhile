"use client";

import { useSyncExternalStore } from "react";
import { copy, type CopyKey, type CopyValues } from "@/lib/design/copy";

const EMPTY: CopyValues = {};
let values = EMPTY;
let revision = -1;
let inFlight: Promise<void> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

async function refresh() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const response = await fetch("/api/reader/settings", { cache: "no-cache" });
      if (!response.ok) return;
      const data = await response.json() as { available?: boolean; values?: CopyValues; revision?: number };
      if (!data.available || !data.values || typeof data.revision !== "number" || data.revision <= revision) return;
      values = data.values;
      revision = data.revision;
      listeners.forEach(listener => listener());
    } catch { /* Keep the last good copy on a failed settings read. */ }
    finally { inFlight = null; }
  })();
  return inFlight;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    void refresh();
    timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 60_000);
    window.addEventListener("focus", refresh);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      if (timer) clearInterval(timer);
      timer = null;
      window.removeEventListener("focus", refresh);
    }
  };
}

/** All gap components in one page share one settings read and one subscription. */
export function useReaderCopy() {
  const current = useSyncExternalStore(subscribe, () => values, () => EMPTY);
  return (key: CopyKey, vars?: Readonly<Record<string, string>>) => copy(key, current, vars);
}
