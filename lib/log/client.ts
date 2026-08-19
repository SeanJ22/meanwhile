"use client";

import { SYNTHETIC_RUN_BODY_KEY } from "@/lib/db/run-marker";
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
 *
 * Fire-and-forget is BY DESIGN here and is the deliberate opposite of
 * `lib/reactions/client.ts#submitReaction`, which awaits its response and
 * reports the outcome: a reaction is a promise made to the reader at the
 * capture point ("your answer joins anonymous local totals"), so its
 * success rendering must be earned by the store's 204. A log row is our
 * own bookkeeping — no promise was made, so no outcome is owed. Do not
 * "fix" either side to match the other.
 */
export function logEvent(
  eventType: SearchLogEventType,
  ocdIds: string[],
  detail?: Record<string, string | number | boolean>,
): void {
  try {
    /*
     * ITEM 4b (g17, 2026-08-18): the run declaration rides in the BODY.
     *
     * A beacon flushed at unload does not carry the `x-wtp-synthetic-run`
     * header, so an automated run's rows landed in the sold store labelled as
     * a reader's — seven of them in g14, forty-four in g15. The body survives
     * every transport. `scripts/browser.mts` sets the global on every guarded
     * context before the page's first script runs; a real reader has no such
     * global and sends nothing, which is exactly the organic default.
     *
     * Read defensively and never thrown from: this is fire-and-forget
     * bookkeeping, and a log row may never cost the reader their page.
     */
    const declared =
      typeof window !== "undefined" &&
      typeof (window as { __WTP_SYNTHETIC_RUN__?: unknown }).__WTP_SYNTHETIC_RUN__ === "string"
        ? (window as unknown as { __WTP_SYNTHETIC_RUN__: string }).__WTP_SYNTHETIC_RUN__
        : undefined;
    const body = JSON.stringify(
      declared === undefined
        ? { eventType, ocdIds, detail }
        : { eventType, ocdIds, detail, [SYNTHETIC_RUN_BODY_KEY]: declared },
    );
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
