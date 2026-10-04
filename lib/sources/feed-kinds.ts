/**
 * DB-50: an engineer-built adapter can become a feed.
 *
 * An installed platform adapter (`lib/sources/platform-adapters/<name>.ts`) may
 * export `feedKind`, declaring itself a kind of door a registry record can name:
 *
 *   feedKind = { kind: "some-platform", configKeys: ["pageUrl"], read(door, ctx) { ... } }
 *
 * `read` is given one door's settings and a polite, paced text fetch, and returns
 * the sittings it found, each with a start time, a title, where the facts came
 * from and, when it states them, a place and an agenda link. It builds no
 * `Meeting`: the platform here does, so every sitting an engineer kind publishes
 * carries the same fields, status, provenance and honest accounting as any other
 * source's, and one that cannot be built is counted as dropped, never lost.
 *
 * Installed kinds are registered once per pass by the same loader that reads
 * Scout adapters (`scheduler/scout-adapters.ts`); with none registered nothing
 * about composite wiring changes.
 *
 * Nothing here names a place.
 */

import type { BodySourceWiring } from "../registry/source-wiring.ts";
import { unplacedVenueGap } from "../meetings/venue-cache.ts";
import { toZonedIso } from "../time/zoned.ts";
import { politeGetText } from "./http.ts";
import { accountedNormalize, type Accounted } from "./normalize-account.ts";
import type { Meeting, MeetingQuery, MeetingStatus, NormalizeDropCounts, ReportingMeetingSource } from "./types.ts";
import type { FeedDoor, FeedKindDeclaration, FeedSitting } from "./feed-kind-registry.ts";

export * from "./feed-kind-registry.ts";

const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/;

interface FeedRaw {
  readonly wiring: BodySourceWiring;
  readonly sittings: readonly FeedSitting[];
  readonly collectedAt: string;
}

function startsAtOf(value: string, zone: string): string | null {
  if (/(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))) return value;
  const m = WALL_CLOCK.exec(value);
  if (!m) return null;
  return toZonedIso(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), zone);
}

/** The composite child for the doors of one installed feed kind. */
export function makeFeedKindSource(kind: FeedKindDeclaration, wiringRows: BodySourceWiring[], fetchImpl?: typeof fetch): ReportingMeetingSource<FeedRaw> {
  const normalizeWithDrops = (raw: FeedRaw[], now: Date = new Date()): Accounted<{ meetings: Meeting[]; drops: NormalizeDropCounts }> => {
    const meetings: Meeting[] = [];
    const drops: NormalizeDropCounts = { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 };
    let considered = 0;
    let keptButPlaceless = 0;
    let duplicates = 0;
    for (const { wiring, sittings, collectedAt } of raw) {
      const seen = new Set<string>();
      for (const sitting of sittings) {
        considered += 1;
        const startsAt = typeof sitting.startsAt === "string" ? startsAtOf(sitting.startsAt, wiring.timeZone) : null;
        if (typeof sitting.id === "string" && seen.has(sitting.id)) {
          duplicates += 1;
          continue;
        }
        if (startsAt === null || !Number.isFinite(Date.parse(startsAt)) || !sitting.title?.trim() || !sitting.id?.trim() || !/^https:\/\//i.test(sitting.sourceUrl ?? "")) {
          drops.unplaceableInTime += 1;
          continue;
        }
        seen.add(sitting.id);
        const location = sitting.location ?? null;
        // A missing place never suppresses an otherwise verified sitting: it is kept, the gap is named on it and counted.
        const venueGap = location === null ? unplacedVenueGap(sitting.statedPlace, wiring.publishingOrg) : null;
        if (venueGap !== null) {
          drops.unknownVenue += 1;
          keptButPlaceless += 1;
        }
        const status: MeetingStatus = sitting.cancelled === true ? "CANCELED" : Date.parse(startsAt) < now.getTime() ? "CONCLUDED" : "SCHEDULED";
        meetings.push({
          id: `${kind.kind}:${wiring.config.slug ?? wiring.bodyId}:${sitting.id}`,
          ocdId: wiring.ocdId,
          bodyId: wiring.bodyId,
          bodyName: sitting.bodyName?.trim() || sitting.title.trim(),
          title: sitting.title.trim(),
          startsAt,
          timeZone: wiring.timeZone,
          location,
          ...(venueGap === null ? {} : { venueGap }),
          agendaUrl: sitting.agendaUrl && /^https:\/\//i.test(sitting.agendaUrl) ? sitting.agendaUrl : null,
          jurisdiction: wiring.jurisdiction,
          status,
          provenance: { sourceUrl: sitting.sourceUrl, sourceOrg: wiring.publishingOrg, collectedAt, verifiedAt: null },
        });
      }
    }
    return accountedNormalize(kind.kind, raw, { meetings, drops }, { logicalInput: considered, countedButProduced: keptButPlaceless, duplicates });
  };
  return {
    name: kind.kind,
    async fetch(query?: MeetingQuery): Promise<FeedRaw[]> {
      const collected: FeedRaw[] = [];
      for (const wiring of wiringRows) {
        const door: FeedDoor = {
          bodyId: wiring.bodyId,
          ocdId: wiring.ocdId,
          timeZone: wiring.timeZone,
          jurisdiction: wiring.jurisdiction,
          publishingOrg: wiring.publishingOrg,
          config: Object.fromEntries(kind.configKeys.filter((key) => typeof wiring.config[key] === "string").map((key) => [key, wiring.config[key]!])),
        };
        const sittings = await kind.read(door, {
          signal: query?.signal,
          getText: async (url, accept) => {
            const { status, text } = await politeGetText(url, { fetchImpl, accept: accept ?? "text/html", signal: query?.signal });
            return { status, text };
          },
        });
        collected.push({ wiring, sittings, collectedAt: new Date().toISOString() });
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
