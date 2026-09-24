/**
 * **WHERE A GOVERNMENT'S MEETINGS ARE ALREADY KNOWN TO BE.** (2026-09-24.)
 *
 * The meetings-discovery walk starts from the address the jurisdiction
 * reference records: the Census 2022 Government Units WEB column. That address
 * cannot carry two things.
 *
 * 1. **The current official site, when the recorded one is stale.** Census
 *    recorded addresses that have since died, moved or were mistyped (six
 *    Arizona cities and three New Hampshire governments by 2026-09-24). The
 *    reference has no correction path of its own: its authority reads only
 *    Census and the Arizona Secretary of State. So the walk kept knocking on
 *    a dead or parked host. An official-site hint names the current site and
 *    the evidence that it is the government's own, strongest first: its .gov
 *    registration, the old host's own redirect, or another government's
 *    official page that links it.
 * 2. **Routes found on the government's own publications that its homepage
 *    does not link.** For example, a committee's own notice feed.
 *
 * The walk tries a government's hints first. Every request is robots-first,
 * like every other, and each route is confirmed by content where a check
 * exists for its kind. Being listed never makes a hint a find. A hint whose
 * kind no check covers is recorded as a lead, and a witness corroborates a
 * sitting but is never a sitting on its own. What a hint yields is written the
 * way every walk's results are, to the attempt and to the field manual's routes
 * and leads, so later walks and scouts inherit it (RULING 252). A hint that
 * stops answering is recorded as the walk found it; nothing here is a
 * disposition.
 *
 * Each hint is something a person or session observed, and it says who
 * observed it, when, and on what evidence, so a reviewer can check it again.
 * Hints are committed and reviewed with the change that adds them. Only the
 * discovery walk reads them: they never write reader truth and never wire a
 * body.
 *
 * PURE: no fetch, no clock, no store.
 */

import { fingerprint } from "../control-plane/ids.ts";
import type { VerifiableVendor } from "./meetings-site-discovery.ts";

export type RouteHintKind =
  /** A feed of notices or events (RSS, Atom). */
  | "FEED"
  /** A page that dates the body's sittings. */
  | "PAGE"
  /** A document, such as a PDF, that dates sittings or carries an agenda. */
  | "DOCUMENT"
  /** A third party's listing that corroborates a sitting and is never a sitting on its own, such as a video channel's scheduled streams. */
  | "WITNESS";

export interface HintObservation {
  /** UTC instant of the observation. */
  readonly at: string;
  /** Who observed it: a session, a ledger, a person. */
  readonly by: string;
}

export interface RouteHint {
  readonly url: string;
  readonly kind: RouteHintKind;
  /** The body the route serves, in the publisher's own words. */
  readonly body: string;
  /** The platform in the field manual's vocabulary (wordpress, squarespace, drupal, youtube, pdf). */
  readonly platform: string;
  /** The content check that confirms the route, or null, in which case the walk records it as a lead and never as a find. */
  readonly verifyAs: VerifiableVendor | null;
  readonly evidence: string;
  readonly observed: HintObservation;
}

export interface OfficialSiteHint {
  /** The current official site's origin: `https://host`, no path. */
  readonly origin: string;
  /**
   * The government's name as the site's own homepage gave it when observed ("City of El Mirage"). The walk
   * treats the site as the government's only while its homepage still carries this name: a lapsed domain
   * can be anyone's.
   */
  readonly selfName: string;
  /** The address the reference records, which this replaces for the walk. */
  readonly replaces: string;
  /** What the recorded address does now, as observed: NXDOMAIN, parked, a dead redirect. */
  readonly recordedState: string;
  /** Why the origin is the government's own, strongest first. */
  readonly evidence: readonly string[];
  readonly observed: HintObservation;
}

export interface JurisdictionRouteHints {
  readonly jurisdictionId: string;
  readonly officialSite: OfficialSiteHint | null;
  readonly routes: readonly RouteHint[];
}

/**
 * The New Hampshire routes the Backend session found on 2026-09-24. Each host's robots.txt was read first and
 * evaluated for `*`; one GET per URL; every redirect hop checked. They are bodies the town's own iCal never
 * carries.
 */
const NH_LEDGER: HintObservation = { at: "2026-09-24T04:33:00Z", by: "Backend session ledger, 2026-09-24 04:03-04:33Z, robots-checked" };

/**
 * Chandler's own publications, found by the RouteTask session's research on 2026-09-24 (robots.txt read first on
 * every host; about 90 requests, none to destinyhosted.com). Every agenda, result and set of minutes is published
 * only on destinyhosted.com, whose robots.txt reads as disallow-all and which is never requested: that is the
 * owner's decision. The city's own pages date the sittings. The official-page-events check reads no dated event
 * from them yet, so the walk records them as leads until it does; then they are finds with no change here.
 */
