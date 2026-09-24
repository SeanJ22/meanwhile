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
   * The name the walk requires the homepage to carry: the government's name as its homepage gave it when
   * observed ("City of El Mirage"), or, when the homepage served a challenge and could not be observed, the
   * government's short name. The walk treats the site as the government's only while its homepage carries
   * it: a lapsed domain can be anyone's.
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

/**
 * The current official sites of governments whose recorded addresses went stale, verified by the RouteTask
 * session's research on 2026-09-24: robots.txt read first on every host, no challenge passed. The .gov rows
 * are from CISA's registry (current-full.csv, read 2026-09-24T18:03:54Z, sha256 62de2f53…07e4f).
 */
const SITE_RESEARCH = "RouteTask session research, robots-checked";
const DOTGOV = "the .gov registry (CISA current-full.csv, read 2026-09-24T18:03:54Z) lists";

function siteHint(jurisdictionId: string, officialSite: OfficialSiteHint): JurisdictionRouteHints {
  return { jurisdictionId, officialSite, routes: [] };
}

/** The committed hints. Each entry names what it was observed on; the walk re-checks all of it. */
export const ROUTE_HINTS: readonly JurisdictionRouteHints[] = [
  siteHint("az:city:city-of-cottonwood", {
    origin: "https://cottonwoodaz.gov",
    selfName: "City of Cottonwood",
    replaces: "http://www.ci.cottonwood.az.us",
    recordedState: "it does not resolve: www.ci.cottonwood.az.us is a CNAME to ci.cottonwood.az.us, which has no address record",
    evidence: [
      `${DOTGOV} cottonwoodaz.gov, City, City of Cottonwood, Cottonwood, AZ`,
      "its homepage answered 200, titled \"Cottonwood, AZ | Official Website\", naming the City of Cottonwood at 827 N. Main St",
    ],
    observed: { at: "2026-09-24T18:07:56Z", by: SITE_RESEARCH },
  }),
  siteHint("az:city:city-of-douglas", {
    origin: "https://douglasaz.gov",
    selfName: "City of Douglas",
    replaces: "http://www.douglasaz.org",
    recordedState: "it does not resolve: douglasaz.org's nameservers refuse or time out (SERVFAIL)",
    evidence: [
      `${DOTGOV} douglasaz.gov, City, City of Douglas, Douglas, AZ`,
      "Cochise County's Quick Links page (www.cochise.az.gov/QuickLinks.aspx) links www.douglasaz.gov",
      "its homepage answered 200, titled \"Douglas, AZ | Official Website\"",
    ],
    observed: { at: "2026-09-24T18:08:01Z", by: SITE_RESEARCH },
  }),
  siteHint("az:city:city-of-el-mirage", {
    origin: "https://elmirageaz.gov",
    selfName: "City of El Mirage",
    replaces: "http://www.cityofelmirage.org",
    recordedState: "it has moved: http and https both answer 301 to https://elmirageaz.gov/",
    evidence: [
      "the recorded host's own 301 names https://elmirageaz.gov/",
      `${DOTGOV} elmirageaz.gov, City, City of El Mirage, El Mirage, AZ`,
    ],
    observed: { at: "2026-09-24T18:08:06Z", by: SITE_RESEARCH },
  }),
  siteHint("az:city:city-of-eloy", {
    origin: "https://eloyaz.gov",
    selfName: "City of Eloy",
    replaces: "http://www.ci.eloy.az.us",
    recordedState: "it serves a stock IIS default page (last modified 2022-05-19) over http, and https resets",
    evidence: [
      `${DOTGOV} eloyaz.gov, City, City of Eloy, Eloy, AZ`,
      "Pinal County's City & Town Governments list (www.pinal.gov/QuickLinks.aspx?CID=74) links https://www.eloyaz.gov/",
    ],
    observed: { at: "2026-09-24T18:08:12Z", by: SITE_RESEARCH },
  }),
  siteHint("az:city:city-of-flagstaff", {
    origin: "https://www.flagstaff.az.gov",
    selfName: "City of Flagstaff",
    replaces: "http://www.flagstaffaz.gov",
    recordedState: "it answers, but its root is 404 and does not redirect (flagstaffaz.gov is still registered to the City of Flagstaff)",
    evidence: [
      "the State of Arizona's az.gov zone (az.gov is registered to the State of Arizona) delegates flagstaff.az.gov to the city's CivicPlus host",
      "its homepage answered 200, titled \"City of Flagstaff Official Website\"",
    ],
    observed: { at: "2026-09-24T18:08:17Z", by: SITE_RESEARCH },
  }),
  siteHint("az:city:city-of-holbrook", {
    origin: "https://holbrookaz.gov",
    selfName: "City of Holbrook",
    replaces: "http://www.ci.holbrook.az.us/",
    recordedState: "it does not resolve: ci.holbrook.az.us is delegated to nameservers that time out (SERVFAIL)",
    evidence: [
      `${DOTGOV} holbrookaz.gov, City, Holbrook, City of, Holbrook, AZ`,
      "its homepage answered 200 and reads \"The Official City of Holbrook Website\"",
    ],
    observed: { at: "2026-09-24T18:08:23Z", by: SITE_RESEARCH },
  }),
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
    officialSite: {
      origin: "https://www.newbury.nh.gov",
      selfName: "Newbury",
      replaces: "http://www.newburyh.org",
      recordedState: "it is not registered (NXDOMAIN): newburyh.org is one letter short of the town's former newburynh.org, which is dead too",
      evidence: [
        "the State of New Hampshire's own nh.gov zone publishes the name: nh.gov's authoritative nameserver answers newbury.nh.gov " +
          "directly (zone SOA nh.gov, hostmaster.nh.gov), and www.newbury.nh.gov is a CNAME to the town's CivicPlus host; only " +
          "the State can publish a name there, as it does for newlondon.nh.gov, which Merrimack County links",
        "the apex answers 301 to https://www.newbury.nh.gov/",
        "its homepage served a challenge when observed, and Merrimack County still links the dead newburynh.org, so the name " +
          "the walk requires is the town's short name",
      ],
      observed: { at: "2026-09-24T18:10:35Z", by: SITE_RESEARCH },
    },
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
    officialSite: {
      origin: "https://www.suttonnh.gov",
      selfName: "Sutton",
      replaces: "http://www.sutton-nh.gov",
      recordedState: "it is not registered (NXDOMAIN): the town's former domain was sutton-nh.org",
      evidence: [
        `${DOTGOV} suttonnh.gov, City, Town of Sutton, Sutton Mills, NH`,
        "the town's former domain, sutton-nh.org, which Merrimack County still links, answers 301 to https://www.suttonnh.gov/",
        "its homepage served a challenge when observed, so the name the walk requires is the town's short name",
      ],
      observed: { at: "2026-09-24T18:10:39Z", by: SITE_RESEARCH },
    },
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
    officialSite: {
      origin: "https://www.kearsarge.org",
      selfName: "Kearsarge",
      replaces: "http://www.kearsarge.k12.nh.us/",
      recordedState: "it is a CNAME to ghs.google.com that answers Google's 404",
      evidence: [
        "a Town of Warner library newsletter (library.warnernh.gov; warnernh.gov is registered to the Town of Warner) gives " +
          "https://www.kearsarge.org/district/school-board-mbc for the district's School Board minutes",
        "the district's board schedule and agenda PDFs are served from www.kearsarge.org (the Backend session's ledger, below)",
        "its homepage served a challenge when observed, so the name the walk requires is the district's short name",
      ],
      observed: { at: "2026-09-24T18:10:44Z", by: SITE_RESEARCH },
    },
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
