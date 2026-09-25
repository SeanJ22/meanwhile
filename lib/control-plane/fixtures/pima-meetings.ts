/**
 * THE PIMA PROVING FIXTURE — a real obligation, attached in SHADOW mode.
 *
 * The architecture document asks for a real Meanwhile obligation attached to
 * the control plane from the first implementation stage rather than a synthetic
 * demo, and it names this one. MTG-13 is the right choice because it is the
 * failure the whole design exists to prevent, and because the repository has
 * already paid for it:
 *
 *   MTG-13 shipped THREE future Pima Board sittings because three is what the
 *   two routes anyone had wired AGREED on. The publisher publishes FOURTEEN.
 *   The intersection of the wired routes is 0; the union across every
 *   materially distinct first-party route is 14.
 *
 * SHADOW MODE, precisely. Nothing here changes what a reader sees. The serving
 * path is still `data/meetings-snapshot.json` through the InSite adapter, and
 * `tests/legistar-insite-union.test.ts` is still the acceptance authority for
 * the fourteen. This module builds the same obligation as a control-plane
 * WorkItem so that the completion contract can be exercised against a case
 * whose right answer is already independently known. If the control plane and
 * the adapter ever disagree about the floor, that is a finding about the
 * control plane, not a licence to move reader truth.
 *
 * What it proves, and it is the only thing worth proving here: with the eight
 * first-party routes as the inherited floor, an Attempt that walks seven of
 * them and quietly omits `/EventDates` CANNOT close the obligation. The
 * refusal names the route.
 */

import {
  FIRST_PARTY_ROUTES,
  GRANICUS_LIVE_PROCEEDINGS_ROUTE,
  type FirstPartyRoute,
} from "../../sources/legistar-insite/horizon.ts";
import type { Jurisdiction } from "../../method/portability.ts";
import type { AdapterRouteDeclaration } from "../preflight.ts";
import { createWorkItem, type WorkItem } from "../work-item.ts";

/** The registered body. R-0197: the registry is the authority, never the adapter. */
export const PIMA_BODY_ID = "ocd-division/country:us/state:az/county:pima#governing";
export const PIMA_DIVISION = "ocd-division/country:us/state:az/county:pima";

export const PIMA_JURISDICTION: Jurisdiction = {
  state: "az",
  governmentType: "county",
  platform: "legistar",
  publisher: "pima.legistar.com",
};

/**
 * Where each first-party route is actually walked.
 *
 * The targets are DIFFERENT HOSTS on purpose. `webapi.legistar.com`,
 * `pima.legistar.com`, `www.pima.gov` and `pima.granicus.com` are four
 * publishers' surfaces, and the host-budget layer must be able to tell them
 * apart — twelve workers politely hitting one host is not twelve polite
 * workers.
 */
const ROUTE_TARGETS: Record<FirstPartyRoute, { label: string; target: string }> = {
  LEGISTAR_WEBAPI_EVENTS: {
    label: "Legistar WebAPI /events",
    target: "webapi.legistar.com",
  },
  LEGISTAR_WEBAPI_EVENTDATES: {
    label: "Legistar WebAPI /EventDates/{bodyId}",
    target: "webapi.legistar.com",
  },
  INSITE_CALENDAR_GRID: {
    label: "InSite Calendar.aspx grid",
    target: "pima.legistar.com",
  },
  INSITE_CALENDAR_RSS: {
    label: "InSite Feed.ashx calendar RSS",
    target: "pima.legistar.com",
  },
  INSITE_ICAL_EXPORT: {
    label: "InSite View.ashx iCalendar export",
    target: "pima.legistar.com",
  },
  INSITE_MEETING_DETAIL: {
    label: "InSite MeetingDetail.aspx",
    target: "pima.legistar.com",
  },
  CLERK_SCHEDULE_PAGE: {
    label: "Clerk of the Board schedule table (the body's own site)",
    target: "www.pima.gov",
  },
  GRANICUS_VIEW_PUBLISHER: {
    label: "Granicus ViewPublisher live proceedings",
    target: GRANICUS_LIVE_PROCEEDINGS_ROUTE.host,
  },
};

