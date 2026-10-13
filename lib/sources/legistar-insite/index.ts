/**
 * @freshness-reads-here
 *
 * The clock stamps here are minted by the code path that performs the read: `collectedAt` is taken at
 * the moment of the fetch.
 */
import { unplacedVenueGap } from "../../meetings/venue-cache.ts";
import { observationFromGridCell } from "../../outcomes/publication.ts";
import type { AgendaPublicationObservation } from "../../outcomes/publication.ts";
import {
  MEETING_HELD_HORIZON_DAYS,
  MEETING_HELD_LOOKBACK_DAYS,
} from "../../meetings/constants.ts";
import { toZonedIso } from "../../time/zoned.ts";
import { isPlaceless, venuesWithinRadius } from "../legistar/client-registry.ts";
import {
  accountedNormalize,
  type Accounted,
} from "../normalize-account.ts";
import {
  localWallClock,
  sittingKey,
  sittingKeyFromLocal,
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
  gridPagePostback,
  parseCalendarFeed,
  parseCalendarRows,
  parseInSiteIcal,
  parseGridNoRecords,
  parseGridPager,
  parseGridPageTargets,
  renderedRange,
  type InSiteCalendarRow,
  type InSiteGridPager,
  type InSiteRange,
} from "./calendar.ts";
import { parseClerkSchedule } from "./clerk-schedule.ts";
import {
  MEETING_PRODUCING_ROUTES,
  openObligations,
  richerRouteLink,
  summarizeRoute,
  timelessInstances,
  unionFutureInstances,
  type DispositionVerdict,
  type InstanceDisposition,
  type ProducedVendorRecord,
  type RicherRouteLink,
  type RouteInstance,
  type RouteObservation,
  type UnionInstance,
} from "./horizon.ts";
import { InSiteSession } from "./http.ts";
import {
  INSITE_TENANTS,
  inSiteTenantsFromWiring,
  findTenantVenue,
  isWiredBody,
  type InSiteTenant,
} from "./tenant-registry.ts";

/**
 * Legistar InSite: the vendor's own portal, read directly.
 *
 * `webapi.legistar.com/v1/{client}/events` returns only sittings whose InSite meeting-detail page is
 * publicly viewable; the others have no WebAPI record at all and the two routes number meetings in
 * disjoint id spaces. The discriminator is `class="meeting_NotViewable"` in the portal's calendar grid, so
 * every Legistar tenant loses its unpublished future sittings through the API alone. The API and the web
 * UI also have different publication clocks: the portal can publish months ahead while the API carries
 * only days.
 *
 * Not a replacement: `/events` carries the agenda file, agenda items and the acting-body join, which the
 * grid does not. Both routes ship with their own provenance, and `sittingKey` in
 * `lib/sources/event-identity.ts` stops one sitting rendering twice.
 *
 * Tenant hosts publish no robots.txt rules; the `legistar.com` apex publishes `Crawl-delay: 2`, honoured
 * for the whole vendor, and disallows only paths this adapter never requests.
 */
const SOURCE_NAME = "legistar-insite";


const WINDOW_BACK_DAYS = MEETING_HELD_LOOKBACK_DAYS;

/**
 * This adapter does not clip the future. What a publisher has published and what this application
 * currently serves are different facts; `lib/meetings/query.ts` clips reads to the serving horizon on
 * every read. Rows past the serving horizon carry a `BEYOND_APP_SERVING_HORIZON` disposition, so the gap
 * between what we hold and what a reader sees is a stated number.
 */
const SERVING_HORIZON_DAYS = MEETING_HELD_HORIZON_DAYS;

/**
 * The grid ranges this adapter drives, in order, in the dropdown's own vocabulary. "This Year" pages at 100
 * rows, so its pager is walked (`parseGridPageTargets`). "Next Year" is included: its emptiness is accepted
 * only when the grid renders `rgNoRecords` and "No records were found."; a zero without that sentence is a
 * wall.
 */
export const RANGES: InSiteRange[] = [
  "Last Month",
  "This Month",
  "Next Month",
  "This Year",
  "Next Year",
];

/**
 * The ranges to drive on `now`. The held window reaches back `WINDOW_BACK_DAYS`; when that crosses into the
 * prior calendar year, "Last Year" is read first too. Otherwise the set is `RANGES`.
 */
export function rangesAt(now: Date): InSiteRange[] {
  const backYear = new Date(now.getTime() - WINDOW_BACK_DAYS * 86_400_000).getUTCFullYear();
  return backYear < now.getUTCFullYear() ? ["Last Year", ...RANGES] : [...RANGES];
}

/**
 * How many pages of one range this run will walk before reporting the enumeration incomplete. A budget on
 * this run (each page is a paced request), never a completion condition: `partialScopes` reports the
 * pager's total beside the count actually read.
 */
export const MAX_GRID_PAGES = 6;

