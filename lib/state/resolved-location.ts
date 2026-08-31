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
 *
 * ---
 *
 * ## WGH-15 (2026-08-28) — HOME LOCATION IS NOT BROWSING LOCATION
 *
 * The third state above was **declared and never constructed.** `zipOnly` emits
 * `SELF_DECLARED_ZIP`, `use-resolved-location` emits that or `ADDRESS_RESOLVED`,
 * and the only assignment of `BROWSING` anywhere in the repository was in this
 * module's own test. The union member modelling *I am exploring elsewhere* had
 * no producer, so no surface could be in it, so no surface could say so.
 *
 * The two stores were already disjoint — selecting a district on the map does
 * not, and never did, write the reader's home. `tests/one-at-a-time.test.ts`
 * has locked that since it shipped. **Nothing needed untangling. The
 * DISTINCTION needed surfacing.**
 *
 * Because what a reader sees is two panels at once:
 *
 * ```
 * WHO GOVERNS HERE (subject: their zip)      State House District 17
 * DISTRICT                (subject: a click) State House District 19
 * ```
 *
 * Neither panel is wrong and neither says which question it is answering, so
 * the reader reads a contradiction. A reader may live in House 17 and inspect
 * House 21 all afternoon; **the panels must never appear to contradict, and
 * the only way to do that is for each to name its own subject.**
 *
 * So the surface state is explicit — {@link SurfaceSubject} — and it carries
 * two facts that are not the same fact: WHICH QUESTION this surface answers,
 * and WHERE THE READER'S HOME STANDS relative to the thing on it. The second
 * is computed against the HOME location, using the strongest evidence there is,
 * before the location is downgraded to `BROWSING` for the surface's own use.
 *
 * **A `BROWSING` location settles nothing, by construction.** `standingOf`
 * short-circuits on any certainty that is not `ADDRESS_RESOLVED`, so a browse
 * surface cannot retire a hedge, cannot claim a body governs the reader, and
 * cannot write back — the browse path is READ-ONLY over the home location and
 * every function below returns a new object.
 *
 * ---
 *
 * ## WGH-16 (2026-08-28) — A SHARED LEVEL IS NOT AN EXCLUSIVE LEVEL
 *
 * WGH-15's browse copy earns a strong sentence — *"your address is in a
 * different one — this is here because you tapped it, not because it governs
 * you"* — from `standingOf` returning `ELSEWHERE_IN_ZIP`, and that return was
 * gated on one thing: **some other division sharing this one's `levelKeyOf`
 * had been confirmed.**
 *
 * `levelKeyOf` is the deepest OCD segment. It is a string split, and it buckets
 * every division type in the product — `place`, `school_district`, `county`,
 * `sldl`, `sldu`, `cd`, `state`, and whatever a source adds next. For
 * legislative and congressional districts the inference is airtight, because a
 * point is in exactly one of them. **For two of those buckets it is not merely
 * weak, it is invalid**, and both reach the browse surface through the map:
 *
 * ```
 * place            75/113 AZ and 364/477 NJ interior points are in TWO
 * school_district  39/104 interior points are in TWO
 * ```
 *
 * A reader in an elementary school district is simultaneously in a regional
 * high school district. Confirming the first told us nothing about the second,
 * and the card said *this does not govern you* — a manufactured claim about a
 * government, produced by a bucket name rather than by evidence.
 *
 * So exclusivity became a MEASURED property with its own module,
 * `lib/state/division-levels.ts`, and `standingOf` gained a fourth state.
 * `ELSEWHERE_IN_ZIP` is now reserved for levels proven to admit at most one
 * division per point; `OVERLAP_NOT_RULED_OUT` carries the honest weaker case;
 * and a level nobody has measured falls to `UNSETTLED` by MISSING from a
 * lookup rather than by anyone remembering to handle it.
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
 * The OCD segment key that decides which LEVEL a division sits at.
 *
 * The deepest segment, the same rule `tierForOcdId` uses — `place`,
 * `school_district`, `sldl`, `county`, `cd`. Two divisions with the same key
 * answer the same question about a reader.
 *
 * **WGH-16: that is where the resemblance stops.** Sharing a level makes two
 * divisions COMPARABLE; it does not make them mutually exclusive, and this
 * function cannot tell the difference — it is a string split. Whether a
 * positive match on one is evidence AGAINST the other is a separate, measured
 * question, and it is answered in `lib/state/division-levels.ts`.
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
   *
   * **WGH-16: reserved for levels measured to admit AT MOST ONE division per
   * point** — `cd`, `sldl`, `sldu`, `county`, `state`. This is the only
   * standing that licenses a claim about a government, so it is the only one
   * with an evidence gate in front of it.
   */
  | "ELSEWHERE_IN_ZIP"
  /**
   * **WGH-16.** The address settled this level and named a different division —
   * and the level is one where a point is routinely inside SEVERAL divisions at
   * once, so that says nothing about this one.
   *
   * **The verb is OURS, and the name says so.** It records what WE have not
   * established. It makes no claim about the body on the row: not that it
   * governs the reader, not that it does not, and above all not the
   * `ELSEWHERE_IN_ZIP` sentence, which would be a manufactured claim about a
   * government whose territory nobody tested.
   *
   * A reader in an elementary school district and a regional high school
   * district is governed by both. Confirming the first may never exclude the
   * second. See `lib/state/division-levels.ts` for what was measured.
   */
  | "OVERLAP_NOT_RULED_OUT";

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

  // Nothing was settled at this level at all, so there is nothing to compare
  // against. Silence is not a contradiction.
  const settledHere = location.confirmedDivisionIds.some(
    (id) => levelKeyOf(id) === level,
  );
  if (!settledHere) return "UNSETTLED";

  /*
   * **WGH-16 — THE EVIDENCE GATE, AND WHY IT IS NOT A STYLE PREFERENCE.**
   *
   * Something else at this level was confirmed and this is not it. What that
   * licenses depends ENTIRELY on whether the level can hold two divisions over
   * one point, and `levelKeyOf` — a string split on the deepest OCD segment —
   * cannot tell:
   *
   * - at `sldl`, confirming District 17 excludes District 19 without anyone
   *   testing District 19's polygon, because a point is in exactly one;
   * - at `school_district`, confirming an elementary district excludes
   *   NOTHING. The reader is routinely inside a regional high school district
   *   at the same time, and both are real governments they really vote for.
   *
   * The old rule returned `ELSEWHERE_IN_ZIP` for both, so the second case
   * rendered *"this is here because you tapped it, not because it governs
   * you"* — a false claim about a government, manufactured out of a bucket
   * name.
   *
   * Three branches, and the third is the one that matters most. A level nobody
   * has measured is not "probably like the others" — it is unknown, and it
   * reaches `UNSETTLED`, the most neutral thing this module can say, because
   * even the overlap sentence *("these can overlap, so this one may cover you
   * too")* is a claim, and an unmeasured level has not earned that one either.
   * `relationshipOfLevel` answers by MISSING from a lookup, so a division type
   * a source introduces next month lands here by existing rather than by
   * anyone remembering to add it.
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
   *
   * **WGH-16 changes nothing here and that is the correct outcome.**
   * `OVERLAP_NOT_RULED_OUT` is also not `CONFIRMED`, so it also keeps the
   * hedge — which is exactly right for a row we have not established anything
   * about. The predicate is written against `CONFIRMED` rather than against a
   * list of the other states, so a state added to the union inherits the
   * cautious answer instead of silently falling out of the list.
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

/* ════════════════ RULING 222 (2026-08-31): SCOPE IS THE ADDRESS ══════════ */

