import { haversineKm } from "../../geo/distance.ts";
import type {
  Meeting,
  MeetingQuery,
  MeetingSource,
  MeetingStatus,
} from "../types.ts";
import { toZonedIso } from "../../time/zoned.ts";

import { FIXTURES, type LegistarEventFixture } from "./fixtures.ts";

/**
 * Mock meeting source.
 *
 * Stands in for the Granicus Legistar adapter until that one exists. It
 * implements the same MeetingSource contract and emits the same normalized
 * Meeting records, so nothing downstream — the query cascade, the API route,
 * the map — knows or cares that these meetings aren't real.
 *
 * Swapping in the real adapter is a one-line change in lib/meetings/registry.ts.
 */

/**
 * A resolved upstream event, shaped the way Legistar actually returns them:
 * calendar date and wall-clock time as separate strings, no zone attached.
 * Reassembling those two into an instant is the interesting part of the
 * transform, so the mock keeps it rather than shortcutting to an ISO string.
 */
export interface LegistarEvent {
  EventId: number;
  EventBodyName: string;
  EventName: string;
  /** `YYYY-MM-DD` in the body's local calendar. */
  EventDate: string;
  /** `h:mm AM/PM`, local wall clock. */
  EventTime: string;
  EventLocation: string;
  EventAddress: string | null;
  EventLatitude: number;
  EventLongitude: number;
  EventAgendaFile: string | null;
  EventInSiteURL: string;
  EventAgendaStatusName: "Draft" | "Final" | null;
  EventCanceled: boolean;
  DivisionOcdId: string;
  DivisionLabel: string;
  DivisionTimeZone: string;
  PublishingOrg: string;
  CollectedAt: string;
}

const SOURCE_NAME = "mock";

/** Widest window the mock will hand back, either side of now. */
const WINDOW_DAYS = 120;

function localCalendarDate(dayOffset: number, timeZone: string, now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);

  const shifted = new Date(
    Date.UTC(get("year"), get("month") - 1, get("day")) + dayOffset * 86_400_000,
  );
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function to12Hour(hour: number, minute: number): string {
  const suffix = hour < 12 ? "AM" : "PM";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function parse12Hour(time: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(time.trim());
  if (!match) return null;

  const rawHour = Number(match[1]);
  const minute = Number(match[2]);
  if (rawHour < 1 || rawHour > 12 || minute > 59) return null;

  const isPm = match[3].toUpperCase() === "PM";
  const hour = (rawHour % 12) + (isPm ? 12 : 0);
  return { hour, minute };
}

/** Fixture day offsets become concrete dates relative to whenever you run it. */
function resolve(fixture: LegistarEventFixture, now: Date): LegistarEvent {
  const { year, month, day } = localCalendarDate(
    fixture.EventDayOffset,
    fixture.DivisionTimeZone,
    now,
  );

  return {
    EventId: fixture.EventId,
    EventBodyName: fixture.EventBodyName,
    EventName: fixture.EventName,
    EventDate: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    EventTime: to12Hour(fixture.EventHour, fixture.EventMinute),
    EventLocation: fixture.EventLocation,
    EventAddress: fixture.EventAddress,
    EventLatitude: fixture.EventLatitude,
    EventLongitude: fixture.EventLongitude,
    EventAgendaFile: fixture.EventAgendaFile,
    EventInSiteURL: fixture.EventInSiteURL,
    EventAgendaStatusName: fixture.EventAgendaStatusName,
    EventCanceled: fixture.EventCanceled,
    DivisionOcdId: fixture.DivisionOcdId,
    DivisionLabel: fixture.DivisionLabel,
    DivisionTimeZone: fixture.DivisionTimeZone,
    PublishingOrg: fixture.PublishingOrg,
    CollectedAt: now.toISOString(),
  };
}

function statusOf(
  event: LegistarEvent,
  startsAt: string,
  now: Date,
): MeetingStatus {
  if (event.EventCanceled) return "CANCELED";
  return Date.parse(startsAt) < now.getTime() ? "CONCLUDED" : "SCHEDULED";
}

export const mockSource: MeetingSource<LegistarEvent> = {
  name: SOURCE_NAME,

  async fetch(query: MeetingQuery): Promise<LegistarEvent[]> {
    const now = new Date();
    const windowMs = WINDOW_DAYS * 86_400_000;

    return FIXTURES.filter(
      (fixture) => Math.abs(fixture.EventDayOffset) * 86_400_000 <= windowMs,
    )
      .filter(
        (fixture) =>
          haversineKm(
            query.lat,
            query.lng,
            fixture.EventLatitude,
            fixture.EventLongitude,
          ) <= query.radiusKm,
      )
      .map((fixture) => resolve(fixture, now));
  },

  normalize(raw: LegistarEvent[], now: Date = new Date()): Meeting[] {
    const meetings: Meeting[] = [];

    for (const event of raw) {
      const time = parse12Hour(event.EventTime);
      const [year, month, day] = event.EventDate.split("-").map(Number);

      // A meeting we can't place in time or space can't be a pin. Drop it
      // rather than guess — a wrong date on a public hearing is worse than a
      // missing one.
      if (!time || !year || !month || !day) continue;
      if (
        !Number.isFinite(event.EventLatitude) ||
        !Number.isFinite(event.EventLongitude)
      ) {
        continue;
      }

      const startsAt = toZonedIso(
        year,
        month,
        day,
        time.hour,
        time.minute,
        event.DivisionTimeZone,
      );

      meetings.push({
        id: `${SOURCE_NAME}:${event.EventId}`,
        ocdId: event.DivisionOcdId,
        bodyName: event.EventBodyName,
        title: event.EventName,
        startsAt,
        timeZone: event.DivisionTimeZone,
        location: {
          name: event.EventLocation,
          address: event.EventAddress,
          lat: event.EventLatitude,
          lng: event.EventLongitude,
        },
        agendaUrl: event.EventAgendaFile,
        jurisdiction: event.DivisionLabel,
        status: statusOf(event, startsAt, now),
        provenance: {
          sourceUrl: event.EventInSiteURL,
          sourceOrg: event.PublishingOrg,
          collectedAt: event.CollectedAt,
          // Nothing has confirmed these against a live source, because there
          // isn't one. Null is the honest answer; the UI says as much.
          verifiedAt: null,
        },
      });
    }

    return meetings;
  },

  async upsert(meetings: Meeting[]) {
    // No tables yet. The mock is read-only by design: persisting fixtures would
    // put fake public meetings in the same table real ones will land in.
    return { inserted: 0, updated: meetings.length };
  },
};
