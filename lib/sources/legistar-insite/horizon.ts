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
export type FirstPartyRoute =
  /** `webapi.legistar.com/v1/{client}/events` — the vendor's JSON API. */
  | "LEGISTAR_WEBAPI_EVENTS"
  /** `webapi.legistar.com/v1/{client}/EventDates/{bodyId}` — dates only. */
  | "LEGISTAR_WEBAPI_EVENTDATES"
  /** `{tenant}.legistar.com/Calendar.aspx` — the portal's own grid. */
  | "INSITE_CALENDAR_GRID"
  /** `{tenant}.legistar.com/Feed.ashx?M=Calendar` — the grid's RSS. */
  | "INSITE_CALENDAR_RSS"
  /** `{tenant}.legistar.com/View.ashx?M=IC` — the per-meeting iCalendar. */
  | "INSITE_ICAL_EXPORT"
  /** `{tenant}.legistar.com/MeetingDetail.aspx` — the per-meeting page. */
  | "INSITE_MEETING_DETAIL"
  /** The body's OWN site: the Clerk of the Board's schedule table. */
  | "CLERK_SCHEDULE_PAGE"
  /** `{tenant}.granicus.com/ViewPublisher.php` — see `GRANICUS_LIVE_PROCEEDINGS_WALL`. */
  | "GRANICUS_VIEW_PUBLISHER";

/**
 * What a route's enumeration actually achieved — never inferred from a 200.
 *
 * The five states are five different facts and the product breaks if any two
 * are pooled. `PUBLISHER_STATED_EMPTY` is the only one that licenses a zero:
 * it means the page rendered its grid and said **"No records were found."**
 * `NOT_RETRIEVED` with zero rows is a wall wearing a zero, and
 * `PERMISSION_DISALLOWED` is a fact about US that says nothing whatever about
 * the record behind it.
 */
export type EnumerationState =
  | "COMPLETE_AS_OBSERVED"
  | "INCOMPLETE"
  | "PUBLISHER_STATED_EMPTY"
  | "NOT_RETRIEVED"
  | "PERMISSION_DISALLOWED";

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
 * about this application; `CANCELED_BY_PUBLISHER` is a fact about the body;
 * `ROUTE_DISALLOWED` is a fact about our permission and about nothing else.
 * `CLAUDE.md` requires a null to render as its NAMED GAP with whose gap it is,
 * and a verdict that blurred the three would make that impossible upstream.
 */
export type DispositionVerdict =
  /** It reaches the reader. The only verdict that is not a gap. */
  | "REPRESENTED_IN_READER"
  /** OURS: collected, keyed, carried — outside the window the app serves. */
  | "BEYOND_APP_SERVING_HORIZON"
  /** OURS: no venue record for the room the publisher named. */
  | "VENUE_NOT_RESOLVED"
  /** OURS: the route published no hour, so it has no canonical identity. */
  | "TIME_NOT_PUBLISHED"
  /** THEIRS: the publisher's own text calls the sitting off. */
  | "CANCELED_BY_PUBLISHER"
  /** THEIRS: the row is a different body than the one this tenant is wired for. */
  | "NOT_THE_WIRED_BODY"
  /** Ours and theirs: the same sitting on a route that carries more about it. */
  | "SUPERSEDED_BY_RICHER_ROUTE"
  /** OURS, and a permission fact: the route publishes `Disallow: /`. */
  | "ROUTE_DISALLOWED";

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
 * `claimAboutContent` is null wherever we are not entitled to a claim — most
 * importantly on `ROUTE_DISALLOWED`, where a permission refusal says nothing
 * about what is behind it (RULING 182). It is not optional and not omitted: an
 * absent field reads as an oversight, a present null reads as a decision.
 */
export interface InstanceDisposition {
  key: string;
  bodyId: string;
  date: string;
  time: string | null;
  verdict: DispositionVerdict;
  evidence: DispositionEvidence[];
  claimAboutContent: string | null;
}

/**
 * The union instances that neither reached the reader nor carry a disposition.
 *
 * **Asserted empty.** This is the whole acceptance rule expressed as a
 * function: an instance that is neither shipped nor explained is a sitting the
 * product lost quietly, which is the failure mode the September three were.
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
 * **A PERMISSION WALL, RECORDED SO IT IS NEVER RE-WALKED ON A CLOCK.**
 *
 * `pima.granicus.com/robots.txt` publishes `User-agent: * / Disallow: /` —
 * read 2026-08-28. Its "Live Proceedings" / `ViewPublisher.php` surface is
 * therefore not retrieved by this adapter or by anything else in this
 * repository, at any rung, including on the recheck cadence that transport
 * walls get.
 *
 * Pima's own site links to it — `www.pima.gov/2312/Clerk-of-the-Board` renders
 * `http://pima.granicus.com/ViewPublisher.php?view_id=3` — so we know it
 * exists, that the county treats it as a publication surface, and that it is
 * out of reach. **No claim whatever is made about what it holds**: not that it
 * duplicates the portal, not that it adds nothing, not that it is empty. A
 * disallow is a rule about US.
 *
 * It is not a dead end either. A records request, an agreement with the vendor,
 * or a feed the county publishes itself are all still open, and the fourteen
 * instances this workstream owes a reader are all obtainable from routes that
 * permit us — which is why nothing here depends on it.
 */
export const GRANICUS_LIVE_PROCEEDINGS_WALL = {
  host: "pima.granicus.com",
  rule: "User-agent: * / Disallow: /",
  readAt: "2026-08-28",
  state: "PERMISSION_DISALLOWED" as const,
  /** Where we learned the surface exists, without fetching it. */
  linkedFrom: "https://www.pima.gov/2312/Clerk-of-the-Board",
  linkedUrl: "http://pima.granicus.com/ViewPublisher.php?view_id=3",
  /** Deliberately empty of any statement about the content behind it. */
  claimAboutContent: null,
};

/** The wall as a route observation, so it appears in the per-route table as a wall. */
export function granicusWallObservation(): RouteObservation {
  return {
    route: "GRANICUS_VIEW_PUBLISHER",
    mechanism: GRANICUS_LIVE_PROCEEDINGS_WALL.linkedUrl,
    observedAt: GRANICUS_LIVE_PROCEEDINGS_WALL.readAt,
    enumeration: "PERMISSION_DISALLOWED",
    // Not zero-as-measured. Zero is what we RETRIEVED, and we retrieved nothing
    // because we are not permitted to ask. The counts are the honest report of
    // our own action; they are not a statement about the route's contents.
    rawFutureCount: 0,
    uniqueFutureCount: 0,
    earliest: null,
    latest: null,
    instances: [],
    note:
      `${GRANICUS_LIVE_PROCEEDINGS_WALL.host}/robots.txt publishes ` +
      `"${GRANICUS_LIVE_PROCEEDINGS_WALL.rule}" (read ${GRANICUS_LIVE_PROCEEDINGS_WALL.readAt}). ` +
      "NOT FETCHED AT ANY RUNG. This states our permission and makes NO claim " +
      "about what the route publishes.",
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
