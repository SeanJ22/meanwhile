"use client";

import { useSyncExternalStore } from "react";

// LAY-12: tablet and phone preserve the map by collapsing boundary details.
// Matches the desktop ballot breakpoint and the compact-map CSS rules.
function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export function useCompactMap() {
  return useMediaQuery("(max-width: 1023px)");
}

/** LAY-14's four-command phone band and compact bottom navigation. */
export function usePhoneMap() {
  return useMediaQuery("(max-width: 639px)");
}

/** LAY-15's six-command tablet band, including 1024px landscape tablets. */
export function useTabletMap() {
  return useMediaQuery("(min-width: 640px) and (max-width: 1199px)");
}
