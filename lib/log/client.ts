"use client";

import type { SearchLogEventType } from "@/lib/db/search-log";

/**
 * Fire-and-forget client half of the search log.
 *
 * Sends exactly what /api/log accepts: an event type, the divisions the
 * event touched, and scalar detail. Nothing here reads or sends anything
 * that could identify the reader — no cookie, no generated client id, no
 * stored key of any kind — and the server stores none either. Disclosed on
 * /transparency, which ships with this file.
 *
 * sendBeacon over fetch where available so an event on a closing page still
 * goes out; a failure of any kind is silently dropped, because losing a log
 * row must never cost the reader anything.
 */
export function logEvent(
  eventType: SearchLogEventType,
  ocdIds: string[],
  detail?: Record<string, string | number | boolean>,
): void {
  try {
    const body = JSON.stringify({ eventType, ocdIds, detail });
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
