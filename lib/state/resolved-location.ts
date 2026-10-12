/**
 * One resolved location, and what every surface may say about it.
 *
 * The confirmed divisions of a resolved address stay on the device
 * (`lib/geo/session-address.ts`); everything here is a pure function over them
 * and the ZIP-area coverage answer the client already holds.
 *
 * Use the strongest evidence there is, and drop a weaker hedge once a stronger
 * answer has settled the same question. An address settles the LEVELS it
 * settles; a level the street genuinely crosses stays hedged (`splitLevels`).
 *
 * ```
 * SELF_DECLARED_ZIP  orientation. Every hedge stands.
 * ADDRESS_RESOLVED   a point. Hedges retire at the levels it settled.
 * BROWSING           looking at somewhere the reader does not live.
 * ```
 *
 * Two questions, two surfaces: HOME (who governs the reader's place) and
 * BROWSING (what is this thing I clicked). Each surface names its own subject,
 * so the two never appear to contradict. A `BROWSING` location settles
 * nothing: `standingOf` short-circuits on any certainty but
 * `ADDRESS_RESOLVED`, and every function returns a new object.
 *
 * Sharing a level key does not make two divisions exclusive; exclusivity is
 * measured in `lib/state/division-levels.ts`. `ELSEWHERE_IN_ZIP` is reserved
 * for measured-exclusive levels, `OVERLAP_NOT_RULED_OUT` carries the weaker
 * case, and an unmeasured level falls to `UNSETTLED`.
 */

import { ocdSegments } from "../ocd/tiers.ts";
import type { OcdId } from "../sources/types.ts";
import { relationshipOfLevel } from "./division-levels.ts";

/** How strongly the app knows where the reader is. */
export type LocationCertainty =
  | "SELF_DECLARED_ZIP"
  | "ADDRESS_RESOLVED"
  | "BROWSING";

export interface ResolvedLocation {
  certainty: LocationCertainty;
  /** The zip the reader typed. Orientation, never identity. */
  zip: string | null;
  /**
   * Divisions the reader's own point CONFIRMED, at the levels it settled.
   * Empty under `SELF_DECLARED_ZIP` — an empty list is "not asked", never
   * "asked and nothing governs them".
   */
  confirmedDivisionIds: readonly string[];
  /**
   * Levels the street genuinely crosses. These stay hedged: partial ambiguity
   * resolves partially, and a level we could not settle is not settled by
   * having settled a different one.
   */
  splitLevels: readonly string[];
}

/** The reader has given a zip and nothing more. */
export function zipOnly(zip: string | null): ResolvedLocation {
  return {
    certainty: "SELF_DECLARED_ZIP",
    zip,
    confirmedDivisionIds: [],
    splitLevels: [],
  };
}

/**
 * The OCD segment key that decides which LEVEL a division sits at: the deepest
 * segment, the same rule `tierForOcdId` uses. Sharing a level makes two
 * divisions comparable, not mutually exclusive (see
 * `lib/state/division-levels.ts`).
 */
export function levelKeyOf(ocdId: string): string | null {
  const segments = ocdSegments(ocdId as OcdId);
  return segments.length > 0 ? segments[segments.length - 1].key : null;
}

/** Minimal shape this module needs. The real `CoveredBody` is much wider. */
interface BodyLike {
  ocdId: string | null;
  couldGovern?: boolean;
}

export type BodyStanding =
  /** The reader's own point confirmed this division. */
  | "CONFIRMED"
  /** Still genuinely unsettled — hedge stands. */
  | "UNSETTLED"
  /**
   * The address settled this LEVEL and named a different division, so this
   * body governs somewhere else in the zip. Reserved for levels measured to
   * admit at most one division per point; the only standing that licenses a
   * claim about a government.
   */
  | "ELSEWHERE_IN_ZIP"
  /**
   * The address named a different division at a level where a point is
   * routinely inside several. Records only what WE have not established; it
   * claims nothing about the body.
   */
  | "OVERLAP_NOT_RULED_OUT";

/**
 * What may be said about one body, given the reader's resolved location. A
 * division-less body has no level to compare at and is never "elsewhere".
 */
export function standingOf(
  body: BodyLike,
  location: ResolvedLocation,
): BodyStanding {
  if (location.certainty !== "ADDRESS_RESOLVED") return "UNSETTLED";
  if (!body.ocdId) return "UNSETTLED";

  if (location.confirmedDivisionIds.includes(body.ocdId)) return "CONFIRMED";

  const level = levelKeyOf(body.ocdId);
  if (level === null) return "UNSETTLED";

  // A level the street genuinely crosses is not settled by this address.
  if (location.splitLevels.includes(level)) return "UNSETTLED";

  // Nothing was settled at this level at all, so there is nothing to compare
  // against. Silence is not a contradiction.
  const settledHere = location.confirmedDivisionIds.some(
    (id) => levelKeyOf(id) === level,
  );
  if (!settledHere) return "UNSETTLED";

  /*
   * Something else at this level was confirmed and this is not it. That
   * excludes this body only at a measured-exclusive level; at an overlapping
   * level it says nothing; at an unmeasured level the answer is `UNSETTLED`.
   */
  switch (relationshipOfLevel(level)) {
    case "MUTUALLY_EXCLUSIVE_PARTITION":
      return "ELSEWHERE_IN_ZIP";
    case "POTENTIALLY_OVERLAPPING":
      return "OVERLAP_NOT_RULED_OUT";
    case "UNKNOWN_SEMANTICS":
      return "UNSETTLED";
  }
}

