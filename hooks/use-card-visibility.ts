"use client";

import { useEffect, type RefObject } from "react";

import { captureEvent } from "@/lib/events/client";

/** Time shorter than this is a card scrolling past, not a card being read. */
const MIN_VISIBLE_MS = 1_000;

/**
 * Counts the time the element is at least half visible with the tab in the
 * foreground, and records one `CARD_VISIBLE` event with the total when the card
 * leaves view or unmounts.
 */
export function useCardVisibility(
  ref: RefObject<Element | null>,
  cardId: string,
  cardKind: string,
  context: { zip?: string; district?: string } = {},
): void {
  const { zip, district } = context;
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;

    let visibleSince: number | null = null;
    let total = 0;

    const stop = () => {
      if (visibleSince !== null) {
        total += Date.now() - visibleSince;
        visibleSince = null;
      }
    };
    const report = () => {
      stop();
      if (total >= MIN_VISIBLE_MS) {
        captureEvent({ type: "CARD_VISIBLE", cardId, cardKind, durationMs: total, zip, district });
      }
      total = 0;
    };

    let inView = false;
    const sync = () => {
      const visible = inView && document.visibilityState === "visible";
      if (visible && visibleSince === null) visibleSince = Date.now();
      if (!visible) stop();
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          inView = entry.isIntersecting && entry.intersectionRatio >= 0.5;
          sync();
          if (!inView) report();
        }
      },
      { threshold: [0, 0.5, 1] },
    );
    observer.observe(element);
    document.addEventListener("visibilitychange", sync);

    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
      report();
    };
  }, [ref, cardId, cardKind, zip, district]);
}
