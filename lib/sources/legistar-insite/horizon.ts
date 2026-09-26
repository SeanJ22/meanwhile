/**
 * **THE UNION IS THE ACCEPTANCE.** (2026-08-28, the correction to MTG-13.)
 *
 * ## The wrong answer this file exists to make impossible
 *
 * A prior reading of Pima County's future settled on **three** September
 * sittings, because three is what the routes it happened to ask AGREED on. The
 * three are real, they ship, and they are the regression floor at the bottom of
 * this file's tests. They were never the answer.
 *
 * Measured live on 2026-08-28, over the same body, the same day, one hour:
 *
 * | route | explicit FUTURE Board sittings |
 * | --- | --- |
 * | `webapi.legistar.com/v1/pima/events` | **0** (latest row 2026-08-25) |
 * | `webapi.legistar.com/v1/pima/EventDates/138?FutureDatesOnly=true` | **0** |
 * | `pima.legistar.com/Calendar.aspx` — "Next Month" | 3 |
 * | `pima.legistar.com/Calendar.aspx` — "This Year" | **14** |
 * | `pima.legistar.com/Feed.ashx` (This Year RSS) | **14** |
 * | `www.pima.gov/2559/…Meeting-Schedule` (the Clerk's own table) | **14** |
 *
 * **The intersection of those six routes is ZERO SITTINGS.** The intersection
 * of the two that anyone had wired is zero as well. Any rule of the form "ship
 * what the routes agree on" ships an empty calendar for a county that has
 * fourteen published meetings, and it does it while every request returns 200.
 *
 * So the rule here is the opposite one, and it is not a preference:
 *
 * > **An instance published by ANY materially distinct first-party route is
 * > owed to the reader. Absence from another route is never evidence against
 * > it.** A route that does not carry a sitting has told us about ITSELF.
 *
 * `intersectionOfRoutes` at the bottom of this file exists solely so a test can
 * name the forbidden semantics and prove it fails. Nothing in the product path
 * calls it.
 *
 * ## Identity, and why it cannot be the vendor's number
 *
 * The routes do not share an id space. The WebAPI calls the 25 August sitting
 * `1825`; the portal grid calls it `1381574`; the Clerk's table numbers nothing
 * at all. Keying on a vendor id publishes one meeting three times.
 *
 * Identity is therefore `(bodyId, local date, local wall-clock time)` —
 * `sittingKeyFromLocal` in `lib/sources/event-identity.ts`, the same key the
 * meeting layer uses, so a union instance and a produced `Meeting` are
 * comparable without a second notion of sameness.
 *
 * ## Every instance is accounted for, as DATA
 *
 * A union instance either reaches the reader or carries an
 * `InstanceDisposition` naming why not and quoting the publisher. `unaccounted`
 * returns the ones that do neither, and it is asserted empty. A comment
 * explaining a gap is not a disposition: nothing reads a comment.
 */
import { sittingKeyFromLocal } from "../event-identity.ts";

/**
 * The routes this workstream enumerated, each a materially distinct publisher
 * surface rather than a different query against one.
 *
 * "Materially distinct" is the test: two URLs are one route when one is a
 * filter over the other's dataset, and two routes when they are separately
 * generated records that can disagree. `Calendar.aspx` under "This Month" and
 * under "This Year" is ONE route asked twice. `Calendar.aspx` and the Clerk's
 * own table on `www.pima.gov` are two publishers.
 */
/**
 * The routes, as a VALUE.
 *
 * This was a bare type union until the control plane needed to compute an
 * inherited route floor from it. A union that exists only in the type system
 * cannot be enumerated at runtime, so every consumer wanting "all of them" had
 * to retype the list — and a retyped floor is exactly the forgot-the-API defect
 * wearing a different hat. The array is now the declaration and the type is
 * derived from it, so the two cannot drift apart.
 */