/**
 * **THE ONE SCOPE FILTER EVERY ZIP-SCOPED READER SURFACE RUNS.** (WGH-22,
 * third recurrence, falsified on 2026-08-31.)
 *
 * ```
 *   BEFORE a confirmed address   the scope is the ZIP: every governing entity
 *                                intersecting it, complete and unpartitioned
 *   AFTER  a confirmed address   the scope IS the address: only entities that
 *                                govern that address
 * ```
 *
 * **A "not yours" label on a governing-entities surface is prohibited.** An
 * entity the system has DETERMINED does not govern the reader is out of scope,
 * not annotated. The panel that carried that label is what the owner
 * photographed three times, and each previous repair made the label better
 * instead of removing the row.
 *
 * ## Why this does not weaken RULING 26 / RULING 27
 *
 * Show-everything forbids suppressing something because something ELSE is
 * missing — collection state governing display. It guarantees COMPLETENESS
 * WITHIN THE CORRECT SCOPE, and it never licensed displaying entities we have
 * positively established do not govern this reader. The 2026-08-30 reading of
 * it produced a disclosure that kept excluded districts on the panel; the
 * owner's ruling settles that reading, and this function is where it is
 * enforced once rather than per surface.
 *
 * ## What is and is not dropped
 *
 * ONLY `ELSEWHERE_IN_ZIP` — the state `standingOf` may reach only at a level
 * measured to hold one division per point, where the address named a different
 * one. `OVERLAP_NOT_RULED_OUT` rows STAY: nothing has been determined about
 * them, and dropping a row we have not ruled out would be exactly the
 * manufactured claim this product refuses, made in the other direction.
 *
 * Without a confirmed address nothing is dropped at all, because `standingOf`
 * cannot reach `ELSEWHERE_IN_ZIP` from any certainty but `ADDRESS_RESOLVED`.
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
 * The rows the address positively excluded — never rendered, and returned so a
 * check can assert they were dropped rather than never computed.
 *
 * A surface calling this to DISPLAY the rows is the defect RULING 222 names.
 * It exists for tests, for counts a surface may need about its own filtering,
 * and so that "we found these and set them aside" stays an inspectable fact.
 */
