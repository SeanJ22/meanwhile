import type { Meeting } from "@/lib/sources/types";

import { hasPhysicalLocation } from "./online.ts";

/**
 * A place that hosts meetings.
 *
 * Pins are venues, not meetings. A city hall chamber can host four sittings in
 * a fortnight, and four markers stacked on the same coordinate means three of
 * them are unclickable.
 */
export interface Venue {
  key: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  /** Chronological, in whatever direction the caller's list arrived. */
  meetings: Meeting[];
}

/** ~11 meters. Two rooms in one building are one pin. */
const COORD_PRECISION = 4;

export function groupByVenue(meetings: Meeting[]): Venue[] {
  const venues = new Map<string, Venue>();

  for (const meeting of meetings) {
    /*
     * A meeting held online has no place, so it is not a venue and never a
     * pin (D18). This is the ONE gate that decides that: everything upstream
     * keeps such a meeting so the reader can see it, and giving it a
     * coordinate here — the body's home, the map centre, anything — would put
     * a marker on a building nobody is going to.
     *
     * MTG-14 (2026-08-28) routes it through the one predicate and changes
     * nothing about it. **The gate is CORRECT and stays** — a helper that made
     * it easy to give an online sitting a coordinate would be a worse module
     * than none.
     */
    if (!hasPhysicalLocation(meeting)) continue;

    const { lat, lng, name, address } = meeting.location;
    const key = `${lat.toFixed(COORD_PRECISION)},${lng.toFixed(COORD_PRECISION)}`;

    const existing = venues.get(key);
    if (existing) {
      existing.meetings.push(meeting);
      continue;
    }

    venues.set(key, { key, name, address, lat, lng, meetings: [meeting] });
  }

  return [...venues.values()];
}
