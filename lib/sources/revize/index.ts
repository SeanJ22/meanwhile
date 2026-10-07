/**
 * @freshness-reads-here — the freshness date is taken at the moment of the
 * fetch, by the code path that performs the read.
 */
import type { BodySourceWiring } from "../../registry/source-wiring.ts";
import {
  isPlacelessLocation,
  resolveVenue,
  soleVenueForBody,
  unplacedVenueGap,
} from "../../meetings/venue-cache.ts";
import { toZonedIso } from "../../time/zoned.ts";
import { politeGetText } from "../http.ts";
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
 * Revize meeting source. calendar.php is JavaScript-only, but two things on a
 * Revize site are server-rendered:
 *
 * 1. **The homepage "Upcoming Meetings" block** — the next few meetings as
 *    plain text: a title line, a `Month D, YYYY @ H:MMAM` line, a venue line.
 *    This is where the meeting rows come from.
 * 2. **The body's notices/agendas page** — dated PDFs ("Public Notice
 *    8.10.26.pdf", "BOC Packet 7.27.26.pdf"). This is where agenda links come
 *    from, matched to a meeting by the date in the filename. The `?t=`
 *    cache-buster is stripped; the tokenless URL serves fine.
 *
 * Venue strings resolve through the venue cache. One with no reviewed row is
 * never placed and never suppresses its sitting: it is published with no pin
 * and the block's own words as its named gap, counted as `unknownVenue`.
 */

const SOURCE_NAME = "revize";

export interface RevizeRaw {
  wiring: BodySourceWiring;
  homepageHtml: string;
  agendaPageHtml: string;
  collectedAt: string;
}

