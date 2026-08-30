import { isDivisionsOwnGovernment } from "../officials/division-government.ts";
import { COULD_GOVERN_ACTION, COULD_GOVERN_TEXT } from "../ballot/could-govern.ts";
import { governVerbMayAttach } from "../registry/body-class-labels.ts";
import type { BodyClass, DivisionType } from "../registry/types.ts";
import type { Meeting } from "../sources/types.ts";

/**
 * **Does this body govern the reader, or is it just close?** — tracker **M81**.
 *
 * ## The author's insight, which is the whole row
 *
 * *Impact is jurisdiction MEMBERSHIP, not distance.* A meeting forty miles
 * away at the county seat governs the reader; the next town's select board
 * four miles away does not. A map sorted by proximity teaches the opposite,
 * and it teaches it silently — the closest pin looks like the most relevant
 * one, and for the reader trying to find out what is happening TO THEM it
 * frequently is not.
 *
 * So every meeting card and list row says which it is, and distance becomes
 * secondary rather than the organising fact.
 *
 * ## Geometry only, and NOT a second geometry
 *
 * The badge is a set membership test against the divisions the reader's point
 * already resolved into — the SAME `divisionsAt` sweep the map's own layers
 * and the who-governs card use. **Never a second geometry source.** A badge
 * computed from a different boundary file would disagree with the map the
 * reader is looking at, and there is no way to tell which is lying.
 *
 * That is also why this module holds no polygons and no fetch. It takes the
 * answer and returns a label. `tests/jurisdiction-badge.test.ts` asserts the
 * source file contains no boundary import, because the cheapest way to break
 * this rule is to add one "just for the badge".
 *
 * ## Register
 *
 * LEVEL, on a claim surface. The badge states a geometric fact about a real
 * government and says nothing about importance — no "matters to you", no
 * "safe to ignore". A reader who wants the next town's select board is
 * entitled to it, and the badge is there so they know which one they clicked.
 *
 * ## The third state, settled first because it decides the shape
 *
 * A meeting whose body has a **null `ocdId`** — a curated division-less body,
 * D28: Pima Community College's district, which the Census enumerates no
 * boundary for — **cannot be point-tested at all**. Defaulting it into either
 * badge would be a render default manufacturing a claim: "Nearby" would assert
 * the body does not govern the reader, which we do not know, and "Governs your
 * area" would assert that it does, which we also do not know.
 *
 * So it gets its own name, and the name says WHOSE gap it is: the boundary is
 * not published, which is a fact about the Census, not about us and not about
 * the body.
 */

export type JurisdictionBadge =
  /** The reader's point is inside this body's division. */
  | "GOVERNS"
  /** This body has a division and the reader's point is not in it. */
  | "NEARBY"
  /** This body has no published boundary, so the question cannot be asked. */
  | "NO_BOUNDARY"
  /**
   * **The answer came from a ZIP, and this division covers only part of it.**
   * (`JUR-2`, 2026-08-23, the author's 8/22 walkthrough.)
   *
   * The Rockaway Township Council meeting card read *"Governs your area"* with
   * a tooltip saying *"Your address is inside the area this body governs"* —
   * to a reader who had given nothing but a zip. `CLAUDE.md`'s first
   * geographic rule is that a zip is orientation only and can never resolve a
   * ballot; a ZCTA crosses city, county, school district and legislative
   * lines. 07866 holds Rockaway Township, Rockaway Borough and Denville
   * Township, and the card was picking one and asserting it.
   *
   * It is not `NEARBY` either — that asserts the body governs a DIFFERENT
   * area, which is the same unearned certainty pointed the other way. Both
   * collapse to this while the basis is a zip and the division is partial.
   */
  | "COULD_GOVERN";

/**
 * **What the division set was resolved FROM.**
 *
 * `ADDRESS` — a street the reader gave, resolved to a point. Membership is a
 * real geometric answer about a real location.
 *
 * `ZIP` — a ZCTA centroid. One point standing in for an area that crosses
 * every kind of line there is. It answers correctly for a division that covers
 * the WHOLE zip — a county, a regional school district, a state — and cannot
 * answer at all for one that covers part of it.
 */
export type JurisdictionBasis = "ADDRESS" | "ZIP";

export interface BadgeCopy {
  /** The badge itself. Short enough to sit on a card row. */
  label: string;
  /** One sentence, for the card. Level register, geometry only. */
  detail: string;
}

