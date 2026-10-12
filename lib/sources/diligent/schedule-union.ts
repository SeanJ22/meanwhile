import type { BodySourceWiring } from "../../registry/source-wiring.ts";
import { MEETING_HELD_HORIZON_DAYS } from "../../meetings/constants.ts";
import { isPlacelessLocation, resolveVenue } from "../../meetings/venue-cache.ts";
import { toZonedIso } from "../../time/zoned.ts";
import { sittingBodyKey } from "../event-identity.ts";
import { saysCanceled, sittingStatus } from "../sitting-status.ts";
import { bodyNameOf, parseCalendarFragment } from "../tusd-govboard/index.ts";
import type { Meeting } from "../types.ts";

/**
 * One partition, every sitting either of the body's own publications verifies. Some bodies publish
 * sittings twice: in their Diligent Community portal (with agenda links and cancellation notes) and on
 * their own board site's calendar, which can list sittings months earlier. Neither is a superset, so the
 * partition publishes the union for the forward window (through `UPCOMING_HORIZON_DAYS`):
 *
 * - A calendar sitting matching a portal sitting (same body, same local date and time) is the same
 *   sitting and is counted as a duplicate; the portal row stands.
 * - A calendar sitting the portal does not list is published from the calendar, with the place the
 *   body's own sentence names, `online` when it says Zoom, and no place when it names none. Absence from
 *   the portal is never read as cancellation.
 * - Concluded sittings stay the portal's list; the calendar's past entries are counted out of window.
 *
 * Identity: every sitting new to the partition is identified by `<YYYY-MM-DD>T<HHMM>-<body key>`,
 * whichever source lists it, so its id survives the portal picking it up later. Portal rows readers
 * already hold keep the portal's ids (`legacyIdsThrough`), and `legacySitting:<id>` lets a calendar row
 * inherit an id if the portal stops returning it.
 */

/**
 * The body a sitting belongs to, as both publications spell it. Defined once in
 * lib/sources/event-identity.ts.
 */
export { sittingBodyKey };