/**
 * Whether a body still carries the "Could govern you" invitation; once the
 * address settled this body, asking again is the product not listening.
 */
export function keepsCouldGovernPill(
  body: BodyLike,
  location: ResolvedLocation,
): boolean {
  if (body.couldGovern !== true) return false;

  /*
   * Only `CONFIRMED` retires the pill. An unmarked row reads as "this governs
   * you", so `ELSEWHERE_IN_ZIP` and `OVERLAP_NOT_RULED_OUT` keep the hedge.
   * Written against `CONFIRMED` so a new state inherits the cautious answer.
   */
  return standingOf(body, location) !== "CONFIRMED";
}

/**
 * Applies the reader's resolved location to a list of bodies. Returns every
 * body it was given, annotated; it never drops one.
 */
export function applyResolvedLocation<T extends BodyLike>(
  bodies: readonly T[],
  location: ResolvedLocation,
): (T & { standing: BodyStanding; couldGovern?: boolean })[] {
  return bodies.map((body) => ({
    ...body,
    standing: standingOf(body, location),
    couldGovern: keepsCouldGovernPill(body, location) ? true : undefined,
  }));
}

/**
 * The one scope filter every ZIP-scoped reader surface runs:
 *
 * ```
 *   BEFORE a confirmed address   the scope is the ZIP: every governing entity
 *                                intersecting it, complete and unpartitioned
 *   AFTER  a confirmed address   the scope IS the address: only entities that
 *                                govern that address
 * ```
 *
 * An entity determined not to govern the reader is out of scope, not labelled
 * "not yours". Only `ELSEWHERE_IN_ZIP` rows are dropped; `OVERLAP_NOT_RULED_OUT`
 * rows stay, since nothing has been determined about them. Without a confirmed
 * address nothing is dropped.
 */
export function scopedToAddress<T extends BodyLike>(
  bodies: readonly T[],
  location: ResolvedLocation,
): (T & { standing: BodyStanding; couldGovern?: boolean })[] {
  return applyResolvedLocation(bodies, location).filter(
    (body) => body.standing !== "ELSEWHERE_IN_ZIP",
  );
}

/**
 * The rows the address positively excluded — never rendered; for checks and
 * counts that the rows were dropped rather than never computed.
 */
export function excludedByAddress<T extends BodyLike>(
  bodies: readonly T[],
  location: ResolvedLocation,
): (T & { standing: BodyStanding; couldGovern?: boolean })[] {
  return applyResolvedLocation(bodies, location).filter(
    (body) => body.standing === "ELSEWHERE_IN_ZIP",
  );
}

/**
 * Which question a surface is answering.
 *
 * `HOME`     — *who governs the place the reader told us about?* The subject is
 *              their zip, or the address they resolved inside it. This is the
 *              who-governs card.
 * `BROWSING` — *what is this thing I just clicked?* The subject is a division
 *              on the map, chosen by a tap, and it is not a claim about the
 *              reader at all.
 */
export type LocationQuestion = "HOME" | "BROWSING";

/**
 * A surface's whole location state: the question, the location to reason with,
 * and — for a browse surface — how the reader's home stands relative to the
 * subject on screen.
 */
export interface SurfaceSubject {
  question: LocationQuestion;
  /**
   * The location this surface may reason from. Under `BROWSING` its certainty
   * is `BROWSING`, which settles nothing, so no hedge can retire here.
   */
  location: ResolvedLocation;
  /** The division this surface is about. Null on the home surface. */
  subjectOcdId: string | null;
  /**
   * Where the reader's HOME stands relative to `subjectOcdId`, computed against
   * the home location with the strongest evidence available.
   *
   * `CONFIRMED`             — they are looking at their own district.
   * `ELSEWHERE_IN_ZIP`      — their address settled this level, the level
   *                           admits one division per point, and it named a
   *                           different one.
   *                           that can hold both. We claim nothing.
   * `UNSETTLED`             — we have not been told enough to say.
   *
   * Always `UNSETTLED` on a `HOME` surface: there is no clicked subject.
   */
  standing: BodyStanding;
}

/** The home surface — the who-governs card, the ballot, the meeting pill. The location passes through unchanged. */
export function homeSubject(home: ResolvedLocation): SurfaceSubject {
  return {
    question: "HOME",
    location: home,
    subjectOcdId: null,
    standing: "UNSETTLED",
  };
}

/**
 * The browse surface — a district popup, an entity modal, an Ask about a
 * clicked district. Standing is computed against HOME first (so it can say
 * "your address is in District 17" while showing District 19), and only then
 * is the location downgraded to `BROWSING`, which settles nothing. A reader
 * inspecting their OWN district keeps the home location. `home` is never
 * mutated.
 */
export function browsingSubject(
  home: ResolvedLocation,
  subjectOcdId: string | null,
): SurfaceSubject {
  const standing =
    subjectOcdId === null ? "UNSETTLED" : standingOf({ ocdId: subjectOcdId }, home);

  return {
    question: "BROWSING",
    // Looking at the district the address confirmed is looking at home.
    location: standing === "CONFIRMED" ? home : { ...home, certainty: "BROWSING" },
    subjectOcdId,
    standing,
  };
}