export const FIRST_PARTY_ROUTES = [
  /** `webapi.legistar.com/v1/{client}/events` — the vendor's JSON API. */
  "LEGISTAR_WEBAPI_EVENTS",
  /** `webapi.legistar.com/v1/{client}/EventDates/{bodyId}` — dates only. */
  "LEGISTAR_WEBAPI_EVENTDATES",
  /** `{tenant}.legistar.com/Calendar.aspx` — the portal's own grid. */
  "INSITE_CALENDAR_GRID",
  /** `{tenant}.legistar.com/Feed.ashx?M=Calendar` — the grid's RSS. */
  "INSITE_CALENDAR_RSS",
  /** `{tenant}.legistar.com/View.ashx?M=IC` — the per-meeting iCalendar. */
  "INSITE_ICAL_EXPORT",
  /** `{tenant}.legistar.com/MeetingDetail.aspx` — the per-meeting page. */
  "INSITE_MEETING_DETAIL",
  /** The body's OWN site: the Clerk of the Board's schedule table. */
  "CLERK_SCHEDULE_PAGE",
  /** `{tenant}.granicus.com/ViewPublisher.php` — see `GRANICUS_LIVE_PROCEEDINGS_ROUTE`. */
  "GRANICUS_VIEW_PUBLISHER",
] as const;

export type FirstPartyRoute = (typeof FIRST_PARTY_ROUTES)[number];

/**
 * What a route's enumeration actually achieved — never inferred from a 200.
 *
 * The five states are five different facts and the product breaks if any two
 * are pooled. `PUBLISHER_STATED_EMPTY` is the only one that licenses a zero:
 * it means the page rendered its grid and said **"No records were found."**
 * `NOT_RETRIEVED` with zero rows is a wall wearing a zero, and `NOT_BUILT` —
 * no adapter reads the route yet, so nothing was asked — is a fact about US
 * that says nothing whatever about the record behind it.
 *
 * `NOT_BUILT` replaced `PERMISSION_DISALLOWED` on 2026-09-25: robots.txt is
 * recorded and blocks nothing since the owner decision of that day, so a
 * route nobody reads is unbuilt, not forbidden. Route observations are never
 * stored (they are dropped at the composite boundary), so no record carries
 * the old member.
 */
export type EnumerationState =
  | "COMPLETE_AS_OBSERVED"
  | "INCOMPLETE"
  | "PUBLISHER_STATED_EMPTY"
  | "NOT_RETRIEVED"
  | "NOT_BUILT";

/** One future sitting, as ONE route published it. */
export interface RouteInstance {
  route: FirstPartyRoute;
  /** The exact URL or mechanism the row was read from. */
  sourceUrl: string;
  /** UTC, minted at the read. */
  observedAt: string;
  /** The registry body id — identity's first component. */
  bodyId: string;
  /** `YYYY-MM-DD`, the body's own calendar date. */
  date: string;
  /**
   * `HH:MM` 24-hour local, or null when THIS route published no hour.
   *
   * Null is a real observation and is kept: a route that names a meeting
   * without a time has told us the meeting exists. It cannot join the keyed
   * union — identity needs a time — so it is carried as a `timeless` record and
   * dispositioned, never silently dropped.
   */
  time: string | null;
  /** "Study Session", "Special Meeting" — as printed, or null. */
  kind: string | null;
  /** The room or the placeless string, as printed, or null. */
  location: string | null;
  /** This route's own number for the sitting. NOT comparable across routes. */
  vendorId: string | null;
  /** Which id space `vendorId` lives in, so nobody joins two that cannot join. */
  vendorIdSpace: string | null;
  /** The publisher's own words for this row — the evidence, verbatim. */
  publishedText: string | null;
}

