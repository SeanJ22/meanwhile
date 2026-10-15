// @freshness-reads-here
import type { BodySourceWiring } from "../../registry/source-wiring.ts";
import {
  MEETING_HELD_HORIZON_DAYS,
  MEETING_HELD_LOOKBACK_DAYS,
} from "../../meetings/constants.ts";
import {
  isPlacelessLocation,
  resolveVenue,
  unplacedVenueGap,
} from "../../meetings/venue-cache.ts";
import { toZonedIso } from "../../time/zoned.ts";
import { politeGetJson } from "../http.ts";
import { makePermissionGate, permittedText } from "../permission-gate.ts";
import { saysCanceled, sittingStatus } from "../sitting-status.ts";
import { parseBoardActions } from "../tusd-govboard/board-actions.ts";
import { calendarApiUrl } from "../smartsites/index.ts";
import { calendarFragmentUrl } from "../tusd-govboard/index.ts";
import {
  calendarSittingsNotInPortal,
  forwardCalendarMonths,
  sittingBodyKey,
  sittingKey,
  type CalendarMonth,
  type ScheduleCalendar,
} from "./schedule-union.ts";
import type {
  Meeting,
  MeetingQuery,
  NormalizeDropCounts,
  ReportingMeetingSource,
} from "../types.ts";
import {
  accountedNormalize,
  type Accounted,
} from "../normalize-account.ts";


const SOURCE_NAME = "diligent";

/** The fetch window is the served window, derived from the serving constants so the two cannot drift. */
const WINDOW_FORWARD_DAYS = MEETING_HELD_HORIZON_DAYS;
const WINDOW_BACK_DAYS = MEETING_HELD_LOOKBACK_DAYS;

export interface DiligentMeeting {
  Id: number;
  Name: string | null;
  CleanName?: string | null;
  MeetingDateTime: string | null;
  MeetingLocation: string | null;
  MeetingTypeName?: string | null;
  TypeId?: number | null;
  Published?: boolean;
}

/** Public service response, used by discovery and the existing reader adapter. */
export function parseDiligentMeetings(text: string): DiligentMeeting[] | null {
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) && value.every(m => m && Number.isInteger(m.Id) && typeof m.Name === "string" && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(m.MeetingDateTime)) ? value : null;
  } catch { return null; }
}

