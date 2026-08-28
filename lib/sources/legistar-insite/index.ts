/**
 * @freshness-reads-here
 *
 * RULING 107 — the clock stamps in this file are minted by the code path that
 * performs the read: `collectedAt` is taken at the moment of the fetch.
 */
import { haversineKm } from "../../geo/distance.ts";
import {
  CONCLUDED_LOOKBACK_DAYS,
  UPCOMING_HORIZON_DAYS,
} from "../../meetings/constants.ts";
import { toZonedIso } from "../../time/zoned.ts";
import { isPlaceless } from "../legistar/clients.ts";
import {
  accountedNormalize,
  type Accounted,
} from "../normalize-account.ts";
import {
  sittingKey,
  type SittingFieldProvenance,
} from "../event-identity.ts";
import type {
  Meeting,
  MeetingQuery,
  MeetingStatus,
  NormalizeDropCounts,
  PartialScopeFailure,
  ReportingMeetingSource,
} from "../types.ts";

import {
  calendarFeedUrl,
  dateRangePostback,
  parseCalendarFeed,
  parseCalendarRows,
  parseInSiteIcal,
  parseGridPager,
  renderedRange,
  type InSiteCalendarRow,
  type InSiteGridPager,
  type InSiteRange,
} from "./calendar.ts";
import { InSiteSession } from "./http.ts";
import {
  INSITE_TENANTS,
  findTenant,
  findTenantVenue,
  isWiredBody,
  type InSiteTenant,
} from "./tenants.ts";

/**
 * **Legistar InSite — the vendor's own portal, read directly.** (2026-08-28.)
 *
 * ## The false conclusion this exists to retire
 *
 * A prior session measured that `webapi.legistar.com/v1/pima/events` returns
 * **zero rows for September 2026**, reconciled the seven August rows it did
 * return, and recorded that Pima's September sittings "exist only as a
 * recurring schedule rule". The measurement reproduces exactly and is true. The
 * inference was false: the sittings are individually published records, on the
 * county's own portal, with a date, a time, a room and a meeting kind —
 * including a **1:00 PM study session on 8 September** that no recurrence rule
 * in this repository could have produced, because the committed rule text gives
 * study sessions no time at all.
 *
 * Reconciling proves nothing was DROPPED. It never proves enough was ASKED FOR.
 *
 * ## What the API actually filters on
 *
 * Not agenda status, and not data it lacks. `/events` returns only the sittings
 * whose InSite meeting-detail page is **publicly viewable**; the ones it omits
 * have no WebAPI record at all (40 of 40 probed ids 404 on the item endpoint),
 * and the two routes number their meetings in disjoint id spaces. The
 * discriminator is `class="meeting_NotViewable"` in the portal's calendar grid.
 *
 * Three tenants, one day, one filter:
 *
 * | tenant | grid rows | not viewable | returned by `/events` |
 * | --- | --- | --- | --- |
 * | Mesa | 15 | 12 | exactly the 3 viewable |
 * | Phoenix | 8 | 8 | 0 |
 * | Pima | 3 | 3 | 0 |
 *
 * **Every wired Legistar tenant was silently losing its unpublished future
 * sittings.** That is a class defect, not a Pima one.
 *
 * ## The two publication clocks
 *
 * InSite published Pima's 22 September sitting on **15 June** — 74 days of
 * notice, read off the calendar RSS `pubDate`. The WebAPI's lead time across 32
 * Pima 2026 events is **max 5 days, median 0, min -2**. The Legistar adapter's
 * 60-day forward window is therefore asking that route for roughly ten times
 * more than it can ever return, and no amount of asking it harder changes that.
 * A vendor's public API and its public web UI are DIFFERENT RECORDS WITH
 * DIFFERENT PUBLICATION CLOCKS.
 *
 * ## What this adapter is not
 *
 * It is not a replacement. `/events` carries the agenda file, the agenda items
 * and the D19 acting-body join; the grid carries none of those. Both routes
 * ship, both keep their own provenance, and `sittingKey` in
 * `lib/sources/event-identity.ts` is what stops one sitting rendering twice.
 *
 * ## Permission
 *
 * `pima.legistar.com` and `mesa.legistar.com` return **404 for robots.txt** —
 * no rules published, read 2026-08-28. The `legistar.com` apex publishes
 * `Crawl-delay: 2` and disallows only `*?wtime` / `*?wmediaid` / `*?wchannelid`,
 * none of which this adapter requests. The delay is honoured for the whole
 * vendor. **`pima.granicus.com` publishes `Disallow: /` and is NOT fetched by
 * anything here** — see `GRANICUS_LIVE_PROCEEDINGS_WALL` below.
 */
