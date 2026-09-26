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
 * only on destinyhosted.com, whose robots.txt reads as disallow-all. On 2026-09-24 that host waited on the owner;
 * since the owner decision of 2026-09-25 (robots.txt alone must not block acquisition) it may be read, and what
 * is missing is an adapter that follows the city's Destiny agenda links. The city's own pages date the sittings.
 * The official-page-events check reads no dated event from them yet, so the walk records them as leads until it
 * does; then they are finds with no change here. The observation strings below are the 2026-09-24 record as made.
 */
const CHANDLER_RESEARCH: HintObservation = { at: "2026-09-24T18:24:00Z", by: "RouteTask session research, robots-checked, destinyhosted.com never requested" };

/**
 * The current official sites of governments whose recorded addresses went stale, verified by the RouteTask
 * session's research on 2026-09-24: robots.txt read first on every host, no challenge passed. The .gov rows
 * are from CISA's registry (current-full.csv, read 2026-09-24T18:03:54Z, sha256 62de2f53…07e4f).
 */
const SITE_RESEARCH = "RouteTask session research, robots-checked";
const DOTGOV = "the .gov registry (CISA current-full.csv, read 2026-09-24T18:03:54Z) lists";
/**
 * The class behind the six (2026-09-24): 262 of the 1,975 governments owed discovery had a recorded host that does
 * not resolve at all (checked against 1.1.1.1 and 8.8.8.8). Forty matched exactly one .gov registry row by name and
 * state; each of those homepages was read robots-first, and the ones that name the government (or plainly the place)
 * are hinted below. Unreadable robots, challenges, refusals and failed fetches are not.
 */
const DOTGOV_SWEEP = "RouteTask .gov sweep: one exact registry match by name and state, homepage read robots-first";

function siteHint(jurisdictionId: string, officialSite: OfficialSiteHint): JurisdictionRouteHints {
  return { jurisdictionId, officialSite, routes: [] };
}

/*
 * Cottonwood, Douglas, El Mirage, Eloy, Flagstaff and Holbrook left this list on 2026-09-24, and Newbury's and
 * Kearsarge's official-site parts with them: their current sites are reviewed website corrections now (C15,
 * `lib/civic-data/website-corrections.ts`), so the gap ledger records the corrected address itself and a hint
 * replacing the old one would name an address no longer on record. Newbury's and Kearsarge's routes stay.
 */