export const BADGE_COPY: Readonly<Record<JurisdictionBadge, BadgeCopy>> = {
  GOVERNS: {
    label: "Governs your area",
    detail: "Your address is inside the area this body governs.",
  },
  NEARBY: {
    label: "Nearby, different jurisdiction",
    detail: "This body meets near you, but it governs a different area.",
  },
  // A named gap, in the gap's own words. It says what is missing and whose
  // gap it is, and it never reads as either of the other two.
  NO_BOUNDARY: {
    label: "Boundary not published",
    detail:
      "No official boundary is published for this body, so we can't say whether it governs your area.",
  },
  /*
   * The RULING 71 wording, verbatim from `lib/ballot/could-govern.ts`, because
   * this is the same claim about the same reader on a different surface and
   * two wordings for one fact is how they drift.
   *
   * It is an INVITATION, not a disclosure of our incompleteness. Our data is
   * complete — we hold Rockaway Township's council and Rockaway Borough's,
   * both in full. What is unsettled is which one is the reader's, and the
   * reader is the only party who can settle it.
   */
  COULD_GOVERN: {
    label: COULD_GOVERN_TEXT,
    detail: `Your zip covers more than one town here, so ${COULD_GOVERN_ACTION}.`,
  },
};

/**
 * **JUR-1 — A BODY MAY NOT BOTH GOVERN YOU AND HAVE NO BOUNDARY.**
 * (2026-08-22, the author's 8/22 walkthrough, item 12.)
 *
 * Morris County's Board of County Commissioners rendered *"Governs your area"*
 * and *"Boundary not published"* **at the same time**. Those are not two facts
 * that can both be true: if no boundary is published, the question of whether
 * it governs the reader cannot be asked, which is exactly what `NO_BOUNDARY`
 * was created to say.
 *
 * The badge above was never the problem — `badgeFor` returns exactly one value.
 * The contradiction came from a SECOND surface: the body card built a
 * `Governs: <division>` row unconditionally, from the division label, with no
 * reference to whether a boundary existed. Two code paths, one subject, and
 * nothing making them agree.
 *
 * So the claim is made in ONE place. A body with no division cannot produce a
 * `Governs` row, structurally, and there is no branch left where it could.
 *
 * `tests/jurisdiction-badge.test.ts` asserts the two are mutually exclusive.
 */
/* ========================================================================== *
 * GOV-1 — THE GOVERN VERB IS KEYED ON THE BODY, NEVER ON THE GROUND IT STANDS
 * ON. (2026-08-29. RULING 118 enforced by the path that predates it.)
 *
 * ## The defect, measured
 *
 * `jurisdictionClaim` took `{ ocdId, divisionLabel }` and returned
 * `{ kind: "GOVERNS", ... }` for **every** body that had a division with a
 * label — 1,256 of them. It never asked WHICH body it was.
 *
 * 248 of those 1,256 are not the government of the division they sit on, and
 * every one of them rendered **"Governs: <that division>"**. The Tucson Design
 * Review Board — an ADVISORY board — read *"Governs: Tucson"*. The Central
 * Arizona Water Conservation District, which spans three counties, read
 * *"Governs: Pima County"*, an area it does not govern and is not inside of.
 * **100 of the 248 are `coverageStatus: LIVE`** and reader-reachable today.
 *
 * It is DATA-4's finding on a third surface. #214 said a body may not acquire
 * MEMBERS from a shared division; DATA-4 said it may not acquire POWERS; this
 * says it may not acquire a GOVERNING RELATIONSHIP WITH THE READER, which is
 * the strongest of the three because it is a claim about the reader's own life.
 *
 * ## Two gates, and they are independent
 *
 * **Identity.** `isDivisionsOwnGovernment` — the body IS the government of that
 * division, by the id grammar the registry derives such bodies under. If it is
 * not, then `divisionLabel` is not this body's territory and no claim may be
 * built out of it, whatever kind of body it is. This is what catches CAWCD,
 * which is a real GOVERNING body that governs a real territory — just not this
 * one.
 *
 * **The verb.** `governVerbMayAttach(bodyClass)` — RULING 118. Even where the
 * division IS the body's own territory, an appointed body never carries the
 * verb, and for a sovereign tribal nation the relationship is UNSETTLED rather
 * than established (RULING 119). The labels table is the single authority on
 * which; this module asks it rather than deciding.
 *
 * **On today's registry the identity gate strictly subsumes the verb gate** —
 * all 1,008 division-derived bodies are `GOVERNING` — so the verb gate changes
 * no current row. It is kept because it is the FLOOR, and because the day the
 * registry derives a `SOVEREIGN_TRIBAL` or `EXECUTIVE_AGENCY` body from a
 * division, the verb must not attach without anyone having decided that it may.
 *
 * ## What replaces the verb, and why it is not a weaker synonym
 *
 * A synonym for *governs* is the same claim in a quieter voice. So neither
 * replacement makes a governing claim at all; each states only what is
 * actually known, and the name says whose knowledge it is.
 *
 * - **Not the division's government → `LISTED_UNDER`.** *"Listed under: Pima
 *   County"* is a fact about OUR REGISTRY — this is where we filed it — and it
 *   asserts nothing about the body's own territory, which we do not have.
 * - **Its government, but the verb may not attach → `TERRITORY`.** *"Territory:
 *   <label>"* states the area, which IS known, without the relationship, which
 *   is what RULING 118 and RULING 119 withhold. It is the labels table's own
 *   words — *"this nation's government, its territory, its meetings — without
 *   asserting a governing relationship it has not established."*
 *
 * Neither reuses `NO_BOUNDARY`'s copy, and that is deliberate. That line says
 * *"no official boundary is published"*, which is a claim about the PUBLISHER.
 * For a body nobody has yet sought a boundary for, that would be a fact about
 * us wearing a fact about them — the exact substitution `CLAUDE.md` forbids.
 * ========================================================================== */

