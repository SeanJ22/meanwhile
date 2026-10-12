/**
 * @freshness-reads-here — `collectedAt` is taken at the moment of the fetch, in
 * `fetch()` below, and never reconstructed afterwards.
 */
import type { BodySourceWiring } from "../../registry/source-wiring.ts";
import {
  MEETING_HELD_HORIZON_DAYS,
  MEETING_HELD_LOOKBACK_DAYS,
} from "../../meetings/constants.ts";
import { toZonedIso } from "../../time/zoned.ts";
import { decodeEntities } from "../http.ts";
import { makePermissionGate, permittedText } from "../permission-gate.ts";
import {
  accountedNormalize,
  type Accounted,
} from "../normalize-account.ts";
import type {
  Meeting,
  MeetingQuery,
  MeetingStatus,
  NormalizeDropCounts,
  ReportingMeetingSource,
} from "../types.ts";

/**
 * SuiteOne Media meeting management — a town's hosted agenda portal
 * (`<tenant>.suiteonemedia.com`, ASP.NET). Its home page is plain
 * server-rendered HTML:
 *
 * - **Upcoming Meetings**: a table of the next TEN meetings of every body the
 *   town runs on the portal, each row a link to the meeting's own page
 *   (`/event/?id=<id>`), its document links once posted
 *   (`/event/GetAgendaFile/Agenda?aid=<id>`) and its date and time as printed
 *   ("Oct 27, 2026 | 06:30 PM") beside a sort key in .NET ticks of the same
 *   wall clock (`data-sort="639287226000000000"`).
 * - **Past Meetings**: one panel per body category ("City Council (47)"), with
 *   the current and previous year's sittings in the same row shape.
 *
 * A body is ONE category panel (`groupName`, its exact heading) plus the
 * upcoming rows whose title begins with the body's own name (`titleMatch`);
 * the upcoming table names no category. Other bodies' rows are counted and set
 * aside.
 *
 * - **Time**: the printed wall clock, cross-checked against the row's own
 *   ticks. A row whose two readings disagree is not placed in time, counted.
 * - **Place**: not on the portal's rows. The agenda link is carried and the
 *   ingest's agenda reading may place a sitting from its own agenda; until then
 *   the sitting carries our own "place not recorded" gap, never "online".
 * - **Cancellation**: only the town's own word ("… ~ CANCELLED").
 * - **Minutes**: labelled as the portal labels them, not marked draft or
 *   approved.
 *
 * The home page lists only the next ten meetings across all bodies; later
 * sittings appear as the table rolls forward. The page's "next page" control is
 * a POST and is not wired.
 */

export const SOURCE_NAME = "suiteone";

const WINDOW_FORWARD_DAYS = MEETING_HELD_HORIZON_DAYS;
const WINDOW_BACK_DAYS = MEETING_HELD_LOOKBACK_DAYS;

/* ------------------------------------------------------------ parsing -- */

/** One meeting row, as the portal printed it. */
export interface PortalRow {
  /** The portal's own meeting id (`/event/?id=<id>`). */
  readonly eventId: string;
  /** The title as printed, entities decoded. */
  readonly title: string;
  /** "Oct 27, 2026 | 06:30 PM". */
  readonly printed: string;
  /** The row's own sort key, .NET ticks of the same wall clock; null when absent. */
  readonly ticks: string | null;
  readonly agenda: string | null;
  readonly packet: string | null;
  readonly minutes: string | null;
  /** The row carries a "Media" (video) link to the meeting's page. */
  readonly media: boolean;
}

function text(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function rowsIn(html: string, origin: string): PortalRow[] {
  const out: PortalRow[] = [];
  for (const tr of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = tr[1];
    const title = /<a\b[^>]*href="\/event\/\?id=(\d+)"[^>]*>\s*<b>([\s\S]*?)<\/b>/i.exec(row);
    if (!title) continue;
    const when = /<td\b([^>]*)>\s*([A-Za-z]{3,9}\.?\s+\d{1,2},\s*\d{4}\s*\|\s*\d{1,2}:\d{2}\s*[AP]M)\s*<\/td>/i.exec(row);
    const sortKey = when ? /\bdata-sort="(\d+)"/i.exec(when[1])?.[1] ?? null : null;
    const link = (pattern: RegExp): string | null => {
      const m = pattern.exec(row);
      return m ? new URL(decodeEntities(m[1]), origin).toString() : null;
    };
    out.push({
      eventId: title[1],
      title: text(title[2]),
      printed: when ? when[2].replace(/\s+/g, " ").trim() : "",
      ticks: sortKey,
      agenda: link(/href="(\/event\/GetAgendaFile\/[^"]+)"/i),
      packet: link(/href="(\/event\/GetAgendaPacketFile\/[^"]+)"/i),
      minutes: link(/href="(\/event\/GetMinutesFile\/[^"]+)"/i),
      media: /<span class="bold">\s*Media\s*<\/span>/i.test(row),
    });
  }
  return out;
}

/** One category panel of past meetings. */
export interface PortalGroup {
  readonly rows: PortalRow[];
  /** The count the panel's own heading declares ("City Council (50)"), or null. */
  readonly declared: number | null;
}

