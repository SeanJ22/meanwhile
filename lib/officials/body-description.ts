import HOLDINGS from "../../data/states/az/reference/body-blurbs.json" with { type: "json" };

/**
 * What a governing body does: plain-language paraphrases of a cited statute or charter, each read before it was
 * written. A body with no entry gets the honest absence line, never a paraphrase of what such bodies generally do.
 */

export interface BodyBlurb {
  /** The plain-words explanation. Level register — this is a claim. */
  text: string;
  /** Where this body's powers are defined. The checkable source. */
  basis: string;
  basisUrl: string | null;
  /** The date the citation above was read. Never a plausible date. */
  readOn: string;
}

/** The division kinds a covered body can sit on. Mirrors `CoveredBody`. */
export type BodyDivisionType = string;

interface BodyBlurbRow {
  /** Two-letter state, lowercased, as it appears in an OCD-ID. */
  state: string;
  divisionType: BodyDivisionType;
  blurb: BodyBlurb;
}

/** By state and division kind; no national default, since what a county board does differs by state. */
export const BODY_BLURBS: ReadonlyArray<BodyBlurbRow> = HOLDINGS.records.BODY_BLURBS as BodyBlurbRow[];

/** Overrides for one division where the general answer would be wrong for it. */
export const DIVISION_BODY_BLURBS: ReadonlyArray<{
  divisionOcdId: string;
  blurb: BodyBlurb;
}> = HOLDINGS.records.DIVISION_BODY_BLURBS;

/** The honest absence line: one sentence about our research, never the body. */
export const NO_BODY_BLURB_LINE =
  "We haven't yet read the law that says what this body decides. What we do hold about it is below.";

/**
 * The blurb for a division's own government, or null; the division override wins. Keyed on the division, so the only
 * legitimate caller has already established the body is its division's own government (`isDivisionsOwnGovernment`).
 */
export function blurbForBody(
  ocdId: string | null,
  divisionType: BodyDivisionType,
): BodyBlurb | null {
  if (ocdId) {
    const override = DIVISION_BODY_BLURBS.find((r) => r.divisionOcdId === ocdId);
    if (override) return override.blurb;
  }
  const state = ocdId?.match(/\/state:([a-z]{2})\b/)?.[1] ?? null;
  if (!state) return null;
  return (
    BODY_BLURBS.find((r) => r.state === state && r.divisionType === divisionType)
      ?.blurb ?? null
  );
}
