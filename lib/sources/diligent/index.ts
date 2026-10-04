/**
 * @freshness-reads-here
 *
 * RULING 107 — the clock stamps in this file are minted by the code path that
 * performs the read: the freshness date is taken at the moment of the fetch,
 * which is what the ruling asks for rather than what it forbids. Verified
 * 2026-08-23 by reading each stamp site against the retrieval it sits in.
 */
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

/**
 * Diligent Community / iCompass CivicWeb meeting source — trackers **D13**
 * and the Newbury half of the 03255 hunt.
 *
 * Both brands ship the same portal software, and both expose the same WCF
 * JSON service the portal page itself calls:
 *
 *   <serviceBase>/Services/MeetingsService.svc/meetings?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Found by watching the network requests on `MeetingSchedule.aspx` — the page
 * renders "Loading…" to a plain client while this endpoint answers plain GET
 * with no auth. That is ladder rung 7: the same public data the page shows,
 * in the form the page already receives it. Verified live against both the
 * TUSD tenant (diligentoneplatform.com) and Newbury's (civicweb.net).
 *
 * `CIVICWEB` and `DILIGENT` stay distinct `AgendaSourceType` values — they
 * are different products to a clerk — but they dispatch here together because
 * the wire format is one format.
 */

const SOURCE_NAME = "diligent";

/**
 * The fetch window IS the served window (M76, 2026-08-15).
 *
 * These were literal 60 and 30 with a comment claiming they matched the
 * cascade. The served lookback moved 30 -> 90 and the adapters did not, so
 * every source quietly dropped sixty days of published, retrievable history
 * at the fetch — invisible to every count check, because each adapter
 * honestly reported what it had asked for. Deriving them is what makes the
 * drift impossible rather than merely noticed.
 */
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
  /**
   * The body's OWN per-sitting agenda records on a host that permits this
   * client, when its wiring row names one (`agendaRecordsUrl`). Read raw here
   * and parsed in normalize, like the meetings themselves.
   */
  agendaRecords?: { url: string; html: string } | null;
  /**
   * The body's OWN meeting calendar on a permitted host, when its wiring row
   * names one (`scheduleCalendarBase` + `scheduleCalendarPid` for the ixCal
   * month fragments, or `scheduleCalendarKind: smartsites` + `siteBase` +
   * `calendarApiId` for a SmartSites events response), read for the forward
   * window and unioned with the portal's list in normalize
   * (`./schedule-union.ts`).
   */
  scheduleCalendar?: ScheduleCalendar | null;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The body's name for a row, from published text only: the service's own
 * `MeetingTypeName` where the tenant sends one (TUSD does), else the wiring
 * row's `typeName:<TypeId>` — read off the portal's own MeetingTypeList page
 * and cited there — else the row's published `Name`. Never minted.
 */
