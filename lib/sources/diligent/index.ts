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
  CONCLUDED_LOOKBACK_DAYS,
  UPCOMING_HORIZON_DAYS,
} from "../../meetings/constants.ts";
import {
  isPlacelessLocation,
  resolveVenue,
} from "../../meetings/venue-cache.ts";
import { toZonedIso } from "../../time/zoned.ts";
import { politeGetJson } from "../http.ts";
import { makePermissionGate, permittedText } from "../permission-gate.ts";
import { parseBoardActions } from "../tusd-govboard/board-actions.ts";
import type {
  Meeting,
  MeetingQuery,
  MeetingStatus,
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
const WINDOW_FORWARD_DAYS = UPCOMING_HORIZON_DAYS;
const WINDOW_BACK_DAYS = CONCLUDED_LOOKBACK_DAYS;

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
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function statusOf(startsAt: string, now: Date): MeetingStatus {
  return Date.parse(startsAt) < now.getTime() ? "CONCLUDED" : "SCHEDULED";
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

    for (const { wiring, meetings: rows, collectedAt, agendaRecords } of raw) {
      considered += rows.length;
      /*
       * **A CONCLUDED SITTING'S AGENDA RECORD FROM THE BODY'S OWN PERMITTED
       * HOST.** (2026-09-23.)
       *
       * The portal's meeting page is not the agenda — the agenda is a linked
       * document on the same tenant host, and the tenants' robots.txt refuses
       * this client. Tucson Unified publishes, for every Governing Board
       * sitting, a Board Actions PDF on govboard.tusd1.org (permitted): the
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
        if (!location) {
          drops.unknownVenue++;
          continue;
        }
        /*
         * A meeting held online is KEPT (D18). No building means no
         * coordinates and no pin, but it is a real public meeting a reader
         * could attend, and dropping it applied the map's constraint to the
         * reader. The label is the published string verbatim; nothing here
         * publishes a join link, so joinUrl is null and renders as the gap
         * it is rather than as some other URL dressed up as a way in.
         */
        const online = isPlacelessLocation(location)
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
        const venue = online
          ? null
          : resolveVenue(SOURCE_NAME, wiring.ocdId, location, wiring.config.slug);
        if (!online && !venue) {
          drops.unknownVenue++;
          continue;
        }

        // The portal's own permalink pattern, verified resolving on both
        // tenants (TUSD Id=492, Newbury Id=3370) before being relied on.
        const meetingUrl = `${wiring.config.serviceBase}${wiring.config.meetingPath}${m.Id}`;

        const bodyName = bodyNameFor(m, wiring);
        const status = statusOf(startsAt, now);
        const record =
          status === "CONCLUDED" && m.TypeId != null && recordTypes.has(m.TypeId)
            ? recordsByDay.get(`${clock[1]}-${clock[2]}-${clock[3]}`) ?? null
            : null;
        meetings.push({
          id: `${SOURCE_NAME}:${wiring.config.slug}:${m.Id}`,
          ocdId: wiring.ocdId,
          /* NH-RC4: the body, from the wiring row that produced this meeting. */
          bodyId: wiring.bodyId,
          bodyName,
          title: (m.CleanName ?? m.Name ?? bodyName).trim(),
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
    }

    return accountedNormalize(
      SOURCE_NAME,
      raw,
      { meetings, drops },
      { logicalInput: considered, countedButProduced: keptButPlaceless },
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
        const recordsUrl = wiring.config.agendaRecordsUrl;
        let agendaRecords: DiligentRaw["agendaRecords"] = null;
        if (recordsUrl) {
          const gate = makePermissionGate({ fetchImpl, signal: query?.signal });
          const html = await permittedText(gate, recordsUrl, { fetchImpl, signal: query?.signal });
          agendaRecords = { url: recordsUrl, html };
        }
        collected.push({
          wiring,
          meetings: Array.isArray(rows) ? rows : [],
          collectedAt: new Date().toISOString(),
          agendaRecords,
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
