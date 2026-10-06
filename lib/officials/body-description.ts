import HOLDINGS from "../../data/states/az/reference/body-blurbs.json" with { type: "json" };

/**
 * WHAT A GOVERNING BODY DOES — the sourced half of M136's section 2.
 *
 * ## Why this is a separate library from `office-blurbs.ts`
 *
 * That one answers "what does the person holding this office do", keyed by an
 * office TITLE. This answers "what does this body do", which is a different
 * question with a different legal basis: a school board's powers come from one
 * statute whether it has five members or seven, and a county board's from
 * another, and neither is derivable from any one seat's title.
 *
 * ## The rule these entries live under
 *
 * `CLAUDE.md`: **never generate a claim about a government.** Every entry here
 * is a plain-language paraphrase of a CITED statute or charter, read before it
 * was written, with the citation and its URL on the row. A body this library
 * has no entry for gets the honest absence line — never a paraphrase of what
 * bodies of that kind "generally" do, which is exactly the shape of a
 * generated claim wearing a reasonable face.
 *
 * The register is LEVEL, because this is a claim surface: what the body can
 * and cannot decide, in words a fifteen-year-old reads once.
 *
 * ## What is here, and what is honestly not
 *
 * Arizona's three governing classes are entered, because M136's own done-test
 * names Pima County, Tucson and Tucson Unified. New Hampshire's are NOT, and
 * that is a stated gap rather than a silent one: those bodies render the
 * absence line until a session reads RSA 28, RSA 47 and RSA 189 the way this
 * one read A.R.S. 11-251 and 15-341. The absence line is identical for every
 * unsourced body, so no body is made to look smaller than another by it.
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

/**
 * By state and division kind. A body whose state or kind is missing gets
 * nothing — there is deliberately no national default, because "what a county
 * board does" is a different answer in all fifty states and a national
 * paraphrase would be wrong somewhere without ever saying so.
 */
export const BODY_BLURBS: ReadonlyArray<BodyBlurbRow> = HOLDINGS.records.BODY_BLURBS as BodyBlurbRow[];

/**
 * Overrides for one specific division, where the general answer would be
 * wrong for it. Same idea as `DIVISION_OFFICE_BLURBS` — and the same reason:
 * Tucson is a charter council-manager city, so anything saying its council
 * runs the city day to day would be false there.
 */
export const DIVISION_BODY_BLURBS: ReadonlyArray<{
  divisionOcdId: string;
  blurb: BodyBlurb;
}> = HOLDINGS.records.DIVISION_BODY_BLURBS;

/**
 * The honest absence line for section 2. One sentence, describing OUR
 * research and never the body.
 *
 * It used to cite the candidate card's `THIN_CANDIDATE_LINE` as its sibling.
 * That line is deleted (RULING 42, 2026-08-20) and this one is NOT, because
 * they are different things: a BODY is an institution, and one body is not
 * ranked against another by how much we hold on it. The reason the card line
 * had to go — a marker that lands on exactly the least-resourced PERSON in a
 * contest — has no equivalent here.
 */
export const NO_BODY_BLURB_LINE =
  "We haven't yet read the law that says what this body decides. What we do hold about it is below.";

/**
 * The blurb for a body, or null. The division override wins, because it exists
 * precisely for the case where the general answer is wrong.
 *
 * **THIS FUNCTION IS KEYED ON THE DIVISION, AND ITS NAME SAYS BODY. THAT GAP IS
 * THE DEFECT DATA-4 / NH270 WAS ABOUT, AND IT IS LEFT NAMED RATHER THAN
 * SILENT.** (2026-08-29.)
 *
 * Both lookups below take an `ocdId`. `DIVISION_BODY_BLURBS` says so in its own
 * field name, and `BODY_BLURBS` is state × division-kind. So every answer this
 * returns is a claim about *the government of that division* — and 58 bodies
 * sit on `az/place:tucson`, of which exactly one is that government. Calling
 * this for any of the other 57 hands *"This is the city's governing body — the
 * mayor and the council together"* to a design review board.
 *
 * **The only legitimate caller is one that has ALREADY established the body IS
 * its division's own government**, by `isDivisionsOwnGovernment` in
 * `body-definitions.ts` — `bodyId === ocdId + "#" + <the registry's derived
 * suffix>`. Today there is exactly one such caller, `definitionsForBody`, and
 * the call sits below that gate. A new call site that does not pass the gate is
 * a false claim about a named government, not a missing feature.
 *
 * The signature is deliberately NOT widened to take a `bodyId` and check the
 * gate itself: that would make the gate a thing two modules each half-own, and
 * the check would then run twice with no single place to read it. The gate has
 * one home. This note names it.
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
