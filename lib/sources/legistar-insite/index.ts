/**
 * @freshness-reads-here
 *
 * RULING 107 — the clock stamps in this file are minted by the code path that
 * performs the read: `collectedAt` is taken at the moment of the fetch.
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
  granicusRouteObservation,
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
 * vendor. `pima.granicus.com` publishes `Disallow: /`; that is recorded and,
 * since the owner decision of 2026-09-25, blocks nothing. Its Live Proceedings
 * page is not read by anything here because no adapter for it exists yet — see
 * `GRANICUS_LIVE_PROCEEDINGS_ROUTE` below.
 */
const SOURCE_NAME = "legistar-insite";

/**
 * The Granicus Live Proceedings route lives with the rest of the route model,
 * in `./horizon.ts`, because it IS a route observation — one whose enumeration
 * state is `NOT_BUILT` (it was `PERMISSION_DISALLOWED` until 2026-09-25) and
 * whose claim about the content is null. Re-exported here because it is part
 * of this adapter's public surface, and a route that moved file is a route
 * somebody stops finding.
 */
export { GRANICUS_LIVE_PROCEEDINGS_ROUTE } from "./horizon.ts";

const WINDOW_BACK_DAYS = MEETING_HELD_LOOKBACK_DAYS;

/**
 * **THIS ADAPTER NO LONGER CLIPS THE FUTURE, AND THAT IS THE CORRECTION.**
 * (2026-08-28.)
 *
 * It used to stop at `UPCOMING_HORIZON_DAYS` — 60 — which on the day this was
 * written silently discarded **eight of the fourteen** future Board sittings
 * Pima County has published: everything from 10 November to 15 December, each
 * one an explicit dated instance carried by three separate first-party routes.
 * The clip produced no drop counter anybody would read as a loss, because
 * `outOfWindow` is the ordinary and correct name for a row outside the served
 * window.
 *
 * Two windows were being conflated. **What a publisher has published** and
 * **what this application currently serves** are different facts, and the
 * second is not this adapter's to enforce: `lib/meetings/query.ts` clips reads
 * to the serving horizon independently, on every read, for every source. An
 * adapter clipping as well bought nothing and cost the snapshot the rows that
 * would appear the instant the horizon widened.
 *
 * `CLAUDE.md`: *show everything we find; collection state never governs
 * display.* This is the same rule pointing the other way — DISPLAY state must
 * not govern collection either. `lib/sources/revize` already established the
 * shape for the backward edge (`publishedLookbackDays: null`, g13); this is
 * the forward one.
 *
 * The rows past the serving horizon are still ACCOUNTED: each carries a
 * `BEYOND_APP_SERVING_HORIZON` disposition naming this application's own
 * constant and its value, so the gap between what we hold and what a reader
 * sees is a stated number and not a silence.
 */
const SERVING_HORIZON_DAYS = MEETING_HELD_HORIZON_DAYS;

/**
 * The grid ranges this adapter drives, in order.
 *
 * The vocabulary is the DROPDOWN'S OWN — read off the page rather than invented
 * — and it is still not complete: the control also offers "Last Week", "This
 * Week", "Next Week", "Last Year", "All Years" and every year back to 2013.
 * Those are rungs this adapter has not needed, not ranges that do not exist.
 *
 * ## Why this used to stop at "Next Month", and why that was a wrong answer
 *
 * The three-month set was chosen to stay inside the grid's 100-row page, on the
 * reasoning that "This Year" is a pagination trap — Mesa's answers `items 1 to
 * 100 of 148`. The trap is real. The conclusion was not: it traded **eleven of
 * Pima's fourteen published future sittings** for the convenience of not
 * writing a pager walk. Measured 2026-08-28 on `pima.legistar.com`:
 *
 * | range | rows | future Board sittings | pager |
 * | --- | --- | --- | --- |
 * | "Next Month" | 3 | **3** | none |
 * | "This Year" | 46 | **14** | none |
 * | "Next Year" | 0 | 0 | none — grid says "No records were found." |
 *
 * A one-month forward window against a portal publishing 109 days ahead is an
 * adapter asking for a quarter of what is there. `CLAUDE.md`: the universe of
 * methods is not bounded, and difficulty is friction rather than refusal. The
 * pager walk is the method, and it is now written (`parseGridPageTargets`).
 *
 * ## "Next Year" is in the set, and its zero is a publisher's zero
 *
 * It returns nothing today and that is not a reason to leave it out — it is the
 * range that will carry January the moment Pima files it, and asking it costs
 * one paced request. Its emptiness is only ever accepted when the grid renders
 * `rgNoRecords` and the words **"No records were found."**; a zero without that
 * sentence is a wall, reported as one.
 */
