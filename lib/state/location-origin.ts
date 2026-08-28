"use client";

import type { LocationOrigin } from "../ask/residency.ts";

/**
 * **WHAT THE READER ACTUALLY DID TO GET THIS LOCATION.**
 * (PR #212 follow-up, 2026-08-28.)
 *
 * `lib/ask/residency.ts` models the two location axes correctly and the model
 * was worth nothing until something recorded which act produced the ZIP. The
 * grounded route's first version had no input at all for this, so every row it
 * would have written carried `UNKNOWN`/`UNKNOWN` — a model of location
 * confidence whose only live value was "we do not know".
 *
 * This is the missing fact, recorded where it happens: the welcome card knows
 * whether a ZIP was typed, tapped from the demonstration list, or resolved from
 * the browser's own geolocation, and those are three different things about the
 * reader. Nothing else in the product can tell them apart afterwards — a stored
 * ZIP looks identical however it arrived.
 *
 * ## Why it is keyed on the ZIP
 *
 * Because the reader can change it. A reader who typed 85641 and then tapped
 * the Tucson demonstration chip has done two different things, and an
 * unkeyed record would report the first act about the second location. Keying
 * on the value means a stale origin can never describe a ZIP it was not about;
 * it can only fail to describe the current one, which reads as `UNKNOWN`.
 *
 * ## Why `sessionStorage` and not the shared UI state
 *
 * It is an ORIGIN, not a preference, and it must not outlive the visit that
 * produced it. A durable record of how somebody arrived is a longer-lived fact
 * about a person than the ZIP itself, for no product benefit. Every read and
 * write is wrapped: a browser with site data blocked is a normal browser, and
 * an unknown origin is a correct answer rather than an error.
 */

const STORAGE_KEY = "wtp.location_origin";

interface StoredOrigin {
  zip: string;
  origin: LocationOrigin;
}

/** Record how the reader arrived at this ZIP. Never throws. */
export function recordLocationOrigin(zip: string | null, origin: LocationOrigin): void {
  if (!zip) return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ zip, origin } satisfies StoredOrigin));
  } catch {
    /* A browser that refuses site data still gets the whole product. The row
       this would have stamped reads UNKNOWN, which is true. */
  }
}

/**
 * How the reader arrived at THIS ZIP, or `UNKNOWN`.
 *
 * The ZIP is compared rather than trusted: a record about a different ZIP is
 * not evidence about this one, and returning it anyway would be the stale-fact
 * defect the keying exists to prevent.
 */
export function readLocationOriginFor(zip: string | null): LocationOrigin {
  if (!zip) return "UNKNOWN";
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return "UNKNOWN";
    const parsed = JSON.parse(raw) as Partial<StoredOrigin>;
    return parsed?.zip === zip && typeof parsed.origin === "string"
      ? (parsed.origin as LocationOrigin)
      : "UNKNOWN";
  } catch {
    return "UNKNOWN";
  }
}