/**
 * The portal home page's two lists: the upcoming table, and each category
 * panel of past meetings by its exact heading. The count in the heading's
 * `<small>` is not part of the name; it is the publisher's own count of the
 * panel's rows, kept so a row this parser missed is counted, never silent.
 */
export function portalRows(html: string, pageUrl: string): { upcoming: PortalRow[]; groups: Map<string, PortalGroup> } {
  const origin = new URL(pageUrl).origin;
  const upStart = html.indexOf('aria-label="Upcoming events"');
  const upEnd = html.indexOf('aria-label="Recent events"');
  const upcoming = upStart >= 0 ? rowsIn(html.slice(upStart, upEnd > upStart ? upEnd : undefined), origin) : [];
  const groups = new Map<string, PortalGroup>();
  const parts = html.split(/<div class="recentEventsGroupDiv_/).slice(1);
  for (const part of parts) {
    const heading = /<h3 class="panel-title">\s*<a\b[^>]*>([\s\S]*?)<\/a>/i.exec(part);
    if (!heading) continue;
    const name = text(heading[1].replace(/<small>[\s\S]*?<\/small>/gi, ""));
    const count = /<small>\s*\((\d+)\)\s*<\/small>/i.exec(heading[1]);
    const held = groups.get(name);
    const declared = count ? Number(count[1]) : null;
    groups.set(name, {
      rows: [...(held?.rows ?? []), ...rowsIn(part, origin)],
      declared: held === undefined ? declared : held.declared === null || declared === null ? null : held.declared + declared,
    });
  }
  return { upcoming, groups };
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** The wall clock a row prints: "Oct 27, 2026 | 06:30 PM". */
export function printedWallClock(printed: string): { y: number; mo: number; d: number; h: number; mi: number } | null {
  const m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),\s*(\d{4})\s*\|\s*(\d{1,2}):(\d{2})\s*([AP])M$/i.exec(printed.trim());
  if (!m) return null;
  const mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
  const y = Number(m[3]);
  const d = Number(m[2]);
  let h = Number(m[4]);
  const mi = Number(m[5]);
  if (mo < 1 || h < 1 || h > 12 || mi > 59) return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  if (h === 12) h = 0;
  if (m[6].toUpperCase() === "P") h += 12;
  return { y, mo, d, h, mi };
}

/** .NET ticks (100 ns since 0001-01-01) of a wall clock, as that wall clock. */
export function ticksWallClock(ticks: string): { y: number; mo: number; d: number; h: number; mi: number } | null {
  if (!/^\d{15,19}$/.test(ticks)) return null;
  // Ticks exceed 2^53, so the arithmetic is exact only in BigInt. The epoch
  // offset is 1970-01-01 in ticks; ten thousand ticks make a millisecond.
  const ms = Number((BigInt(ticks) - BigInt("621355968000000000")) / BigInt(10_000));
  const at = new Date(ms);
  if (!Number.isFinite(at.getTime())) return null;
  return { y: at.getUTCFullYear(), mo: at.getUTCMonth() + 1, d: at.getUTCDate(), h: at.getUTCHours(), mi: at.getUTCMinutes() };
}

const CANCELED = /\bcancell?ed\b/i;

/* ------------------------------------------------------------ the source -- */

export interface SuiteOneRaw {
  wiring: BodySourceWiring;
  /** The portal home page's HTML; empty when `error` is set. */
  html: string;
  collectedAt: string;
  error?: string;
}

function statusOf(startsAt: string, canceled: boolean, now: Date): MeetingStatus {
  if (canceled) return "CANCELED";
  return Date.parse(startsAt) <= now.getTime() ? "CONCLUDED" : "SCHEDULED";
}

export function makeSuiteOneSource(
  wiringRows: BodySourceWiring[],
  fetchImpl?: typeof fetch,
): ReportingMeetingSource<SuiteOneRaw> {
  const normalizeWithDrops = (
    raw: SuiteOneRaw[],
    now: Date = new Date(),
  ): Accounted<{ meetings: Meeting[]; drops: NormalizeDropCounts; unreachableOcdIds: string[] }> => {
    const meetings: Meeting[] = [];
    const drops: NormalizeDropCounts = { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 };
    const unreachable = new Set<string>();
    const windowStart = now.getTime() - WINDOW_BACK_DAYS * 86_400_000;
    const windowEnd = now.getTime() + WINDOW_FORWARD_DAYS * 86_400_000;
    let considered = 0;
    let duplicates = 0;
    let outOfWindow = 0;
    let keptUnplaced = 0;
    let unretrieved = 0;

    for (const row of raw) {
      const { wiring } = row;
      const pageUrl = wiring.config.portalUrl;
      const { upcoming, groups } = row.error ? { upcoming: [], groups: new Map<string, PortalGroup>() } : portalRows(row.html, pageUrl);
      const group = groups.get(wiring.config.groupName ?? "");
      if (row.error || group === undefined) {
        // A refused read, or a page that no longer carries this body's own
        // panel: nothing is produced from it THIS run, the division is named,
        // and the partition keeps its last good version. A portal that stopped
        // listing the body is never read as a body with no meetings.
        considered += 1;
        if (row.error) unretrieved += 1;
        drops.notConfigured += 1;
        if (wiring.ocdId) unreachable.add(wiring.ocdId);
        continue;
      }
      const prefix = (wiring.config.titleMatch ?? "").trim().toLowerCase();
      const bodyName = wiring.config.bodyName ?? wiring.publishingOrg;
      const selected: PortalRow[] = [];
      for (const r of upcoming) {
        considered += 1;
        // The upcoming table names no category: a row is this body's only when
        // its own title begins with the body's own name.
        if (!prefix || !(r.title.toLowerCase().startsWith(`${prefix} `) || r.title.toLowerCase() === prefix)) {
          drops.notConfigured += 1;
          continue;
        }
        selected.push(r);
      }
      considered += group.rows.length;
      selected.push(...group.rows);
      // Rows the panel's own heading counts and this parser did not read are
      // counted as rows it could not place, never silently fewer.
      if (group.declared !== null && group.declared > group.rows.length) {
        considered += group.declared - group.rows.length;
        drops.unplaceableInTime += group.declared - group.rows.length;
      }

      const seen = new Set<string>();
      for (const r of selected) {
        if (seen.has(r.eventId)) {
          duplicates += 1;
          continue;
        }
        seen.add(r.eventId);
        const clock = printedWallClock(r.printed);
        const sorted = r.ticks === null ? null : ticksWallClock(r.ticks);
        if (!clock || (sorted !== null && JSON.stringify(sorted) !== JSON.stringify(clock))) {
          // No printed time, or the row's two readings of its own time disagree:
          // not placed in time, and counted.
          drops.unplaceableInTime += 1;
          continue;
        }
        const startsAt = toZonedIso(clock.y, clock.mo, clock.d, clock.h, clock.mi, wiring.timeZone);
        const t = Date.parse(startsAt);
        if (t < windowStart || t > windowEnd) {
          outOfWindow += 1;
          continue;
        }
        const eventPage = new URL(`/event/?id=${r.eventId}`, pageUrl).toString();
        const links = [
          ...(r.packet ? [{ label: "Agenda packet", href: r.packet }] : []),
          ...(r.minutes ? [{ label: "Minutes (not marked draft or approved)", href: r.minutes }] : []),
          { label: r.media ? "Meeting page and video" : "Meeting page", href: eventPage },
        ];
        // No place is on the portal's row: our own named gap, never online.
        drops.unknownVenue += 1;
        keptUnplaced += 1;
        meetings.push({
          id: `${SOURCE_NAME}:${wiring.config.slug}:${r.eventId}`,
          ocdId: wiring.ocdId,
          bodyId: wiring.bodyId,
          bodyName,
          title: r.title,
          startsAt,
          startPrecision: "MINUTE",
          timeZone: wiring.timeZone,
          location: null,
          publishedLinks: links,
          agendaUrl: r.agenda,
          // The row's document area is where the portal lists "Agenda" once it
          // is posted; a row showing none is the publisher's slot, observed empty.
          ...(r.agenda === null ? { agendaSlotObservedEmpty: true } : {}),
          jurisdiction: wiring.jurisdiction,
          status: statusOf(startsAt, CANCELED.test(r.title), now),
          provenance: {
            sourceUrl: pageUrl,
            sourceOrg: wiring.publishingOrg,
            collectedAt: row.collectedAt,
            verifiedAt: null,
            evidenceExcerpt: `${r.title} | ${r.printed}`,
          },
        });
      }
    }

    meetings.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return accountedNormalize(
      SOURCE_NAME,
      raw,
      { meetings, drops, unreachableOcdIds: [...unreachable] },
      { logicalInput: considered, duplicates, outOfWindow, countedButProduced: keptUnplaced, unretrieved },
    );
  };

  return {
    name: SOURCE_NAME,

    /** One page per body, robots.txt asked first; isolated per body. */
    async fetch(query?: MeetingQuery): Promise<SuiteOneRaw[]> {
      const gate = makePermissionGate({ fetchImpl, signal: query?.signal });
      const collected: SuiteOneRaw[] = [];
      for (const wiring of wiringRows) {
        try {
          const html = await permittedText(gate, wiring.config.portalUrl, { fetchImpl, signal: query?.signal });
          collected.push({ wiring, html, collectedAt: new Date().toISOString() });
        } catch (error) {
          collected.push({ wiring, html: "", collectedAt: new Date().toISOString(), error: String((error as Error)?.message ?? error) });
        }
      }
      if (collected.length > 0 && collected.every((row) => row.error)) {
        throw new Error(collected[0].error);
      }
      return collected;
    },

    normalize(raw, now: Date = new Date()): Meeting[] {
      return normalizeWithDrops(raw, now).meetings;
    },

    normalizeWithDrops,

    async upsert(meetings: Meeting[]) {
      // Persistence is the promotion door's, not the adapter's.
      return { inserted: 0, updated: meetings.length };
    },
  };
}