/** One route's whole answer about a body's future, and how complete it was. */
export interface RouteObservation {
  route: FirstPartyRoute;
  /** The URL, query or postback that produced it — stated, never implied. */
  mechanism: string;
  /** UTC, minted at the read. */
  observedAt: string;
  enumeration: EnumerationState;
  /** Rows this route published for the future, before deduplication. */
  rawFutureCount: number;
  /** Distinct `(body, date, time)` identities among them. */
  uniqueFutureCount: number;
  /** `YYYY-MM-DD` of the first and last future instance, or null when none. */
  earliest: string | null;
  latest: string | null;
  instances: RouteInstance[];
  /**
   * Why the enumeration is in the state it is in, in plain words. Mandatory
   * for every state but `COMPLETE_AS_OBSERVED`, because a state that cannot
   * explain itself is an assertion.
   */
  note: string | null;
}

/** One sitting, as every route that published it saw it. */
export interface UnionInstance {
  /** `sittingKeyFromLocal` — body, local date, local wall clock. */
  key: string;
  bodyId: string;
  date: string;
  time: string;
  /** Distinct routes carrying it, in the order the observations were given. */
  routes: FirstPartyRoute[];
  /**
   * The route that is its ONLY publisher, or null when more than one carries
   * it. **This is the field the acceptance rule is about**: an instance with a
   * non-null `onlyOn` still reaches the reader.
   */
  onlyOn: FirstPartyRoute | null;
  /** Every route's own record of it, so a disagreement is inspectable. */
  observations: RouteInstance[];
  /** The most specific kind any route published, or null when none did. */
  kind: string | null;
  /** The most specific location any route published, or null when none did. */
  location: string | null;
}

/**
 * The union of every route's future enumeration, keyed on canonical identity.
 *
 * Order is the first route that published each instance, then date and time, so
 * a report reads chronologically and a diff between two runs is stable.
 *
 * Instances whose route published no time cannot be keyed and are returned
 * separately by `timelessInstances` rather than folded in on a guess.
 */
