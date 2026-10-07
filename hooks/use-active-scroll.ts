"use client";

import { useEffect } from "react";

import { captureEvent } from "@/lib/events/client";

/** A gap longer than this between scroll events means the reader stopped. */
const ACTIVE_GAP_MS = 400;
/** Report once this much active scrolling has gathered, or when the page is hidden. */
const REPORT_AT_MS = 10_000;

/**
 * Adds up the time the reader is actively scrolling (events less than a moment
 * apart) on any scroll container, and records it as one `ACTIVE_SCROLL` event
 * when ten seconds have gathered or the tab is hidden. A duration only, never
 * positions.
 */
export function useActiveScroll(pageId: string): void {
  useEffect(() => {
    let active = 0;
    let last: number | null = null;

    const report = () => {
      if (active >= 500) captureEvent({ type: "ACTIVE_SCROLL", cardId: pageId, cardKind: "PAGE", durationMs: Math.round(active) });
      active = 0;
      last = null;
    };
    const onScroll = () => {
      const now = performance.now();
      if (last !== null && now - last <= ACTIVE_GAP_MS) active += now - last;
      last = now;
      if (active >= REPORT_AT_MS) report();
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") report();
    };

    // Capture phase: scroll does not bubble, and the sidebar and cards scroll on their own containers.
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      document.removeEventListener("visibilitychange", onHide);
      report();
    };
  }, [pageId]);
}