function bodyNameFor(m: DiligentMeeting, wiring: BodySourceWiring): string {
  // A `typeName:<TypeId>` override wins when the wiring row carries one:
  // some tenants publish a SITTING name in MeetingTypeName ("Regular
  // Governing Board Meeting", Sunnyside) where a body name belongs, and
  // the override is itself a published name — read off the portal's
  // MeetingTypeList or the body's own site, cited on the wiring row.
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
      // Sittings new to the partition are identified by body + local date and
      // time once a body's own calendar is unioned in (./schedule-union.ts);
      // portal ids at or below this stay as readers already hold them.
      const legacyIdsThrough = wiring.config.legacyIdsThrough ? Number(wiring.config.legacyIdsThrough) : null;
      if (scheduleCalendar && (legacyIdsThrough === null || !Number.isInteger(legacyIdsThrough))) {
        // Without it, a sitting first published from the calendar would change
        // id the day the portal lists it, and show twice.
        throw new Error(`SCHEDULE_UNION_REQUIRES_LEGACY_IDS_THROUGH:${wiring.bodyId}`);
      }
      const portal: { id: string; key: string }[] = [];
      const taken = new Set<string>();
      /*
       * **A CONCLUDED SITTING'S AGENDA RECORD FROM THE BODY'S OWN HOST.**
       * (2026-09-23.)
       *
       * The portal's meeting page is not the agenda — the agenda is a linked
       * document on the same tenant host (`/document/…`), which nothing here
       * follows yet. (The tenants' robots.txt disallows this client; that is
       * recorded, and has blocked nothing since the owner decision of
       * 2026-09-25.) Tucson Unified publishes, for every Governing Board
       * sitting, a Board Actions PDF on govboard.tusd1.org: the
       * agenda's numbered items with the action taken on each. Where the
       * wiring row names that index (`agendaRecordsUrl`) and the portal type
       * ids it covers (`agendaRecordsTypeIds`, read off the portal's own
       * rows), a CONCLUDED sitting of those types links its record instead of
       * the portal page. Nothing else about the row changes.
       */
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
        /*
         * A meeting held online is KEPT (D18). No building means no
         * coordinates and no pin, but it is a real public meeting a reader
         * could attend, and dropping it applied the map's constraint to the
         * reader. The label is the published string verbatim; nothing here
         * publishes a join link, so joinUrl is null and renders as the gap
         * it is rather than as some other URL dressed up as a way in.
         */
        const online = location && isPlacelessLocation(location)
          ? { label: location, joinUrl: null }
          : null;
        if (online) {
          drops.placeless++;
          // A-002: this TALLIES a meeting that is then PRODUCED below (D18),
          // so it is not a drop and must not be summed as one.
          keptButPlaceless += 1;
        }
        // D31: the tenant is passed so a division-less body keys on itself
        // rather than on a null every other division-less body also has.
        // A sitting with no published place, or a place with no reviewed
        // spelling yet, is still a verified sitting: it is published with no
        // place rather than withheld (the owner's rule of 2026-09-23 — a
        // missing location never suppresses an otherwise verified meeting).
        const venue = online || !location
          ? null
          : resolveVenue(SOURCE_NAME, wiring.ocdId, location, wiring.config.slug) ?? null;
        // The gap is NAMED, not hidden: `unknownVenue` still counts it, as
        // `placeless` counts a kept online sitting (D18) — so the ingest
        // report and the venue hunt still see an unreviewed place — and the
        // row is PRODUCED with no place and the gap the portal's own
        // `MeetingLocation` states (the venue-gap class, 2026-09-23, one
        // construction for every adapter): its words verbatim when it names a
        // room we hold no reviewed row for, the portal's silence when it is
        // blank. It used to carry no gap, so a stated room read as "We
        // haven't recorded a place for this meeting yet".
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
          // The meeting page hosts the agenda once the tenant publishes it;
          // `Published` is the service's own flag for exactly that. A body's
          // own permitted agenda record for a concluded sitting comes first.
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
      const from = isoDate(new Date(now - WINDOW_BACK_DAYS * 86_400_000));
      const to = isoDate(new Date(now + WINDOW_FORWARD_DAYS * 86_400_000));

      const collected: DiligentRaw[] = [];
      for (const wiring of wiringRows) {
        const url =
          `${wiring.config.serviceBase}/Services/MeetingsService.svc/meetings` +
          `?from=${from}&to=${to}${wiring.config.extraQuery ?? ""}`;
        const rows = await politeGetJson<DiligentMeeting[]>(url, {
          fetchImpl,
          signal: query?.signal,
        });
        // The body's own agenda-record index is read only under a permission
        // verdict for ITS host, asked before the request (RULING 263).
        const gate = makePermissionGate({ fetchImpl, signal: query?.signal });
        const http = { fetchImpl, signal: query?.signal };
        const recordsUrl = wiring.config.agendaRecordsUrl;
        let agendaRecords: DiligentRaw["agendaRecords"] = null;
        if (recordsUrl) {
          agendaRecords = { url: recordsUrl, html: await permittedText(gate, recordsUrl, http) };
        }
        // The body's own calendar for the forward window, under the same
        // permission gate. Any refusal or failure throws, so the partition
        // keeps its last good version rather than publishing half a union.
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
