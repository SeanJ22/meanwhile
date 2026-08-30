/**
 * **THE LEGISTAR ROUTE PORTFOLIO — WHAT THIS SOURCE CLASS CAN BE ASKED, AND
 * WHICH FACTS EACH ASKING CAN CARRY.**
 * (WS-LEGI, 2026-08-29.)
 *
 * ## Why a portfolio rather than a fetch function
 *
 * Legistar is a NATIONAL SOURCE CLASS. `data/reference/granicus_legistar_tenants.csv`
 * names 39 tenants and is explicitly not an enumeration; Pima is the tenant this
 * repository proved the method on, and it is not the scope. An adapter written as
 * "the function that gets a Legistar meeting" encodes one tenant's happy path as
 * the shape of the source, and the next tenant's different publishing habits then
 * read as that tenant having no data.
 *
 * So the source is represented as a GRAPH OF ROUTES, each declaring the classes
 * of fact it is capable of carrying. Nothing here fetches. This module is the map;
 * `client.ts` and `outcomes.ts` are two of the vehicles.
 *
 * ## THE RULE THIS FILE EXISTS TO ENFORCE
 *
 * **One successful route never collapses the source universe.**
 *
 * An HTTP 200 from the Web API does not discharge the Accessible Agenda. A
 * readable agenda PDF does not discharge the API. Different representations of
 * one meeting carry DIFFERENT FACTS, and the temptation — always, in every
 * adapter — is to notice that the JSON route answered and stop asking. That
 * optimisation is invisible when it is wrong: the meeting still renders, the
 * fields we happened to collect are all populated, and the facts only the other
 * representation carried are simply never missed.
 *
 * `docs/sources.md` already records the measured proof, on this exact source, on
 * two tenants (2026-08-28):
 *
 * > On one Mesa "Next Month" filter the InSite grid published 15 sittings with 12
 * > `meeting_NotViewable` while `/v1/mesa/events` returned exactly the other 3.
 * > On Pima the InSite grid holds 14 future Board sittings the Web API returns
 * > zero of. **Only the UNION survives both tenants.**
 *
 * That is one fact class — MEETING_EXISTENCE — where the preferred route is
 * tenant-dependent and neither route dominates. This file generalises it: every
 * route declares `bears`, and {@link factClassesOwedAfter} answers what is STILL
 * owed given what has already succeeded. A route that succeeded discharges only
 * the facts it is capable of carrying, and never a fact it cannot see.
 *
 * `tests/legistar-routes.test.ts` fails if the portfolio collapses back toward a
 * single preferred representation.
 *
 * ## Permission is a property of the ROUTE, and a wall is not a discharge
 *
 * Two of the highest-value routes in this portfolio are DISALLOWED: every Pima
 * and Mesa agenda and minutes URL resolves to `legistar.granicus.com`, which
 * answers `User-agent: *` with `Disallow: /` (read three ways by three clients,
 * `docs/sources.md`, 2026-08-29). They stay in the portfolio, declared, with the
 * facts they would carry and the reason they are not walked.
 *
 * **A blocked route may never become a blocked fact (RULING 184).** Deleting the
 * minutes routes from this map because we cannot walk them would silently
 * convert "we are not permitted to read the minutes" into "there are no minutes",
 * which is the exact substitution this product cannot make. So NARRATIVE_MINUTES
 * remains permanently owed on every tenant whose minutes sit behind that host,
 * and {@link factClassesOwedAfter} keeps returning it however many JSON routes
 * come back 200.
 */

/**
 * The classes of FACT a Legistar route can carry.
 *
 * Deliberately not one entry per endpoint: the whole mechanism depends on two
 * different endpoints being comparable on what they can TELL you, so that "the
 * API answered" can be checked against "and the API cannot see item full text".
 */
