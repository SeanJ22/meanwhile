"use client";

import { useSyncExternalStore } from "react";

import {
  DEFAULT_RAISED_STATE_VARIANT,
  raisedStateVariantFromSearch,
} from "@/lib/map/raised-state-variants";

/**
 * Reads the presentation-only review parameter without tying the Reader to
 * Admin code or requiring `useSearchParams` (and therefore a route Suspense
 * boundary). History navigation is enough for the review links; a direct load
 * hydrates from the stable B snapshot and then adopts the URL candidate.
 */
const subscribe = (onChange: () => void) => {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
};

const snapshot = () => raisedStateVariantFromSearch(window.location.search);
const serverSnapshot = () => DEFAULT_RAISED_STATE_VARIANT;

export function useRaisedStateVariant() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
