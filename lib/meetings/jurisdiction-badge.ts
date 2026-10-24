import { isDivisionsOwnGovernment } from "../officials/division-government.ts";
import { COULD_GOVERN_ACTION, COULD_GOVERN_TEXT } from "../ballot/could-govern.ts";
import { readerGovernmentName } from "../text/reader-names.ts";
import { BODY_CLASS_LABELS, bodyClassLong, governVerbMayAttach } from "../registry/body-class-labels.ts";
import type { BodyClass, DivisionType } from "../registry/types.ts";
import type { Meeting } from "../sources/types.ts";

/**
 * Whether a body governs the reader's point or only meets near it: a set-membership test against the divisions the
 * point already resolved into, never a second geometry source. A body with no published boundary cannot be tested.
 */

export type JurisdictionBadge =
  /** The reader's point is inside this body's division. */
  | "GOVERNS"
  /** This body has a division and the reader's point is not in it. */
  | "NEARBY"
  /** This body has no published boundary, so the question cannot be asked. */
  | "NO_BOUNDARY"
  /** The answer came from a ZIP and this division covers only part of it, so neither governing nor nearby is known. */
  | "COULD_GOVERN"
  /** The body holds no governing authority, so no governing claim is made about it. */
  | "NOT_GOVERNING";

/** What the division set was resolved from. A ZIP centroid answers only for divisions covering the whole ZIP. */
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
  // Same wording as `lib/ballot/could-govern.ts`: one fact, one wording on every surface.
  COULD_GOVERN: {
    label: COULD_GOVERN_TEXT,
    detail: `Your zip covers more than one town here, so ${COULD_GOVERN_ACTION}.`,
  },
  // The class-specific wording comes from `badgeCopyFor`; this is the floor for
  // a caller that has no class in hand.
  NOT_GOVERNING: {
    label: "Not a governing body",
    detail: "This body advises or administers; it does not govern your area.",
  },
};

/**
 * The copy a badge shows. `NOT_GOVERNING` is worded by the body's class, from
 * the one labels table, so an advisory board, a commission and a department
 * each say what they are rather than one generic non-answer.
 */
export function badgeCopyFor(badge: JurisdictionBadge, bodyClass?: BodyClass | null): BadgeCopy {
  if (badge === "NOT_GOVERNING" && bodyClass) {
    const label = BODY_CLASS_LABELS[bodyClass];
    return { label: bodyClassLong(bodyClass), detail: label?.why ?? BADGE_COPY.NOT_GOVERNING.detail };
  }
  return BADGE_COPY[badge];
}

/** A body with no division can never produce a `Governs` row: the claim is made in one place. */
/*
 * The govern verb is keyed on the body, never on the division it is listed under. Two independent gates: identity (is
 * the body the division's own government?) and the verb (may this body class carry it?). Not its own government:
 * `LISTED_UNDER`, a fact about our registry. Its own territory but no verb: `TERRITORY`, the area without the
 * relationship.
 */

export type JurisdictionClaim =
  | { kind: "GOVERNS"; label: string; value: string }
  | { kind: "NO_BOUNDARY"; label: string; value: string }
  /** Its own territory, stated without the relationship. */
  | { kind: "TERRITORY"; label: string; value: string }
  /** Where WE filed it. Never a claim about the body's own territory. */
  | { kind: "LISTED_UNDER"; label: string; value: string };

export function jurisdictionClaim(body: {
  /** Required: an optional identity would silently fall back to the division, which is the defect. */
  bodyId: string;
  ocdId: string | null;
  divisionType: DivisionType | null;
  divisionLabel: string;
  bodyClass: BodyClass;
}): JurisdictionClaim {
  // No published area to be inside of: a named gap, never an empty "Governs:".
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

  // Gate one, identity: a body that is not its division's government gets no claim built from the division's label.
  // The area is printed as the government it is ("<Name> County"), not as the Census's short label.
  const area = readerGovernmentName(body.divisionLabel, body.divisionType);
  if (!isDivisionsOwnGovernment(body.bodyId, body.ocdId, body.divisionType)) {
    return { kind: "LISTED_UNDER", label: "Listed under", value: area };
  }

  // Gate two, the verb: asked here, from the labels table, never reinvented at a call site.
  if (!governVerbMayAttach(body.bodyClass)) {
    return { kind: "TERRITORY", label: "Territory", value: area };
  }

  return { kind: "GOVERNS", label: "Governs", value: area };
}

/** What we hold on who sits on a body, when we hold nobody. A fact about US. */
export const REPRESENTATION_NOTE_UNSOURCED = "We haven't sourced who sits on it.";

/** The roster's absence note, gated on the same claim as the jurisdiction row so the two cannot drift. */
export function representationNoteForClaim(claim: JurisdictionClaim): string {
  if (claim.kind === "GOVERNS") {
    return `We know this body governs here because its division exists. ${REPRESENTATION_NOTE_UNSOURCED}`;
  }
  return REPRESENTATION_NOTE_UNSOURCED;
}

/**
 * The badge for one meeting. A caller that could not resolve the point passes `null`, never an empty set: an empty set
 * would read every meeting as `NEARBY`.
 */
export function badgeFor(
  meeting: Pick<Meeting, "ocdId">,
  divisionsAtPoint: ReadonlySet<string> | null,
  /** The resolution basis and the divisions covering only part of the ZIP, passed in so the badge never consults a second source. */
  basis: JurisdictionBasis = "ADDRESS",
  partialAtZip: ReadonlySet<string> | null = null,
  /** The body's class when known; a body that may not carry the govern verb never gets the badge that says it does. */
  bodyClass: BodyClass | null = null,
): JurisdictionBadge {
  const geometric = geometricBadge(meeting, divisionsAtPoint, basis, partialAtZip);
  if (
    bodyClass !== null &&
    (geometric === "GOVERNS" || geometric === "COULD_GOVERN") &&
    !governVerbMayAttach(bodyClass)
  ) {
    return "NOT_GOVERNING";
  }
  return geometric;
}

function geometricBadge(
  meeting: Pick<Meeting, "ocdId">,
  divisionsAtPoint: ReadonlySet<string> | null,
  basis: JurisdictionBasis,
  partialAtZip: ReadonlySet<string> | null,
): JurisdictionBadge {
  if (meeting.ocdId === null) return "NO_BOUNDARY";
  if (divisionsAtPoint === null) return "NO_BOUNDARY";
  // A division covering the whole ZIP is still answered normally.
  if (basis === "ZIP" && partialAtZip !== null && partialAtZip.has(meeting.ocdId)) {
    return "COULD_GOVERN";
  }

  // On a ZIP basis a centroid miss cannot rule a body out, so it is `COULD_GOVERN`, not `NEARBY`. Applies only when the
  // caller resolved the ZIP's partial set.
  if (basis === "ZIP" && partialAtZip !== null && !divisionsAtPoint.has(meeting.ocdId)) {
    return "COULD_GOVERN";
  }

  return divisionsAtPoint.has(meeting.ocdId) ? "GOVERNS" : "NEARBY";
}

/** How many of each badge, so a report states both numbers rather than one. */
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
    NOT_GOVERNING: 0,
  };
  for (const meeting of meetings) {
    census[badgeFor(meeting, divisionsAtPoint, basis, partialAtZip)] += 1;
  }
  return census;
}
