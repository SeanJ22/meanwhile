"use client";

import { useEffect, useState } from "react";

/**
 * Whether the left rail is on screen (not merely not-dismissed). `default`
 * shows the rail at Tailwind's `sm` (640px) and up, the same breakpoint as
 * `app/globals.css`; move both together. The server answers `false`, so the
 * pill cluster first renders in the map placement.
 */
export const SIDEBAR_BREAKPOINT_PX = 640;

export function useSidebarVisible(
  state: "default" | "open" | "closed",
): boolean {
  const [wide, setWide] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(
      `(min-width: ${SIDEBAR_BREAKPOINT_PX}px)`,
    );
    const read = () => setWide(query.matches);
    read();
    query.addEventListener("change", read);
    return () => query.removeEventListener("change", read);
  }, []);

  if (state === "open") return true;
  if (state === "closed") return false;
  return wide;
}
