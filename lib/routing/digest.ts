import type { CoverageSummary } from "../registry/coverage.ts";
import type { SeatHolder } from "../officials/lookup.ts";
import type { Meeting } from "../sources/types.ts";

/**
 * "What's going on where I live?": upcoming items, recent decisions, and who represents the reader,
 * scoped to their own divisions. An assembly, not a summary: every row is collected data with its
 * provenance and every sentence is curated copy here. No model, no network.
 *
 * Each block states its own count against its own denominator and its own named gap. The scope is
 * `coverage.divisions` (where the reader is), never the viewport. Meetings with a null `ocdId` are
 * counted in a separate named line rather than dropped.
 */

/** How many rows each block shows before it says how many more there are. */
export const DIGEST_BLOCK_LIMIT = 5;

/** How far back "recently decided" reaches. Stated on the surface. */
export const DIGEST_RECENT_DAYS = 30;

/** How far forward "upcoming" reaches. Stated on the surface. */
export const DIGEST_UPCOMING_DAYS = 60;

/**
 * Phrases that ask for the digest. Multi-word only, and for the same reason
 * destinations are: a single word carries a vocabulary, not an intent.
 *
 * Deliberately disjoint from the destination phrases — "who represents me" is
 * the districts destination and stays there. These are the shapes that ask for
 * a picture of the whole place rather than for one surface.
 */
const DIGEST_PHRASES: readonly string[] = [
  "whats going on",
  "what is going on",
  "whats going on here",
  "whats going on around here",
  "whats going on where i live",
  "what is going on where i live",
  "whats happening",
  "what is happening",
  "whats happening here",
  "whats happening in my area",
  "whats happening near me",
  "whats new in my area",
  "catch me up",
  "what should i know",
  "what do i need to know",
  "whats going on in my town",
  "whats going on in my area",
];

function normalize(text: string): string {
  return ` ${text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

export interface DigestMatch {
  /** The phrase that carried it — mechanical evidence, same as a topic's. */
  matchedOn: string[];
}

/**
 * Did the reader ask for the digest? Longest phrase wins, exactly as it does
 * for a destination; there is only one digest so a tie cannot mean two places.
 */
export function matchDigest(text: string): DigestMatch | null {
  const normalized = normalize(text);
  if (normalized.trim().length === 0) return null;
  const hits = DIGEST_PHRASES.filter((phrase) =>
    normalized.includes(` ${normalize(phrase).trim()} `),
  );
  return hits.length > 0 ? { matchedOn: [...new Set(hits)] } : null;
}

export interface DigestMeetingRow {
  id: string;
  bodyName: string;
  /**
   * The division this sitting belongs to, so the body name can open that body's card. An exact key,
   * never the name string. Null renders as plain text.
   */
  ocdId: string | null;
  title: string;
  startsAt: string;
  startPrecision: "MINUTE" | "DAY";
  timeZone: string;
  jurisdiction: string;
  agendaUrl: string | null;
  /** Null when the meeting is held online, or nowhere we could resolve. */
  locationName: string | null;
  onlineLabel: string | null;
}

export interface DigestBlock<T> {
  rows: T[];
  /** Every row that qualified, before the display limit. The denominator. */
  total: number;
  /**
   * The block's own named gap, or null. Never shared with another block, and
   * never a generic "nothing here" — see the header.
   */
  gap: string | null;
}

export interface Digest {
  /** The divisions this digest is about, by label. Stated on the surface. */
  divisionLabels: string[];
  upcoming: DigestBlock<DigestMeetingRow>;
  recent: DigestBlock<DigestMeetingRow>;
  representation: DigestBlock<{ seatLabel: string; holder: SeatHolder }>;
  /**
   * Meetings we hold that carry no Census division, so they cannot be scoped
   * to the reader by boundary. Counted and named rather than dropped.
   */
  unscopedMeetingCount: number;
  windows: { recentDays: number; upcomingDays: number };
}

function toRow(meeting: Meeting): DigestMeetingRow {
  return {
    id: meeting.id,
    bodyName: meeting.bodyName,
    ocdId: meeting.ocdId,
    title: meeting.title,
    startsAt: meeting.startsAt,
    startPrecision: meeting.startPrecision ?? "MINUTE",
    timeZone: meeting.timeZone,
    jurisdiction: meeting.jurisdiction,
    agendaUrl: meeting.agendaUrl,
    locationName: meeting.location?.name ?? null,
    onlineLabel: meeting.online?.label ?? null,
  };
}

/** Assemble the digest. Pure; `now` is a parameter so tests can pin it. */
export function buildDigest(
  coverage: CoverageSummary,
  meetings: readonly Meeting[],
  now: number,
): Digest {
  const scope = new Set(coverage.divisions.map((d) => d.ocdId));
  const upcomingCutoff = now + DIGEST_UPCOMING_DAYS * 86_400_000;
  const recentCutoff = now - DIGEST_RECENT_DAYS * 86_400_000;

  const mine: Meeting[] = [];
  let unscopedMeetingCount = 0;
  for (const meeting of meetings) {
    if (meeting.ocdId === null) {
      unscopedMeetingCount += 1;
      continue;
    }
    if (scope.has(meeting.ocdId)) mine.push(meeting);
  }

  const upcomingAll = mine
    .filter((m) => m.status === "SCHEDULED")
    .filter((m) => {
      const at = Date.parse(m.startsAt);
      return Number.isFinite(at) && at >= now && at <= upcomingCutoff;
    })
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));

  const recentAll = mine
    .filter((m) => m.status === "CONCLUDED")
    .filter((m) => {
      const at = Date.parse(m.startsAt);
      return Number.isFinite(at) && at < now && at >= recentCutoff;
    })
    .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));

  const seats: Array<{ seatLabel: string; holder: SeatHolder }> = [];
  for (const senator of coverage.senators) {
    seats.push({ seatLabel: "US Senate", holder: senator });
  }
  for (const seat of coverage.seats) {
    for (const holder of seat.representatives) {
      seats.push({ seatLabel: seat.label, holder });
    }
  }

  return {
    divisionLabels: coverage.divisions.map((d) => d.label),
    upcoming: {
      rows: upcomingAll.slice(0, DIGEST_BLOCK_LIMIT).map(toRow),
      total: upcomingAll.length,
      gap:
        upcomingAll.length > 0
          ? null
          : `We hold nothing on the calendar for these divisions in the next ${DIGEST_UPCOMING_DAYS} days. That is what we have collected, not a statement that nobody is meeting.`,
    },
    recent: {
      rows: recentAll.slice(0, DIGEST_BLOCK_LIMIT).map(toRow),
      total: recentAll.length,
      gap:
        recentAll.length > 0
          ? null
          : `No meeting we hold for these divisions has concluded in the last ${DIGEST_RECENT_DAYS} days.`,
    },
    representation: {
      rows: seats.slice(0, DIGEST_BLOCK_LIMIT),
      total: seats.length,
      gap:
        seats.length > 0
          ? null
          : "We have not sourced who holds these seats yet. Every place has representation; this gap is ours.",
    },
    unscopedMeetingCount,
    windows: {
      recentDays: DIGEST_RECENT_DAYS,
      upcomingDays: DIGEST_UPCOMING_DAYS,
    },
  };
}
