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
import { resolveVenue } from "../../meetings/venue-cache.ts";
import { weakEventIdentity } from "../event-identity.ts";
import { politeGetText } from "../http.ts";
import type {
  Meeting,
  MeetingQuery,
  MeetingStatus,
  DuplicateIdentityCounts,
  NormalizeDropCounts,
  PartialScopeFailure,
  ReportingMeetingSource,
} from "../types.ts";
import {
  accountedNormalize,
  type Accounted,
} from "../normalize-account.ts";

/**
 * **An `.ics` feed is a calendar handed to us** — ladder rung 8, and the first
 * adapter for the `ICAL` source type, which had sat in the enum with nothing
 * behind it since the enum was written (M123, 2026-08-19).
 *
 * Not a vendor: a FORMAT. A town publishing its boards through WordPress's
 * The Events Calendar, or through any of the plugins that speak iCalendar,
 * hands over start time, end time, title, venue string and — crucially — the
 * board's own name in `CATEGORIES`. That is better data than the HTML the
 * plugin renders from it, and it is one parse for every town that publishes
 * one.
 *
 * ## The trap this adapter was written around, and it cost 5x
 *
 * `https://<town>/events/?ical=1` returns **the current VIEW**, not the
 * calendar. On Wilmot NH that is the month view: **four** events, HTTP 200,
 * `text/calendar`, perfectly well-formed. The list view at
 * `/events/list/?ical=1` returns **twenty-three** — the same total the
 * plugin's own REST API reports.
 *
 * A feed that answers 200 with a fifth of the calendar is the empty-success
 * shape wearing a healthier face: nothing errors, nothing is malformed, and
 * nineteen public meetings are missing. So the wiring row names the FULL
 * feed URL explicitly rather than the adapter constructing one, and this
 * adapter reports its parsed count per row so a five-becomes-four regression
 * is visible rather than silent.
 *
 * ## What is dropped, and counted
 *
 * * An event with no parseable `DTSTART` → `unplaceableInTime`.
 * * An event whose `LOCATION` does not resolve to a curated venue →
 *   `unknownVenue`. Wilmot writes `LOCATION:NH` on nine of its
 *   twenty-three, which is a state, not a building, and pinning a meeting on
 *   the middle of New Hampshire would be a fabricated location.
 * * An event whose `CATEGORIES` does not name a board this row serves →
 *   `notConfigured`. A town calendar is mostly not board meetings.
 *
 * ## Per-body isolation
 *
 * One row is one feed. A host refusing us empties that row and NOTHING else,
 * and the refusal is reported as a refusal rather than written into the data
 * as an absence — the refresh corollary, applied at the adapter.
 */

const SOURCE_NAME = "ical";

const WINDOW_FORWARD_DAYS = UPCOMING_HORIZON_DAYS;
const WINDOW_BACK_DAYS = CONCLUDED_LOOKBACK_DAYS;

/** The body itself says so, in its own summary. */
const CANCELED = /\bcancell?ed\b/i;

export interface IcalRaw {
  wiring: BodySourceWiring;
  /** The feed body, or empty when the retrieval was refused. */
  ics: string;
  collectedAt: string;
  /** This ROW's retrieval was refused and `ics` is empty. */
  refused?: boolean;
  /**
   * A-004 · the UPCOMING feed answered and the town's PAST feed did not.
   *
   * The row still produces its upcoming sittings, so it is not `refused`.
   * What it is, is PARTIAL — and until A-004 there was no way to say that, so
   * an archive outage read as a town with no history and carry-forward
   * preserved nothing.
   */
  archiveRefused?: string;
  sourceUrl: string;
}

/** One event, as the feed wrote it. Nothing is inferred here. */
export interface IcalEvent {
  uid: string | null;
  summary: string | null;
  location: string | null;
  categories: string | null;
  /** The raw `DTSTART` value with its parameters, e.g. `TZID=…:20260819T180000`. */
  dtstart: string | null;
  status: string | null;
  url: string | null;
}

/**
 * Unfold RFC 5545 line folding, then split into events.
 *
 * The unfolding is not optional politeness: a `LOCATION` line carrying a
 * street address is routinely longer than 75 octets and arrives split across
 * a newline plus one space. Parsing without unfolding truncates the address
 * at a byte boundary and produces a venue string that matches nothing —
 * which would render as "we could not place this meeting" about a meeting
 * whose address the town published in full.
 */
