/**
 * The union is the acceptance. Routes enumerating one body's future can each carry different subsets
 * (an empty API horizon beside a full portal calendar), so any rule of the form "ship what the routes
 * agree on" can ship an empty calendar while every request returns 200. The rule is the opposite:
 *
 * > An instance published by any materially distinct first-party route is owed to the reader. Absence
 * > from another route is never evidence against it.
 *
 * `intersectionOfRoutes` exists only so a test can name the forbidden semantics and prove it fails.
 *
 * Identity is `(bodyId, local date, local wall-clock time)` (`sittingKeyFromLocal` in
 * `lib/sources/event-identity.ts`), because the routes do not share an id space.
 *
 * Every union instance either reaches the reader or carries an `InstanceDisposition` naming why not and
 * quoting the publisher; `unaccounted` returns the ones that do neither, and it is asserted empty.
 */
import { sittingKeyFromLocal } from "../event-identity.ts";

/**
 * The routes this module enumerates, each a materially distinct publisher surface: two URLs are one route
 * when one is a filter over the other's dataset, and two routes when they are separately generated
 * records that can disagree.
 */
/** The routes, as a value; the type is derived from it so consumers can enumerate them at runtime. */
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
] as const;

export type FirstPartyRoute = (typeof FIRST_PARTY_ROUTES)[number];

/**
 * What a route's enumeration actually achieved, never inferred from a 200. `PUBLISHER_STATED_EMPTY` is the
 * only state that licenses a zero (the grid said "No records were found."). `NOT_RETRIEVED` with zero rows
 * is a wall.
 */
export type EnumerationState =
  | "COMPLETE_AS_OBSERVED"
  | "INCOMPLETE"
  | "PUBLISHER_STATED_EMPTY"
  | "NOT_RETRIEVED";

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
 * The forbidden semantics, written down so a test can fail it: the instances every given route carries.
 * Nothing in the product path calls this.
 */
export function intersectionOfRoutes(
  union: UnionInstance[],
  routes: FirstPartyRoute[],
): UnionInstance[] {
  if (routes.length === 0) return [];
  return union.filter((instance) => routes.every((route) => instance.routes.includes(route)));
}

/**
 * Why a union instance is not in front of a reader, or that it is. Every verdict names whose fact it is
 * (`BEYOND_APP_SERVING_HORIZON` is about this application; `CANCELED_BY_PUBLISHER` is about the body).
 */
export type DispositionVerdict =
  /** It reaches the reader. The only verdict that is not a gap. */
  | "REPRESENTED_IN_READER"
  /** OURS: collected, keyed, carried — outside the window the app serves. */
  | "BEYOND_APP_SERVING_HORIZON"
  /**
   * Ours: no reviewed venue record for the room the publisher named (or the location cell is empty). The
   * sitting itself is produced with its place as a named gap; what stays open is the venue record.
   */
  | "VENUE_NOT_RESOLVED"
  /** OURS: the route published no hour, so it has no canonical identity. */
  | "TIME_NOT_PUBLISHED"
  /** THEIRS: the publisher's own text calls the sitting off. */
  | "CANCELED_BY_PUBLISHER"
  /** THEIRS: the row is a different body than the one this tenant is wired for. */
  | "NOT_THE_WIRED_BODY"
  /**
   * Theirs and then ours: the same publisher record as one we produce under a different canonical identity
   * (e.g. the hour moved and a thinner route still carries the earlier wording). A checked precondition,
   * never a fallback: legal only when `richerRouteLink` returns a concrete link. An instance merely missing
   * from the producing route is `PUBLISHED_BUT_UNPLACED_BY_US`.
   */
  | "SUPERSEDED_BY_RICHER_ROUTE"
  /**
   * Ours, and still open: an explicit first-party route published this sitting, the producing route did not
   * carry it, and we have not placed it. An open obligation (see `openObligations`), carrying
   * `missingForPlacement`.
   */
  | "PUBLISHED_BUT_UNPLACED_BY_US";

/**
 * The routes this adapter can actually turn into a `Meeting`: the portal grid, the only route that
 * publishes a room. The RSS and the clerk's table are corroboration.
 */
export const MEETING_PRODUCING_ROUTES: readonly FirstPartyRoute[] = ["INSITE_CALENDAR_GRID"];

/**
 * The proof that something richer actually exists. The link is a shared vendor id inside one declared id
 * space (a null space never matches). The superseding record must be one this run produced, under a
 * different canonical identity; the same identity is `REPRESENTED_IN_READER`, not supersession.
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
 * A disposition is data, and the only permitted alternative to shipping an instance. `claimAboutContent`
 * is null wherever we are not entitled to a claim; present-and-null reads as a decision.
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
 * The verdicts that leave work owed. `REPRESENTED_IN_READER` is discharged. `CANCELED_BY_PUBLISHER` and
 * `NOT_THE_WIRED_BODY` are facts about the publisher. `BEYOND_APP_SERVING_HORIZON` is held, not missing.
 * `SUPERSEDED_BY_RICHER_ROUTE` means the sitting is served under the identity `supersededBy` names. The
 * rest are ours and open.
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
 * The union instances that neither reached the reader nor carry a disposition. Asserted empty. Empty here
 * is not "nothing is owed": read it together with `openObligations`.
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
