"use client";

import { SYNTHETIC_RUN_BODY_KEY } from "@/lib/db/run-marker";
import type { SearchLogEventType } from "@/lib/db/search-log";
import { LOG_MAX_BODY_BYTES, LOG_MAX_OCD_IDS, LOG_MAX_OCD_ID_CHARS } from "@/lib/log/limits";

/**
 * Fire-and-forget client half of the search log: an event type, the divisions
 * the event touched, and scalar detail; nothing that could identify the
 * reader. `sendBeacon` where available so a closing page still delivers; any
 * failure is dropped. Unlike reactions, no outcome is promised to the reader.
 */
export function logEvent(
  eventType: SearchLogEventType,
  ocdIds: string[],
  detail?: Record<string, string | number | boolean>,
  /** Orientation-only zip for a SEARCH; never coordinates, never identity. */
  approximateLocation?: string | null,
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
    const body = fittedLogBody(eventType, ocdIds, detail, approximateLocation, declared);
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon(
        "/api/log",
        new Blob([body], { type: "application/json" }),
      );
      return;
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

/**
 * One event's body, inside what /api/log accepts. A ZIP can touch more divisions than one event carries; the
 * event then keeps the leading divisions that fit and states how many it touched, rather than being refused.
 */
export function fittedLogBody(
  eventType: SearchLogEventType,
  ocdIds: string[],
  detail: Record<string, string | number | boolean> | undefined,
  approximateLocation: string | null | undefined,
  declared: string | undefined,
): string {
  const ids = [...new Set(ocdIds)].filter(id => id.length <= LOG_MAX_OCD_ID_CHARS);
  const bodyWith = (kept: string[]) => {
    const fitted = kept.length < ids.length ? { ...detail, ocdIdCount: ids.length } : detail;
    const base: Record<string, unknown> = { eventType, ocdIds: kept, detail: fitted };
    if (approximateLocation !== undefined) base.approximateLocation = approximateLocation;
    if (declared !== undefined) base[SYNTHETIC_RUN_BODY_KEY] = declared;
    return JSON.stringify(base);
  };
  let kept = ids.slice(0, LOG_MAX_OCD_IDS), body = bodyWith(kept);
  while (kept.length > 0 && new TextEncoder().encode(body).length > LOG_MAX_BODY_BYTES) body = bodyWith(kept = kept.slice(0, -1));
  return body;
}