const SOURCE_NAME = "legistar-insite";

/**
 * **A PERMISSION WALL, RECORDED SO IT IS NEVER RE-WALKED ON A CLOCK.**
 *
 * `pima.granicus.com/robots.txt` publishes `User-agent: * / Disallow: /` —
 * read 2026-08-28. Its "Live Proceedings" surface is therefore not retrieved by
 * this adapter or by anything else in this repository.
 *
 * **No claim is made about what it holds.** A disallow is a rule about US, not
 * a fact about the record: it is not evidence that the page is empty, that it
 * duplicates the portal, or that it adds nothing. RULING 182 — permission state
 * and transport state are orthogonal — and `docs/policies/discovery` is
 * explicit that a permission refusal is not re-tried on a recheck clock the way
 * a transport wall is. A different route to the same facts (a records request,
 * a published feed, an agreement with the vendor) remains open and is where the
 * next attempt belongs.
 */
export const GRANICUS_LIVE_PROCEEDINGS_WALL = {
  host: "pima.granicus.com",
  rule: "User-agent: * / Disallow: /",
  readAt: "2026-08-28",
  state: "PERMISSION_DISALLOWED" as const,
  /** Deliberately empty of any statement about the content behind it. */
  claimAboutContent: null,
};

const WINDOW_FORWARD_DAYS = UPCOMING_HORIZON_DAYS;
const WINDOW_BACK_DAYS = CONCLUDED_LOOKBACK_DAYS;

/**
 * The grid ranges this adapter drives, in order.
 *
 * The vocabulary is the DROPDOWN'S OWN — read off the page rather than invented
 * — and it is not complete: the same control also offers "This Week", "Next
 * Year", "All Years" and every year back to 2013. Those are rungs this adapter
 * has not needed, not ranges that do not exist.
 *
 * **Three calendar months, not one year, and the reason is pagination.** The
 * single-request alternative was "This Year", and it is a trap: Mesa's "This
 * Year" answers `items 1 to 100 of 148` behind a two-page pager, so a parse of
 * that page returns 100 rows and a clean 200 for a range holding 148. Three
 * modest ranges stay inside the grid's own page size on every tenant measured,
 * and `parseGridPager` checks rather than assumes — a window that comes back
 * paged is reported as an incomplete enumeration and never as the answer.
 *
 * The cost is reach: "Last Month" through "Next Month" is roughly 30 to 60 days
 * back, against a 90-day serving lookback. That is an adapter that fetches less
 * history than the app serves — a stated limit, not a claim that the portal
 * holds no more. The portal holds every year back to 2013 and paging the grid
 * is the rung that gets them.
 */
export const RANGES: InSiteRange[] = ["Last Month", "This Month", "Next Month"];

/** One tenant's portal reading. The raw layer holds documents, never conclusions. */
export interface LegistarInSiteRaw {
  slug: string;
  /** The page every window below was posted back to. */
  calendarUrl: string;
  windows: {
    range: InSiteRange;
    /**
     * What the returned page said it was showing.
     *
     * Checked because an ASP.NET postback missing a field answers **200 with
     * the page it already had** — the filter silently unchanged. A range that
     * did not take is a failed retrieval wearing a successful status code, and
     * it is recorded here rather than parsed as if it had worked.
     */
    rendered: string | null;
    html: string;
    /**
     * What the grid's own pager said this range holds. Null when the page
     * rendered no pager — one page, nothing to reconcile against.
     */
    pager: InSiteGridPager | null;
  }[];
  /**
   * The calendar RSS, when it was read. **`null` is not `""`** — null means
   * nobody asked or the feed refused, and the publication clock is then absent
   * rather than zero.
   */
  feedXml: string | null;
  feedUrl: string | null;
  /** Per-meeting iCalendar bodies, keyed by InSite id, for rows the grid could not time. */
  icalByInsiteId: Record<string, string>;
  collectedAt: string;
}

