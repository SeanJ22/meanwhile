"use client";

import { useSyncExternalStore } from "react";

// LAY-12: tablet and phone preserve the map by collapsing boundary details.
// Matches the desktop ballot breakpoint and the compact-map CSS rules.
const QUERY = "(max-width: 1023px)";
const subscribe = (onChange: () => void) => {
  const query = window.matchMedia(QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};
export function useCompactMap() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);
}