export const LEGISTAR_FACT_CLASSES = [
  /** Which bodies exist on this tenant, and their names and types. */
  "BODY_IDENTITY",
  /** That a sitting happened or is scheduled at all. */
  "MEETING_EXISTENCE",
  /** Date, wall clock, room. */
  "MEETING_TIME_PLACE",
  /** Whether an agenda/minutes document is published, and when it last was. */
  "PUBLICATION_STATE",
  /** The ordered list of items noticed — titles and file numbers. */
  "AGENDA_ITEM_LIST",
  /**
   * The BODY of an item: the full legislative text, the recitals, the dollar
   * amounts, the parties to a contract. **The Web API does not carry this.**
   * `EventItemTitle` is a caption; the text is on the InSite detail page and in
   * the packet PDF.
   */
  "ITEM_FULL_TEXT",
  /** Attachments, exhibits, staff memoranda, the packet. */
  "SUPPORTING_DOCUMENT",
  /** That the body acted, and the verb it used. */
  "ACTION_TAKEN",
  /** A NAMED PERSON'S cast value on one question. The strongest record here. */
  "PERSON_VOTE",
  /**
   * The clerk's prose account of the sitting — what was said, who appeared, the
   * amendments taken from the floor, the items pulled from consent. Structurally
   * unavailable from the item endpoint, which has fields and no narrative.
   */
  "NARRATIVE_MINUTES",
  /** A matter's history across sittings: introduced, referred, continued, adopted. */
  "MATTER_LIFECYCLE",
  /** That a recording exists, and where. */
  "MEDIA_RECORD",
] as const;

export type LegistarFactClass = (typeof LEGISTAR_FACT_CLASSES)[number];

/**
 * What kind of asking a route is. Named because a portfolio with two routes in
 * the same class is a portfolio with a fallback, and one with a single route in
 * a class is a single point of failure worth being able to see.
 */
export const LEGISTAR_ROUTE_CLASSES = [
  "DISCOVERY",
  "BODY_IDENTITY",
  "MEETING_ENUMERATION",
  "PUBLICATION_STATUS",
  "AGENDA_CONTENT",
  "ACCESSIBLE_CONTENT",
  "DOCUMENT_PACKET",
  "ATTACHMENT",
  "MINUTES",
  "OUTCOME_ACTION",
  "ROLL_CALL",
  "MATTER_HISTORY",
  "ARCHIVE",
  "FEED",
] as const;

export type LegistarRouteClass = (typeof LEGISTAR_ROUTE_CLASSES)[number];

/**
 * How a route is reached. The transport matters on its own: a fact available
 * only as PDF bytes behind a `Disallow` is in a different position from the same
 * fact in a JSON field, and "we have it in one transport" is the assumption that
 * makes a portfolio collapse.
 */
export type LegistarTransport = "JSON_API" | "HTML" | "PDF" | "XML" | "ICS";

/**
 * Whether this repository may ask, and whether it has.
 *
 * `DISALLOWED` is a permission state and `NOT_BUILT` is a tooling state, and
 * RULING 182 keeps them apart from each other and from absence: neither is
 * evidence about what the route holds.
 */
export type LegistarRouteDisposition =
  /** Built, permitted, and exercised against at least one tenant. */
  | "WALKED"
  /** Permitted, and no adapter has been written. A gap in US, not in them. */
  | "REQUIRES_NEW_ADAPTER"
  /** The host says do not ask. Never re-walked on a clock (RULING 148). */
  | "DISALLOWED";

export interface LegistarRoute {
  readonly id: string;
  readonly routeClass: LegistarRouteClass;
  readonly transport: LegistarTransport;
  /**
   * The URL shape, with `{}` placeholders. A TEMPLATE, never a tenant's URL —
   * a concrete Pima id in this file would be the Pima-special-case defect this
   * whole module exists to prevent.
   */
  readonly urlShape: string;
  /** The fact classes this route is CAPABLE of carrying. */
  readonly bears: readonly LegistarFactClass[];
  readonly disposition: LegistarRouteDisposition;
  /**
   * Why the disposition is what it is, in a sentence, always present. A
   * disposition with no stated reason is the thing a later session cannot
   * re-examine.
   */
  readonly note: string;
}

/**
 * **THE PORTFOLIO. What the project knows about this source class NOW.**
 *
 * Not complete, and never will be — CLAUDE.md: no route list is ever complete,
 * each represents what the project knows now. Adding a route here is how a wall
 * that fell becomes a rung for every tenant at once.
 */
