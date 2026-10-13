import { feedKindForWiringType } from "../sources/feed-kind-registry.ts";
import type { OcdId } from "../sources/types.ts";
import type { AgendaSourceType } from "./types.ts";

/**
 * One hand-wired meeting door as the adapters read it: which body the composite meeting source serves, and how.
 * Doors live in the door registry; a door is added or changed there, never here. The composite dispatches on
 * `agendaSourceType`, and each adapter reads the rows declaring its type and carries no hardcoded body list.
 * `config` keys are documented by the adapter that reads them; URLs in `config` were verified live on the date
 * in `verifiedAt`.
 */
export interface BodySourceWiring {
  /** Matches `Body.id` in the registry exactly. */
  bodyId: string;
  /**
   * The division whose government meets; the join key on every Meeting. Null for a body with no Census
   * division, whose meetings are then local-tier by construction.
   */
  ocdId: OcdId | null;
  agendaSourceType: AgendaSourceType;
  /** Display only — never joined on. */
  jurisdiction: string;
  /** Who published the records. The public body, never the vendor. */
  publishingOrg: string;
  /** IANA zone the body meets in. */
  timeZone: string;
  /** Per-adapter settings. Keys are documented by the adapter. */
  config: Record<string, string>;
  /**
   * The body's own meeting-notice page, where one exists ahead of the vendor portal. Retrieved as a
   * document for this body's meetings that have no published agenda yet.
   */
  noticeUrl?: string;
  /**
   * Whether this row's route serves concluded meetings. Absent means yes. Set to `false` only when the
   * published route genuinely carries no past sitting. Not a coverage status. Sent with the body (`historyGapFor()`)
   * so the Concluded filter can say why a jurisdiction is empty.
   */
  publishesHistory?: false;
  /** Why, in the reader's own language. Required when the flag is set. */
  historyGapReason?: string;
  /** When the URLs in config were last confirmed working. */
  verifiedAt: string;
}

/** The one route each single-route agenda-source type runs. LEGISTAR names its routes per row (`LEGISTAR_ROUTES`). */
const MEETING_ROUTE_BY_TYPE: Partial<Record<AgendaSourceType, string>> = {
  CIVICPLUS: "civicplus",
  ONBASE: "onbase",
  APPTEGY: "apptegy",
  DILIGENT: "diligent",
  CIVICWEB: "diligent",
  CIVICCLERK: "civicclerk",
  CLERKSBOARDS: "clerksboards",
  BOARDBOOK: "boardbook",
  BOARDDOCS: "boarddocs",
  GRANICUS: "granicus",
  IQM2: "iqm2",
  REVIZE: "revize",
  SCHEDULEPAGE: "schedulepage",
  ICAL: "ical",
  PIMA_EDU: "pima-edu",
  OFFICIAL_PAGE_EVENTS: "official-page-events",
  DOCUMENT_LISTING: "document-listing",
  SUITEONE: "suiteone",
};
const LEGISTAR_ROUTES = ["legistar", "legistar-insite"] as const;

/** Every built-in adapter route a meeting door can run, once each. */
export function meetingRouteKinds(): readonly string[] {
  return [...new Set([...LEGISTAR_ROUTES, ...Object.values(MEETING_ROUTE_BY_TYPE)])];
}

/**
 * The adapter routes a wiring row actually belongs to.  Most agenda-source
 * types have one implementation.  LEGISTAR is deliberately explicit because
 * WebAPI and InSite are independent publication routes and therefore require
 * independent candidates, clocks, and LKG pointers.
 *
 * This is the production membership boundary: adapter-owned client/tenant
 * arrays may be derived from these rows, but may not add another body.
 */
export function meetingSourceNamesForWiring(row: BodySourceWiring): readonly string[] {
  if (row.agendaSourceType === "LEGISTAR") {
    const routes = row.config.sourceRoutes?.split(",").map((route) => route.trim()).filter(Boolean) ?? [];
    if (routes.length === 0 || routes.some((route) => !(LEGISTAR_ROUTES as readonly string[]).includes(route))) {
      throw new Error(`MEETING_SOURCE_ROUTES_INVALID:${row.bodyId}`);
    }
    return [...new Set(routes)];
  }
  const route = MEETING_ROUTE_BY_TYPE[row.agendaSourceType];
  if (route) {
    const retired = retiredMeetingRoute(route, row.bodyId);
    if (retired) {
      throw new Error(
        `MEETING_ROUTE_RETIRED:${route}:${row.bodyId} — retired ${retired.retiredOn} (${retired.reason}); ` +
          `the route that replaced it is ${retired.replacedBy}.`,
      );
    }
  }
  if (route) return [route];
  // A door of an installed engineer-built feed kind is served by that kind's own source.
  const feed = feedKindForWiringType(row.agendaSourceType);
  return feed ? [feed.kind] : [];
}

/**
 * A retired meetings route. A proved source cutover disables its old writer. Naming the (route, body)
 * pair here makes `meetingSourceNamesForWiring` throw for a row that would re-open it and makes agenda
 * retrieval refuse its `hosts` unless `hostsReadable`; `tests/retired-meeting-routes.test.ts` holds that
 * every retired pair has a wired successor. robots.txt alone retires nothing and closes no host.
 *
 * What the retired route already holds stays: its promoted partition version is HELD in the successor's
 * place until the successor's first promotion (`HELD_MEETING_PARTITIONS`,
 * lib/civic-data/meeting-partitions.ts). A route whose host is gone retires the same way, and its host is
 * not readable.
 */