/**
 * The adapter's declared first-party surfaces, as a floor input.
 *
 * Derived from `FIRST_PARTY_ROUTES` rather than retyped. That is the whole
 * reason `horizon.ts` gained a value-level route array: a floor that is
 * hand-listed in a second file drifts from the adapter the first time a route
 * is added, and the drift is silent.
 */
export const PIMA_ADAPTER_ROUTES: readonly AdapterRouteDeclaration[] = FIRST_PARTY_ROUTES.map(
  (routeId) => ({
    routeId,
    label: ROUTE_TARGETS[routeId].label,
    target: ROUTE_TARGETS[routeId].target,
  }),
);

/**
 * The union denominator, as independently established by
 * `tests/legistar-insite-union.test.ts`.
 *
 * Carried here as the EXPECTED value the control plane's coverage clause is
 * checked against, not as a new source of truth. If the adapter's acceptance
 * moves, this constant is wrong and its test says so.
 */
export const PIMA_UNION_DENOMINATOR = 14;

/**
 * The routes that carried instances, and the count each produced.
 *
 * These are the measured figures recorded in `horizon.ts`. They exist here so
 * the fixture can demonstrate route-only accounting: `/Events` and
 * `/EventDates` both returned ZERO future sittings while three other routes
 * each returned fourteen. A route that returns nothing has told us about
 * itself.
 */
export const PIMA_MEASURED_FUTURE_COUNTS: Readonly<Partial<Record<FirstPartyRoute, number>>> = {
  LEGISTAR_WEBAPI_EVENTS: 0,
  LEGISTAR_WEBAPI_EVENTDATES: 0,
  INSITE_CALENDAR_GRID: 14,
  INSITE_CALENDAR_RSS: 14,
  CLERK_SCHEDULE_PAGE: 14,
};

/**
 * The obligation.
 *
 * `requiresCompleteDenominator` is true, and that clause is the fixture's
 * point. "We found some meetings" is not a coverage statement; "the publisher's
 * union across every materially distinct first-party route is fourteen and we
 * carry fourteen" is.
 */
export function pimaFutureMeetingsWorkItem(now: string): WorkItem {
  return createWorkItem({
    project: "meanwhile",
    subject: PIMA_BODY_ID,
    obligation:
      "Enumerate every explicit future Pima County Board of Supervisors meeting instance " +
      "published across materially distinct first-party routes",
    why:
      "The reader is shown a future meeting universe for this body. MTG-13 shipped three of " +
      "fourteen because the acceptance was the intersection of two wired routes rather than " +
      "the union of every route the publisher actually uses.",
    priority: "P0",
    contract: {
      requiresValidation: true,
      requiresAudit: true,
      requiresCompleteDenominator: true,
    },
    now,
  });
}

/**
 * The Granicus route's robots.txt reading — EVIDENCE, not a verdict.
 *
 * `pima.granicus.com` serves `User-agent: * / Disallow: /`. Until 2026-09-25
 * that disposed the route `BLOCKED_CURRENTLY` as a permission wall. Since the
 * owner decision of 2026-09-25 robots.txt is recorded and blocks nothing
 * (`robotsBlocks: false`), and the true state is ours: no adapter reads the
 * route yet. It is disposed `REQUIRES_NEW_ADAPTER` — an OPEN state — and the
 * obligation stays open on it rather than counting it as walked-and-empty. The
 * adapter still carries no claim about the content behind it
 * (`claimAboutContent: null`).
 *
 * This is the case that would be easiest to get wrong, and getting it wrong
 * would convert "we have not looked" into "there is nothing there".
 */
export const PIMA_GRANICUS_PERMISSION = {
  host: GRANICUS_LIVE_PROCEEDINGS_ROUTE.host,
  rule: GRANICUS_LIVE_PROCEEDINGS_ROUTE.rule,
  readAt: GRANICUS_LIVE_PROCEEDINGS_ROUTE.readAt,
  robotsBlocks: GRANICUS_LIVE_PROCEEDINGS_ROUTE.robotsBlocks,
  claimAboutContent: GRANICUS_LIVE_PROCEEDINGS_ROUTE.claimAboutContent,
} as const;