/** `M/D/YYYY` as the grid prints it. */
function gridDate(raw: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw.trim());
  if (!match) return null;
  return { year: Number(match[3]), month: Number(match[1]), day: Number(match[2]) };
}

/** `h:mm AM/PM`, the only format the grid emits. */
function gridTime(raw: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(raw.trim());
  if (!match) return null;
  const rawHour = Number(match[1]);
  const minute = Number(match[2]);
  if (rawHour < 1 || rawHour > 12 || minute > 59) return null;
  return {
    hour: (rawHour % 12) + (match[3].toUpperCase() === "PM" ? 12 : 0),
    minute,
  };
}

/**
 * The portal has **no cancellation field**, exactly like the WebAPI.
 *
 * A clerk who calls a sitting off says so in the row's own free text — the
 * `<em>` meeting kind, or the location. Deliberately narrow, and deliberately
 * not widened into guesswork: **a meeting wrongly marked canceled keeps someone
 * at home.** Nothing in the recorded Pima or Mesa fixtures matches it, so this
 * path has no live positive and must not grow one by inference.
 */
function isCanceled(row: InSiteCalendarRow): boolean {
  return [row.kind ?? "", row.location, row.bodyName].some((field) =>
    /\bcancell?ed\b/i.test(field),
  );
}

export interface InSiteNormalizeResult {
  meetings: Meeting[];
  drops: NormalizeDropCounts;
  /**
   * **A-004 — completeness is never inferred from a successful read.**
   *
   * One entry per range whose grid came back PAGED: the pager published a
   * total, and the page in hand held fewer rows than that. The retrieval
   * succeeded and the ENUMERATION did not, and those are different facts. It
   * rides on the existing partial-scope channel so carry-forward preserves
   * exactly the scope that fell short and no other.
   */
  partialScopes: PartialScopeFailure[];
  /** Which route supplied each field of each meeting — one row per meeting. */
  provenance: SittingFieldProvenance[];
}

/**
 * Turn portal documents into meetings.
 *
 * Pure: every clock it needs is a parameter, and every document it reads is in
 * `raw`. `now` decides SCHEDULED against CONCLUDED and bounds the served
 * window.
 */