export interface RevizeUpcoming {
  title: string;
  /** "August 24, 2026" */
  dateText: string;
  /** "10:00AM" */
  timeText: string;
  venueText: string;
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

const DATE_AT_TIME =
  /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s*@\s*(\d{1,2}):(\d{2})\s*(AM|PM)$/i;

/**
 * The upcoming-meetings block, as lines.
 *
 * The block is CMS-authored rich text, so the markup around it varies; the
 * *shape* is stable: after the words "Upcoming Meetings", every meeting is a
 * title line followed by a date@time line followed by a venue line. The
 * parser strips tags in that region and walks the lines, keying on the date
 * pattern, which survives markup churn a div-structure parser would not.
 */
export function parseUpcomingBlock(html: string): RevizeUpcoming[] {
  const at = html.search(/Upcoming\s+Meetings/i);
  if (at < 0) return [];

  const region = html.slice(at, at + 4000);
  const lines = region
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const found: RevizeUpcoming[] = [];
  for (let i = 1; i < lines.length; i++) {
    const m = DATE_AT_TIME.exec(lines[i]);
    if (!m) continue;
    const title = lines[i - 1];
    const venueText = lines[i + 1] ?? "";
    // A date line whose neighbour is another date line is not a meeting.
    if (!title || DATE_AT_TIME.test(title) || /^Upcoming\s+Meetings$/i.test(title)) {
      continue;
    }
    found.push({
      title,
      dateText: `${m[1]} ${m[2]}, ${m[3]}`,
      timeText: `${m[4]}:${m[5]}${m[6].toUpperCase()}`,
      venueText,
    });
  }
  return found;
}

interface DatedDocument {
  href: string;
  year: number;
  month: number;
  day: number;
  kind: "agenda" | "notice" | "other";
}

/**
 * Dated PDFs on the notices/agendas page, with the meeting date parsed out of
 * the filename. Two published spellings occur: "8.10.26" and "August 10".
 */
export function parseAgendaDocuments(
  html: string,
  documentsFolder: string,
): DatedDocument[] {
  const docs: DatedDocument[] = [];
  const pattern = new RegExp(
    `href="(${documentsFolder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^"]+\\.pdf)[^"]*"`,
    "gi",
  );

  for (const match of html.matchAll(pattern)) {
    const href = match[1];
    const file = href.slice(href.lastIndexOf("/") + 1);

    let year: number | null = null;
    let month: number | null = null;
    let day: number | null = null;

    const numeric = /(\d{1,2})\.(\d{1,2})\.(\d{2,4})/.exec(file);
    if (numeric) {
      month = Number(numeric[1]);
      day = Number(numeric[2]);
      year = Number(numeric[3]);
      if (year < 100) year += 2000;
    } else {
      const worded = /([A-Za-z]+)\s+(\d{1,2})/.exec(file);
      if (worded && MONTHS[worded[1].toLowerCase()]) {
        month = MONTHS[worded[1].toLowerCase()];
        day = Number(worded[2]);
        // The page is one running archive; a filename with no year takes the
        // year the sibling numeric-dated files carry. It is only a match key —
        // nothing renders it.
        year = new Date().getFullYear();
      }
    }
    if (year === null || month === null || day === null) continue;
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;

    const lower = file.toLowerCase();
    const kind = /agenda|packet/.test(lower)
      ? "agenda"
      : /notice/.test(lower)
        ? "notice"
        : "other";

    docs.push({ href, year, month, day, kind });
  }
  return docs;
}

/** Site-absolute URL for a document href, cache-buster stripped, encoded. */
function documentUrl(base: string, href: string): string {
  const clean = href.split("?")[0];
  return `${base}/${clean.split("/").map(encodeURIComponent).join("/")}`;
}

export function makeRevizeSource(
  wiringRows: BodySourceWiring[],
  fetchImpl?: typeof fetch,
): ReportingMeetingSource<RevizeRaw> {
  const normalizeWithDrops = (
    raw: RevizeRaw[],
    now: Date = new Date(),
  ): Accounted<{ meetings: Meeting[]; drops: NormalizeDropCounts }> => {
    const meetings: Meeting[] = [];
    const drops: NormalizeDropCounts = {
      placeless: 0,
      unknownVenue: 0,
      unplaceableInTime: 0,
      notConfigured: 0,
    };

        // Counted per logical record: an upcoming-block item or a dated document set.
    let considered = 0;
    let duplicates = 0;
        // `placeless` and `unknownVenue` tally sittings that are then
        // PRODUCED, so neither is a drop.
    let keptButPlaceless = 0;

    for (const { wiring, homepageHtml, agendaPageHtml, collectedAt } of raw) {
      const documents = parseAgendaDocuments(
        agendaPageHtml,
        wiring.config.documentsFolder,
      );

      for (const item of parseUpcomingBlock(homepageHtml)) {
        considered += 1;
        // Only the wired body's meetings; the block also lists other bodies.
        if (
          wiring.config.titleMatch &&
          !item.title.includes(wiring.config.titleMatch)
        ) {
          drops.notConfigured++;
          continue;
        }

        const d = DATE_AT_TIME.exec(`${item.dateText} @ ${item.timeText}`);
        if (!d) {
          drops.unplaceableInTime++;
          continue;
        }
        const month = MONTHS[d[1].toLowerCase()];
        if (!month) {
          drops.unplaceableInTime++;
          continue;
        }
        let hour = Number(d[4]) % 12;
        if (d[6].toUpperCase() === "PM") hour += 12;
        const year = Number(d[3]);
        const day = Number(d[2]);
        const startsAt = toZonedIso(
          year,
          month,
          day,
          hour,
          Number(d[5]),
          wiring.timeZone,
        );

        /*
         * No place never suppresses the sitting; each case is kept with no pin:
         * a venue line naming no building is online (`placeless`), a venue line
         * with no reviewed row is the publisher's own words
         * (`STATED_NOT_PLACED`), and an item with no venue line is the
         * publisher's own gap (`NOT_STATED_BY_PUBLISHER`), both `unknownVenue`.
         */
        const online = item.venueText && isPlacelessLocation(item.venueText)
          ? { label: item.venueText, joinUrl: null }
          : null;
        if (online) {
          drops.placeless++;
          keptButPlaceless += 1;
        }
        const venue = online || !item.venueText
          ? null
          : resolveVenue(SOURCE_NAME, wiring.ocdId, item.venueText) ?? null;
        const venueGap = !online && !venue ? unplacedVenueGap(item.venueText, wiring.publishingOrg) : null;
        if (venueGap) {
          drops.unknownVenue++;
          keptButPlaceless += 1;
        }

        // The agenda (or, failing that, the statutory notice) whose filename
        // dates to this meeting, as observed on the page — never constructed.
        const dated = documents.filter(
          (doc) => doc.year === year && doc.month === month && doc.day === day,
        );
        const agenda =
          dated.find((doc) => doc.kind === "agenda") ??
          dated.find((doc) => doc.kind === "notice") ??
          null;

        const pageUrl = `${wiring.config.base}/${wiring.config.agendaPage}`;

        meetings.push({
          id: `${SOURCE_NAME}:${wiring.config.slug}:${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
          ocdId: wiring.ocdId,
          bodyId: wiring.bodyId,
          bodyName: wiring.config.bodyName ?? item.title,
          title: item.title,
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
          agendaUrl: agenda ? documentUrl(wiring.config.base, agenda.href) : null,
          jurisdiction: wiring.jurisdiction,
          status: Date.parse(startsAt) < now.getTime() ? "CONCLUDED" : "SCHEDULED",
          provenance: {
            sourceUrl: pageUrl,
            sourceOrg: wiring.publishingOrg,
            collectedAt,
            verifiedAt: null,
          },
        });
      }

      // The archive rung: the notices page carries past sittings (one notice,
      // packet and minutes set each, filename-dated) but no start time, so
      // these rows carry `startPrecision: "DAY"` rather than a default hour.
      const pageUrl = `${wiring.config.base}/${wiring.config.agendaPage}`;
      const seen = new Set(meetings.map((m) => m.id));
      const venue = soleVenueForBody(SOURCE_NAME, wiring.ocdId);

      const dates = new Map<string, DatedDocument[]>();
      for (const doc of documents) {
        const key = `${doc.year}-${String(doc.month).padStart(2, "0")}-${String(doc.day).padStart(2, "0")}`;
        dates.set(key, [...(dates.get(key) ?? []), doc]);
      }

      for (const [key, docs] of dates) {
        considered += 1;
        const id = `${SOURCE_NAME}:${wiring.config.slug}:${key}`;
        // A date the upcoming block already produced with a REAL time wins.
        // The archive never overwrites a known hour with an unknown one.
        if (seen.has(id)) {
          // The same sitting arriving a second way is a duplicate.
          duplicates += 1;
          continue;
        }

        if (!venue) {
          /*
           * The notices page states no place for any sitting, so the sitting is
           * published with our own place-not-recorded gap, counted
           * `unknownVenue`.
           */
          drops.unknownVenue++;
          keptButPlaceless += 1;
        }

        const [y, m, d] = key.split("-").map(Number);
        // Local midnight: an ordering position, not a claim. See
        // `Meeting.startPrecision`.
        const startsAt = toZonedIso(y, m, d, 0, 0, wiring.timeZone);
        const agenda =
          docs.find((doc) => doc.kind === "agenda") ??
          docs.find((doc) => doc.kind === "notice") ??
          null;

        meetings.push({
          id,
          ocdId: wiring.ocdId,
          bodyId: wiring.bodyId,
          bodyName: wiring.config.bodyName ?? wiring.publishingOrg,
          title: wiring.config.bodyName ?? wiring.publishingOrg,
          startsAt,
          startPrecision: "DAY",
          timeZone: wiring.timeZone,
          location: venue
            ? {
                name: venue.name,
                address: venue.address,
                lat: venue.lat,
                lng: venue.lng,
              }
            : null,
          agendaUrl: agenda ? documentUrl(wiring.config.base, agenda.href) : null,
          jurisdiction: wiring.jurisdiction,
          status:
            Date.parse(startsAt) < now.getTime() ? "CONCLUDED" : "SCHEDULED",
          provenance: {
            sourceUrl: pageUrl,
            sourceOrg: wiring.publishingOrg,
            collectedAt,
            verifiedAt: null,
          },
        });
      }
    }

    return accountedNormalize(SOURCE_NAME, raw, { meetings, drops }, {
      logicalInput: considered,
      duplicates,
      // Every `placeless` and `unknownVenue` here tallies a sitting that is then produced.
      countedButProduced: keptButPlaceless,
    });
  };

  return {
    name: SOURCE_NAME,

    // The archive rung clips nothing off the back, so this source's window is
    // the publisher's. Carry-forward reads this; the reader still only sees the
    // serving window, which `lib/meetings/query.ts` clips independently.
    publishedLookbackDays: null,

    async fetch(query?: MeetingQuery): Promise<RevizeRaw[]> {
      const collected: RevizeRaw[] = [];
      for (const wiring of wiringRows) {
        const home = await politeGetText(`${wiring.config.base}/`, {
          fetchImpl,
          signal: query?.signal,
        });
        const agendas = await politeGetText(
          `${wiring.config.base}/${wiring.config.agendaPage}`,
          { fetchImpl, signal: query?.signal },
        );
        collected.push({
          wiring,
          homepageHtml: home.text,
          agendaPageHtml: agendas.text,
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