export const LEGISTAR_ROUTES: readonly LegistarRoute[] = [
  {
    id: "WEBAPI_BODIES",
    routeClass: "BODY_IDENTITY",
    transport: "JSON_API",
    urlShape: "https://webapi.legistar.com/v1/{slug}/bodies",
    bears: ["BODY_IDENTITY"],
    disposition: "WALKED",
    note:
      "The tenant's own list of its bodies. `webapi.legistar.com` publishes no " +
      "robots.txt (HTTP 404 → NO_ROBOTS, docs/sources.md 2026-08-28).",
  },
  {
    id: "WEBAPI_EVENTS",
    routeClass: "MEETING_ENUMERATION",
    transport: "JSON_API",
    urlShape: "https://webapi.legistar.com/v1/{slug}/events",
    bears: ["MEETING_EXISTENCE", "MEETING_TIME_PLACE", "PUBLICATION_STATE"],
    disposition: "WALKED",
    note:
      "Returns only sittings whose InSite detail page is publicly viewable, which " +
      "is why it is NOT a complete enumeration and why INSITE_CALENDAR is a " +
      "distinct route rather than a fallback (measured on Mesa: the grid held 15 " +
      "where this route held 3, docs/sources.md 2026-08-28).",
  },
  {
    id: "WEBAPI_EVENT",
    routeClass: "PUBLICATION_STATUS",
    transport: "JSON_API",
    urlShape: "https://webapi.legistar.com/v1/{slug}/events/{eventId}",
    bears: ["PUBLICATION_STATE", "MEETING_TIME_PLACE", "MEDIA_RECORD"],
    disposition: "WALKED",
    note:
      "The authoritative source for a PUBLISHER-STATE fact: EventAgendaStatusName, " +
      "EventMinutesStatusName and the two LastPublishedUTC stamps. Verified present " +
      "on the wire in tests/fixtures/legistar/pima-event-1825.json.",
  },
  {
    id: "WEBAPI_EVENTITEMS",
    routeClass: "OUTCOME_ACTION",
    transport: "JSON_API",
    urlShape: "https://webapi.legistar.com/v1/{slug}/events/{eventId}/eventitems",
    bears: ["AGENDA_ITEM_LIST", "ACTION_TAKEN"],
    disposition: "WALKED",
    note:
      "Carries BOTH record classes on one row — what was noticed and what was done " +
      "— and `outcomes.ts` splits them. It does NOT carry ITEM_FULL_TEXT: " +
      "EventItemTitle is a caption, not the text of the measure.",
  },
  {
    id: "WEBAPI_EVENTITEM_VOTES",
    routeClass: "ROLL_CALL",
    transport: "JSON_API",
    urlShape: "https://webapi.legistar.com/v1/{slug}/eventitems/{eventItemId}/votes",
    bears: ["PERSON_VOTE"],
    disposition: "WALKED",
    note:
      "The only WALKED route in this portfolio that bears PERSON_VOTE. Measured on " +
      "Pima 2026-08-29: 2,083 per-person rows across 20 Board sittings.",
  },
  {
    id: "WEBAPI_MATTER_HISTORIES",
    routeClass: "MATTER_HISTORY",
    transport: "JSON_API",
    urlShape: "https://webapi.legistar.com/v1/{slug}/matters/{matterId}/histories",
    bears: ["MATTER_LIFECYCLE", "ACTION_TAKEN"],
    disposition: "REQUIRES_NEW_ADAPTER",
    note:
      "A matter's path across sittings, which no per-event route can see: an item " +
      "continued three times looks like three unrelated agenda rows from the event " +
      "endpoint. Not built. This is OUR gap and not a statement about the tenant.",
  },
  {
    id: "INSITE_CALENDAR",
    routeClass: "MEETING_ENUMERATION",
    transport: "HTML",
    urlShape: "https://{insiteHost}/Calendar.aspx",
    bears: ["MEETING_EXISTENCE", "MEETING_TIME_PLACE"],
    disposition: "WALKED",
    note:
      "The portal grid — `lib/sources/legistar-insite/`. Holds future sittings the " +
      "Web API returns zero of on Pima, and fewer than the API on Mesa. Neither " +
      "route dominates; the union is the answer.",
  },
  {
    id: "INSITE_MEETING_DETAIL",
    routeClass: "AGENDA_CONTENT",
    transport: "HTML",
    urlShape: "https://{insiteHost}/MeetingDetail.aspx?LEGID={eventId}&GID={gid}&G={guid}",
    bears: ["AGENDA_ITEM_LIST", "ITEM_FULL_TEXT", "SUPPORTING_DOCUMENT"],
    disposition: "REQUIRES_NEW_ADAPTER",
    note:
      "The human page for one sitting. Carries the item TEXT and the attachment " +
      "links, neither of which any JSON route in this portfolio can see. Its URL is " +
      "already held on every event as EventInSiteURL; nothing parses it yet.",
  },
  {
    id: "INSITE_ACCESSIBLE_AGENDA",
    routeClass: "ACCESSIBLE_CONTENT",
    transport: "HTML",
    urlShape: "https://{insiteHost}/View.ashx?M=A&ID={eventId}&GUID={guid}",
    bears: ["AGENDA_ITEM_LIST", "ITEM_FULL_TEXT", "SUPPORTING_DOCUMENT"],
    disposition: "REQUIRES_NEW_ADAPTER",
    note:
      "The accessible HTML rendering Legistar publishes beside the agenda PDF, on " +
      "the PORTAL host rather than the disallowed document host. It is the highest " +
      "-value unbuilt route in this portfolio: it is permitted, it is text, and it " +
      "carries what the API structurally cannot.",
  },
  {
    id: "INSITE_ACCESSIBLE_MINUTES",
    routeClass: "MINUTES",
    transport: "HTML",
    urlShape: "https://{insiteHost}/View.ashx?M=M&ID={eventId}&GUID={guid}",
    bears: ["NARRATIVE_MINUTES", "ACTION_TAKEN", "PERSON_VOTE"],
    disposition: "REQUIRES_NEW_ADAPTER",
    note:
      "The accessible minutes rendering, again on the permitted portal host rather " +
      "than the disallowed document host. The only route in this portfolio that " +
      "could bear PERSON_VOTE for a body whose clerk does not enter roll calls into " +
      "the vendor's vote table — which is 108 acted Pima items in four months.",
  },
  {
    id: "INSITE_LEGISLATION_DETAIL",
    routeClass: "MATTER_HISTORY",
    transport: "HTML",
    urlShape: "https://{insiteHost}/LegislationDetail.aspx?ID={matterId}&GUID={guid}",
    bears: ["MATTER_LIFECYCLE", "ITEM_FULL_TEXT", "SUPPORTING_DOCUMENT"],
    disposition: "REQUIRES_NEW_ADAPTER",
    note: "One matter's own page, with its full text and its history table.",
  },
  {
    id: "GRANICUS_AGENDA_PDF",
    routeClass: "DOCUMENT_PACKET",
    transport: "PDF",
    urlShape: "https://legistar.granicus.com/{slug}/meetings/{path}_Agenda.pdf",
    bears: ["AGENDA_ITEM_LIST", "ITEM_FULL_TEXT", "SUPPORTING_DOCUMENT"],
    disposition: "DISALLOWED",
    note:
      "`legistar.granicus.com` answers `User-agent: *` with `Disallow: /` — read " +
      "2026-08-29 by three clients under three user agents, so a RULE and not a " +
      "RULING 182 transport artefact. Recorded here, never fetched. It stays in the " +
      "portfolio because deleting it would convert a permission wall into an " +
      "absence of documents (RULING 184).",
  },
  {
    id: "GRANICUS_MINUTES_PDF",
    routeClass: "MINUTES",
    transport: "PDF",
    urlShape: "https://legistar.granicus.com/{slug}/meetings/{path}_Meeting_Summary.pdf",
    bears: ["NARRATIVE_MINUTES", "ACTION_TAKEN", "PERSON_VOTE"],
    disposition: "DISALLOWED",
    note:
      "Same host, same rule. `minutesPointerFor` in outcomes.ts records this as a " +
      "LEAD WITH NO RECORD CLASS precisely so a document nobody has opened can " +
      "never be offered as evidence of what a body decided.",
  },
  {
    id: "INSITE_RSS",
    routeClass: "FEED",
    transport: "XML",
    urlShape: "https://{insiteHost}/Feed.ashx?M=Calendar&ID={feedId}&{guid}",
    bears: ["MEETING_EXISTENCE"],
    disposition: "WALKED",
    note:
      "Drops location and meeting kind, so it is a change DETECTOR and never an " +
      "enumeration — which is why it bears one fact class and the grid bears two.",
  },
  {
    id: "INSITE_ICAL",
    routeClass: "FEED",
    transport: "ICS",
    urlShape: "https://{insiteHost}/View.ashx?M=IC&ID={eventId}&GUID={guid}",
    bears: ["MEETING_EXISTENCE", "MEETING_TIME_PLACE"],
    disposition: "WALKED",
    note:
      "Needs an id and GUID only the grid supplies, so it is downstream of " +
      "INSITE_CALENDAR rather than an alternative to it.",
  },
  {
    id: "INSITE_CALENDAR_ARCHIVE",
    routeClass: "ARCHIVE",
    transport: "HTML",
    urlShape: "https://{insiteHost}/Calendar.aspx?__EVENTTARGET=lstYears&lstYears={year}",
    bears: ["MEETING_EXISTENCE", "MEETING_TIME_PLACE"],
    disposition: "WALKED",
    note:
      "Prior years behind an ASP.NET postback. The grid pages at 100 rows and a " +
      "GUESSED page index returns the WRONG page with a clean HTTP 200, so page " +
      "targets are read off the pager (docs/sources.md 2026-08-28).",
  },
];