export function normalizeWithDrops(
  raw: LegistarInSiteRaw[],
  now: Date = new Date(),
): Accounted<InSiteNormalizeResult> {
  const meetings: Meeting[] = [];
  const provenance: SittingFieldProvenance[] = [];
  const partialScopes: PartialScopeFailure[] = [];
  const drops: NormalizeDropCounts = {
    placeless: 0,
    unknownVenue: 0,
    unplaceableInTime: 0,
    notConfigured: 0,
  };

  // A-002 · counted in the unit the disposition happens in. One raw row is one
  // tenant and carries many grid rows across several ranges.
  let considered = 0;
  let duplicates = 0;
  let outOfWindow = 0;
  // D18: an online-only sitting is TALLIED as placeless and then PRODUCED.
  let keptButPlaceless = 0;
  // A tenant whose portal refused every range holds no documents at all.
  let unretrieved = 0;

  const backEdge = now.getTime() - WINDOW_BACK_DAYS * 86_400_000;
  const forwardEdge = now.getTime() + WINDOW_FORWARD_DAYS * 86_400_000;

  for (const reading of raw) {
    const tenant = findTenant(reading.slug);
    if (!tenant) {
      // The tenant list is this adapter's own registry, so a raw row naming a
      // slug it does not hold is a configuration fact, counted as one.
      drops.notConfigured++;
      continue;
    }
    if (reading.windows.length === 0) {
      unretrieved += 1;
      continue;
    }

    const published = publicationClock(reading);
    const seen = new Set<string>();

    for (const window of reading.windows) {
      const rows = parseCalendarRows(window.html);

      /*
       * **THE GRID PAGES AT 100 AND PUBLISHES ITS TOTAL.** A range that came
       * back short is an INCOMPLETE ENUMERATION and is reported as one — the
       * same failure this adapter exists to correct, one layer down: a route
       * answering completely about the part it chose to send. Mesa's "This
       * Year" is the measured case, `items 1 to 100 of 148`.
       *
       * It rides on A-004's partial-scope channel so carry-forward preserves
       * exactly the scope that fell short and no other, and so that
       * completeness is never inferred from a successful read.
       */
      if (window.pager && rows.length < window.pager.totalItems) {
        partialScopes.push({
          scope: window.range === "Next Month" ? "UPCOMING" : "ARCHIVE",
          ocdIds: [tenant.ocdId],
          cause:
            `${tenant.host} Calendar.aspx "${window.range}" came back paged: page ` +
            `${window.pager.page} of ${window.pager.pageCount}, items ` +
            `${window.pager.firstItem}-${window.pager.lastItem} of ${window.pager.totalItems}; ` +
            `${rows.length} row(s) read. This range is INCOMPLETE, not empty.`,
        });
      }

      for (const row of rows) {
        considered += 1;

        if (!isWiredBody(tenant, row.bodyName)) {
          drops.notConfigured++;
          continue;
        }

        // The same sitting can appear under two ranges when a range boundary
        // falls inside the served window. Neither produced nor dropped.
        const dedupeRef = row.insiteId ?? `${row.date}|${row.time}|${row.bodyName}`;
        if (seen.has(dedupeRef)) {
          duplicates += 1;
          continue;
        }
        seen.add(dedupeRef);

        const date = gridDate(row.date);
        const time = gridTime(row.time) ?? icalTime(reading, row);
        if (!date || !time) {
          drops.unplaceableInTime++;
          continue;
        }

        const startsAt = toZonedIso(
          date.year,
          date.month,
          date.day,
          time.hour,
          time.minute,
          tenant.timeZone,
        );
        const at = Date.parse(startsAt);
        if (at < backEdge || at > forwardEdge) {
          outOfWindow += 1;
          continue;
        }

        const location = row.location.trim();
        if (!location) {
          drops.unknownVenue++;
          continue;
        }

        // D18 — a meeting held online is KEPT. `label` is the published string
        // verbatim; the portal publishes no join link on the grid, so
        // `joinUrl` is null and renders as the gap it is.
        const online = isPlaceless(location) ? { label: location, joinUrl: null } : null;
        if (online) {
          drops.placeless++;
          keptButPlaceless += 1;
        }

        const venue = online ? null : findTenantVenue(tenant, location);
        if (!online && !venue) {
          drops.unknownVenue++;
          continue;
        }

        const id = `${SOURCE_NAME}:${tenant.slug}:${row.insiteId ?? dedupeRef}`;
        const origin = `https://${tenant.host}`;

        meetings.push({
          id,
          ocdId: tenant.ocdId,
          bodyId: tenant.bodyId,
          bodyName: row.bodyName,
          // The `<em>` is what distinguishes one sitting from another on the
          // same day — "Study Session" against a regular meeting. Where there
          // is none, the body name is the most specific true thing available.
          title: row.kind ?? row.bodyName,
          startsAt,
          timeZone: tenant.timeZone,
          location: venue
            ? {
                name: venue.name,
                address: venue.address,
                lat: venue.lat,
                lng: venue.lng,
              }
            : null,
          ...(online ? { online } : {}),
          /*
           * Null when the portal says "Not Available", which is the state
           * every sitting the WebAPI cannot see is in. It renders as the
           * NAMED GAP it is — the body has not posted an agenda — and is
           * never filled with the portal's own search page dressed up as one.
           */
          agendaUrl:
            row.agenda.href && !/not available/i.test(row.agenda.status)
              ? `${origin}/${row.agenda.href.replace(/^\//, "")}`
              : null,
          jurisdiction: tenant.jurisdiction,
          status: isCanceled(row)
            ? "CANCELED"
            : ((at < now.getTime() ? "CONCLUDED" : "SCHEDULED") satisfies MeetingStatus),
          provenance: {
            /*
             * The page the row was read from. A not-viewable sitting has NO
             * public detail page — that is the whole finding — so constructing
             * a `MeetingDetail.aspx` link for it would be a fabricated
             * citation pointing at a door that does not open. The grid is
             * where the fact is published, and the grid is what is cited.
             */
            sourceUrl: row.detailHref
              ? `${origin}/${row.detailHref.replace(/^\//, "")}`
              : reading.calendarUrl,
            // The PUBLIC BODY, not Granicus. The county authored the notice.
            sourceOrg: tenant.publishingOrg,
            collectedAt: reading.collectedAt,
            verifiedAt: null,
          },
        });

        const key = sittingKey({
          bodyId: tenant.bodyId,
          ocdId: tenant.ocdId,
          jurisdiction: tenant.jurisdiction,
          startsAt,
          timeZone: tenant.timeZone,
        });
        provenance.push({
          meetingId: id,
          key: key ?? "",
          fields: {
            bodyName: "INSITE_CALENDAR_GRID",
            startsAt: gridTime(row.time)
              ? "INSITE_CALENDAR_GRID"
              : "INSITE_ICAL_EXPORT",
            title: "INSITE_CALENDAR_GRID",
            location: "INSITE_CALENDAR_GRID",
            agendaUrl: "INSITE_CALENDAR_GRID",
            ...(row.insiteId && published.has(row.insiteId)
              ? { firstPublishedAt: "INSITE_CALENDAR_RSS" as const }
              : {}),
          },
          insiteId: row.insiteId,
          insiteGuid: row.insiteGuid,
          // This route has no WebAPI record for the rows it exists to recover —
          // stated as null rather than omitted, because the absence IS the
          // finding.
          legistarEventId: null,
          firstPublishedAt: row.insiteId ? published.get(row.insiteId) ?? null : null,
        });
      }
    }
  }

  return accountedNormalize(
    SOURCE_NAME,
    raw,
    { meetings, drops, partialScopes, provenance },
    {
      logicalInput: considered,
      duplicates,
      outOfWindow,
      unretrieved,
      countedButProduced: keptButPlaceless,
    },
  );
}

