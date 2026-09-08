"use client";

import { useSyncExternalStore } from "react";

import { raisedStateVariantFromSearch } from "@/lib/map/raised-state-variants";

/**
 * Reads the presentation-only review parameter without tying the Reader to
 * Admin code or requiring `useSearchParams` (and therefore a route Suspense
 * boundary). The URL switch is deliberately disabled in production: A/B/C
 * remain local review fixtures until the owner chooses one explicitly.
 */
const subscribe = (onChange: () => void) => {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
};

const snapshot = () =>
  raisedStateVariantFromSearch(
    window.location.search,
    process.env.NODE_ENV !== "production",
  );
const serverSnapshot = () => null;

export function useRaisedStateVariant() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