/** `<YYYY-MM-DD>T<HHMM>-<body key>` from the publisher's own wall clock. */
export function sittingKey(
  wall: { readonly y: number; readonly m: number; readonly d: number; readonly h: number; readonly mi: number },
  bodyKey: string,
): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${wall.y}-${two(wall.m)}-${two(wall.d)}T${two(wall.h)}${two(wall.mi)}-${bodyKey}`;
}

/** The months from `now`'s month through the forward horizon, as `YYYY-MM-01`. */
export function forwardCalendarMonths(now: Date): string[] {
  const end = new Date(now.getTime() + MEETING_HELD_HORIZON_DAYS * 86_400_000);
  const out: string[] = [];
  let y = now.getUTCFullYear();
  let m = now.getUTCMonth() + 1;
  while (y < end.getUTCFullYear() || (y === end.getUTCFullYear() && m <= end.getUTCMonth() + 1)) {
    out.push(`${y}-${String(m).padStart(2, "0")}-01`);
    m += 1;
    if (m === 13) { m = 1; y += 1; }
  }
  return out;
}

/** The portal ids readers already hold for upcoming sittings, by sitting key. */
export function legacySittings(config: Record<string, string>): Map<string, string> {
  const map = new Map<string, string>();
  for (const [key, value] of Object.entries(config)) {
    if (key.startsWith("legacySitting:")) map.set(value, key.slice("legacySitting:".length));
  }
  return map;
}

export interface CalendarMonth {
  readonly url: string;
  readonly html: string;
}

/** A district calendar's own JSON response (ParentSquare SmartSites). */
export interface CalendarEvents {
  readonly url: string;
  readonly text: string;
}

/** One sitting as a district calendar states it, whichever calendar software serves it. */
interface StatedSitting {
  /** Dedupe key within the calendar (the event's own id). */
  readonly ref: string;
  readonly title: string;
  readonly wall: { readonly y: number; readonly m: number; readonly d: number; readonly h: number; readonly mi: number };
  /** Everything the calendar says about place, for the place rules. */
  readonly details: string;
  readonly sourceUrl: string;
}

function ixcalSittings(months: readonly CalendarMonth[]): StatedSitting[] {
  return months.flatMap((fragment) =>
    parseCalendarFragment(fragment.html).map((s) => ({
      ref: `${s.date.y}-${s.date.m}-${s.date.d}-${s.modalId}`,
      title: s.title,
      wall: { ...s.date, h: s.h, mi: s.mi },
      details: s.details,
      sourceUrl: fragment.url,
    })),
  );
}

/**
 * A SmartSites calendar's events of THIS body (`scheduleCalendarTitlePattern`),
 * read as a wall clock in the body's own zone (the tenant's payload offset is
 * not the district's clock; see lib/sources/smartsites). All-day or untimed
 * entries are not sittings and are not returned.
 */
function smartsitesSittings(events: CalendarEvents, config: Record<string, string>, siteBase: string): StatedSitting[] {
  const body = JSON.parse(events.text) as {
    success?: boolean;
    data?: { events?: { id: string; title: string; start_date: string; start_time: string | null; all_day?: boolean; address?: string | null; link?: string | null }[] };
  };
  if (body.success !== true || !Array.isArray(body.data?.events)) {
    throw new Error(`${events.url} answered without a success envelope`);
  }
  const include = new RegExp(config.scheduleCalendarTitlePattern ?? "governing board", "i");
  return body.data!.events!.flatMap((e) => {
    const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(e.start_date ?? "");
    const clock = /^(\d{2}):(\d{2})/.exec(e.start_time ?? "");
    if (!include.test(e.title) || !day || !clock || e.all_day) return [];
    return [{
      ref: String(e.id),
      title: e.title.trim(),
      wall: { y: Number(day[1]), m: Number(day[2]), d: Number(day[3]), h: Number(clock[1]), mi: Number(clock[2]) },
      details: (e.address ?? "").trim(),
      sourceUrl: e.link ? new URL(e.link, siteBase).toString() : events.url,
    }];
  });
}

export interface CalendarUnion {
  /** Sittings published from the calendar because the portal does not list them. */
  readonly produced: Meeting[];
  /** This body's calendar entries considered. */
  readonly considered: number;
  /** The same sitting seen twice in the calendar, or already a portal row. */
  readonly duplicates: number;
  /** Placed in time, and before now or past the forward horizon. */
  readonly outOfWindow: number;
  /** Portal sittings the calendar also lists, by portal row id. */
  readonly corroborated: readonly string[];
}

/** The body's own calendar as read this run: month fragments (ixCal) or an events response (SmartSites). */
export interface ScheduleCalendar {
  readonly months?: readonly CalendarMonth[];
  readonly events?: CalendarEvents;
}

/**
 * The calendar sittings the portal does not list. `portal` is the portal's own
 * rows for this body in this run, each with the sitting key it was matched on.
 */
export function calendarSittingsNotInPortal(input: {
  readonly wiring: BodySourceWiring;
  readonly sourceName: string;
  readonly calendar: ScheduleCalendar;
  readonly portal: readonly { readonly id: string; readonly key: string }[];
  readonly takenIds: ReadonlySet<string>;
  readonly collectedAt: string;
  readonly now: Date;
}): CalendarUnion {
  const { wiring, now } = input;
  const cfg = wiring.config;
  const upper = now.getTime() + MEETING_HELD_HORIZON_DAYS * 86_400_000;
  const unmatched = new Map<string, string[]>();
  for (const row of input.portal) unmatched.set(row.key, [...(unmatched.get(row.key) ?? []), row.id]);
  const legacy = legacySittings(cfg);
  const taken = new Set(input.takenIds);
  const produced: Meeting[] = [];
  const corroborated: string[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  let outOfWindow = 0;

  const sittings = [
    ...ixcalSittings(input.calendar.months ?? []),
    ...(input.calendar.events ? smartsitesSittings(input.calendar.events, cfg, cfg.siteBase ?? input.calendar.events.url) : []),
  ];
  for (const s of sittings) {
    if (seen.has(s.ref)) {
      duplicates += 1;
      continue;
    }
    seen.add(s.ref);
    const startsAt = toZonedIso(s.wall.y, s.wall.m, s.wall.d, s.wall.h, s.wall.mi, wiring.timeZone);
    const at = Date.parse(startsAt);
    if (at < now.getTime() || at > upper) {
      outOfWindow += 1;
      continue;
    }
    const key = sittingKey(s.wall, sittingBodyKey(s.title));
    const portalIds = unmatched.get(key);
    if (portalIds && portalIds.length > 0) {
      // The same sitting: the portal's row stands (agenda link, notes).
      corroborated.push(portalIds.shift()!);
      duplicates += 1;
      continue;
    }
    const legacyId = legacy.get(key);
    let id = legacyId && !taken.has(`${input.sourceName}:${cfg.slug}:${legacyId}`)
      ? `${input.sourceName}:${cfg.slug}:${legacyId}`
      : `${input.sourceName}:${cfg.slug}:${key}`;
    for (let n = 2; taken.has(id); n += 1) id = `${input.sourceName}:${cfg.slug}:${key}-${n}`;
    taken.add(id);

    const statement = `${s.title} ${s.details}`;
    const joinUrl = /https:\/\/[a-z0-9.-]*zoom\.us\/j\/[^\s"<]+/i.exec(s.details)?.[0] ?? null;
    // Only what the sitting's own entry says: "Virtual" in its title, "via
    // Zoom" in its words, or a place field that names no place.
    const online = /\bvirtual\b/i.test(s.title)
      ? { label: "Virtual", joinUrl }
      : /\bvia zoom\b/i.test(statement) || (s.details && isPlacelessLocation(s.details))
        ? { label: "Via Zoom", joinUrl }
        : null;
    const phrase = Object.keys(cfg)
      .filter((k) => k.startsWith("venueMatch:"))
      .find((k) => statement.toLowerCase().includes(k.slice("venueMatch:".length).toLowerCase()));
    const venue = !online && phrase
      ? resolveVenue(input.sourceName, wiring.ocdId, cfg[phrase], cfg.slug)
      : undefined;
    produced.push({
      id,
      ocdId: wiring.ocdId,
      bodyId: wiring.bodyId,
      bodyName: bodyNameOf(s.title),
      title: s.title,
      startsAt,
      timeZone: wiring.timeZone,
      // No place named, or a place with no reviewed spelling: published with no place rather than withheld.
      location: venue ? { name: venue.name, address: venue.address, lat: venue.lat, lng: venue.lng } : null,
      ...(online ? { online } : {}),
      // Posted before its agenda exists: a null is a fact about us.
      agendaUrl: null,
      jurisdiction: wiring.jurisdiction,
      status: sittingStatus(startsAt, saysCanceled(s.title), now),
      provenance: {
        sourceUrl: s.sourceUrl,
        sourceOrg: wiring.publishingOrg,
        collectedAt: input.collectedAt,
        verifiedAt: null,
      },
    });
  }
  return { produced, considered: sittings.length, duplicates, outOfWindow, corroborated };
}
