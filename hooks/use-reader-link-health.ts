"use client";

import { useSyncExternalStore } from "react";
import { linkHealthKey, readLinkHealth } from "@/lib/design/link-health";

const EMPTY = new Set<string>();
let dead = EMPTY;
let sweptAt = -1;
let inFlight: Promise<void> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();
async function refresh() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const response = await fetch("/api/reader/link-health", { cache: "no-cache" });
      if (!response.ok) return;
      const snapshot = readLinkHealth(await response.json());
      if (!snapshot || Date.parse(snapshot.sweptAt) <= sweptAt) return;
      sweptAt = Date.parse(snapshot.sweptAt);
      dead = new Set(snapshot.deadAddresses);
      listeners.forEach(listener => listener());
    } catch { /* Retain the last successful sweep on a failed edge read. */ }
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
export function useReaderDeadLink(address: string): boolean {
  const current = useSyncExternalStore(subscribe, () => dead, () => EMPTY);
  const key = linkHealthKey(address);
  return key !== null && current.has(key);
}
