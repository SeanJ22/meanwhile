/**
 * **ONE RESOLVED LOCATION, AND WHAT EVERY SURFACE IS ALLOWED TO SAY ABOUT IT.**
 * (WGH-12/13/14, BAL-31 — the 2026-08-28 reader-feedback sweep.)
 *
 * ## What the reader saw
 *
 * At 85641, having typed `10723 South Bear Table Tank Drive`, one card said
 * both of these things at once:
 *
 * ```
 * Set to Tucson CCD, Vail, Vail Unified District, Pima,
 *        State House District 17, State Senate District 17, AZ-6.
 * ...
 * STATE
 *   State House District 19     Gail Griffin, Lupe Diaz
 *   State Senate District 19    David Gowan
 * ```
 *
 * The prompt had the right answer and the panel underneath it did not.
 *
 * ## Why, measured rather than reasoned about
 *
 * The server is not wrong. Asked at the address's own point, `/api/meetings`
 * returns `sldl:17` and `sldu:17`; asked at the ZIP centroid it returns what
 * is true at the centroid. The ZIP-area widening adds `place:tucson`,
 * `place:corona_de_tucson` and `place:rincon_valley` to a point whose own
 * divisions are `place:tucson_ccd` and `place:vail` — which is where the
 * lingering "Tucson" came from, and it is a CCD, a statistical shape with no
 * government, not the City of Tucson.
 *
 * The defect is that the resolved address never became the app's location:
 *
 * - `writeSessionAddress` stores the confirmed divisions, and
 *   `lib/geo/session-address.ts` was READ BY NOTHING except the component that
 *   writes it;
 * - `onResolved` reaches `map-entry.tsx` as `onNarrowApplied`, which **ignores
 *   its argument entirely** and only switches district layers on;
 * - only `onPoint` moves anything, and the resolve route withholds the point
 *   whenever the street is ambiguous — precisely when the reader most needs
 *   the answer.
 *
 * So the confirmed divisions existed, were correct, were displayed by the
 * prompt, and had zero consumers.
 *
 * ## Why the repair is client-side, and that is not a shortcut
 *
 * The obvious fix is to send the confirmed divisions to the server. It is the
 * wrong fix here, and deliberately so: `lib/geo/session-address.ts` states
 * that nothing about the reader's address reaches the server or disk, and
 * `CLAUDE.md` puts a new field about a reader behind an explicit ask. Putting
 * division ids in a query string would send them to access logs.
 *
 * The client does not need to. It already holds the whole coverage answer for
 * the ZIP AREA and it already holds the confirmed divisions. Everything below
 * is a pure function over those two, so the strongest evidence is applied
 * without a byte more about the reader leaving the device.
 *
 * ## The rule
 *
 * **USE THE STRONGEST EVIDENCE THERE IS, AND DO NOT KEEP A WEAKER HEDGE ONCE
 * A STRONGER ANSWER HAS SETTLED THE SAME QUESTION.**
 *
 * That is narrower than "an address makes everything certain", which would be
 * false. An address settles the LEVELS it settles. A level the street
 * genuinely crosses stays hedged, because it is still genuinely unsettled, and
 * `splitLevels` carries exactly those.
 *
 * Three states, and they are not the same fact:
 *
 * ```
 * SELF_DECLARED_ZIP  orientation. Every hedge stands.
 * ADDRESS_RESOLVED   a point. Hedges retire at the levels it settled.
 * BROWSING           looking at somewhere the reader does not live.
 * ```
 *
 * This module never MUTATES any of them. It reads a location and a coverage
 * answer and returns what may be said — nothing here writes state, and a
 * display filter cannot reach it.
 */

import { ocdSegments } from "../ocd/tiers.ts";
import type { OcdId } from "../sources/types.ts";

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
 * The OCD segment key that decides which LEVEL a division sits at.
 *
 * The deepest segment, the same rule `tierForOcdId` uses — `place`,
 * `school_district`, `sldl`, `county`, `cd`. Two divisions with the same key
 * answer the same question about a reader, which is what makes one capable of
 * contradicting the other.
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
   * body governs somewhere else in the zip. Not a gap in what we hold: we hold
   * it in full, and it is simply not the reader's.
   */
  | "ELSEWHERE_IN_ZIP";

/**
 * What may be said about one body, given the reader's resolved location.
 *
 * A body with no division is never contradicted: a division-less body (D28 —
 * a special district, a regional council) has no level to be compared at, and
 * inferring that it is "elsewhere" from an absence would be exactly the
 * absence-asserted-as-fact this product refuses.
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

  // Settled at this level, and this is not the division that was settled.
  const settledHere = location.confirmedDivisionIds.some(
    (id) => levelKeyOf(id) === level,
  );
  return settledHere ? "ELSEWHERE_IN_ZIP" : "UNSETTLED";
}

/**
 * Whether a body still carries the "Could govern you" invitation.
 *
 * The pill asks the reader for their address. Once they have given it and it
 * settled this body, continuing to ask is the product not listening — which is
 * the friction rule, and it is also simply a weaker claim standing in front of
 * a stronger one.
 */
export function keepsCouldGovernPill(
  body: BodyLike,
  location: ResolvedLocation,
): boolean {
  if (body.couldGovern !== true) return false;

  /*
   * ONLY `CONFIRMED` RETIRES THE PILL, AND THE REASON IS A REGRESSION THIS
   * NEARLY SHIPPED.
   *
   * The tempting rule is "the address settled it, so drop the mark" — which
   * would drop it from `ELSEWHERE_IN_ZIP` too. But an unmarked row on this
   * card reads as *this governs you*, so clearing the mark from the City of
   * Tucson would upgrade a body the reader's own address EXCLUDES from a
   * hedged claim to a confident wrong one. A weaker hedge is worth keeping
   * until there is stronger COPY to replace it with, not just stronger
   * evidence.
   *
   * So `ELSEWHERE_IN_ZIP` keeps the invitation for now and is carried as an
   * open copy decision: what that row should say is "this one is not yours",
   * which is a different sentence from "could govern you", and inventing it
   * here would be this module writing reader copy.
   */
  return standingOf(body, location) !== "CONFIRMED";
}

/**
 * Apply the reader's resolved location to a list of bodies.
 *
 * Returns every body it was given, annotated. **It never drops one.**
 * `CLAUDE.md` is explicit that collection state never governs display, and a
 * body that governs elsewhere in the zip is still a body we hold in full — the
 * surface decides how to present it, and the reader can always ask for the
 * whole area again.
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