export type JurisdictionClaim =
  | { kind: "GOVERNS"; label: string; value: string }
  | { kind: "NO_BOUNDARY"; label: string; value: string }
  /** Its own territory, stated without the relationship. RULING 118 / 119. */
  | { kind: "TERRITORY"; label: string; value: string }
  /** Where WE filed it. Never a claim about the body's own territory. */
  | { kind: "LISTED_UNDER"; label: string; value: string };

export function jurisdictionClaim(body: {
  /**
   * **REQUIRED, AND REQUIRED ON PURPOSE.** It is `CoveredBody.bodyId`.
   *
   * There is no default and it is not optional, for the reason
   * `definitionsForBody` made it mandatory on the definition path: the thing an
   * optional identity silently falls back to is the DIVISION, and that is the
   * defect. A compiler error at every call site is the cheapest way to be told.
   */
  bodyId: string;
  ocdId: string | null;
  divisionType: DivisionType | null;
  divisionLabel: string;
  bodyClass: BodyClass;
}): JurisdictionClaim {
  // No division id, no division type, or a division with no label: the same
  // situation from the reader's side — there is no published area to be inside
  // of. Naming it is the whole of JUR-1's fix; the code before it rendered
  // "Governs:" with an empty value, which reads as a finding rather than a gap.
  if (
    body.ocdId === null ||
    body.divisionType === null ||
    body.divisionLabel.trim().length === 0
  ) {
    return {
      kind: "NO_BOUNDARY",
      label: BADGE_COPY.NO_BOUNDARY.label,
      value: BADGE_COPY.NO_BOUNDARY.detail,
    };
  }

  /*
   * GATE ONE — IDENTITY. Is `divisionLabel` this body's territory at all?
   *
   * 248 bodies reach here and are not their division's government. For them the
   * label names a NEIGHBOUR's territory, so every claim built from it is false
   * — including the honest-looking ones.
   */
  if (!isDivisionsOwnGovernment(body.bodyId, body.ocdId, body.divisionType)) {
    return { kind: "LISTED_UNDER", label: "Listed under", value: body.divisionLabel };
  }

  /*
   * GATE TWO — THE VERB (RULING 118, RULING 119). The territory is this body's;
   * the RELATIONSHIP is what the labels table may withhold. Asked here rather
   * than at the call site, because a binary reinvented at a call site is how
   * `door-overlay.tsx` came to call a sovereign nation advisory.
   */
  if (!governVerbMayAttach(body.bodyClass)) {
    return { kind: "TERRITORY", label: "Territory", value: body.divisionLabel };
  }

  return { kind: "GOVERNS", label: "Governs", value: body.divisionLabel };
}

/** What we hold on who sits on a body, when we hold nobody. A fact about US. */
export const REPRESENTATION_NOTE_UNSOURCED = "We haven't sourced who sits on it.";

/**
 * The roster's absence note, gated on the SAME claim as the jurisdiction row.
 *
 * The body card said, unconditionally: *"We know this body governs here because
 * its division exists. We haven't sourced who sits on it."* The first sentence
 * is an inference from the division's existence — the banned move, in as many
 * words — and it was rendered on all 248 bodies whose division is not theirs.
 *
 * It survives for `GOVERNS` and only there, where it is not an inference but
 * the registry's own construction: such a body exists BECAUSE the division
 * does. Everywhere else the note is the second sentence alone, which claims
 * nothing beyond what we have looked for.
 *
 * It lives here so the two cannot drift — JUR-1's finding was two code paths,
 * one subject, and nothing making them agree.
 */
export function representationNoteForClaim(claim: JurisdictionClaim): string {
  if (claim.kind === "GOVERNS") {
    return `We know this body governs here because its division exists. ${REPRESENTATION_NOTE_UNSOURCED}`;
  }
  return REPRESENTATION_NOTE_UNSOURCED;
}

