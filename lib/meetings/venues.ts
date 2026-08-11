import type { Meeting } from "@/lib/sources/types";

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