export interface RetiredMeetingRoute {
  /** The adapter route (partition `meetings:<meetingSource>:<bodyId>`) that no longer runs. */
  readonly meetingSource: string;
  readonly bodyId: string;
  /**
   * Hosts the retired route read. No clock or partition reads them for this
   * body. Agenda retrieval refuses them too, unless `hostsReadable` is set.
   */
  readonly hosts: readonly string[];
  /**
   * The retirement closes the route's clock only: its hosts stay readable, so
   * a link into them (the body's own agenda link) is read like any public
   * document. Set for a route superseded by a better one while its host still
   * serves the body's documents — never for a host that is gone.
   */
  readonly hostsReadable?: true;
  /** ISO date of the cutover (`pnpm stamp`). */
  readonly retiredOn: string;
  readonly reason: string;
  /** The wired meeting source that replaced it for the same body. */
  readonly replacedBy: string;
  /** What happens to the rows and documents the retired route already holds. */
  readonly held: string;
  /**
   * The successor was already a wired, promoting route for this body before
   * this one retired — two routes for one body, one of them retired — so the
   * successor has its own pointer from the start. Nothing is HELD in its place
   * (`HELD_MEETING_PARTITIONS` omits the pair), and the Reader proof drops the
   * retired identity's import disposition instead of handing it to a successor
   * that already carries its own.
   */
  readonly successorAlreadyWired?: true;
}

export const RETIRED_MEETING_ROUTES: readonly RetiredMeetingRoute[] = [
  {
    meetingSource: "diligent",
    bodyId: "curated:az/pima-community-college#governing",
    hosts: ["pima.community.highbond.com"],
    hostsReadable: true,
    retiredOn: "2026-09-23",
    reason:
      "retired 2026-09-23 for robots.txt alone: the tenant's robots.txt is an allowlist — six named search " +
      "crawlers may read /Portal/, /document/ and /Services/, and User-agent: * carries Disallow: / (read " +
      "2026-09-23T20:02Z and again 2026-09-25, 23,479 bytes, sha256 b5cbf0b4b2cbcf18…). robots.txt no longer " +
      "blocks since the owner decision of 2026-09-25. The route stays retired because pima-edu carries every " +
      "sitting it did (cutover dry run: 7 the same, 5 added, none removed), and a second route for the body " +
      "would show each sitting twice; its host is readable again for the college's agenda links",
    replacedBy: "pima-edu",
    held:
      "the promoted meetings:diligent partition for this body (7 sittings, 486 stored portal-page reads as of " +
      "2026-09-23T19:48Z) stays in the production store unchanged, composed as held rows until the pima-edu " +
      "partition's first promotion supersedes it; the college's own links into the tenant are carried by " +
      "pima-edu as links, and agenda retrieval reads them",
  },
  {
    // Not a permission cutover: the host is gone (ENOTFOUND).
    meetingSource: "diligent",
    bodyId: "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town#governing",
    hosts: ["newburynh.civicweb.net"],
    retiredOn: "2026-09-25",
    reason:
      "newburynh.civicweb.net no longer resolves: DNS answers NXDOMAIN and fetch fails with ENOTFOUND " +
      "(read 2026-09-25T17:37Z); every partition read since 2026-09-14 ended SOURCE_BLOCKED",
    replacedBy: "ical",
    held:
      "the promoted meetings:diligent partition for this body stays in the production store unchanged and is no " +
      "longer composed: the town's own calendar feed (newbury-ical-governing, wired 2026-08-20) already carries " +
      "the Selectboard under its own pointer, and the portal links the retired rows carried lead to a host that " +
      "no longer exists",
    successorAlreadyWired: true,
  },
];

export function retiredMeetingRoute(meetingSource: string, bodyId: string): RetiredMeetingRoute | null {
  return (
    RETIRED_MEETING_ROUTES.find((r) => r.meetingSource === meetingSource && r.bodyId === bodyId) ?? null
  );
}

/**
 * Is this URL on a retired route's host that nothing may fetch? Agenda retrieval refuses these; the
 * link stays a link a reader can follow. A retired route whose hosts stay readable (`hostsReadable`) is
 * not one.
 */
export function isUnreadableRetiredMeetingHost(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return RETIRED_MEETING_ROUTES.some((r) => !r.hostsReadable && r.hosts.includes(host));
}

export function wiringForMeetingSource(sourceName: string): BodySourceWiring[] {
  return activeWiring().filter((row) => meetingSourceNamesForWiring(row).includes(sourceName));
}

/**
 * The hand-wired meeting doors this process reads: the door registry's, put here by the runner from the registry and
 * by every other process from the registry's promoted projection (`lib/doors/meeting-doors.ts`). Empty until then:
 * there is no other list.
 */
let installedDoors: readonly BodySourceWiring[] = [];

export function installMeetingDoors(rows: readonly BodySourceWiring[]): void {
  installedDoors = rows;
}

/** The hand-wired rows adapters read right now: the door registry's. */
export function activeWiring(): readonly BodySourceWiring[] {
  return installedDoors;
}

/** Rows a given adapter capability should serve. */
export function wiringForTypes(
  types: AgendaSourceType[],
): BodySourceWiring[] {
  return activeWiring().filter((row) => types.includes(row.agendaSourceType));
}
