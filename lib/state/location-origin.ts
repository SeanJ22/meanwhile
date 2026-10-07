"use client";

import type { LocationOrigin } from "../ask/residency.ts";

/**
 * How the reader arrived at this ZIP: typed, tapped from the demonstration
 * list, or resolved from browser geolocation (`lib/ask/residency.ts` reads it).
 * A stored ZIP looks the same however it arrived, so this is recorded where it
 * happens.
 *
 * Keyed on the ZIP, so a stale origin can never describe a different ZIP. Kept
 * in `sessionStorage`: it is an origin, not a preference, and must not outlive
 * the visit. Every read and write is wrapped; an unknown origin is a correct
 * answer.
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
    /* A browser that refuses site data reads UNKNOWN, which is true. */
  }
}

/** How the reader arrived at THIS ZIP, or `UNKNOWN`; a record about another ZIP is ignored. */
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