const CHANDLER_RESEARCH: HintObservation = { at: "2026-09-24T18:24:00Z", by: "RouteTask session research, robots-checked, destinyhosted.com never requested" };

/** The committed hints. Each entry names what it was observed on; the walk re-checks all of it. */
export const ROUTE_HINTS: readonly JurisdictionRouteHints[] = [
  {
    jurisdictionId: "az:city:city-of-chandler",
    officialSite: null,
    routes: [
      {
        url: "https://www.chandleraz.gov/events",
        kind: "PAGE",
        body: "City Council",
        platform: "drupal",
        verifyAs: "official-page-events",
        evidence:
          "The city's own \"City Meetings Calendar\", as the city links it: one /events/<slug> page per sitting with its date, " +
          "time, venue and an America/Phoenix start, for the Council and about a dozen boards and commissions, posted 4-6 days " +
          "ahead. Robots allow it (only /events/*? with a query string is disallowed). Its pages' \"View Current Agenda\" links " +
          "go to destinyhosted.com.",
        observed: CHANDLER_RESEARCH,
      },
      {
        url: "https://www.chandleraz.gov/government/departments/city-clerks-office/city-council-meetings",
        kind: "PAGE",
        body: "City Council",
        platform: "drupal",
        verifyAs: "official-page-events",
        evidence:
          "The \"2026 City Council Meeting Dates\" table (Resolution No. 5937, Exhibit A): 33 dates in three columns, one row a " +
          "month; the time and place are stated once, in prose: the Council usually meets at 88 E. Chicago St., Council " +
          "Chambers, at 6 p.m. Robots allowed.",
        observed: CHANDLER_RESEARCH,
      },
      {
        url: "https://chandleraz.new.swagit.com/views/155/",
        kind: "WITNESS",
        body: "City Council, Planning and Zoning Commission, Public Housing Authority Commission",
        platform: "swagit",
        verifyAs: null,
        evidence:
          "456 past recordings, 2018-01-03 to 2026-09-17: proof a sitting was held, never a sitting on its own. Robots allowed. " +
          "Its Agenda links redirect to destinyhosted.com and are not followed.",
        observed: CHANDLER_RESEARCH,
      },
    ],
  },
  {
    jurisdictionId: "nh:city:town-of-newbury",
    officialSite: null,
    routes: [
      {
        url: "https://newburynhlibrary.net/feed/",
        kind: "FEED",
        body: "Newbury Library Trustees",
        platform: "wordpress",
        verifyAs: null,
        evidence:
          "200 RSS with 10 items, 6 of them the Trustees' public meeting notices, posted Mar 31 to Sep 3 (2026/09/03: " +
          "\"Tuesday September 8th, 5pm at the Newbury Public Library\"). The library's home page advertises /feed/; its " +
          "/events/?ical=1 carries no trustee meeting.",
        observed: NH_LEDGER,
      },
      {
        url: "https://www.newburyenergynh.org/",
        kind: "PAGE",
        body: "Newbury Energy Committee",
        platform: "squarespace",
        verifyAs: null,
        evidence:
          "The homepage states \"Next Meeting Date: (tentative date) October 21, 2026 4pm Town Offices Meeting Room\". " +
          "Robots allow * (only named AI crawlers are refused); the bare domain 301s to www. The town's winter newsletter names the site.",
        observed: NH_LEDGER,
      },
      {
        url: "https://www.newburyenergynh.org/agenda-and-minutes",
        kind: "PAGE",
        body: "Newbury Energy Committee",
        platform: "squarespace",
        verifyAs: null,
        evidence:
          "The committee's agenda and minutes list, 89 links, e.g. /s/NEC-Agenda-August-26-2026.pdf, which 302s to " +
          "static1.squarespace.com (robots.txt 404, so allowed).",
        observed: NH_LEDGER,
      },
    ],
  },
  {
    jurisdictionId: "nh:city:town-of-sutton",
    officialSite: null,
    routes: [
      {
        url: "https://www.youtube.com/@TownofSuttonCable/streams",
        kind: "WITNESS",
        body: "Town of Sutton boards (streams named PB, ZBA, FC and SC)",
        platform: "youtube",
        verifyAs: null,
        evidence:
          "The town cable channel's Live tab (UCvE2OUek7LYKU2s4ZSSTXXQ) lists scheduled streams with exact starts: " +
          "PB_2026_10_05, ZBA_2026_10_01, FC_2026_09_30, SC_2026_09_28. Robots allowed. A schedule witness only.",
        observed: NH_LEDGER,
      },
    ],
  },
  {
    jurisdictionId: "nh:school:kearsarge-regional-school-dist",
    officialSite: null,
    routes: [
      {
        url: "https://www.kearsarge.org/sites/g/files/vyhlif731/f/pages/2026-2027_school_board_schedule.pdf",
        kind: "DOCUMENT",
        body: "Kearsarge Regional School Board",
        platform: "pdf",
        verifyAs: null,
        evidence:
          "The 2026-27 School Board meeting schedule: 200, 140,821 bytes, last modified 2026-03-13, served without a " +
          "challenge. The listing page that names new agendas is the challenged part.",
        observed: NH_LEDGER,
      },
      {
        url: "https://www.kearsarge.org/sites/g/files/vyhlif731/f/pages/final_krsd_school_board_meeting_agenda_-_september_24_2026.pdf",
        kind: "DOCUMENT",
        body: "Kearsarge Regional School Board",
        platform: "pdf",
        verifyAs: null,
        evidence:
          "A per-meeting agenda (time, place, Zoom): 200, 242,710 bytes. Agendas are published under the same " +
          "/sites/g/files/vyhlif731/f/pages/ path.",
        observed: NH_LEDGER,
      },
    ],
  },
];

