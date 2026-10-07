"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type Reading<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly data: T; readonly at: string; readonly stale: boolean }
  | { readonly kind: "failed"; readonly says: string };

export function useReading<T>(url: string, everyMs = 60_000): { readonly reading: Reading<T>; readonly reload: () => void } {
  const [reading, setReading] = useState<Reading<T>>({ kind: "loading" });
  const last = useRef<{ data: T; at: string } | null>(null);
  const load = useCallback(async () => {
    try {
      const response = await fetch(url, { cache: "no-store", headers: { accept: "application/json" } });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const says = body !== null && typeof body === "object" && typeof (body as { says?: unknown }).says === "string" ? (body as { says: string }).says : `The console answered ${response.status}.`;
        throw new Error(says);
      }
      const at = new Date().toISOString();
      last.current = { data: body as T, at };
      setReading({ kind: "ready", data: body as T, at, stale: false });
    } catch (error) {
      const kept = last.current;
      setReading(kept ? { kind: "ready", data: kept.data, at: kept.at, stale: true } : { kind: "failed", says: error instanceof Error ? error.message : "It could not be read." });
    }
  }, [url]);
  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), everyMs);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load, everyMs]);
  return { reading, reload: () => void load() };
}
