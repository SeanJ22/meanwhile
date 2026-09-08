"use client";

import { useSyncExternalStore } from "react";

import { desktopVotePlacementVariantFromSearch } from "@/lib/map/reader-review-variants";

const subscribe = (onChange: () => void) => {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
};

const snapshot = () =>
  desktopVotePlacementVariantFromSearch(
    window.location.search,
    process.env.NODE_ENV !== "production",
  );
const serverSnapshot = () => null;

/** Local-development switch for the three unresolved desktop placements. */
export function useDesktopVotePlacementVariant() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