export interface DiligentRaw {
  wiring: BodySourceWiring;
  meetings: DiligentMeeting[];
  collectedAt: string;
  agendaRecords?: { url: string; html: string } | null;
  scheduleCalendar?: ScheduleCalendar | null;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function diligentCalendarUrl(wiring: BodySourceWiring, now = Date.now()): string {
  const from = isoDate(new Date(now - WINDOW_BACK_DAYS * 86_400_000));
  const to = isoDate(new Date(now + WINDOW_FORWARD_DAYS * 86_400_000));
  return `${wiring.config.serviceBase}/Services/MeetingsService.svc/meetings?from=${from}&to=${to}${wiring.config.extraQuery ?? ""}`;
}

function bodyNameFor(m: DiligentMeeting, wiring: BodySourceWiring): string {
  // A `typeName:<TypeId>` override wins: some tenants publish a sitting name in MeetingTypeName where a
  // body name belongs, and the override is itself a published name cited on the wiring row.
  const fromConfig =
    m.TypeId != null ? wiring.config[`typeName:${m.TypeId}`] : undefined;
  if (fromConfig) return fromConfig;
  const fromService = m.MeetingTypeName?.trim();
  if (fromService) return fromService;
  return (m.Name ?? "").trim();
}

export function makeDiligentSource(
  wiringRows: BodySourceWiring[],
  fetchImpl?: typeof fetch,
): ReportingMeetingSource<DiligentRaw> {
  const normalizeWithDrops = (
    raw: DiligentRaw[],
    now: Date = new Date(),
  ): Accounted<{ meetings: Meeting[]; drops: NormalizeDropCounts }> => {
    const meetings: Meeting[] = [];
    const drops: NormalizeDropCounts = {
      placeless: 0,
      unknownVenue: 0,
      unplaceableInTime: 0,
      notConfigured: 0,
    };

    // A-002 · counted in the unit the disposition happens in. One raw row is
    // one tenant's service response and carries many meetings.
    let considered = 0;
    let keptButPlaceless = 0;
    let outOfWindow = 0;
    let duplicates = 0;

    for (const { wiring, meetings: rows, collectedAt, agendaRecords, scheduleCalendar } of raw) {
      considered += rows.length;
      const legacyIdsThrough = wiring.config.legacyIdsThrough ? Number(wiring.config.legacyIdsThrough) : null;
      if (scheduleCalendar && (legacyIdsThrough === null || !Number.isInteger(legacyIdsThrough))) {
        // Without it, a sitting first published from the calendar would change
        // id the day the portal lists it, and show twice.
        throw new Error(`SCHEDULE_UNION_REQUIRES_LEGACY_IDS_THROUGH:${wiring.bodyId}`);
      }
      const portal: { id: string; key: string }[] = [];
      const taken = new Set<string>();
      const recordsByDay = agendaRecords
        ? parseBoardActions(agendaRecords.html, agendaRecords.url)
        : new Map<string, string>();
      const recordTypes = new Set(
        (wiring.config.agendaRecordsTypeIds ?? "")
          .split(",")
          .map((id) => Number(id.trim()))
          .filter((id) => Number.isInteger(id) && id > 0),
      );
      for (const m of rows) {
        // Derived connections carry reviewed body filters. Existing hand-wired
        // single-body tenants retain their own configuration when these are absent.
        const filterTitle = m.Name ?? m.CleanName ?? "";
        const match = (wiring.config.titleMatch ?? "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
        const exclude = (wiring.config.titleExclude ?? "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
        if ((match.length && !match.some(s => filterTitle.toLowerCase().includes(s))) || exclude.some(s => filterTitle.toLowerCase().includes(s))) { drops.notConfigured++; continue; }
        const clock = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(
          m.MeetingDateTime ?? "",
        );
        if (!clock) {
          drops.unplaceableInTime++;
          continue;
        }
        const startsAt = toZonedIso(
          Number(clock[1]),
          Number(clock[2]),
          Number(clock[3]),
          Number(clock[4]),
          Number(clock[5]),
          wiring.timeZone,
        );

        const location = (m.MeetingLocation ?? "").trim();
        // A meeting held online is kept: no building means no pin, but it is a real public meeting. The label is
        // the published string verbatim; no join link is published, so `joinUrl` is null.
        const online = location && isPlacelessLocation(location)
          ? { label: location, joinUrl: null }
          : null;
        if (online) {
          drops.placeless++;
          // A-002: this TALLIES a meeting that is then PRODUCED below (D18),
          // so it is not a drop and must not be summed as one.
          keptButPlaceless += 1;
        }
        // The tenant is passed so a division-less body keys on itself. A sitting with no published place, or a
        // place with no reviewed spelling, is still published, with no place.
        const venue = online || !location
          ? null
          : resolveVenue(SOURCE_NAME, wiring.ocdId, location, wiring.config.slug) ?? null;
        // The gap is named: `unknownVenue` still counts it, and the row is produced with no place and the gap the
        // portal's own `MeetingLocation` states (its words verbatim, or its silence when blank).
        const venueGap = !online && !venue ? unplacedVenueGap(location, wiring.publishingOrg) : null;
        if (venueGap) {
          drops.unknownVenue++;
          keptButPlaceless += 1;
        }

        // The portal's own permalink pattern, verified resolving on both
        // tenants (TUSD Id=492, Newbury Id=3370) before being relied on.
        const meetingUrl = `${wiring.config.serviceBase}${wiring.config.meetingPath}${m.Id}`;

        const bodyName = bodyNameFor(m, wiring);
        const title = (m.CleanName ?? m.Name ?? bodyName).trim();
        // The portal's own word for a called-off sitting ("CANCELLED DUE TO
        // LACK OF QUORUM ...") is the sitting's status, not only its title.
        const status = sittingStatus(startsAt, saysCanceled(title), now);
        const record =
          status === "CONCLUDED" && m.TypeId != null && recordTypes.has(m.TypeId)
            ? recordsByDay.get(`${clock[1]}-${clock[2]}-${clock[3]}`) ?? null
            : null;
        const key = sittingKey(
          { y: Number(clock[1]), m: Number(clock[2]), d: Number(clock[3]), h: Number(clock[4]), mi: Number(clock[5]) },
          sittingBodyKey(bodyName),
        );
        let id = legacyIdsThrough !== null && m.Id > legacyIdsThrough
          ? `${SOURCE_NAME}:${wiring.config.slug}:${key}`
          : `${SOURCE_NAME}:${wiring.config.slug}:${m.Id}`;
        for (let n = 2; taken.has(id); n += 1) id = `${SOURCE_NAME}:${wiring.config.slug}:${key}-${n}`;
        taken.add(id);
        portal.push({ id, key });
        meetings.push({
          id,
          ocdId: wiring.ocdId,
          /* NH-RC4: the body, from the wiring row that produced this meeting. */
          bodyId: wiring.bodyId,
          bodyName,
          title,
          startsAt,
          timeZone: wiring.timeZone,
          location: venue
            ? {
                name: venue.name,
                address: venue.address,
                lat: venue.lat,
                lng: venue.lng,
              }
            : null,
          ...(online ? { online } : {}),
          ...(venueGap ? { venueGap } : {}),
          agendaUrl: record ?? (m.Published ? meetingUrl : null),
          jurisdiction: wiring.jurisdiction,
          status,
          provenance: {
            sourceUrl: meetingUrl,
            sourceOrg: wiring.publishingOrg,
            collectedAt,
            verifiedAt: null,
          },
        });
      }
      if (scheduleCalendar) {
        const union = calendarSittingsNotInPortal({
          wiring,
          sourceName: SOURCE_NAME,
          calendar: scheduleCalendar,
          portal,
          takenIds: taken,
          collectedAt,
          now,
        });
        considered += union.considered;
        duplicates += union.duplicates;
        outOfWindow += union.outOfWindow;
        for (const meeting of union.produced) {
          if (meeting.online) {
            drops.placeless++;
            keptButPlaceless += 1;
          } else if (!meeting.location) {
            // Kept, and the gap named — the same tally as a portal row above.
            drops.unknownVenue++;
            keptButPlaceless += 1;
          }
          meetings.push(meeting);
        }
      }
    }

    return accountedNormalize(
      SOURCE_NAME,
      raw,
      { meetings, drops },
      { logicalInput: considered, countedButProduced: keptButPlaceless, outOfWindow, duplicates },
    );
  };

  return {
    name: SOURCE_NAME,

    async fetch(query?: MeetingQuery): Promise<DiligentRaw[]> {
      const now = Date.now();

      const collected: DiligentRaw[] = [];
      for (const wiring of wiringRows) {
        const url = diligentCalendarUrl(wiring, now);
        const rows = await politeGetJson<DiligentMeeting[]>(url, {
          fetchImpl,
          signal: query?.signal,
        });
        // The body's own agenda-record index is read only under a permission verdict for its host, asked before
        // the request.
        const gate = makePermissionGate({ fetchImpl, signal: query?.signal });
        const http = { fetchImpl, signal: query?.signal };
        const recordsUrl = wiring.config.agendaRecordsUrl;
        let agendaRecords: DiligentRaw["agendaRecords"] = null;
        if (recordsUrl) {
          agendaRecords = { url: recordsUrl, html: await permittedText(gate, recordsUrl, http) };
        }
        const calendarBase = wiring.config.scheduleCalendarBase;
        const calendarPid = wiring.config.scheduleCalendarPid;
        let scheduleCalendar: DiligentRaw["scheduleCalendar"] = null;
        if (wiring.config.scheduleCalendarKind === "smartsites") {
          const url = calendarApiUrl(
            wiring.config,
            new Date(now),
            new Date(now + WINDOW_FORWARD_DAYS * 86_400_000),
          );
          scheduleCalendar = {
            events: { url, text: await permittedText(gate, url, { ...http, accept: "application/json" }) },
          };
        } else if (calendarBase && calendarPid) {
          const months: CalendarMonth[] = [];
          for (const month of forwardCalendarMonths(new Date(now))) {
            const url = calendarFragmentUrl(calendarBase, calendarPid, month);
            months.push({ url, html: await permittedText(gate, url, http) });
          }
          scheduleCalendar = { months };
        }
        collected.push({
          wiring,
          meetings: Array.isArray(rows) ? rows : [],
          collectedAt: new Date().toISOString(),
          agendaRecords,
          scheduleCalendar,
        });
      }
      return collected;
    },

    normalize(raw, now: Date = new Date()): Meeting[] {
      return normalizeWithDrops(raw, now).meetings;
    },

    normalizeWithDrops,

    async upsert(meetings: Meeting[]) {
      return { inserted: 0, updated: meetings.length };
    },
  };
}