export const RANGES: InSiteRange[] = [
  "Last Month",
  "This Month",
  "Next Month",
  "This Year",
  "Next Year",
];

/**
 * The ranges to drive on `now`. The held window reaches back `WINDOW_BACK_DAYS`; "Last Month" and "This Year" cover
 * that until January to April, when it crosses into the prior calendar year, and then "Last Year" is read first too
 * (DB-03). Otherwise the set is `RANGES`, unchanged.
 */
export function rangesAt(now: Date): InSiteRange[] {
  const backYear = new Date(now.getTime() - WINDOW_BACK_DAYS * 86_400_000).getUTCFullYear();
  return backYear < now.getUTCFullYear() ? ["Last Year", ...RANGES] : [...RANGES];
}

/**
 * How many pages of one range this adapter will walk before it reports the
 * enumeration incomplete.
 *
 * **A FLOOR AND AN INSTRUMENT, NEVER A COMPLETION CONDITION** (RULING 170,
 * RULING 184). Reaching it does not mean the range is enumerated; it means this
 * run stopped walking, and `partialScopes` says so with the pager's own total
 * beside the count we actually read. It exists because each page is a paced
 * request at the vendor's stated `Crawl-delay: 2` and a refresh job has other
 * bodies to serve — a budget on THIS run, not a claim about the portal.
 */
export const MAX_GRID_PAGES = 6;