/** One route, by id. Undefined for an id this portfolio does not know. */
export function findRoute(id: string): LegistarRoute | undefined {
  return LEGISTAR_ROUTES.find((route) => route.id === id);
}

/** Every route capable of carrying this fact, whatever its disposition. */
export function routesBearing(
  factClass: LegistarFactClass,
): readonly LegistarRoute[] {
  return LEGISTAR_ROUTES.filter((route) => route.bears.includes(factClass));
}

/**
 * The fact classes a set of SUCCEEDED routes actually discharges.
 *
 * Takes route ids and not a boolean, because "the fetch worked" is not a fact
 * class and the whole failure mode this module addresses is code that treats it
 * as one.
 */
export function factsBorneBy(
  succeededRouteIds: readonly string[],
): ReadonlySet<LegistarFactClass> {
  const borne = new Set<LegistarFactClass>();
  for (const id of succeededRouteIds) {
    const route = findRoute(id);
    if (route === undefined) continue;
    for (const fact of route.bears) borne.add(fact);
  }
  return borne;
}

/**
 * **WHAT IS STILL OWED AFTER THOSE ROUTES SUCCEEDED.**
 *
 * The anti-collapse primitive. A caller that has a 200 from the Web API asks
 * this and is told, in fact classes rather than in prose, that it still has no
 * item text, no supporting documents and no narrative minutes — so the
 * Accessible Agenda is not an optional extra it may skip because the JSON
 * parsed.
 *
 * A fact borne only by DISALLOWED routes stays owed forever, and that is
 * correct: we are not permitted to read it, we do not hold it, and the honest
 * state is a permanent named gap rather than a quiet removal from the map.
 */
