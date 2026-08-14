import type { BodySourceWiring } from "../../registry/source-wiring.ts";
import {
  isPlacelessLocation,
  resolveVenue,
} from "../../meetings/venue-cache.ts";
import { toZonedIso } from "../../time/zoned.ts";
import { politeGetJson } from "../http.ts";
import type {
  Meeting,
  MeetingStatus,
  NormalizeDropCounts,
  ReportingMeetingSource,
} from "../types.ts";

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

/** Matches the cascade's reach: 60 days forward, 30 back. */
const WINDOW_FORWARD_DAYS = 60;
const WINDOW_BACK_DAYS = 30;

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
  ): { meetings: Meeting[]; drops: NormalizeDropCounts } => {
    const meetings: Meeting[] = [];
    const drops: NormalizeDropCounts = {
      placeless: 0,
      unknownVenue: 0,
      unplaceableInTime: 0,
      notConfigured: 0,
    };

    for (const { wiring, meetings: rows, collectedAt } of raw) {
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
        if (isPlacelessLocation(location)) {
          drops.placeless++;
          continue;
        }
        const venue = resolveVenue(SOURCE_NAME, wiring.ocdId, location);
        if (!venue) {
          drops.unknownVenue++;
          continue;
        }

        // The portal's own permalink pattern, verified resolving on both
        // tenants (TUSD Id=492, Newbury Id=3370) before being relied on.
        const meetingUrl = `${wiring.config.serviceBase}${wiring.config.meetingPath}${m.Id}`;

        const bodyName = bodyNameFor(m, wiring);
        meetings.push({
          id: `${SOURCE_NAME}:${wiring.config.slug}:${m.Id}`,
          ocdId: wiring.ocdId,
          bodyName,
          title: (m.CleanName ?? m.Name ?? bodyName).trim(),
          startsAt,
          timeZone: wiring.timeZone,
          location: {
            name: venue.name,
            address: venue.address,
            lat: venue.lat,
            lng: venue.lng,
          },
          // The meeting page hosts the agenda once the tenant publishes it;
          // `Published` is the service's own flag for exactly that.
          agendaUrl: m.Published ? meetingUrl : null,
          jurisdiction: wiring.jurisdiction,
          status: statusOf(startsAt, now),
          provenance: {
            sourceUrl: meetingUrl,
            sourceOrg: wiring.publishingOrg,
            collectedAt,
            verifiedAt: null,
          },
        });
      }
    }

    return { meetings, drops };
  };

  return {
    name: SOURCE_NAME,

    async fetch(): Promise<DiligentRaw[]> {
      const now = Date.now();
      const from = isoDate(new Date(now - WINDOW_BACK_DAYS * 86_400_000));
      const to = isoDate(new Date(now + WINDOW_FORWARD_DAYS * 86_400_000));

      const collected: DiligentRaw[] = [];
      for (const wiring of wiringRows) {
        const url =
          `${wiring.config.serviceBase}/Services/MeetingsService.svc/meetings` +
          `?from=${from}&to=${to}${wiring.config.extraQuery ?? ""}`;
        const rows = await politeGetJson<DiligentMeeting[]>(url, { fetchImpl });
        collected.push({
          wiring,
          meetings: Array.isArray(rows) ? rows : [],
          collectedAt: new Date().toISOString(),
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