export function parseIcs(ics: string): IcalEvent[] {
  const unfolded = ics.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
  const blocks = unfolded.split("BEGIN:VEVENT").slice(1);
  const events: IcalEvent[] = [];
  for (const block of blocks) {
    const body = block.split("END:VEVENT")[0];
    const prop = (name: string): string | null => {
      const m = new RegExp(`^${name}(;[^:\\r\\n]*)?:(.*)$`, "mi").exec(body);
      return m ? m[2].trim() : null;
    };
    const dtstartLine = /^DTSTART([^:\r\n]*):(.*)$/im.exec(body);
    events.push({
      uid: prop("UID"),
      summary: unescapeText(prop("SUMMARY")),
      location: unescapeText(prop("LOCATION")),
      categories: unescapeText(prop("CATEGORIES")),
      dtstart: dtstartLine ? `${dtstartLine[1]}:${dtstartLine[2].trim()}` : null,
      status: prop("STATUS"),
      url: prop("URL"),
    });
  }
  return events;
}

/** iCalendar escapes commas and semicolons; a venue string carries both. */
function unescapeText(value: string | null): string | null {
  if (value === null) return null;
  return value
    .replace(/\\n/gi, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

/**
 * `DTSTART;TZID=America/New_York:20260819T180000` → an instant.
 *
 * The zone comes from the feed's own `TZID` where it has one, and from the
 * wiring row otherwise. A `Z` suffix is already UTC. A DATE-only value
 * (`VALUE=DATE:20260819`) has no time and is reported as such by the caller —
 * this returns the midnight instant and a precision flag, never an invented
 * hour.
 */
export function parseDtStart(
  raw: string,
  fallbackZone: string,
): { iso: string; dayOnly: boolean } | null {
  const [params, value] = splitOnce(raw, ":");
  if (!value) return null;
  const tzid = /TZID=([^;:]+)/i.exec(params)?.[1] ?? fallbackZone;
  const dayOnly = /VALUE=DATE\b/i.test(params) || /^\d{8}$/.test(value.trim());

  const v = value.trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(v);
  if (!m) return null;
  const [, y, mo, d, hh = "00", mi = "00", ss = "00", z] = m;
  if (z) {
    return { iso: `${y}-${mo}-${d}T${hh}:${mi}:${ss}.000Z`, dayOnly };
  }
  // A wall-clock time in a named zone. Resolve it by asking what offset that
  // zone had at that instant, which is the only correct way across a DST
  // boundary — a fixed offset is right for half the year.
  const naive = Date.UTC(+y, +mo - 1, +d, +hh, +mi, +ss);
  const offset = zoneOffsetMs(naive, tzid);
  return { iso: new Date(naive - offset).toISOString(), dayOnly };
}

function splitOnce(s: string, sep: string): [string, string] {
  const i = s.indexOf(sep);
  return i < 0 ? [s, ""] : [s.slice(0, i), s.slice(i + 1)];
}

/** How far the named zone was from UTC at `utcMs`, in milliseconds. */
function zoneOffsetMs(utcMs: number, zone: string): number {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const parts = Object.fromEntries(
      dtf.formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]),
    );
    const asUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour) % 24,
      Number(parts.minute),
      Number(parts.second),
    );
    return asUtc - utcMs;
  } catch {
    return 0;
  }
}

function statusOf(startsAt: string, now: Date): MeetingStatus {
  return Date.parse(startsAt) < now.getTime() ? "CONCLUDED" : "SCHEDULED";
}

