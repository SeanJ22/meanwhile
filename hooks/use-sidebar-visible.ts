"use client";

import { useEffect, useState } from "react";

/**
 * Is the left rail actually ON SCREEN right now?
 *
 * G05 rule 4e decides where the single pill cluster is rendered from two
 * booleans, one of which is "sidebar open". That word means *visible to the
 * reader*, not *not-dismissed*, and on this app those are different things:
 * the rail's own state is `default | open | closed`, and `default` shows the
 * rail at `sm` and up while hiding it below (`app/globals.css`, the 640px
 * block). A cluster placed into the sidebar's DOM while the sidebar is a
 * hidden drawer would be a cluster the reader cannot see — and 4e's check
 * counts RENDERED instances, so it would count one and the phone would show
 * none.
 *
 * The breakpoint is Tailwind's `sm` (640px), which is the same number the
 * stylesheet uses; both are stated rather than assumed, and if the stylesheet
 * moves this must move with it.
 *
 * Server render answers `false`. That is deliberate and it is the safe way
 * round: the map placement always exists, so the first paint puts the cluster
 * somewhere real, and the effect moves it on hydration. The reverse default
 * would render a cluster into a rail the server cannot know is there.
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
