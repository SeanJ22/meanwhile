"use client";

import { SYNTHETIC_RUN_BODY_KEY } from "@/lib/db/run-marker";
import type { SearchLogEventType } from "@/lib/db/search-log";

/**
 * Fire-and-forget client half of the search log: an event type, the divisions
 * the event touched, scalar detail, and an optional random continuity key.
 * The server hashes the key before storage. `sendBeacon` lets a closing page deliver; any
 * failure is dropped. Unlike reactions, no outcome is promised to the reader.
 */
export function logEvent(
  eventType: SearchLogEventType,
  ocdIds: string[],
  detail?: Record<string, string | number | boolean>,
  /** Orientation-only zip for a SEARCH; never coordinates, never identity. */
  approximateLocation?: string | null,
  /** Shared with Ask solely to count distinct browsers in district aggregates. */
  continuityKey?: string | null,
): void {
  try {
    /*
     * The run declaration rides in the body, because a beacon sent at unload
     * does not carry custom headers. Automated browser runs set the global; a
     * real reader has none. Read defensively and never thrown from.
     */
    const declared =
      typeof window !== "undefined" &&
      typeof (window as { __WTP_SYNTHETIC_RUN__?: unknown }).__WTP_SYNTHETIC_RUN__ === "string"
        ? (window as unknown as { __WTP_SYNTHETIC_RUN__: string }).__WTP_SYNTHETIC_RUN__
        : undefined;
    const base: Record<string, unknown> = { eventType, ocdIds, detail };
    if (approximateLocation !== undefined) base.approximateLocation = approximateLocation;
    if (continuityKey !== undefined) base.continuityKey = continuityKey;
    if (declared !== undefined) base[SYNTHETIC_RUN_BODY_KEY] = declared;
    const body = JSON.stringify(base);
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      const queued = navigator.sendBeacon(
        "/api/log",
        new Blob([body], { type: "application/json" }),
      );
      if (queued) return;
    }
    void fetch("/api/log", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* never the reader's problem */
  }
}