/**
 * The ranges whose window can contain a date later than today.
 *
 * Used to attribute an incomplete enumeration to the right SCOPE, because
 * carry-forward preserves exactly the scope that fell short: a short "Last
 * Month" is an archive gap, and a short "This Year" is an UPCOMING gap that
 * would otherwise be carried as if the future were fine.
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
     * **The grid saying, in its own words, that it holds nothing.**
     *
     * True only for `class="rgNoRecords"` plus "No records were found."
     * A zero-row window with this `false` is a FAILED RETRIEVAL, not an empty
     * calendar, and the caller reports it as one. Pima's "Next Year" is the
     * measured true case (2026-08-28).
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
   * **THE BODY'S OWN SITE, SAYING THE SAME THING WITHOUT THE VENDOR.**
   *
   * The Clerk of the Board's schedule table, when the tenant declares one and
   * it was retrieved. `null` means nobody asked or the page refused — never
   * that the county publishes no schedule.
   *
   * It is CORROBORATION and disposition evidence, not an ingestion source: no
   * `Meeting` is produced from it. See `./clerk-schedule.ts`.
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
  /**
   * **What each first-party route actually answered about the future**, with
   * its mechanism, its observation time, its counts, its earliest and latest
   * instance, and how complete the enumeration was. One row per route per
   * tenant, including the routes that answered nothing and the one no adapter
   * reads yet.
   */
  routes: RouteObservation[];
  /**
   * **The publisher's own statement about each sitting's agenda, one per
   * produced sitting.**
   *
   * The grid's agenda cell was previously read, used to decide `agendaUrl`, and
   * then discarded — leaving a null whose reader-facing sentence ("the body has
   * not posted an agenda") was a claim about a government supported only by our
   * own empty field. These are that reading, kept, scoped to one sitting, with
   * what the cell said and when we read it. `lib/ask/agenda-publication.ts`
   * decides what may be SAID from them; nothing here renders a sentence.
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
   * **WHAT THIS RUN STILL OWES A READER**, derived from `dispositions` by
   * `openObligations` — never asserted, never typed by hand.
   *
   * A disposition explains; it does not discharge. This is the subset that is
   * explained AND still absent from the product: a sitting a first-party route
   * published that we have not placed, a room we could not resolve, an hour
   * nobody published. Every one of them is ALSO emitted as an incomplete
   * `UPCOMING` scope in `partialScopes`, because that is the only one of these
   * fields that survives the composite boundary and reaches the run's report.
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
  /**
   * **What the portal said about each sitting's agenda, kept.**
   *
   * One per produced sitting. See `lib/outcomes/publication.ts` for why this
   * exists and what was being lost without it.
   */
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
  // D18: an online-only sitting is TALLIED as placeless and then PRODUCED; a
  // sitting with no reviewed place is tallied as unknownVenue and PRODUCED
  // with its venue gap named (the venue-gap class, 2026-09-23).
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
     * Why a future instance this adapter SAW did not become a `Meeting` — or
     * became one that still owes something — keyed on canonical identity.
     * Recorded at the point of the decision, because a reason reconstructed
     * afterwards from the absence of a row is a guess. Two verdicts ride here
     * on a PRODUCED sitting: `CANCELED_BY_PUBLISHER` (it reaches the reader as
     * canceled) and `VENUE_NOT_RESOLVED` (it reaches the reader with its place
     * as a named gap, and the reviewed venue row is still owed).
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

      /*
       * **A ZERO IS ONLY EVER THE PUBLISHER'S ZERO.** (RULING 100.)
       *
       * A range that returned no rows and did NOT render "No records were
       * found." is a failed extraction wearing a 200 — a template change, an
       * expired session, a challenge page. It is reported as an incomplete
       * enumeration for that scope rather than folded into the union as
       * nothing, because "this range is empty" and "we could not read this
       * range" are different facts and only one of them is ours to state.
       */
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

        /*
         * The FUTURE record this route published, captured before any of this
         * adapter's own decisions can remove it.
         *
         * It is taken here rather than after the venue and window checks on
         * purpose: the union is what the PUBLISHER said, and a row that this
         * adapter later declines to produce — no venue record, outside the
         * app's serving horizon — is still a sitting Pima County published and
         * still owes the reader an explanation. Capturing it downstream of our
         * own filters would mean the union could only ever contain what we
         * already ship, which makes the acceptance rule vacuous.
         */
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

        /*
         * **ONLY THE BACK EDGE CLIPS.** See `SERVING_HORIZON_DAYS` above: the
         * forward clip used to live here and it discarded eight of Pima's
         * fourteen published future sittings, counted as `outOfWindow`, which
         * reads as routine. `lib/meetings/query.ts` clips reads to the serving
         * horizon on every read, so nothing downstream depended on this.
         */
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
        /*
         * **NO REVIEWED PLACE NEVER SUPPRESSES THE SITTING** (the venue-gap
         * class, 2026-09-23). A room name is still never geocoded at runtime —
         * a pin on a building nobody promised is worse than a named gap — so
         * the sitting is PUBLISHED with `location: null` and that gap: the
         * location cell verbatim (`STATED_NOT_PLACED`), or, for an empty cell,
         * the publisher's own silence (`NOT_STATED_BY_PUBLISHER`). It is still
         * tallied as `unknownVenue` (counted, and produced) and still
         * dispositioned `VENUE_NOT_RESOLVED`, which stays an OPEN obligation:
         * what is owed now is the reviewed venue row, not the sitting. Both
         * cases used to `continue`, and a tenant with an empty reviewed venue
         * scope failed its whole partition before a row was read.
         */
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

        /*
         * **KEEP THE PUBLISHER'S OWN READING.** One per sitting, scoped to that
         * sitting, whatever the cell said — an "Agenda" cell is evidence too,
         * and recording only the negatives would make this a defect log rather
         * than an observation record.
         */
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
          ...(venueGap ? { venueGap } : {}),
          /*
           * Null when the portal says "Not Available", and never filled with
           * the portal's own search page dressed up as an agenda.
           *
           * **The comment here used to say this null "renders as the NAMED GAP
           * it is — the body has not posted an agenda". That sentence is a
           * claim about a government, and this expression was destroying the
           * only evidence that could have supported it.**
           *
           * The grid cell is the county's own words about its own docket. It
           * was read, tested against a regex, used to decide a URL, and then
           * dropped — leaving the reader-facing claim resting on nothing but
           * our own empty field, which is a fact about US. The reading is now
           * kept as an OBSERVATION (`publicationObservations` below, and
           * `lib/outcomes/publication.ts`), scoped to this sitting, carrying
           * what the cell actually said and when we read it. What may be said
           * to a reader is then decided by `lib/ask/agenda-publication.ts`
           * from that evidence rather than from this null.
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
             * **THE PAGE THE ROW WAS ACTUALLY READ FROM, AND ONLY THAT.**
             *
             * This used to say a not-viewable sitting "has no public detail
             * page". Measured 2026-08-28 and it is FALSE:
             * `MeetingDetail.aspx?ID=1381586&GUID=723F4F9A-…` — the 15 December
             * sitting, `meeting_NotViewable` on the grid, no anchor href —
             * answers **200 with 84 KB titled "Pima County - Meeting of Board
             * of Supervisors on 12/15/2026"**. `meeting_NotViewable` governs
             * the LINK the grid renders, not the page's reachability. The
             * correction is recorded in `INSITE_MEETING_DETAIL` in
             * `./horizon.ts`, where it belongs as a route.
             *
             * The citation stays on the grid all the same, and for a better
             * reason than the false one: **we cite what we read.** No detail
             * page is fetched on a refresh — it is a corroboration rung, not a
             * per-row request — so citing one would be citing a document this
             * run never opened.
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
      granicusRouteObservation(),
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

      /*
       * **THE FALLBACK THAT INVERTED ITS OWN MEANING** (audit finding E,
       * corrected 2026-08-28).
       *
       * This chain used to end in `SUPERSEDED_BY_RICHER_ROUTE` for any instance
       * with no `Meeting` and no recorded reason — while its own comment said
       * the meeting-producing route had NOT carried it. Nothing richer
       * superseded those sittings; nothing carried them at all. And because
       * `unaccounted()` is satisfied by ANY disposition, the verdict turned
       * "an explicit first-party route published a sitting we did not produce"
       * into "accounted for", with the sitting nowhere near a reader.
       *
       * Pima never exposed it: its grid carries all fourteen, so the branch was
       * unreachable on the only corpus anyone read. The next tenant is where it
       * would have been paid for.
       *
       * So supersession is now a PRECONDITION. `richerRouteLink` must hand back
       * a produced canonical meeting reached through an id the two routes
       * provably share, or the word is not available. What is left when it
       * cannot is `PUBLISHED_BUT_UNPLACED_BY_US`: an open obligation, named as
       * ours, carrying the exact fields that would discharge it.
       */
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

      /*
       * **AND IT LEAVES THE ADAPTER.** `dispositions`, `union` and `routes` are
       * this function's own richer report and are dropped at the composite
       * boundary (`lib/sources/composite/index.ts` destructures the
       * `ReportingMeetingSource` contract and nothing else). `partialScopes` is
       * in that contract, so it is the one channel a sitting we failed to place
       * can use to reach the run's report and carry-forward.
       *
       * A published sitting we did not produce IS an incomplete UPCOMING
       * enumeration for this division. Reporting it as anything less would be
       * the same silence one layer up.
       */
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

    /*
     * A route record that named a meeting and published no hour cannot be
     * keyed, so it never enters the union — and it is still owed an
     * explanation. `TIME_NOT_PUBLISHED` is OURS in the sense that we cannot
     * place it, and the evidence quotes what the publisher did write.
     */
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
 * **WHOSE FACT THIS VERDICT IS, SAID OUT LOUD.**
 *
 * `CLAUDE.md`: a null renders as its NAMED GAP and the name says WHOSE gap it
 * is — "we haven't recorded this yet" is a fact about us, "not in this chamber
 * for this vote" is a fact about them, and they may never render as the same
 * sentence. A disposition is the machine-readable form of exactly that
 * distinction, so every verdict states its owner in the first word.
 *
 * There is no permission verdict. `ROUTE_DISALLOWED` returned null here until
 * 2026-09-25; it was never given to an instance, and since the owner decision
 * of that day robots.txt blocks nothing, so it is gone.
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
    /*
     * Both of the verdicts below are ALWAYS given a specific `because` by the
     * caller — `supersessionClaim` and `unplacedClaim` — because each is a
     * claim about a particular record and a generic sentence could not name it.
     * These are the floors, and they are written so that a caller which somehow
     * reached them still says something true and still says whose gap it is.
     */
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
 * The named gap, in FIELD terms — what would have to be acquired before this
 * sitting could reach a reader.
 *
 * Only fields that actually BLOCK construction are listed. A missing meeting
 * kind is not one of them (`title` falls back to the body's own name), and
 * listing it would inflate an honest gap into a bigger-sounding one. Never
 * empty: a verdict that says "we could not place it" and then names nothing is
 * a shrug wearing a schema.
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

  /*
   * The identity limitation, stated even when every field happens to be
   * present: the routes that carried this sitting are CORROBORATION. Producing
   * a `Meeting` from one of them is promoting it to an ingestion source, which
   * `CLAUDE.md` makes an ask-before — and `SittingRoute` in
   * `lib/sources/event-identity.ts` cannot even name `CLERK_SCHEDULE_PAGE` as a
   * field's supplier, so a composed record could not carry honest per-field
   * provenance today. Both are ours to fix and neither is a fact about the body.
   */
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
 * The calendar RSS as a route in its own right.
 *
 * It is a materially distinct record and not a view of the grid: it carries
 * `pubDate` — the instant InSite itself first published each sitting, which
 * nothing else states — and it drops the location and the meeting kind, which
 * the grid alone has. Measured 2026-08-28 on Pima's "This Year" feed: **14 of
 * 14 future sittings present**, so on that day it independently confirmed the
 * whole horizon.
 *
 * The date and time come out of the item TITLE, which is the only place the
 * feed states them: `Board of Supervisors - 12/15/2026 - 5:00 PM`.
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
 * The Clerk of the Board's own schedule table as a route — **the body speaking
 * for itself, on its own domain, without the vendor in between.**
 *
 * See `./clerk-schedule.ts` for what it carries that Granicus does not and for
 * the permission reading. It produces no meetings; it is here so that a
 * disagreement between the county and its vendor about whether a sitting exists
 * — or about what hour it starts — becomes visible instead of unknowable.
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

export function makeLegistarInSiteSource(
  options: { fetchImpl?: typeof fetch; tenants?: InSiteTenant[] } = {},
): ReportingMeetingSource<LegistarInSiteRaw> {
  // Test callers may inject an explicit fixture list. Production membership
  // is always derived from SOURCE_WIRING; INSITE_TENANTS is historical test
  // data and is not an autonomous production registry.
  const tenants = options.tenants ?? inSiteTenantsFromWiring();

  return {
    name: SOURCE_NAME,

    async fetch(query: MeetingQuery): Promise<LegistarInSiteRaw[]> {
      const collected: LegistarInSiteRaw[] = [];

      // Serialized across tenants as well as within one. Nothing here runs
      // concurrently, and the session paces itself at the vendor's stated
      // `Crawl-delay: 2`.
      for (const tenant of tenants) {
        // A tenant with no reviewed venue is read, never skipped for want of a
        // coordinate (`venuesWithinRadius`, the venue-gap class, 2026-09-23).
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

          /*
           * **THE PAGER WALK.** The grid pages at 100 and publishes its total,
           * so a range holding 148 answers 100 rows and a clean 200 — a route
           * answering completely about the part it chose to send, which is the
           * exact failure shape this whole adapter exists to correct.
           *
           * The page targets are READ OFF THE PAGER, never constructed: the
           * control indices are ASP.NET's own and are not derivable. Guessing
           * one at Pima's "All Years" grid returned **page 3** while calling
           * itself the next page, with 100 well-formed rows and every check
           * passing (see `parseGridPageTargets`).
           *
           * `MAX_GRID_PAGES` is a budget on THIS run at the vendor's stated
           * `Crawl-delay: 2`. Stopping on it does not enumerate the range; the
           * shortfall against the published total is reported by
           * `normalizeWithDrops` as an incomplete enumeration, with both
           * numbers.
           */
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

        /*
         * The body's OWN schedule, when it declares one. A different publisher
         * on a different domain, read last because everything above works
         * without it and a refusal here must not cost the tenant its calendar.
         *
         * Not paced by `InSiteSession` — that session paces the Legistar
         * vendor, and this is Pima County. `www.pima.gov/robots.txt` (read
         * 2026-09-24) puts `User-agent: *` in one group with Siteimprove, so
         * `*` is asked for `Crawl-delay: 20` and nothing is disallowed; one
         * request per tenant per refresh is within it. (The 2026-08-28 reading
         * took the group for Siteimprove's alone.)
         */
        /*
         * **A MOVED PAGE IS A REFUSAL HERE, NEVER A NEW ROUTE.** (2026-09-24.)
         * Every response a partition retains must end on a registered
         * publication route (scripts/ingest.ts, candidateForMeetingPartition).
         * Pima County moved this page to
         * www.pima.gov/board-of-supervisors-meeting-schedule, the read
         * followed the redirect and answered 200 there, and the unregistered
         * final URL refused the WHOLE partition, with the 14 upcoming
         * sittings the grid carries. So this read does not follow redirects:
         * a move ends it here with no corroboration, the move is named in the
         * route's note, and nothing from the new URL is retained. The move
         * to /board-of-supervisors-meeting-schedule was registered on
         * 2026-09-24 (C18) once its permission was read; a further move is
         * refused the same way until it is.
         */
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