export function excludedByAddress<T extends BodyLike>(
  bodies: readonly T[],
  location: ResolvedLocation,
): (T & { standing: BodyStanding; couldGovern?: boolean })[] {
  return applyResolvedLocation(bodies, location).filter(
    (body) => body.standing === "ELSEWHERE_IN_ZIP",
  );
}

/* ══════════════════════════ WGH-15: the two questions ════════════════════ */

/**
 * **WHICH QUESTION A SURFACE IS ANSWERING.** Two, and they are not the same.
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
   * `OVERLAP_NOT_RULED_OUT` — their address named a different one at a level
   *                           that can hold both. We claim nothing (WGH-16).
   * `UNSETTLED`             — we have not been told enough to say, and we say
   *                           that.
   *
   * On a `HOME` surface it is always `UNSETTLED`: there is no clicked subject
   * for the home to stand relative to, and manufacturing one would be this
   * module inventing a comparison nobody made.
   */
  standing: BodyStanding;
}

/**
 * The home surface — the who-governs card, the ballot, the meeting pill.
 *
 * The location passes through UNCHANGED and by identity, because the strongest
 * evidence about where the reader lives is exactly what this surface is for.
 */
export function homeSubject(home: ResolvedLocation): SurfaceSubject {
  return {
    question: "HOME",
    location: home,
    subjectOcdId: null,
    standing: "UNSETTLED",
  };
}

/**
 * **THE BROWSE SURFACE — a district popup, an entity modal, an Ask about a
 * clicked district.** The producer of `BROWSING` that never existed.
 *
 * The order of the two steps is the whole design and it is not interchangeable:
 *
 * 1. **Standing is computed against HOME first.** That is the only place the
 *    confirmed divisions mean anything, and it is what lets the browse surface
 *    say *"your address is in District 17"* while showing District 19.
 * 2. **Only then is the location downgraded.** The surface reasons from a
 *    `BROWSING` location, which settles nothing, so nothing on it can retire a
 *    hedge or assert that the subject governs the reader.
 *
 * **A reader inspecting their OWN district is not browsing elsewhere**, so the
 * home location stands unchanged in that one case — the same
 * use-the-strongest-evidence rule this module is built on, applied here rather
 * than dropped here.
 *
 * `home` is never mutated. Every return is a fresh object over it, and the
 * confirmed divisions are carried by reference into a frozen-by-convention
 * `readonly` field that nothing downstream writes.
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
