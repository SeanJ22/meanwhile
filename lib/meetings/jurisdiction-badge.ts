import { COULD_GOVERN_ACTION, COULD_GOVERN_TEXT } from "../ballot/could-govern.ts";
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
export type JurisdictionClaim =
  | { kind: "GOVERNS"; label: string; value: string }
  | { kind: "NO_BOUNDARY"; label: string; value: string };

export function jurisdictionClaim(body: {
  ocdId: string | null;
  divisionLabel: string;
}): JurisdictionClaim {
  // No division id, or a division with no label, is the same situation from the
  // reader's side: there is no published area to be inside of. Naming it is the
  // whole of the fix — the previous code rendered "Governs:" with an empty
  // value, which reads as a finding rather than as the gap it is.
  if (body.ocdId === null || body.divisionLabel.trim().length === 0) {
    return {
      kind: "NO_BOUNDARY",
      label: BADGE_COPY.NO_BOUNDARY.label,
      value: BADGE_COPY.NO_BOUNDARY.detail,
    };
  }
  return { kind: "GOVERNS", label: "Governs", value: body.divisionLabel };
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