/**
 * When the publisher itself first published each sitting, by InSite id.
 *
 * From the calendar RSS `pubDate`, which is the only place either route states
 * it. An empty map means no feed was read — never "these were published now".
 */
function publicationClock(reading: LegistarInSiteRaw): Map<string, string> {
  const clock = new Map<string, string>();
  if (!reading.feedXml) return clock;
  for (const item of parseCalendarFeed(reading.feedXml)) {
    if (!item.insiteId || !item.pubDate) continue;
    const at = Date.parse(item.pubDate);
    if (Number.isFinite(at)) clock.set(item.insiteId, new Date(at).toISOString());
  }
  return clock;
}

/**
 * The wall clock from the per-meeting iCalendar export, when the grid's own
 * time cell could not be read.
 *
 * **`DTSTART` is FLOATING** — `20260908T130000`, no `Z` and no `TZID` — so it
 * is returned as the hour and minute that were written and combined with the
 * tenant's zone by the caller. Reading it as UTC would move a 1:00 PM study
 * session to 6:00 AM, silently.
 */
function icalTime(
  reading: LegistarInSiteRaw,
  row: InSiteCalendarRow,
): { hour: number; minute: number } | null {
  if (!row.insiteId) return null;
  const body = reading.icalByInsiteId[row.insiteId];
  if (!body) return null;
  const event = parseInSiteIcal(body);
  if (!event?.start) return null;
  return { hour: event.start.hour, minute: event.start.minute };
}

/** Is any of this tenant's known venues inside the query radius? */
function withinRadius(tenant: InSiteTenant, query: MeetingQuery): boolean {
  return tenant.venues.some(
    (venue) => haversineKm(query.lat, query.lng, venue.lat, venue.lng) <= query.radiusKm,
  );
}