export function unionFutureInstances(observations: RouteObservation[]): UnionInstance[] {
  const byKey = new Map<string, UnionInstance>();

  for (const observation of observations) {
    for (const instance of observation.instances) {
      if (!instance.time) continue;
      const key = sittingKeyFromLocal({
        bodyId: instance.bodyId,
        date: instance.date,
        time: instance.time,
      });
      if (!key) continue;

      const existing = byKey.get(key);
      if (existing) {
        if (!existing.routes.includes(instance.route)) existing.routes.push(instance.route);
        existing.observations.push(instance);
        existing.kind ??= instance.kind;
        existing.location ??= instance.location;
        continue;
      }
      byKey.set(key, {
        key,
        bodyId: instance.bodyId,
        date: instance.date,
        time: instance.time,
        routes: [instance.route],
        onlyOn: null,
        observations: [instance],
        kind: instance.kind,
        location: instance.location,
      });
    }
  }

  const union = [...byKey.values()];
  for (const instance of union) {
    instance.onlyOn = instance.routes.length === 1 ? instance.routes[0] : null;
  }
  return union.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

/**
 * Route records that named a meeting and published no hour.
 *
 * They are held apart from the union because identity needs a time and this
 * code will not invent one. They are still OWED a disposition — "the Clerk
 * published a 6 January sitting and did not publish its hour" is a fact about
 * the record, and losing it silently is the failure this whole file is against.
 */
export function timelessInstances(observations: RouteObservation[]): RouteInstance[] {
  return observations.flatMap((o) => o.instances.filter((i) => !i.time));
}

/**
 * **THE FORBIDDEN SEMANTICS, WRITTEN DOWN SO A TEST CAN FAIL IT.**
 *
 * The instances every one of the given routes carries. On Pima's live routes
 * this returns **zero** for a county publishing fourteen meetings, because the
 * WebAPI's future horizon is empty while the portal's runs to December.
 *
 * Nothing in the product path calls this. It is here because a rule that is
 * only ever stated in prose is a rule that comes back: the alternative to
 * naming the wrong answer in code is a later session re-deriving it, and this
 * one already did.
 */
export function intersectionOfRoutes(
  union: UnionInstance[],
  routes: FirstPartyRoute[],
): UnionInstance[] {
  if (routes.length === 0) return [];
  return union.filter((instance) => routes.every((route) => instance.routes.includes(route)));
}

/**
 * Why a union instance is not in front of a reader — or that it is.
 *
 * Every verdict names WHOSE fact it is. `BEYOND_APP_SERVING_HORIZON` is a fact
 * about this application; `CANCELED_BY_PUBLISHER` is a fact about the body.
 * `CLAUDE.md` requires a null to render as its NAMED GAP with whose gap it is,
 * and a verdict that blurred the two would make that impossible upstream.
 *
 * A `ROUTE_DISALLOWED` verdict (robots.txt reads `Disallow: /`) existed until
 * 2026-09-25 and was never given to any instance. Since the owner decision of
 * that day robots.txt blocks nothing, so it is gone.
 */
export type DispositionVerdict =
  /** It reaches the reader. The only verdict that is not a gap. */
  | "REPRESENTED_IN_READER"
  /** OURS: collected, keyed, carried — outside the window the app serves. */
  | "BEYOND_APP_SERVING_HORIZON"
  /**
   * OURS: no reviewed venue record for the room the publisher named (or for a
   * sitting whose location cell is empty). The sitting itself IS produced, with
   * its place as a named gap (the venue-gap class, 2026-09-23); what stays open
   * is the venue record that would put it on the map.
   */
  | "VENUE_NOT_RESOLVED"
  /** OURS: the route published no hour, so it has no canonical identity. */
  | "TIME_NOT_PUBLISHED"
  /** THEIRS: the publisher's own text calls the sitting off. */
  | "CANCELED_BY_PUBLISHER"
  /** THEIRS: the row is a different body than the one this tenant is wired for. */
  | "NOT_THE_WIRED_BODY"
  /**
   * Theirs and then ours: this record is the SAME PUBLISHER RECORD as one we
   * produce under a different canonical identity — the county moved the hour
   * and a thinner route still carries the earlier wording.
   *
   * **IT IS A CHECKED PRECONDITION AND NEVER A FALLBACK** (audit finding E,
   * 2026-08-28). It is legal only when `richerRouteLink` below returns a
   * concrete link: a produced canonical meeting, reached through an id the two
   * routes provably share, in a declared id space. An instance that is simply
   * missing from the meeting-producing route was NOT superseded by anything,
   * and calling it superseded is the inversion this member exists to make
   * impossible — see `PUBLISHED_BUT_UNPLACED_BY_US`.
   */
  | "SUPERSEDED_BY_RICHER_ROUTE"
  /**
   * **OURS, AND STILL OPEN.** An explicit first-party route published this
   * sitting, the meeting-producing route did not carry it, and we have not
   * placed it.
   *
   * This is the honest name for what used to be reported as
   * `SUPERSEDED_BY_RICHER_ROUTE` by fallback. Nothing richer exists: the
   * sitting is published, and the gap is entirely in what THIS PROJECT has
   * acquired. It is an OPEN OBLIGATION — see `openObligations` — and the
   * disposition carries `missingForPlacement`, naming the exact fields that
   * would let it be placed.
   */
  | "PUBLISHED_BUT_UNPLACED_BY_US";

/**
 * **THE ROUTES THIS ADAPTER CAN ACTUALLY TURN INTO A `Meeting`.**
 *
 * One, today: the portal grid is the only route that publishes a room. (A grid
 * row whose room has no reviewed venue is still produced, with its place as a
 * named gap — the venue-gap class, 2026-09-23.) The RSS publishes a title and a
 * publication instant; the Clerk's table
 * publishes a date, an hour and a kind. Both are CORROBORATION — promoting
 * either to an ingestion source is an ask-before under `CLAUDE.md`, and this
 * constant is the single place that fact is checkable rather than commented.
 *
 * It is a list because it will grow, and it is exported because the disposition
 * logic must be able to say "the producing route did not carry it" without
 * hard-coding which route that is.
 */
export const MEETING_PRODUCING_ROUTES: readonly FirstPartyRoute[] = ["INSITE_CALENDAR_GRID"];

/**
 * **THE PROOF THAT SOMETHING RICHER ACTUALLY EXISTS.**
 *
 * Supersession is a claim about TWO records, and it is only true when the
 * second one is real, is richer, and is provably the same record. This returns
 * that proof or null, and `null` means the caller may not use the word.
 *
 * The link this can establish is a SHARED VENDOR ID inside ONE DECLARED ID
 * SPACE — the only cross-route link in this adapter that is a fact rather than
 * a resemblance. The routes do not share id spaces (the WebAPI calls Pima's 25
 * August sitting `1825` and the portal calls it `1381574`), so the space is
 * compared as well as the number and a null space never matches: the Clerk's
 * table numbers nothing, and a synthesized id would look joinable and is not.
 *
 * The superseding record must be one this run PRODUCED, and it must sit under a
 * DIFFERENT canonical identity — same identity would mean the instance itself
 * is in front of a reader, which is `REPRESENTED_IN_READER` and not
 * supersession.
 */
export interface RicherRouteLink {
  /** The route whose record we produced — richer because it places the sitting. */
  route: FirstPartyRoute;
  /** The canonical sitting identity that stands in this record's place. */
  supersedingKey: string;
  /** Its local date and wall clock, so a reader of the disposition sees the move. */
  supersedingDate: string;
  supersedingTime: string;
  /** HOW the two records are known to be one. Stated, never assumed. */
  via: "SHARED_VENDOR_ID";
  vendorId: string;
  /** Which id space the number lives in, so nobody joins two that cannot join. */
  vendorIdSpace: string;
  /** The route whose thinner record this disposition is about. */
  thinRoute: FirstPartyRoute;
  /** That route's own words, kept so the disagreement stays inspectable. */
  quotedText: string | null;
}

/** One produced sitting, indexed by the vendor id the producing route gave it. */
export interface ProducedVendorRecord {
  key: string;
  date: string;
  time: string;
  route: FirstPartyRoute;
}

/**
 * The link, or null. `producedByVendorId` is keyed `"<space>:<id>"` and holds
 * ONLY sittings this run actually produced a `Meeting` for.
 */
export function richerRouteLink(
  instance: UnionInstance,
  producedByVendorId: ReadonlyMap<string, ProducedVendorRecord>,
): RicherRouteLink | null {
  for (const observation of instance.observations) {
    if (!observation.vendorId || !observation.vendorIdSpace) continue;
    const produced = producedByVendorId.get(`${observation.vendorIdSpace}:${observation.vendorId}`);
    if (!produced) continue;
    // Same identity is not supersession — it is the instance itself, served.
    if (produced.key === instance.key) continue;
    // Richer is a property of the ROUTE, checked rather than assumed: only a
    // meeting-producing route carries the room and the agenda link that make
    // one record richer than another.
    if (!MEETING_PRODUCING_ROUTES.includes(produced.route)) continue;
    return {
      route: produced.route,
      supersedingKey: produced.key,
      supersedingDate: produced.date,
      supersedingTime: produced.time,
      via: "SHARED_VENDOR_ID",
      vendorId: observation.vendorId,
      vendorIdSpace: observation.vendorIdSpace,
      thinRoute: observation.route,
      quotedText: observation.publishedText,
    };
  }
  return null;
}

/** One quotable thing a publisher actually said. */
export interface DispositionEvidence {
  route: FirstPartyRoute;
  sourceUrl: string;
  observedAt: string;
  /** The publisher's own words, or our own measurement stated as ours. */
  quotedText: string;
}

/**
 * A disposition is DATA, and it is the only permitted alternative to shipping
 * an instance.
 *
 * `claimAboutContent` is null wherever we are not entitled to a claim — a
 * route nobody read says nothing about what is behind it (RULING 182). It is
 * not optional and not omitted: an absent field reads as an oversight, a
 * present null reads as a decision.
 */
export interface InstanceDisposition {
  key: string;
  bodyId: string;
  date: string;
  time: string | null;
  verdict: DispositionVerdict;
  evidence: DispositionEvidence[];
  claimAboutContent: string | null;
  /**
   * The proof behind `SUPERSEDED_BY_RICHER_ROUTE`, present exactly when that
   * verdict is given and absent everywhere else.
   *
   * It is a field rather than a sentence because the word "superseded" is a
   * claim about another record, and a claim about a record nobody can look up
   * is indistinguishable from a guess. `richerRouteLink` mints it; nothing
   * else may.
   */
  supersededBy?: RicherRouteLink;
  /**
   * **WHAT WOULD LET US PLACE IT** — present exactly on
   * `PUBLISHED_BUT_UNPLACED_BY_US`, and never empty when present.
   *
   * The named gap, in field terms: what a route would have to publish, or what
   * this project would have to acquire, before the sitting could reach a
   * reader. It is the difference between an obligation somebody can discharge
   * and a shrug.
   */
  missingForPlacement?: string[];
}

/**
 * **THE VERDICTS THAT LEAVE WORK OWED.**
 *
 * A disposition is not a closure. `unaccounted` below asks whether an instance
 * was EXPLAINED; this asks whether the explanation still owes a reader
 * something, which is a different question and the one that keeps a hunt
 * running.
 *
 * `REPRESENTED_IN_READER` is discharged. `CANCELED_BY_PUBLISHER` and
 * `NOT_THE_WIRED_BODY` are facts about the publisher and nothing is owed.
 * `BEYOND_APP_SERVING_HORIZON` is collected and keyed — held, not missing.
 * `SUPERSEDED_BY_RICHER_ROUTE` means the sitting IS served, under the
 * identity `supersededBy` names.
 *
 * The rest are ours and are open.
 */
export const OPEN_OBLIGATION_VERDICTS: readonly DispositionVerdict[] = [
  "PUBLISHED_BUT_UNPLACED_BY_US",
  "VENUE_NOT_RESOLVED",
  "TIME_NOT_PUBLISHED",
];

/**
 * The dispositions that are accounted for and NOT discharged — the sittings a
 * publisher has published and this project has not placed.
 *
 * This is the answer to "what does this tenant still owe a reader?", and it is
 * deliberately separate from `unaccounted`: an instance can be perfectly
 * explained and still be missing from the product, and a project that reads
 * "explained" as "done" stops hunting exactly where the hunting was owed.
 */
export function openObligations(dispositions: InstanceDisposition[]): InstanceDisposition[] {
  return dispositions.filter((d) => OPEN_OBLIGATION_VERDICTS.includes(d.verdict));
}

/**
 * The union instances that neither reached the reader nor carry a disposition.
 *
 * **Asserted empty.** This is the whole acceptance rule expressed as a
 * function: an instance that is neither shipped nor explained is a sitting the
 * product lost quietly, which is the failure mode the September three were.
 *
 * **EMPTY HERE IS NOT "NOTHING IS OWED."** This function is satisfied by ANY
 * disposition, which is exactly how a fallback verdict once turned an unserved
 * sitting into an accounted one. What remains owed is `openObligations` above,
 * and the two are read together or not at all.
 */
export function unaccounted(
  union: UnionInstance[],
  producedKeys: ReadonlySet<string>,
  dispositions: InstanceDisposition[],
): UnionInstance[] {
  const explained = new Set(dispositions.map((d) => d.key));
  return union.filter(
    (instance) => !producedKeys.has(instance.key) && !explained.has(instance.key),
  );
}

/**
 * **A ROUTE NOBODY HAS BUILT YET, WITH ITS ROBOTS.TXT READING KEPT AS EVIDENCE.**
 *
 * `pima.granicus.com/robots.txt` publishes `User-agent: * / Disallow: /` —
 * read 2026-08-28 and again 2026-09-25. Until 2026-09-25 that reading walled
 * the "Live Proceedings" / `ViewPublisher.php` surface off from every rung,
 * and no adapter for it was ever written. Since the owner decision of
 * 2026-09-25 ("Robots.txt alone must not block acquisition") the reading is
 * recorded and blocks nothing, so the true state is ours: the route is not
 * built, and each run's observation of it retrieves nothing.
 *
 * Pima's own site links to it — `www.pima.gov/2312/Clerk-of-the-Board` renders
 * `http://pima.granicus.com/ViewPublisher.php?view_id=3` — so we know it
 * exists and that the county treats it as a publication surface. A research
 * read on 2026-09-25 (through the robots-first research fetch) answered HTTP
 * 200 text/html after a 308 to https, listing upcoming Board of Supervisors
 * sittings, and the page links an RSS feed (`ViewPublisherRSS.php`). That read
 * is why the route is worth building; it is not this adapter's observation,
 * so the run's observation still makes **no claim about what the route
 * holds**: not that it duplicates the portal, not that it adds nothing, not
 * that it is empty.
 *
 * The fourteen instances this workstream owes a reader are all obtainable from
 * routes this adapter already reads, which is why nothing here depends on it.
 */
export const GRANICUS_LIVE_PROCEEDINGS_ROUTE = {
  host: "pima.granicus.com",
  /** The host's robots.txt, as read: recorded evidence, not a block. */
  rule: "User-agent: * / Disallow: /",
  readAt: "2026-08-28",
  /** Since the owner decision of 2026-09-25 robots.txt blocks no public page. */
  robotsBlocks: false as const,
  /** OURS: no adapter reads this route yet. */
  state: "NOT_BUILT" as const,
  /** Where we learned the surface exists. */
  linkedFrom: "https://www.pima.gov/2312/Clerk-of-the-Board",
  linkedUrl: "http://pima.granicus.com/ViewPublisher.php?view_id=3",
  /** Deliberately empty of any statement about the content behind it. */
  claimAboutContent: null,
};

/** The unbuilt route as a route observation, so it appears in the per-route table as ours to build. */
export function granicusRouteObservation(): RouteObservation {
  return {
    route: "GRANICUS_VIEW_PUBLISHER",
    mechanism: GRANICUS_LIVE_PROCEEDINGS_ROUTE.linkedUrl,
    observedAt: GRANICUS_LIVE_PROCEEDINGS_ROUTE.readAt,
    enumeration: "NOT_BUILT",
    // Not zero-as-measured. Zero is what we RETRIEVED, and we retrieved nothing
    // because no adapter reads this route. The counts are the honest report of
    // our own action; they are not a statement about the route's contents.
    rawFutureCount: 0,
    uniqueFutureCount: 0,
    earliest: null,
    latest: null,
    instances: [],
    note:
      "NOT BUILT: no adapter reads this route yet, so nothing was retrieved and the zero " +
      `is ours. ${GRANICUS_LIVE_PROCEEDINGS_ROUTE.host}/robots.txt publishes ` +
      `"${GRANICUS_LIVE_PROCEEDINGS_ROUTE.rule}" (read ${GRANICUS_LIVE_PROCEEDINGS_ROUTE.readAt}): ` +
      "recorded, and not blocking since the owner decision of 2026-09-25. NO claim is " +
      "made about what the route publishes.",
  };
}

/** Build a route observation from its instances, computing what can be computed. */
export function summarizeRoute(
  route: FirstPartyRoute,
  mechanism: string,
  observedAt: string,
  instances: RouteInstance[],
  enumeration: EnumerationState,
  note: string | null = null,
): RouteObservation {
  const keys = new Set(
    instances
      .filter((i) => i.time)
      .map((i) => sittingKeyFromLocal({ bodyId: i.bodyId, date: i.date, time: i.time! })),
  );
  const dates = instances.map((i) => i.date).sort();
  return {
    route,
    mechanism,
    observedAt,
    enumeration,
    rawFutureCount: instances.length,
    uniqueFutureCount: keys.size,
    earliest: dates[0] ?? null,
    latest: dates[dates.length - 1] ?? null,
    instances,
    note,
  };
}