export function routeHintsFor(
  jurisdictionId: string,
  hints: readonly JurisdictionRouteHints[] = ROUTE_HINTS,
): JurisdictionRouteHints | null {
  return hints.find((h) => h.jurisdictionId === jurisdictionId) ?? null;
}

/** Whether a homepage still names the government as its hint observed it did: case and spacing aside, entities decoded. */
export function namesItself(html: string, selfName: string): boolean {
  const flat = (s: string): string =>
    s.replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;|&#38;/gi, "&").replace(/&#39;|&#x27;|&rsquo;/gi, "'").replace(/\s+/g, " ").toLowerCase();
  const name = flat(selfName).trim();
  return name !== "" && flat(html).includes(name);
}

/**
 * The identity of a government's hints as the walk tried them. A walk records
 * it, and a need whose hints changed since its latest walk is due again at
 * once, so a new or corrected hint is not left waiting out a recheck interval
 * that was set without it.
 */
export function routeHintsFingerprint(hints: JurisdictionRouteHints): string {
  return fingerprint([
    hints.jurisdictionId,
    hints.officialSite?.origin ?? null,
    ...hints.routes.flatMap((r) => [r.url, r.kind, r.verifyAs ?? "", r.body]),
  ]).slice(0, 16);
}

function publicHttpsOrigin(raw: string): URL | null {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname.includes(".") ? url : null;
  } catch {
    return null;
  }
}

/** What is wrong with a hint list, one sentence per problem; empty when it is sound. */
export function routeHintProblems(hints: readonly JurisdictionRouteHints[]): readonly string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const instant = (at: string): boolean => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/.test(at) && !Number.isNaN(Date.parse(at));
  for (const h of hints) {
    const who = h.jurisdictionId;
    if (!/^[a-z]{2}:[a-z_]+:[a-z0-9-]+$/.test(who)) problems.push(`${who}: not a jurisdiction id`);
    if (seen.has(who)) problems.push(`${who}: listed twice`);
    seen.add(who);
    if (h.officialSite === null && h.routes.length === 0) problems.push(`${who}: no official site and no route; nothing to try`);
    const site = h.officialSite;
    if (site !== null) {
      const origin = publicHttpsOrigin(site.origin);
      if (origin === null || origin.origin !== site.origin) problems.push(`${who}: official site ${site.origin} is not a bare https origin`);
      let replaced: string | null = null;
      try {
        replaced = new URL(site.replaces).hostname.toLowerCase().replace(/^www\./, "");
      } catch {
        problems.push(`${who}: the replaced address ${site.replaces} is not a URL`);
      }
      if (origin !== null && replaced !== null && origin.hostname.toLowerCase().replace(/^www\./, "") === replaced) {
        problems.push(`${who}: the official site is the recorded host itself; there is nothing to correct`);
      }
      if (site.selfName.trim().length < 4) problems.push(`${who}: the official site's own name for the government is not recorded`);
      if (site.recordedState.trim() === "") problems.push(`${who}: the recorded address's state is not said`);
      if (site.evidence.length === 0 || site.evidence.some((e) => e.trim() === "")) problems.push(`${who}: the official site carries no evidence`);
      if (!instant(site.observed.at) || site.observed.by.trim() === "") problems.push(`${who}: the official site's observation is not dated and attributed`);
    }
    for (const r of h.routes) {
      if (publicHttpsOrigin(r.url) === null) problems.push(`${who}: route ${r.url} is not a public https URL`);
      if (r.body.trim() === "" || r.platform.trim() === "" || r.evidence.trim() === "") problems.push(`${who}: route ${r.url} does not name its body, platform and evidence`);
      if (r.kind === "WITNESS" && r.verifyAs !== null) problems.push(`${who}: witness ${r.url} is checked as a route; a witness is never a sitting on its own`);
      if (!instant(r.observed.at) || r.observed.by.trim() === "") problems.push(`${who}: route ${r.url} is not dated and attributed`);
    }
    const urls = h.routes.map((r) => r.url);
    if (new Set(urls).size !== urls.length) problems.push(`${who}: a route is listed twice`);
  }
  return problems;
}