/** The committed hints. Each entry names what it was observed on; the walk re-checks all of it. */
export const ROUTE_HINTS: readonly JurisdictionRouteHints[] = [
  {
    /*
     * C16's first reviewed calendar (2026-09-24): the walk confirms this feed so the reviewed crosswalk rows for the
     * city's commissions can connect to it. The feed never names a body on its own; each crosswalk row's reviewed
     * title filter does, on the city's own event page naming the commission.
     */
    jurisdictionId: "az:city:city-of-flagstaff",
    officialSite: null,
    routes: [
      {
        url: "https://www.flagstaff.az.gov/common/modules/iCalendar/iCalendar.aspx?catID=49&feed=calendar",
        kind: "FEED",
        body: "Boards and Commissions: the Housing, Tourism and Indigenous Commissions among 18 bodies",
        platform: "civicplus",
        verifyAs: "ical",
        evidence:
          "The city's own CivicPlus \"Boards & Commissions\" iCal feed (catID=49): 440 events with America/Phoenix start times, " +
          "among them 16 \"Housing Commission\", 17 \"Tourism Commission Meeting\" and 33 \"Indigenous Commission Meeting\" " +
          "sittings; read robots-first (sha256 ce54348d…). The commissions' own event pages (Calendar.aspx?EID=2823, 3031, 3778) name each body.",
        observed: { at: "2026-09-24T23:16:02Z", by: "RouteTask session research, robots-checked" },
      },
    ],
  },
  siteHint("az:city:city-of-winslow", {
    origin: "https://www.winslowaz.gov",
    selfName: "City Of Winslow",
    replaces: "http://www.ci.winslow.az.us",
    recordedState: "it does not resolve: its nameservers fail (SERVFAIL)",
    evidence: [
      `${DOTGOV} winslowaz.gov, City, City Of Winslow, Winslow, AZ`,
      "its homepage answered 200, titled \"Home | City Of Winslow\", naming the City Of Winslow",
    ],
    observed: { at: "2026-09-24T19:41:14Z", by: DOTGOV_SWEEP },
  }),
  siteHint("az:city:town-of-huachuca-city", {
    origin: "https://huachucacityaz.gov",
    selfName: "Town of Huachuca City",
    replaces: "http://WWW.HUACHUCACITY.ORG",
    recordedState: "it does not resolve (NXDOMAIN)",
    evidence: [
      `${DOTGOV} huachucacityaz.gov, City, Town of Huachuca City, Huachuca City, AZ`,
      "its homepage answered 200, titled \"Home - Town of Huachuca City\", naming the Town of Huachuca City",
    ],
    observed: { at: "2026-09-24T19:33:49Z", by: DOTGOV_SWEEP },
  }),
  /*
   * The 85635 expansion (2026-09-26): the district's recorded k12.az.us host no longer resolves. The federal
   * school-district directory names its current site, and that site names the district. Its board's agendas are on
   * Diligent (fhasd.community.highbond.com) and BoardDocs (boarddocs.com/az/fhas).
   * Diligent's public MeetingsService now uses the standing adapter after linked-page identity verification;
   * the annual schedule remains complementary evidence when the portal omits later dates.
   */
  siteHint("az:depschool:fort-huachuca-accommodation-school", {
    origin: "https://www.fhasd.org",
    selfName: "Fort Huachuca Accommodation Schools",
    replaces: "http://fthuachuca.k12.az.us/",
    recordedState: "it does not resolve: its nameservers fail (SERVFAIL, with and without www)",
    evidence: [
      "the NCES Common Core of Data district detail for district 0403150, \"Fort Huachuca Accommodation District\" (Fort Huachuca, AZ 85613), lists its website as http://fhasd.org",
      "its homepage answered 200, titled \"Fort Huachuca Accommodation Schools\", and links its \"Meet the Governing Board\", \"Information and Meeting Dates\" and \"Governing Board Agenda/Minutes\" pages",
    ],
    observed: { at: "2026-09-26T04:57:27Z", by: "85635 acquisition session: one honest request per page, robots.txt read first (www.fhasd.org answers 404 to it)" },
  }),
  {
    /*
     * The 85635 expansion (2026-09-26). The city publishes its sittings on its own "Calendar Meeting List" page as
     * schema.org Event JSON-LD, which the official-page-events adapter already reads. The page never names the city
     * in an event's title, so the walk could not confirm it for the city by name; the body this hint names, "City
     * Council", is the name its governing body's events carry. No other route exists that an adapter reads: neither
     * this page nor the council's own meetings page links an iCal or RSS feed or an agenda portal (only a YouTube
     * channel and the city's own agendas-and-minutes document page), read 2026-09-26.
     */
    jurisdictionId: "az:city:city-of-sierra-vista",
    officialSite: null,
    routes: [
      {
        url: "https://www.sierravistaaz.gov/our-city/calendar-meeting-list",
        kind: "PAGE",
        body: "City Council",
        platform: "granicus-govaccess",
        verifyAs: "official-page-events",
        evidence:
          "The city's own \"Calendar Meeting List | City of Sierra Vista, AZ\" page: 20 schema.org Event records with dates and " +
          "America/Phoenix start times, among them \"City Council Work Session\" (2026-10-06, 3 PM) and \"City Council Regular " +
          "Meeting\" (2026-10-08, 5 PM), besides the Neighborhoods and the Parks and Recreation Commissions. Read robots-first; " +
          "official-page-events@cd7f0852192b verifies 8 City Council events from it.",
        observed: { at: "2026-09-26T04:58:00Z", by: "85635 acquisition session: one honest request per page, robots.txt read first" },
      },
    ],
  },
  siteHint("az:city:town-of-kearny", {
    origin: "https://www.kearnyaz.gov",
    selfName: "Town of Kearny",
    replaces: "http://www.townof.kearny.com",
    recordedState: "it does not resolve (NXDOMAIN)",
    evidence: [
      `${DOTGOV} kearnyaz.gov, City, Town of Kearny, Kearny, AZ`,
      "its homepage answered 200, titled \"Official Web Site of Town of Kearny, Arizona\", naming the Town of Kearny",
    ],
    observed: { at: "2026-09-24T19:41:35Z", by: DOTGOV_SWEEP },
  }),
  siteHint("az:city:town-of-pinetop-lakeside", {
    origin: "https://pinetoplakesideaz.gov",
    selfName: "Town of Pinetop-Lakeside",
    replaces: "http://www.ci.pinetop-lakeside.az.us",
    recordedState: "it does not resolve: its nameservers fail (SERVFAIL)",
    evidence: [
      `${DOTGOV} pinetoplakesideaz.gov, City, Town of Pinetop-Lakeside, Lakeside, AZ`,
      "its homepage answered 200, titled \"Pinetop-Lakeside, AZ | Official Website\", naming the Town of Pinetop-Lakeside",
    ],
    observed: { at: "2026-09-24T19:41:44Z", by: DOTGOV_SWEEP },
  }),
  siteHint("az:city:town-of-snowflake", {
    origin: "https://www.snowflakeaz.gov",
    selfName: "Town of Snowflake",
    replaces: "http://www.ci.snowflake.az.us",
    recordedState: "it does not resolve (NXDOMAIN)",
    evidence: [
      `${DOTGOV} snowflakeaz.gov, City, Town of Snowflake, Snowflake, AZ`,
      "its homepage answered 200, titled \"The Town of Snowflake, AZ\", naming the Town of Snowflake",
    ],
    observed: { at: "2026-09-24T19:42:06Z", by: DOTGOV_SWEEP },
  }),
  siteHint("az:special:fountain-hills-sanitary-district", {
    origin: "https://www.az-fhsd.gov",
    selfName: "Fountain Hills Sanitary District",
    replaces: "http://www.azfhsd.gov",
    recordedState: "it does not resolve: the name has no address record",
    evidence: [
      `${DOTGOV} az-fhsd.gov, City, Fountain Hills Sanitary District, Fountain Hills, AZ`,
      "its homepage answered 200, titled \"Home - Fountain Hills Sanitary District\", naming the Fountain Hills Sanitary District",
    ],
    observed: { at: "2026-09-24T19:42:32Z", by: DOTGOV_SWEEP },
  }),
  siteHint("nh:city:town-of-andover", {
    origin: "https://andover-nh.gov",
    selfName: "Town of Andover",
    replaces: "http://www.andovernh.us.com",
    recordedState: "it does not resolve (NXDOMAIN)",
    evidence: [
      `${DOTGOV} andover-nh.gov, City, TOWN OF ANDOVER, Andover, NH`,
      "its homepage answered 200, titled \"Andover, NH | Official Website\", naming the Town of Andover",
    ],
    observed: { at: "2026-09-24T19:42:41Z", by: DOTGOV_SWEEP },
  }),
  siteHint("nh:city:town-of-canterbury", {
    origin: "https://www.canterburynh.gov",
    selfName: "Town of Canterbury",
    replaces: "http://www.canterburynh.org",
    recordedState: "it does not resolve (NXDOMAIN)",
    evidence: [
      `${DOTGOV} canterburynh.gov, City, Town of Canterbury, Canterbury, NH`,
      "its homepage answered 200, titled \"Home | Town of Canterbury NH\", naming the Town of Canterbury",
    ],
    observed: { at: "2026-09-24T19:43:43Z", by: DOTGOV_SWEEP },
  }),
  siteHint("nh:city:town-of-freedom", {
    origin: "https://townoffreedomnh.gov",
    selfName: "Town Of Freedom",
    replaces: "http://www.officeetownoffreedom.net",
    recordedState: "it does not resolve (NXDOMAIN)",
    evidence: [
      `${DOTGOV} townoffreedomnh.gov, City, Town of Freedom, Freedom, NH`,
      "its homepage answered 200, titled \"Town Of Freedom – Official Site\", naming the Town Of Freedom",
    ],
    observed: { at: "2026-09-24T19:43:57Z", by: DOTGOV_SWEEP },
  }),
  siteHint("nh:city:town-of-hollis", {
    origin: "https://hollisnh.gov",
    selfName: "Town of Hollis",
    replaces: "http://www.hollis.nh.us/",
    recordedState: "it does not resolve: its nameservers fail (SERVFAIL)",
    evidence: [
      `${DOTGOV} hollisnh.gov, City, Town of Hollis, Hollis, NH`,
      "its homepage answered 200, titled \"Hollis, NH | Official Website\", naming the Town of Hollis",
    ],
    observed: { at: "2026-09-24T19:44:09Z", by: DOTGOV_SWEEP },
  }),
  siteHint("nh:city:town-of-moultonborough", {
    origin: "https://moultonboroughnh.gov",
    selfName: "Moultonborough",
    replaces: "http://www.moultonborouoghnh.gov",
    recordedState: "it does not resolve: the name has no address record",
    evidence: [
      `${DOTGOV} moultonboroughnh.gov, City, Town of Moultonborough, Moultonborough, NH`,
      "its homepage answered 200, titled \"Moultonborough, NH | Official Website\", naming the place but not in \"X of Y\" form",
    ],
    observed: { at: "2026-09-24T19:44:55Z", by: DOTGOV_SWEEP },
  }),
  siteHint("nh:city:town-of-new-hampton", {
    origin: "https://www.newhamptonnh.gov",
    selfName: "Town of New Hampton",
    replaces: "http://www.newhampton.nh.us",
    recordedState: "it does not resolve (NXDOMAIN)",
    evidence: [
      `${DOTGOV} newhamptonnh.gov, City, Town of New Hampton, New Hampton, NH`,
      "its homepage answered 200, titled \"Town of New Hampton - New Hampton Village Cemetery Association\", naming the Town of New Hampton",
    ],
    observed: { at: "2026-09-24T19:45:10Z", by: DOTGOV_SWEEP },
  }),
  siteHint("nh:city:town-of-newton", {
    origin: "https://newton-nh.gov",
    selfName: "Newton",
    replaces: "http://www.newtonnh.gov",
    recordedState: "it does not resolve: the name has no address record",
    evidence: [
      `${DOTGOV} newton-nh.gov, City, Town of Newton, Newton, NH`,
      "its homepage answered 200, titled \"Newton, NH | Official Website\", naming the place but not in \"X of Y\" form",
    ],
    observed: { at: "2026-09-24T19:45:18Z", by: DOTGOV_SWEEP },
  }),
  siteHint("nh:school:gilford-school-district", {
    origin: "https://sau73nh.gov",
    selfName: "Gilford School District",
    replaces: "http://WWW.GILFORD.K12.NH.US",
    recordedState: "it does not resolve: its nameservers fail (SERVFAIL)",
    evidence: [
      `${DOTGOV} sau73nh.gov, School district, Gilford School District, Gilford, NH`,
      "its homepage answered 200, titled \"Home - Gilford School District\", naming the Gilford School District",
    ],
    observed: { at: "2026-09-24T19:52:04Z", by: DOTGOV_SWEEP },
  }),
  siteHint("nj:city:borough-of-beach-haven", {
    origin: "https://beachhaven-nj.gov",
    selfName: "Borough of Beach Haven",
    replaces: "http://www.beachhavennj.gov",
    recordedState: "it does not resolve: the name has no address record",
    evidence: [
      `${DOTGOV} beachhaven-nj.gov, City, Borough of Beach Haven, Beach Haven, NJ`,
      "its homepage answered 200, titled \"Home - Borough of Beach Haven\", naming the Borough of Beach Haven",
    ],
    observed: { at: "2026-09-24T19:52:12Z", by: DOTGOV_SWEEP },
  }),
  siteHint("nj:city:borough-of-brielle", {
    origin: "https://briellenj.gov",
    selfName: "Borough of Brielle",
    replaces: "http://www.brielln.j.com",
    recordedState: "it does not resolve (NXDOMAIN)",
    evidence: [
      `${DOTGOV} briellenj.gov, City, Borough of Brielle, Brielle, NJ`,
      "its homepage answered 200, titled \"Brielle, NJ | Official Website\", naming the Borough of Brielle",
    ],
    observed: { at: "2026-09-24T19:52:18Z", by: DOTGOV_SWEEP },
  }),
  siteHint("nj:city:borough-of-island-heights", {
    origin: "https://islandheightsborough.gov",
    selfName: "Island Heights",
    replaces: "http://www.islandheightsgov.com/",
    recordedState: "it does not resolve (NXDOMAIN)",
    evidence: [
      `${DOTGOV} islandheightsborough.gov, City, Borough of Island Heights, Island Heights, NJ`,
      "its homepage answered 200, titled \"Welcome | Island Heights, NJ\", naming the place but not in \"X of Y\" form",
    ],
    observed: { at: "2026-09-24T19:52:23Z", by: DOTGOV_SWEEP },
  }),
  siteHint("nj:city:borough-of-ogdensburg", {
    origin: "https://ogdensburgnj.gov",
    selfName: "Borough of Ogdensburg",
    replaces: "http://www.ogdensburgnij.org",
    recordedState: "it does not resolve (NXDOMAIN)",
    evidence: [
      `${DOTGOV} ogdensburgnj.gov, City, Borough of Ogdensburg, Ogdensburg, NJ`,
      "its homepage answered 200, titled \"Borough of Ogdensburg – County of Sussex, NJ\", naming the Borough of Ogdensburg",
    ],
    observed: { at: "2026-09-24T19:52:42Z", by: DOTGOV_SWEEP },
  }),
  siteHint("nj:city:borough-of-waldwick", {
    origin: "https://www.waldwicknj.gov",
    selfName: "Borough of Waldwick",
    replaces: "http://www.waldwickpd.org",
    recordedState: "it does not resolve (NXDOMAIN)",
    evidence: [
      `${DOTGOV} waldwicknj.gov, City, Borough of Waldwick, Waldwick, NJ`,
      "its homepage answered 200, titled \"Borough of Waldwick New Jersey - Home Page\", naming the Borough of Waldwick",
    ],
    observed: { at: "2026-09-24T19:52:52Z", by: DOTGOV_SWEEP },
  }),
  siteHint("nj:city:city-of-absecon", {
    origin: "https://abseconnj.gov",
    selfName: "City of Absecon",
    replaces: "http://www.abseconnewjersey.org",
    recordedState: "it does not resolve (NXDOMAIN)",
    evidence: [
      `${DOTGOV} abseconnj.gov, City, City of Absecon, Absecon, NJ`,
      "its homepage answered 200, titled \"City of Absecon\", naming the City of Absecon",
    ],
    observed: { at: "2026-09-24T19:52:57Z", by: DOTGOV_SWEEP },
  }),
  siteHint("nj:city:city-of-bridgeton", {
    origin: "https://cityofbridgetonnj.gov",
    selfName: "City of Bridgeton",
    replaces: "http://www.city.of.bridgeton.com",
    recordedState: "it does not resolve (NXDOMAIN)",
    evidence: [
      `${DOTGOV} cityofbridgetonnj.gov, City, City of Bridgeton, Bridgeton, NJ`,
      "its homepage answered 200, titled \"Bridgeton, NJ | Official Website\", naming the City of Bridgeton",
    ],
    observed: { at: "2026-09-24T19:53:05Z", by: DOTGOV_SWEEP },
  }),
  siteHint("nj:city:city-of-hoboken", {
    origin: "https://hobokennj.gov",
    selfName: "City of Hoboken",
    replaces: "http://www.hobokennj.org/",
    recordedState: "it does not resolve: its nameservers fail (SERVFAIL)",
    evidence: [
      `${DOTGOV} hobokennj.gov, City, City of Hoboken, Hoboken, NJ`,
      "its homepage answered 200, titled \"Hoboken NJ Website\", naming the City of Hoboken",
    ],
    observed: { at: "2026-09-24T19:53:14Z", by: DOTGOV_SWEEP },
  }),
  siteHint("nj:city:township-of-fredon", {
    origin: "https://fredonnj.gov",
    selfName: "Township of Fredon",
    replaces: "http://WWW.TWP.FREDON.NJ.US",
    recordedState: "it does not resolve: its nameservers fail (SERVFAIL)",
    evidence: [
      `${DOTGOV} fredonnj.gov, City, Township of Fredon, Newton, NJ`,
      "its homepage answered 200, titled \"Fredon Township\", naming the Township of Fredon",
    ],
    observed: { at: "2026-09-24T19:53:19Z", by: DOTGOV_SWEEP },
  }),
  siteHint("nj:city:township-of-north-brunswick", {
    origin: "https://www.northbrunswicknj.gov",
    selfName: "Township of North Brunswick",
    replaces: "http://www.twp.north-brunswick.nj.us/index.html",
    recordedState: "it does not resolve (NXDOMAIN)",
    evidence: [
      `${DOTGOV} northbrunswicknj.gov, City, Township of North Brunswick, North Brunswick, NJ`,
      "its homepage answered 200, titled \"North Brunswick, NJ | Official Website\", naming the Township of North Brunswick",
    ],
    observed: { at: "2026-09-24T19:53:44Z", by: DOTGOV_SWEEP },
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