export function factClassesOwedAfter(
  succeededRouteIds: readonly string[],
): readonly LegistarFactClass[] {
  const borne = factsBorneBy(succeededRouteIds);
  return LEGISTAR_FACT_CLASSES.filter((fact) => !borne.has(fact));
}

/**
 * Routes worth asking next for a fact, given what has already succeeded.
 *
 * Excludes DISALLOWED routes from the SUGGESTION — we do not tell a caller to go
 * and break a permission rule — while {@link factClassesOwedAfter} keeps
 * reporting the fact as owed. That pair is the RULING 184 distinction made
 * operational: the route is closed, the fact is not answered, and neither
 * statement is allowed to stand in for the other.
 */
export function routesStillWorthAsking(
  factClass: LegistarFactClass,
  succeededRouteIds: readonly string[],
): readonly LegistarRoute[] {
  const done = new Set(succeededRouteIds);
  return routesBearing(factClass).filter(
    (route) => !done.has(route.id) && route.disposition !== "DISALLOWED",
  );
}

/**
 * A fact class this portfolio can reach TODAY through exactly one route.
 *
 * **Counted over WALKED routes only, and the choice matters.** An earlier
 * version counted every route that was not `DISALLOWED`, which credited
 * `REQUIRES_NEW_ADAPTER` routes as live paths and reported PERSON_VOTE as
 * comfortably multiply-routed on the strength of an accessible-minutes parser
 * nobody has written. That is the same error class as a permission wall reading
 * as an absence, pointed the other way: an unbuilt route is a gap in US, and a
 * gap in us cannot be counted as coverage.
 *
 * Not an error — PERSON_VOTE is genuinely single-routed today on every tenant
 * whose minutes sit behind the disallowed host — but a thing a session should be
 * able to SEE, because a singly routed fact is one vendor change away from being
 * an unexplained absence.
 */
export function singlyRoutedFacts(): readonly LegistarFactClass[] {
  return LEGISTAR_FACT_CLASSES.filter(
    (fact) =>
      routesBearing(fact).filter((route) => route.disposition === "WALKED").length === 1,
  );
}