/**
 * The badge for one meeting, given the divisions the reader's point is in.
 *
 * `divisionsAtPoint` is the caller's already-resolved answer. An EMPTY set is
 * not the same as "no divisions here": a failed resolution also produces an
 * empty set, and the caller that could not resolve must pass `null` so every
 * meeting reads `NO_BOUNDARY` rather than every meeting reading `NEARBY`. That
 * distinction is the one this function exists to keep — an empty set treated
 * as an answer would tell a reader that nothing on their screen governs them,
 * which is a specific false claim produced by our own lookup failing.
 */
export function badgeFor(
  meeting: Pick<Meeting, "ocdId">,
  divisionsAtPoint: ReadonlySet<string> | null,
  /**
   * **`JUR-2`, 2026-08-23.** What the division set was resolved from, and
   * which divisions cover only PART of the zip.
   *
   * Both default to the pre-`JUR-2` behaviour so no call site silently
   * changes meaning, and every call site was updated in the same commit. The
   * partial set is passed IN rather than looked up, for the same reason this
   * module holds no polygons: a badge that consulted a second source could
   * disagree with the map the reader is looking at, and nothing would say
   * which was lying.
   */
  basis: JurisdictionBasis = "ADDRESS",
  partialAtZip: ReadonlySet<string> | null = null,
): JurisdictionBadge {
  if (meeting.ocdId === null) return "NO_BOUNDARY";
  if (divisionsAtPoint === null) return "NO_BOUNDARY";
  /*
   * The zip could not settle it, so nothing here asserts it did. A division
   * covering the WHOLE zip — a county, a regional district, a state — is still
   * answered normally: RULING 71 is explicit that those do not become
   * uncertain because a zip crosses a municipal line, and a pill on things it
   * obviously does not apply to is a pill readers learn to skip.
   */
  if (basis === "ZIP" && partialAtZip !== null && partialAtZip.has(meeting.ocdId)) {
    return "COULD_GOVERN";
  }

  /*
   * **JUR-2, THIRD ERA (2026-08-25) — `NEARBY` WAS THE OTHER HALF ALL ALONG.**
   *
   * The reasoning was already written, eleven lines above this one, in this
   * module's own words:
   *
   *   *It is not `NEARBY` either — that asserts the body governs a DIFFERENT
   *   area, which is the same unearned certainty pointed the other way.*
   *
   * And then it was applied to one branch. `COULD_GOVERN` replaced the
   * `GOVERNS` assertion for a partial division and the `NEARBY` beside it went
   * on asserting — *"This body meets near you, but it governs a different
   * area"* — from a ZCTA centroid. That is a hard claim about where the reader
   * is, from one point standing in for an area that crosses every kind of
   * line there is.
   *
   * **A centroid MISS cannot rule a body out.** The point is one sample of a
   * zip; a body governing the half of the zip the reader actually lives in
   * looks exactly like a body governing somewhere else. So on a ZIP basis a
   * miss is `COULD_GOVERN` too, and the reader is offered the address that
   * would settle it.
   *
   * **RULING 71 is untouched and is why `GOVERNS` survives.** A division
   * covering the WHOLE zip — a county, a regional district, a state — does not
   * become uncertain because a zip crosses a municipal line, and a pill on
   * things it obviously does not apply to is a pill readers learn to skip. A
   * HIT still answers normally.
   *
   * The guard is `partialAtZip !== null`: it fires only for a caller that
   * actually resolved the zip's partial set. A caller that passed nothing has
   * told us nothing about zip overlap, and its behaviour is unchanged.
   */
  if (basis === "ZIP" && partialAtZip !== null && !divisionsAtPoint.has(meeting.ocdId)) {
    return "COULD_GOVERN";
  }

  return divisionsAtPoint.has(meeting.ocdId) ? "GOVERNS" : "NEARBY";
}

/**
 * The census for a result set — how many of each, so a report or a walk can
 * state both numbers rather than one.
 *
 * An operation that can return nothing must be asked what it returned, and a
 * badge that silently classified everything as `NEARBY` would look exactly
 * like a place where nothing governs the reader.
 */
export function badgeCensus(
  meetings: Pick<Meeting, "ocdId">[],
  divisionsAtPoint: ReadonlySet<string> | null,
  basis: JurisdictionBasis = "ADDRESS",
  partialAtZip: ReadonlySet<string> | null = null,
): Record<JurisdictionBadge, number> {
  const census: Record<JurisdictionBadge, number> = {
    GOVERNS: 0,
    NEARBY: 0,
    NO_BOUNDARY: 0,
    COULD_GOVERN: 0,
  };
  for (const meeting of meetings) {
    census[badgeFor(meeting, divisionsAtPoint, basis, partialAtZip)] += 1;
  }
  return census;
}