/**
 * The ranges whose window can contain a date later than today, so an incomplete enumeration is attributed
 * to the right scope for carry-forward.
 */
const REACHES_FUTURE = new Set<InSiteRange>([
  "This Week",
  "Next Week",
  "This Month",
  "Next Month",
  "This Year",
  "Next Year",
  "All Years",
]);

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
    /**
     * Every FURTHER page of this range that was walked, in page order, each
     * with the pager the page itself rendered.
     *
     * Empty for an unpaged range. It is a separate field rather than more
     * entries in `windows` because the pages are one range's answer and must
     * reconcile against ONE published total — a flattened list would let a
     * later reader count the same range's total twice.
     */
    pages: { page: number; html: string; pager: InSiteGridPager | null }[];
    /**
     * The grid saying, in its own words, that it holds nothing: true only for `class="rgNoRecords"` plus "No
     * records were found." A zero-row window with this `false` is a failed retrieval.
     */
    noRecords: boolean;
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
  /**
   * The body's own clerk schedule table, when the tenant declares one and it was retrieved. `null` means
   * nobody asked or the page refused, never that no schedule is published. Corroboration and disposition
   * evidence only; see `./clerk-schedule.ts`.
   */
  clerkScheduleHtml: string | null;
  clerkScheduleUrl: string | null;
  /** Why the declared clerk page was not read on this run, when it was not. */
  clerkScheduleNote?: string;
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
 * The portal has no cancellation field. A clerk who calls a sitting off says so in the row's free text
 * (the `<em>` kind or the location). Deliberately narrow: a meeting wrongly marked canceled keeps someone
 * at home.
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
   * Completeness is never inferred from a successful read: one entry per range whose pager published a total
   * larger than the rows in hand. Rides the partial-scope channel so carry-forward preserves exactly the
   * scope that fell short.
   */
  partialScopes: PartialScopeFailure[];
  /** Which route supplied each field of each meeting — one row per meeting. */
  provenance: SittingFieldProvenance[];
  /**
   * **What each first-party route actually answered about the future**, with
   * its mechanism, its observation time, its counts, its earliest and latest
   * instance, and how complete the enumeration was. One row per route per
   * tenant, including the routes that answered nothing and the one no adapter
   * reads yet.
   */
  routes: RouteObservation[];
  /**
   * The publisher's own statement about each sitting's agenda, one per produced sitting, with what the cell
   * said and when we read it. `lib/ask/agenda-publication.ts` decides what may be said from them.
   */
  publicationObservations: AgendaPublicationObservation[];
  /**
   * **THE ACCEPTANCE SET.** Every future sitting published by ANY route,
   * deduplicated on `(bodyId, local date, local time)`, each carrying the
   * routes that published it and `onlyOn` when exactly one did.
   */
  union: UnionInstance[];
  /**
   * Why each union instance is or is not in front of a reader — as DATA,
   * carrying the publisher's own words. `unaccounted()` is asserted empty
   * against this: an instance that is neither produced nor dispositioned is a
   * sitting the product lost quietly.
   */
  dispositions: InstanceDisposition[];
  /**
   * What this run still owes a reader, derived from `dispositions` by `openObligations`. Every one is also
   * emitted as an incomplete `UPCOMING` scope in `partialScopes`, the only field that survives the composite
   * boundary.
   */
  openObligations: InstanceDisposition[];
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
  tenants: readonly InSiteTenant[] = INSITE_TENANTS,
): Accounted<InSiteNormalizeResult> {
  const meetings: Meeting[] = [];
  const provenance: SittingFieldProvenance[] = [];
  const partialScopes: PartialScopeFailure[] = [];
  const routes: RouteObservation[] = [];
  const tenantUnions: UnionInstance[] = [];
  const dispositions: InstanceDisposition[] = [];
  /** What the portal said about each sitting's agenda, kept. See `lib/outcomes/publication.ts`. */
  const publicationObservations: AgendaPublicationObservation[] = [];
  /*
   * The instant this normalize ran, which is the instant the grid HTML in hand
   * was read. `now` is injected by the caller and defaults to the clock, so a
   * test gets a fixed observation time and a real refresh gets a true one.
   */
  const observedAt = now.toISOString();
  /** Canonical keys this run actually produced a `Meeting` for. */
  const producedKeys = new Set<string>();
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
  // An online-only sitting is tallied as placeless and produced; a sitting with no reviewed place is tallied
  // as unknownVenue and produced with its venue gap named.
  let keptButPlaceless = 0;
  // A tenant whose portal refused every range holds no documents at all.
  let unretrieved = 0;

  const backEdge = now.getTime() - WINDOW_BACK_DAYS * 86_400_000;
  /**
   * NOT a filter. The edge the app's own read clips at, carried here only so a
   * row past it can say so in its disposition. Nothing is discarded on it.
   */
  const servingEdge = now.getTime() + SERVING_HORIZON_DAYS * 86_400_000;

  for (const reading of raw) {
    const tenant = tenants.find((candidate) => candidate.slug === reading.slug);
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
    /** The tenant's own today. A "future" sitting is future where the body sits. */
    const tenantToday =
      localWallClock(now.toISOString(), tenant.timeZone)?.date ?? "0000-00-00";
    const gridInstances: RouteInstance[] = [];
    let gridComplete = true;
    let gridNote: string | null = null;
    /**
     * Why a future instance this adapter saw did not become a `Meeting`, or became one that still owes
     * something, keyed on canonical identity and recorded at the point of the decision. Two verdicts ride on a
     * produced sitting: `CANCELED_BY_PUBLISHER` and `VENUE_NOT_RESOLVED`.
     */
    const withheldBy = new Map<string, { verdict: DispositionVerdict; because: string }>();
    /**
     * Every sitting this tenant ACTUALLY PRODUCED, indexed by the vendor id the
     * producing route gave it — `"<space>:<id>"`.
     *
     * It is the only checkable cross-route link this adapter has, and it exists
     * so `SUPERSEDED_BY_RICHER_ROUTE` can be a precondition rather than a
     * fallback: the word "superseded" is a claim about ANOTHER record, and a
     * record nobody can look up is a guess. Per tenant, because an InSite id is
     * minted per portal and two tenants' numbers are not comparable.
     */
    const producedByVendorId = new Map<string, ProducedVendorRecord>();

    for (const window of reading.windows) {
      // Every page of this range is one range's answer. The pager total is
      // published once, so the rows are pooled before the comparison — a
      // per-page comparison would report every complete multi-page range as
      // short by design.
      const rows = [window.html, ...window.pages.map((p) => p.html)].flatMap(
        parseCalendarRows,
      );

      // A zero is only ever the publisher's zero. A range with no rows that did not render "No records were
      // found." is a failed extraction, reported as an incomplete enumeration for that scope.
      if (rows.length === 0 && !window.noRecords) {
        gridComplete = false;
        gridNote =
          `${tenant.host} Calendar.aspx "${window.range}" returned 0 rows and did NOT ` +
          'render "No records were found." A zero without the publisher\'s own ' +
          "sentence is a FAILED RETRIEVAL, never an empty calendar.";
        partialScopes.push({
          scope: "UPCOMING",
          ocdIds: [tenant.ocdId],
          cause: gridNote,
        });
      }

      // A range that came back short of the pager's published total is an incomplete enumeration, reported
      // through the partial-scope channel.
      if (window.pager && rows.length < window.pager.totalItems) {
        gridComplete = false;
        gridNote =
          `${tenant.host} Calendar.aspx "${window.range}" came back paged: ` +
          `${window.pages.length + 1} page(s) walked of ${window.pager.pageCount}, ` +
          `${rows.length} row(s) read of ${window.pager.totalItems} the pager published. ` +
          "This range is INCOMPLETE, not empty.";
        partialScopes.push({
          scope: REACHES_FUTURE.has(window.range) ? "UPCOMING" : "ARCHIVE",
          ocdIds: [tenant.ocdId],
          cause: gridNote,
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
        const local = localWallClock(startsAt, tenant.timeZone);

        // The future record this route published, captured before any of this adapter's own decisions can remove
        // it: the union is what the publisher said, including rows this adapter later declines to produce.
        if (local && local.date >= tenantToday) {
          gridInstances.push({
            route: "INSITE_CALENDAR_GRID",
            sourceUrl: reading.calendarUrl,
            observedAt: reading.collectedAt,
            bodyId: tenant.bodyId,
            date: local.date,
            time: local.time,
            kind: row.kind,
            location: row.location.trim() || null,
            vendorId: row.insiteId,
            vendorIdSpace: "insite",
            publishedText: `${row.date} ${row.time} ${row.bodyName}${
              row.kind ? ` — ${row.kind}` : ""
            }`.trim(),
          });
        }

        // Only the back edge clips; `lib/meetings/query.ts` clips reads to the serving horizon on every read.
        if (at < backEdge) {
          outOfWindow += 1;
          continue;
        }

        const futureKey =
          local && local.date >= tenantToday
            ? sittingKeyFromLocal({
                bodyId: tenant.bodyId,
                date: local.date,
                time: local.time,
              })
            : null;

        const location = row.location.trim();

        // D18 — a meeting held online is KEPT. `label` is the published string
        // verbatim; the portal publishes no join link on the grid, so
        // `joinUrl` is null and renders as the gap it is.
        const online = location && isPlaceless(location) ? { label: location, joinUrl: null } : null;
        if (online) {
          drops.placeless++;
          keptButPlaceless += 1;
        }

        const venue = online || !location ? null : findTenantVenue(tenant, location) ?? null;
        // No reviewed place never suppresses the sitting. A room name is never geocoded at runtime, so the sitting
        // is published with `location: null` and its gap: the location cell verbatim (`STATED_NOT_PLACED`), or the
        // publisher's silence for an empty cell (`NOT_STATED_BY_PUBLISHER`). Tallied as `unknownVenue` and
        // dispositioned `VENUE_NOT_RESOLVED`, an open obligation for the reviewed venue row.
        const venueGap = !online && !venue ? unplacedVenueGap(location, tenant.publishingOrg) : null;
        if (venueGap) {
          drops.unknownVenue++;
          keptButPlaceless += 1;
          if (futureKey) {
            withheldBy.set(futureKey, {
              verdict: "VENUE_NOT_RESOLVED",
              because: location
                ? `${tenant.host} published the location "${location}". OURS: this ` +
                  "tenant states no reviewed venue matching it, and a room name is never " +
                  "geocoded at runtime. The sitting IS published, with the publisher's " +
                  "words as its place and no pin; the reviewed venue row is what is owed."
                : `${tenant.host} Calendar.aspx published this sitting with an EMPTY ` +
                  "location cell. OURS: we hold no place for it and will not invent one. " +
                  "The sitting IS published, its place named as the publisher's own gap.",
            });
          }
        }

        const id = `${SOURCE_NAME}:${tenant.slug}:${row.insiteId ?? dedupeRef}`;
        const origin = `https://${tenant.host}`;

        // Keep the publisher's own reading: one per sitting, whatever the cell said.
        publicationObservations.push(
          observationFromGridCell({
            meetingId: id,
            status: row.agenda.status,
            href: row.agenda.href,
            calendarUrl: reading.calendarUrl,
            sourceOrg: tenant.publishingOrg,
            observedAt: observedAt,
          }),
        );

        meetings.push({
          id,
          ocdId: tenant.ocdId,
          bodyId: tenant.bodyId,
          bodyName: row.bodyName,
          // The `<em>` distinguishes one sitting from another on the same day; without one, the body name is the most
          // specific true thing available.
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
          ...(venueGap ? { venueGap } : {}),
          // Null when the portal says "Not Available", and never the portal's search page dressed up as an agenda.
          // The cell's own words are kept as an observation (`publicationObservations`); what may be said to a
          // reader is decided by `lib/ask/agenda-publication.ts` from that evidence.
          agendaUrl:
            row.agenda.href && !/not available/i.test(row.agenda.status)
              ? `${origin}/${row.agenda.href.replace(/^\//, "")}`
              : null,
          jurisdiction: tenant.jurisdiction,
          status: isCanceled(row)
            ? "CANCELED"
            : ((at < now.getTime() ? "CONCLUDED" : "SCHEDULED") satisfies MeetingStatus),
          provenance: {
            // The page the row was actually read from, and only that: we cite what we read. No detail page is fetched
            // on a refresh, so citing one would cite a document this run never opened. (`meeting_NotViewable` governs
            // the link the grid renders, not the detail page's reachability; see `INSITE_MEETING_DETAIL` in
            // `./horizon.ts`.)
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

        if (futureKey) {
          producedKeys.add(futureKey);
          if (row.insiteId && local) {
            // Indexed only for a row that BECAME a meeting. A link to a record
            // we did not produce would let one unserved sitting supersede
            // another, which is the inversion this index exists to prevent.
            producedByVendorId.set(`insite:${row.insiteId}`, {
              key: futureKey,
              date: local.date,
              time: local.time,
              route: "INSITE_CALENDAR_GRID",
            });
          }
          if (isCanceled(row)) {
            // Produced AND dispositioned: a canceled sitting still reaches the
            // reader — as canceled. The disposition records the publisher's own
            // words so nobody later reads the CANCELED status as our inference.
            withheldBy.set(futureKey, {
              verdict: "CANCELED_BY_PUBLISHER",
              because:
                "THEIRS: the publisher's own row text calls this sitting off — " +
                `"${row.kind ?? ""} ${row.location}".trim()`,
            });
          }
        }
      }
    }

    /*
     * ONE TENANT'S ROUTE TABLE, ITS UNION, AND EVERY INSTANCE'S DISPOSITION.
     *
     * Built after the windows because the union is a statement about the
     * TENANT, not about a range: an instance carried by "This Year" and not by
     * "Next Month" is one route asked twice, not two routes disagreeing.
     */
    const observations: RouteObservation[] = [
      summarizeRoute(
        "INSITE_CALENDAR_GRID",
        `${reading.calendarUrl} — ranges ${reading.windows.map((w) => `"${w.range}"`).join(", ")}`,
        reading.collectedAt,
        gridInstances,
        gridComplete ? "COMPLETE_AS_OBSERVED" : "INCOMPLETE",
        gridNote,
      ),
      feedObservation(reading, tenant, tenantToday),
      clerkObservation(reading, tenant, tenantToday),
    ];
    routes.push(...observations);

    const union = unionFutureInstances(observations);
    tenantUnions.push(...union);

    for (const instance of union) {
      const withheld = withheldBy.get(instance.key);
      const produced = producedKeys.has(instance.key);
      const at = Date.parse(
        toZonedIso(
          Number(instance.date.slice(0, 4)),
          Number(instance.date.slice(5, 7)),
          Number(instance.date.slice(8, 10)),
          Number(instance.time.slice(0, 2)),
          Number(instance.time.slice(3, 5)),
          tenant.timeZone,
        ),
      );

      // Supersession is a precondition: `richerRouteLink` must return a produced canonical meeting reached
      // through an id the two routes provably share. Otherwise the verdict is `PUBLISHED_BUT_UNPLACED_BY_US`, an
      // open obligation carrying the fields that would discharge it.
      const superseded: RicherRouteLink | null =
        withheld || produced ? null : richerRouteLink(instance, producedByVendorId);

      const verdict: DispositionVerdict = withheld
        ? withheld.verdict
        : produced && at > servingEdge
          ? "BEYOND_APP_SERVING_HORIZON"
          : produced
            ? "REPRESENTED_IN_READER"
            : superseded
              ? "SUPERSEDED_BY_RICHER_ROUTE"
              : "PUBLISHED_BUT_UNPLACED_BY_US";

      const missing =
        verdict === "PUBLISHED_BUT_UNPLACED_BY_US"
          ? missingForPlacement(instance, tenant)
          : null;

      dispositions.push({
        key: instance.key,
        bodyId: instance.bodyId,
        date: instance.date,
        time: instance.time,
        verdict,
        evidence: instance.observations.map((o) => ({
          route: o.route,
          sourceUrl: o.sourceUrl,
          observedAt: o.observedAt,
          quotedText: o.publishedText ?? `${o.date} ${o.time ?? "(no time published)"}`,
        })),
        claimAboutContent: dispositionClaim(
          verdict,
          withheld?.because ??
            (superseded
              ? supersessionClaim(superseded)
              : missing
                ? unplacedClaim(instance, tenant, missing)
                : null),
        ),
        ...(superseded ? { supersededBy: superseded } : {}),
        ...(missing ? { missingForPlacement: missing } : {}),
      });

      // `dispositions`, `union` and `routes` are dropped at the composite boundary; `partialScopes` is the one
      // channel a sitting we failed to place can use to reach the run's report and carry-forward. A published
      // sitting we did not produce is an incomplete UPCOMING enumeration for this division.
      if (verdict === "PUBLISHED_BUT_UNPLACED_BY_US" && missing) {
        partialScopes.push({
          scope: "UPCOMING",
          ocdIds: [tenant.ocdId],
          cause:
            `${instance.routes.join(", ")} published a ${instance.date} ${instance.time} ` +
            `sitting of ${tenant.bodyName} that ${tenant.host} Calendar.aspx did not carry, ` +
            `and this run did not place it. OURS, and OPEN — missing: ${missing.join("; ")}. ` +
            "This is NOT a claim that the sitting is unpublished.",
        });
      }
    }

    // A route record that named a meeting and published no hour cannot be keyed, so it never enters the union,
    // and it is still owed an explanation (`TIME_NOT_PUBLISHED`, quoting what the publisher wrote).
    for (const timeless of timelessInstances(observations)) {
      if (timeless.date < tenantToday) continue;
      dispositions.push({
        key: "",
        bodyId: timeless.bodyId,
        date: timeless.date,
        time: null,
        verdict: "TIME_NOT_PUBLISHED",
        evidence: [
          {
            route: timeless.route,
            sourceUrl: timeless.sourceUrl,
            observedAt: timeless.observedAt,
            quotedText: timeless.publishedText ?? timeless.date,
          },
        ],
        claimAboutContent:
          "OURS: this route named a sitting on this date and published no start " +
          "time, so it has no canonical identity and cannot be placed on a clock. " +
          "It is NOT a claim that the sitting is unscheduled.",
      });
    }
  }

  return accountedNormalize(
    SOURCE_NAME,
    raw,
    {
      meetings,
      drops,
      partialScopes,
      provenance,
      routes,
      union: tenantUnions,
      dispositions,
      publicationObservations,
      // DERIVED, never asserted: what is still owed is a property of the
      // dispositions, and a hand-maintained second list would drift from them.
      openObligations: openObligations(dispositions),
    },
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
 * Whose fact this verdict is, said out loud: every verdict states its owner in the first word, so "we
 * haven't recorded this yet" and a fact about the body never render as the same sentence.
 */
function dispositionClaim(verdict: DispositionVerdict, because: string | null): string | null {
  if (because) return because;
  switch (verdict) {
    case "REPRESENTED_IN_READER":
      return "This sitting reaches the reader with its own date, time, place and provenance.";
    case "BEYOND_APP_SERVING_HORIZON":
      return (
        "OURS, and only ours: collected, keyed, and carried in the snapshot. " +
        `It sits past this application's own ${SERVING_HORIZON_DAYS}-day held ` +
        "horizon (MEETING_HELD_HORIZON_DAYS in lib/meetings/constants.ts), the furthest we hold a " +
        "sitting for any source. It is NOT " +
        "a statement that the sitting is unpublished, uncertain or far off — the " +
        "county published it and we hold it."
      );
    // Both verdicts below are always given a specific `because` by the caller; these are floors that still say
    // something true and whose gap it is.
    case "SUPERSEDED_BY_RICHER_ROUTE":
      return (
        "THEIRS, then ours: a thinner route still carries this record, and the " +
        "SAME publisher record reaches the reader under another canonical " +
        "identity — see supersededBy, which names it. Nothing is missing."
      );
    case "PUBLISHED_BUT_UNPLACED_BY_US":
      return (
        "OURS, and OPEN: a first-party route published this sitting, the " +
        "meeting-producing route did not carry it, and we have not placed it. " +
        "Nothing superseded it. This is NOT a claim that the sitting is " +
        "unpublished, moved or uncertain — see missingForPlacement."
      );
    default:
      return null;
  }
}

/**
 * The named gap, in field terms: only fields that actually block construction are listed (a missing kind
 * is not one; `title` falls back to the body name). Never empty.
 */
function missingForPlacement(instance: UnionInstance, tenant: InSiteTenant): string[] {
  const missing: string[] = [];

  if (!instance.location) {
    missing.push(
      "a published location — no route carrying this sitting states a room or a " +
        "placeless label, and a place is never inferred",
    );
  } else if (!isPlaceless(instance.location) && !findTenantVenue(tenant, instance.location)) {
    missing.push(
      `a resolvable venue — the published location "${instance.location}" matches no ` +
        `venue this registry states for ${tenant.slug}, and a room name is never ` +
        "geocoded at runtime",
    );
  }

  // The identity limitation, stated even when every field is present: the routes that carried this sitting
  // are corroboration, and `SittingRoute` cannot name `CLERK_SCHEDULE_PAGE` as a field's supplier, so a
  // composed record could not carry honest per-field provenance today. Both are ours to fix.
  missing.push(
    `a record on a meeting-producing route (${MEETING_PRODUCING_ROUTES.join(", ")}) — ` +
      `this sitting is carried only by ${instance.routes.join(", ")}, which this adapter ` +
      "reads as corroboration; promoting one to an ingestion source is an ask-before",
  );

  return missing;
}

/** The `PUBLISHED_BUT_UNPLACED_BY_US` claim, naming the routes and the gap. */
function unplacedClaim(
  instance: UnionInstance,
  tenant: InSiteTenant,
  missing: string[],
): string {
  return (
    `OURS, and OPEN: ${instance.routes.join(", ")} — ` +
    `${instance.routes.length > 1 ? "first-party routes" : "a first-party route"}, published ` +
    `by ${tenant.publishingOrg} or its vendor — states a ${instance.date} ${instance.time} ` +
    `sitting of ${tenant.bodyName}, and WE have not placed it. ` +
    `${tenant.host} Calendar.aspx, the only route this adapter produces meetings from, ` +
    "did not carry it, and NOTHING SUPERSEDED IT. Missing: " +
    `${missing.join("; ")}. This is a gap in what this project has acquired and is NOT ` +
    "a statement that the sitting is unpublished, cancelled or uncertain."
  );
}

/** The `SUPERSEDED_BY_RICHER_ROUTE` claim, naming the record that stands in its place. */
function supersessionClaim(link: RicherRouteLink): string {
  return (
    `THEIRS, then ours: ${link.thinRoute} still carries this record` +
    `${link.quotedText ? ` — "${link.quotedText}"` : ""} — and it is the SAME ` +
    `publisher record as one we produce: ${link.route} numbers both ` +
    `${link.vendorIdSpace} ${link.vendorId}, and we serve it at ` +
    `${link.supersedingDate} ${link.supersedingTime}. The publisher moved the hour and ` +
    "the thinner route kept the earlier wording. The sitting REACHES THE READER under " +
    "that identity; this record is superseded, not lost, and the link is a shared " +
    "vendor id in one declared id space rather than a resemblance."
  );
}

/**
 * The calendar RSS as a route in its own right: it carries `pubDate`, the instant InSite first published
 * each sitting, and drops location and kind. The date and time come out of the item title, the only place
 * the feed states them: `Board of Supervisors - 12/15/2026 - 5:00 PM`.
 */
function feedObservation(
  reading: LegistarInSiteRaw,
  tenant: InSiteTenant,
  tenantToday: string,
): RouteObservation {
  const mechanism = reading.feedUrl ?? `https://${tenant.host}/Feed.ashx?M=Calendar`;
  if (!reading.feedXml) {
    return summarizeRoute(
      "INSITE_CALENDAR_RSS",
      mechanism,
      reading.collectedAt,
      [],
      "NOT_RETRIEVED",
      "No calendar RSS was read for this tenant on this run. The publication " +
        "clock is therefore UNKNOWN — never zero, and never a claim that the " +
        "feed is empty.",
    );
  }

  const instances: RouteInstance[] = [];
  for (const item of parseCalendarFeed(reading.feedXml)) {
    const match = /^(.*?)\s+-\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+-\s+(.+)$/.exec(item.title);
    if (!match) continue;
    if (!isWiredBody(tenant, match[1])) continue;
    const date = gridDate(match[2]);
    const time = gridTime(match[3]);
    if (!date) continue;
    const iso = `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
    if (iso < tenantToday) continue;
    instances.push({
      route: "INSITE_CALENDAR_RSS",
      sourceUrl: item.link || mechanism,
      observedAt: reading.collectedAt,
      bodyId: tenant.bodyId,
      date: iso,
      time: time
        ? `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`
        : null,
      // The feed publishes neither. Stated as null rather than omitted: this
      // route's silence about the room is a property of the ROUTE.
      kind: null,
      location: null,
      vendorId: item.insiteId,
      vendorIdSpace: "insite",
      publishedText: item.title,
    });
  }

  return summarizeRoute(
    "INSITE_CALENDAR_RSS",
    mechanism,
    reading.collectedAt,
    instances,
    "COMPLETE_AS_OBSERVED",
    "The ID/GUID pair was DISCOVERED on the calendar page in hand — it is minted " +
      "per tenant and per range, so a stored pair is only ever true of the range " +
      "it was recorded under.",
  );
}

/**
 * The clerk's own schedule table as a route: the body speaking for itself on its own domain. It produces no
 * meetings; it makes a disagreement between the county and its vendor visible. See `./clerk-schedule.ts`.
 */
function clerkObservation(
  reading: LegistarInSiteRaw,
  tenant: InSiteTenant,
  tenantToday: string,
): RouteObservation {
  const mechanism = reading.clerkScheduleUrl ?? tenant.clerkScheduleUrl ?? "(none declared)";
  if (!tenant.clerkScheduleUrl) {
    return summarizeRoute(
      "CLERK_SCHEDULE_PAGE",
      mechanism,
      reading.collectedAt,
      [],
      "NOT_RETRIEVED",
      `No clerk-schedule route is declared for ${tenant.slug}. That is a gap in ` +
        "THIS REGISTRY and nobody has looked — it is a fact about our own " +
        "coverage and states nothing whatever about what the body publishes.",
    );
  }
  if (!reading.clerkScheduleHtml) {
    return summarizeRoute(
      "CLERK_SCHEDULE_PAGE",
      mechanism,
      reading.collectedAt,
      [],
      "NOT_RETRIEVED",
      `${mechanism} was not read on this run${reading.clerkScheduleNote ? ` (${reading.clerkScheduleNote})` : ""}. ` +
        "Its instances are UNKNOWN, not absent.",
    );
  }

  const parsed = parseClerkSchedule(reading.clerkScheduleHtml);
  const instances: RouteInstance[] = parsed
    .filter((row) => row.date >= tenantToday)
    .map((row) => ({
      route: "CLERK_SCHEDULE_PAGE" as const,
      sourceUrl: mechanism,
      observedAt: reading.collectedAt,
      bodyId: tenant.bodyId,
      date: row.date,
      time: row.startTime,
      kind: row.kind,
      location: null,
      // The Clerk numbers nothing. Null rather than a synthesized id, because
      // an id we invented would look joinable and is not.
      vendorId: null,
      vendorIdSpace: null,
      publishedText: row.publishedText,
    }));

  return summarizeRoute(
    "CLERK_SCHEDULE_PAGE",
    mechanism,
    reading.collectedAt,
    instances,
    parsed.length > 0 ? "COMPLETE_AS_OBSERVED" : "NOT_RETRIEVED",
    parsed.length > 0
      ? "Read as CORROBORATION and disposition evidence. It produces no meetings — " +
        "promoting it to an ingestion source is an ask-before."
      : `${mechanism} rendered no table with a "Board Meeting" and "Meeting Type" ` +
        "header. That is a FAILED EXTRACTION — the page changed, or this parser no " +
        "longer matches it — and never a county with no schedule.",
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
 * The wall clock from the per-meeting iCalendar export, when the grid's own time cell could not be read.
 * `DTSTART` is floating (`20260908T130000`, no `Z`, no `TZID`), so the hour and minute are returned and
 * combined with the tenant's zone by the caller; reading it as UTC would shift the time silently.
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

export function makeLegistarInSiteSource(
  options: { fetchImpl?: typeof fetch; tenants?: InSiteTenant[] } = {},
): ReportingMeetingSource<LegistarInSiteRaw> {
  // Test callers may inject an explicit fixture list. Production membership
  // is always the installed meeting doors.
  const tenants = options.tenants ?? inSiteTenantsFromWiring();

  return {
    name: SOURCE_NAME,

    async fetch(query: MeetingQuery): Promise<LegistarInSiteRaw[]> {
      const collected: LegistarInSiteRaw[] = [];

      // Serialized across tenants as well as within one; the session paces itself at the vendor's
      // `Crawl-delay: 2`.
      for (const tenant of tenants) {
        // A tenant with no reviewed venue is read, never skipped for want of a coordinate.
        if (!venuesWithinRadius(tenant.venues, query)) continue;

        const session = new InSiteSession({
          fetchImpl: options.fetchImpl,
          signal: query.signal,
        });
        const calendarUrl = `https://${tenant.host}/Calendar.aspx`;

        const first = await session.get(calendarUrl, "text/html,application/xhtml+xml");
        const windows: LegistarInSiteRaw["windows"] = [];
        let latest = first.text;

        for (const range of rangesAt(new Date())) {
          if (renderedRange(latest) !== range) {
            latest = (
              await session.postForm(calendarUrl, dateRangePostback(latest, range))
            ).text;
          }

          const pager = parseGridPager(latest);
          const pages: LegistarInSiteRaw["windows"][number]["pages"] = [];

          // The pager walk. Page targets are read off the pager, never constructed (see `parseGridPageTargets`).
          // `MAX_GRID_PAGES` is a budget on this run; a shortfall against the published total is reported by
          // `normalizeWithDrops` with both numbers.
          if (pager && pager.pageCount > 1) {
            let page = latest;
            for (let index = 2; index <= Math.min(pager.pageCount, MAX_GRID_PAGES); index++) {
              const target = parseGridPageTargets(page).get(index);
              if (!target) break;
              page = (await session.postForm(calendarUrl, gridPagePostback(page, target))).text;
              const walked = parseGridPager(page);
              // The page must SAY it is the page we asked for. A pager that
              // came back on another index is a postback that did not take,
              // and its rows would silently duplicate or skip a hundred rows.
              if (!walked || walked.page !== index) break;
              pages.push({ page: index, html: page, pager: walked });
            }
          }

          windows.push({
            range,
            rendered: renderedRange(latest),
            html: latest,
            pager,
            pages,
            noRecords: parseGridNoRecords(latest),
          });
        }

        // The RSS link is read off the page in hand: `Feed.ashx`'s ID/GUID pair is minted per tenant and per range.
        // Null means the publication clock is unknown, never that a sitting was published now.
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

        // The per-meeting iCalendar export is a fallback rung, requested only for a row whose own time cell could
        // not be read. `GUID` is mandatory: without it the portal answers 200 with an HTML page, so the document
        // marker is declared and a non-calendar page is a WALL.
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

        // The body's own schedule, when it declares one: a different publisher on a different domain, read last so
        // a refusal here never costs the tenant its calendar. Not paced by `InSiteSession` (which paces the
        // vendor); one request per tenant per refresh, within the host's stated crawl delay.
        // A moved page is a refusal here, never a new route: every response a partition retains must end on a
        // registered publication route (scripts/ingest.ts, candidateForMeetingPartition), so this read does not
        // follow redirects. A move ends it with no corroboration and is named in the route's note.
        let clerkScheduleHtml: string | null = null;
        let clerkScheduleNote: string | null = null;
        if (tenant.clerkScheduleUrl) {
          try {
            const clerk = await new InSiteSession({
              fetchImpl: options.fetchImpl,
              spacingMs: 0,
              signal: query.signal,
              followRedirects: false,
            }).get(tenant.clerkScheduleUrl, "text/html,application/xhtml+xml");
            clerkScheduleHtml = clerk.text;
          } catch (error) {
            clerkScheduleNote = String((error as Error)?.message ?? error);
            console.warn(
              `  ${SOURCE_NAME}: clerk schedule unavailable for ${tenant.slug} — ${error}; ` +
                "this reading records NO corroboration rather than a disagreement",
            );
          }
        }

        collected.push({
          slug: tenant.slug,
          calendarUrl,
          windows,
          feedXml,
          feedUrl,
          icalByInsiteId,
          clerkScheduleHtml,
          clerkScheduleUrl: tenant.clerkScheduleUrl,
          ...(clerkScheduleNote ? { clerkScheduleNote } : {}),
          collectedAt: new Date().toISOString(),
        });
      }

      return collected;
    },

    normalize(raw, now: Date = new Date()): Meeting[] {
      return normalizeWithDrops(raw, now, tenants).meetings;
    },

    normalizeWithDrops(raw, now) {
      return normalizeWithDrops(raw, now, tenants);
    },

    async upsert(meetings: Meeting[]) {
      // Same honest lie the other adapters tell until the Phase 5 schema lands.
      return { inserted: 0, updated: meetings.length };
    },
  };
}