export function makeLegistarInSiteSource(
  options: { fetchImpl?: typeof fetch; tenants?: InSiteTenant[] } = {},
): ReportingMeetingSource<LegistarInSiteRaw> {
  const tenants = options.tenants ?? INSITE_TENANTS;

  return {
    name: SOURCE_NAME,

    async fetch(query: MeetingQuery): Promise<LegistarInSiteRaw[]> {
      const collected: LegistarInSiteRaw[] = [];

      // Serialized across tenants as well as within one. Nothing here runs
      // concurrently, and the session paces itself at the vendor's stated
      // `Crawl-delay: 2`.
      for (const tenant of tenants) {
        if (!withinRadius(tenant, query)) continue;

        const session = new InSiteSession({ fetchImpl: options.fetchImpl });
        const calendarUrl = `https://${tenant.host}/Calendar.aspx`;

        const first = await session.get(calendarUrl, "text/html,application/xhtml+xml");
        const windows: LegistarInSiteRaw["windows"] = [];
        let latest = first.text;

        for (const range of RANGES) {
          const rendered = renderedRange(latest);
          if (rendered === range) {
            windows.push({ range, rendered, html: latest, pager: parseGridPager(latest) });
            continue;
          }
          const posted = await session.postForm(
            calendarUrl,
            dateRangePostback(latest, range),
          );
          latest = posted.text;
          windows.push({
            range,
            rendered: renderedRange(latest),
            html: latest,
            pager: parseGridPager(latest),
          });
        }

        /*
         * The RSS link is read off the page in hand rather than constructed:
         * `Feed.ashx`'s ID/GUID pair is minted per tenant AND per range, so a
         * pair written into a config file is only ever true of the range it was
         * recorded under. The refusal path returns null, and null means the
         * publication clock is unknown — never that a sitting was published now.
         */
        let feedXml: string | null = null;
        const feedUrl = calendarFeedUrl(latest, `https://${tenant.host}`);
        if (feedUrl) {
          try {
            feedXml = (await session.get(feedUrl, "application/rss+xml, application/xml")).text;
          } catch (error) {
            console.warn(
              `  ${SOURCE_NAME}: calendar feed unavailable for ${tenant.slug} — ${error}; ` +
                "this reading records NO publication clock rather than an empty one",
            );
          }
        }

        /*
         * The per-meeting iCalendar export is a FALLBACK RUNG, not a per-row
         * fetch. The grid already publishes the date, the time, the room and
         * the kind; asking the portal fifteen more times per tenant per refresh
         * to re-read what it has already told us is rude and, at two seconds a
         * request, would outrun the scheduled job's per-source budget. It is
         * requested only for a row whose own time cell could not be read.
         *
         * `GUID` is mandatory: `View.ashx?M=IC&ID=…` alone answers 200 with a
         * 19 KB HTML confirmation page, so the document marker is declared and
         * a page that is not a calendar is a WALL rather than a timeless row.
         */
        const icalByInsiteId: Record<string, string> = {};
        for (const window of windows) {
          for (const row of parseCalendarRows(window.html)) {
            if (gridTime(row.time) || !row.insiteId || !row.insiteGuid) continue;
            if (icalByInsiteId[row.insiteId]) continue;
            try {
              const ics = await session.get(
                `https://${tenant.host}/View.ashx?M=IC&ID=${row.insiteId}&GUID=${row.insiteGuid}`,
                "text/calendar",
              );
              if (/BEGIN:VCALENDAR/.test(ics.text)) icalByInsiteId[row.insiteId] = ics.text;
            } catch (error) {
              console.warn(
                `  ${SOURCE_NAME}: iCalendar export unavailable for ${tenant.slug}/${row.insiteId} — ${error}`,
              );
            }
          }
        }

        collected.push({
          slug: tenant.slug,
          calendarUrl,
          windows,
          feedXml,
          feedUrl,
          icalByInsiteId,
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
      // Same honest lie the other adapters tell until the Phase 5 schema lands.
      return { inserted: 0, updated: meetings.length };
    },
  };
}