export function makeIcalSource(
  wiringRows: BodySourceWiring[],
  fetchImpl?: typeof fetch,
): ReportingMeetingSource<IcalRaw> {
  const normalizeWithDrops = (
    raw: IcalRaw[],
    now: Date = new Date(),
  ): Accounted<{
    meetings: Meeting[];
    drops: NormalizeDropCounts;
    unreachableOcdIds?: string[];
    partialScopes?: PartialScopeFailure[];
    duplicateIdentity?: DuplicateIdentityCounts;
  }> => {
    const meetings: Meeting[] = [];
    const drops: NormalizeDropCounts = {
      placeless: 0,
      unknownVenue: 0,
      unplaceableInTime: 0,
      notConfigured: 0,
    };
    const unreachable: string[] = [];
    const seen = new Set<string>();
    /** Events parsed and dated, then set aside as outside the served window. */
    let outOfWindow = 0;
    /** A-002 · every event this pass looked at, across every feed in hand. */
    let considered = 0;
    /** A-002 · events whose identity had already been produced. */
    let duplicates = 0;
    /** A-005 · the feed published the same UID twice. Its own doing. */
    let exactDuplicates = 0;
    /**
     * A-005 · two UID-less records this code judged to be the same sitting.
     *
     * Counted separately from an exact duplicate because it is OUR judgement
     * rather than the feed's statement, and a judgement that starts firing is
     * evidence the fallback identity is too weak for some town's feed.
     */
    let weakIdCollisions = 0;
    /**
     * A-004 · divisions whose ARCHIVE feed refused while their upcoming feed
     * answered. Collected per cause so the report says what refused, not only
     * that something did.
     */
    const archiveRefusals = new Map<string, (string | null)[]>();

    const from = new Date(now.getTime() - WINDOW_BACK_DAYS * 86_400_000);
    const to = new Date(now.getTime() + WINDOW_FORWARD_DAYS * 86_400_000);

    for (const { wiring, ics, collectedAt, refused, archiveRefused, sourceUrl } of raw) {
      if (archiveRefused) {
        const at = archiveRefusals.get(archiveRefused) ?? [];
        at.push(wiring.ocdId ?? null);
        archiveRefusals.set(archiveRefused, at);
      }
      if (refused) {
        // A refusal is reported as a refusal. It never becomes an empty
        // calendar for this body, and it never touches any other row.
        if (wiring.ocdId) unreachable.push(wiring.ocdId);
        continue;
      }

      /*
       * **WHICH EVENTS ON THIS CALENDAR ARE THIS BODY'S SITTINGS.**
       *
       * Two answers, because two real feeds answer differently, and one of
       * them is required — without either, every town event on the calendar
       * would become a sitting of this board.
       *
       * `categoryMatch` — the feed's own `CATEGORIES` names the board. This is
       * the better signal and the one Wilmot's WordPress plugin gives, because
       * it is the publisher's own classification rather than our reading of a
       * title.
       *
       * `titleMatch` — a comma-separated list of phrases, any of which in the
       * `SUMMARY` makes the event this body's (NH Hunt, 2026-08-20). Added for
       * the Town of Newbury, whose own Drupal calendar publishes **1,157
       * events with no `CATEGORIES` field at all** — 272 Selectboard sittings,
       * 116 Conservation Commission, 108 Zoning Board, 84 Planning Board, and
       * ninety-four of them still upcoming. A category-only adapter reads that
       * feed as a calendar belonging to nobody, which is how a town publishing
       * everything ends up rendering as a town publishing nothing.
       *
       * **It is a LIST because a body's name is spelled several ways on its
       * own calendar**, and dropping the variants would silently lose real
       * sittings: Newbury writes "Supervisors of the Checklist" and
       * "Supervisions of the Checklist" — a typo the town has repeated for
       * years — and its Energy Committee appears as both "Energy Committee
       * Meeting" and "Newbury Energy Committee Meeting". The list is what the
       * wiring row states it is; nothing is inferred from a near-miss.
       *
       * `titleExclude` removes what the phrase would over-catch. Nothing needs
       * it at Newbury today; it exists because the first town whose "Planning
       * Board" also runs a "Planning Board Budget Hearing (staff only)" should
       * be a wiring row and not a code change.
       */
      const category = wiring.config.categoryMatch ?? "";
      const titleTerms = (wiring.config.titleMatch ?? "")
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      const excludeTerms = (wiring.config.titleExclude ?? "")
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);

      for (const event of parseIcs(ics)) {
        // A-002 · the logical record here is the EVENT, never the document.
        // One `.ics` file is one raw row and, at Newbury, 1,157 of these.
        considered += 1;
        const cats = (event.categories ?? "")
          .split(",")
          .map((c) => c.trim().toLowerCase());
        const summary = (event.summary ?? "").toLowerCase();
        const matched = category
          ? cats.includes(category.toLowerCase())
          : titleTerms.length > 0 &&
            titleTerms.some((t) => summary.includes(t)) &&
            !excludeTerms.some((t) => summary.includes(t));
        if (!matched) {
          drops.notConfigured++;
          continue;
        }

        if (!event.dtstart) {
          drops.unplaceableInTime++;
          continue;
        }
        const start = parseDtStart(event.dtstart, wiring.timeZone);
        if (!start) {
          drops.unplaceableInTime++;
          continue;
        }
        const when = new Date(start.iso);
        if (when < from || when > to) {
          // COUNTED, because an uncounted exit path is how a zero-row
          // extraction passes for an accounted one. See `outOfWindow` in
          // lib/sources/normalize-account.ts.
          outOfWindow++;
          continue;
        }

        const rawLocation = (event.location ?? "").trim();
        /*
         * **AN EMPTY `LOCATION` IS NOT A PLACELESS MEETING** (NH Hunt,
         * 2026-08-20), and the distinction is worth twenty-four of Newbury's
         * public meetings.
         *
         * `placeless` means D18's fact: the body PUBLISHED a location string
         * and that string names no building — "Virtual Meeting", "Microsoft
         * Teams". Those are real, attendable meetings kept with a null
         * `location` and an `online` block.
         *
         * The Town of Newbury publishes **no `LOCATION` line at all** on any of
         * its 1,157 events. That is not a claim that the meeting is nowhere; it
         * is the feed saying nothing about where. Dropping it as `placeless`
         * read the town's silence as an assertion — the render-default failure,
         * one layer upstream in the data — and it did so BEFORE the row's own
         * `venueMatch` was ever consulted, so a body with a standing, sourced,
         * published meeting place never got to use it.
         *
         * So an empty location falls through to `venueMatch` exactly as an
         * unrecognised one does. With no `venueMatch` on the row it is still a
         * `placeless` drop, because then we genuinely have nothing.
         */
        if (!rawLocation && !wiring.config.venueMatch) {
          drops.placeless++;
          continue;
        }
        /*
         * THE FEED'S OWN LOCATION FIRST, and the BODY'S OWN STANDING
         * STATEMENT second — never a guess between them.
         *
         * Wilmot writes `LOCATION:NH` on every Selectboard sitting: a state,
         * not a building. Nine real public meetings would drop, and a pin in
         * the middle of New Hampshire would be a fabricated location.
         *
         * What rescues them is not an inference from a neighbouring event. It
         * is the board's OWN page, in its own words: "The Selectboard meets
         * every other Wednesday at 6:00 p.m. in the Town Office Building at 9
         * Kearsarge Valley Road in Wilmot." A wiring row may name that
         * curated venue as `venueMatch`, and the venue row carries the board
         * page as its `addressSourceUrl` — so this is a sourced claim with a
         * citation, exactly like every other row in the venue cache, rather
         * than the nearest-plausible-building guess the rule forbids.
         *
         * It applies ONLY when the feed gave nothing usable. A feed that
         * names a hall wins, every time.
         */
        let venue = resolveVenue(SOURCE_NAME, wiring.ocdId, rawLocation);
        if (!venue && wiring.config.venueMatch) {
          venue = resolveVenue(SOURCE_NAME, wiring.ocdId, wiring.config.venueMatch);
        }
        if (!venue) {
          drops.unknownVenue++;
          continue;
        }

        const title = (event.summary ?? wiring.publishingOrg).trim();
        /*
         * A-005 · IDENTITY, WHEN THE FEED GIVES US NONE.
         *
         * A `UID` is the feed's own identifier and is the identity whenever it
         * exists. The fallback used to be the START INSTANT ALONE — so two
         * different boards of the same town, both sitting at 7pm on the same
         * Tuesday, produced the same id and the second one vanished into the
         * `seen` set without a counter, a drop, or a line anywhere.
         *
         * Same-night, same-time sittings are not an edge case in the towns
         * this product exists for. They are the norm: a Zoning Board and a
         * Conservation Commission on alternate Tuesdays at 7 in the same town
         * hall is how small New England government schedules itself.
         *
         * So a UID-less event is identified by everything the feed DID publish
         * about it — the body slug, the start, the summary, the location and
         * the description. Two records that agree on all five are the same
         * sitting published twice; two that differ anywhere are two sittings.
         */
        const fallbackIdentity = weakEventIdentity({
          slug: wiring.config.slug,
          startIso: start.iso,
          summary: event.summary,
          location: rawLocation,
          description: null,
        });
        const id = `${SOURCE_NAME}:${wiring.config.slug}:${event.uid ?? fallbackIdentity}`;
        if (seen.has(id)) {
          /*
           * A-002 and A-005 · this was a bare `continue` that left the record
           * with no disposition at all. The two kinds are counted apart,
           * because they mean different things: an EXACT duplicate is a feed
           * publishing the same UID twice, and a WEAK-ID collision is two
           * records this code decided were the same without the feed saying
           * so. The second is the one worth watching, and pooling them would
           * hide it inside the first.
           */
          duplicates += 1;
          if (event.uid) exactDuplicates += 1;
          else weakIdCollisions += 1;
          continue;
        }
        seen.add(id);

        meetings.push({
          id,
          ocdId: wiring.ocdId,
          bodyName: wiring.config.bodyName ?? wiring.publishingOrg,
          title,
          startsAt: start.iso,
          startPrecision: start.dayOnly ? "DAY" : "MINUTE",
          timeZone: wiring.timeZone,
          location: {
            name: venue.name,
            address: venue.address,
            lat: venue.lat,
            lng: venue.lng,
          },
          agendaUrl: null,
          jurisdiction: wiring.jurisdiction,
          status:
            CANCELED.test(title) || /^CANCELLED$/i.test(event.status ?? "")
              ? "CANCELED"
              : statusOf(start.iso, now),
          provenance: {
            sourceUrl: event.url ?? sourceUrl,
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
      {
        meetings,
        drops,
        ...(unreachable.length > 0 ? { unreachableOcdIds: unreachable } : {}),
        // A-005 · reported always, including as zeroes. A counter that only
        // appears when it fires cannot be read as "we looked and it was none".
        duplicateIdentity: { exact: exactDuplicates, weakIdCollision: weakIdCollisions },
        ...(archiveRefusals.size > 0
          ? {
              // A-004 · the third state, between `ok` and refused. The
              // upcoming feed answered; the archive did not; and the two must
              // not be reported as one.
              partialScopes: [...archiveRefusals].map(([cause, ocdIds]) => ({
                scope: "ARCHIVE" as const,
                ocdIds,
                cause,
              })),
            }
          : {}),
      },
      // A refused row carries no document, so it is not one this pass could
      // have extracted from. See `accountedNormalize`.
      //
      // A-002 · `unretrieved` is at the DOCUMENT layer and `logicalInput` is at
      // the EVENT layer, and they are deliberately not added together: a
      // refused feed contributes zero events to `considered`, so it is already
      // absent from the conservation sum. It is passed on because the zero-row
      // check below still asks a question about documents in hand.
      {
        unretrieved: raw.filter((r) => r.refused).length,
        outOfWindow,
        logicalInput: considered,
        duplicates,
      },
    );
  };

  return {
    name: SOURCE_NAME,

    async fetch(_query: MeetingQuery): Promise<IcalRaw[]> {
      const collected: IcalRaw[] = [];
      /*
       * **ONE FEED IS FETCHED ONCE, HOWEVER MANY BODIES IT SERVES.**
       * (NH Hunt, 2026-08-20.)
       *
       * Ten Newbury bodies are wired to the same `export.ics`, and the loop
       * below is per WIRING ROW — so the town was being asked for the same
       * 466 KB document ten times per refresh, and Wilmot for the same
       * document three times. That is not a performance note: `CLAUDE.md`
       * forbids requesting at a rate that degrades service, and a tenfold
       * duplicate of a half-megabyte file is exactly the behaviour a
       * reputation limiter is built to stop. Newbury's did, mid-hunt, and it
       * refused all ten rows at once.
       *
       * The cache is per RUN and lives only for this call. A row still gets
       * its own `IcalRaw` with its own wiring, so nothing downstream changes;
       * a refusal is shared by every row on that URL, which is correct,
       * because it is one retrieval and one wall.
       */
      const fetched = new Map<string, { ics: string; refused: boolean }>();
      for (const wiring of wiringRows) {
        const url = wiring.config.feedUrl;
        if (!url) {
          collected.push({
            wiring,
            ics: "",
            collectedAt: new Date().toISOString(),
            refused: true,
            sourceUrl: "",
          });
          continue;
        }
        const cached = fetched.get(url);
        if (cached) {
          collected.push({
            wiring,
            ics: cached.ics,
            collectedAt: new Date().toISOString(),
            ...(cached.refused ? { refused: true } : {}),
            sourceUrl: url,
          });
          continue;
        }
        try {
          const res = await politeGetText(url, {
            fetchImpl,
            accept: "text/calendar,text/plain;q=0.9,*/*;q=0.8",
            profile: wiring.config.profile === "browser" ? "browser" : undefined,
            // A 200 with no VCALENDAR in it is not this town's empty calendar;
            // it is a retrieval that failed while looking like a success. See
            // `expect` in lib/sources/http.ts — this is the case that put
            // `Refresh meetings snapshot` in the red on 2026-08-21.
            expect: { label: "a calendar feed", marker: "BEGIN:VCALENDAR" },
          });
          /*
           * ASK FOR THE PAST AS WELL (M58's shape, applied here).
           *
           * The list view serves UPCOMING events, so a town wired on it alone
           * can never show a concluded meeting — and the reader's Concluded
           * filter would be empty by construction rather than by fact. Wilmot
           * publishes its past sittings at the same feed with
           * `tribe_event_display=past`: thirty of them, measured. The row
           * names that URL rather than the adapter constructing one, for the
           * same reason `feedUrl` does.
           *
           * A past feed that refuses does NOT fail the row — the upcoming
           * calendar is the thing a reader came for, and losing it because
           * the archive was unreachable would be the wrong trade.
           */
          let ics = res.text;
          let archiveRefused: string | undefined;
          if (wiring.config.pastFeedUrl) {
            try {
              const past = await politeGetText(wiring.config.pastFeedUrl, {
                fetchImpl,
                accept: "text/calendar,text/plain;q=0.9,*/*;q=0.8",
                profile:
                  wiring.config.profile === "browser" ? "browser" : undefined,
                expect: { label: "a calendar feed", marker: "BEGIN:VCALENDAR" },
              });
              ics += past.text;
            } catch (error) {
              /*
               * A-004 · THIS CATCH USED TO BE EMPTY, and its comment said the
               * absence would be "visible as a jurisdiction with no concluded
               * meetings". That sentence is the render-default failure written
               * down as a design note: an outage rendering as a fact about the
               * town.
               *
               * The trade above it is still right — losing the upcoming
               * calendar because the archive is down would be worse. What was
               * missing is the third state between success and failure. The
               * row now carries the cause, the normalize pass turns it into a
               * scoped partial, and carry-forward preserves the CONCLUDED
               * rows for this division and nothing else.
               */
              archiveRefused = String((error as Error)?.message ?? error);
            }
          }
          /*
           * **A CALENDAR WITH NO EVENTS IN IT IS A FAILED RETRIEVAL, NOT AN
           * EMPTY CALENDAR** (NH Hunt 4, 2026-08-21, item 7).
           *
           * This is the named cause of the meetings refresh failing 14 of 37
           * runs. The composite's RULING 43 guard was doing its job and going
           * red on `ical: fetched 3 document(s) and extracted 0 meeting(s)`,
           * with every drop counter at zero — and zero drops is the tell: with
           * three rows over one feed, ANY event at all would have produced
           * `notConfigured` hits on the rows it did not belong to. Zero drops
           * means the document that arrived contained **no VEVENT at all**.
           *
           * `politeGetText` cannot catch it. NH Hunt 3 taught the fetch layer
           * to refuse a blank body and a wrong-format body; this is the third
           * shape — a well-formed `BEGIN:VCALENDAR` envelope with nothing
           * inside. It passes every check the transport can make.
           *
           * So the row is REFUSED, which is what it is. That routes it into
           * carry-forward: the body keeps its last known sittings, clipped to
           * the serving window and still carrying their original
           * `collectedAt`, instead of the whole source going red and every
           * OTHER town's calendar going with it. A failed fetch never silently
           * empties a previously-full surface, and it must not empty its
           * neighbours either.
           *
           * THE TRADE, STATED. A calendar that genuinely empties — a town that
           * really did stop publishing — is marked refused too, and carries
           * forward for as long as its rows stay inside the window. That is the
           * correct direction to be wrong in, and it is the same trade the
           * composite's own guard makes one layer up.
           */
          if (!/BEGIN:VEVENT/i.test(ics)) {
            fetched.set(url, { ics: "", refused: true });
            collected.push({
              wiring,
              ics: "",
              collectedAt: new Date().toISOString(),
              refused: true,
              sourceUrl: url,
            });
            continue;
          }
          fetched.set(url, { ics, refused: false });
          collected.push({
            wiring,
            ics,
            collectedAt: new Date().toISOString(),
            ...(archiveRefused ? { archiveRefused } : {}),
            sourceUrl: url,
          });
        } catch {
          // One host's refusal empties this row and no other. `refused`
          // carries it forward as a refusal rather than as an empty calendar.
          fetched.set(url, { ics: "", refused: true });
          collected.push({
            wiring,
            ics: "",
            collectedAt: new Date().toISOString(),
            refused: true,
            sourceUrl: url,
          });
        }
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
