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
export type BodyDivisionType =
  | "county"
  | "place"
  | "school_district"
  | "cd"
  | "sldu"
  | "sldl";

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
export const BODY_BLURBS: ReadonlyArray<BodyBlurbRow> = [
  {
    state: "az",
    divisionType: "county",
    blurb: {
      text:
        "This is the county's governing board. It sets the county budget and property tax rate, runs county roads, the jail, the county hospital and health programs, and decides what can be built in the areas outside any city or town. It supervises how the county's other elected officers handle public money. It cannot change state law, and it has no say over what happens inside a city's own limits.",
      basis: "Arizona Revised Statutes § 11-251 (Powers of board)",
      basisUrl: "https://www.azleg.gov/ars/11/00251.htm",
      readOn: "2026-08-18",
    },
  },
  {
    state: "az",
    divisionType: "school_district",
    blurb: {
      text:
        "This is the school district's governing board. It sets the policies the district's schools run on, manages school buildings and property, decides the district's budget and how state and county school money is spent, and hires the superintendent who runs the district day to day. It also handles appeals when a family disagrees with a decision a teacher made. It does not set state education standards — those come from the State Board of Education.",
      basis:
        "Arizona Revised Statutes § 15-341 (Governing board; powers and duties)",
      basisUrl: "https://www.azleg.gov/ars/15/00341.htm",
      readOn: "2026-08-18",
    },
  },
];

/**
 * Overrides for one specific division, where the general answer would be
 * wrong for it. Same idea as `DIVISION_OFFICE_BLURBS` — and the same reason:
 * Tucson is a charter council-manager city, so anything saying its council
 * runs the city day to day would be false there.
 */
export const DIVISION_BODY_BLURBS: ReadonlyArray<{
  divisionOcdId: string;
  blurb: BodyBlurb;
}> = [
  {
    divisionOcdId: "ocd-division/country:us/state:az/place:tucson",
    blurb: {
      text:
        "This is the city's governing body — the mayor and the council together. It passes city ordinances, adopts the city budget, sets city taxes and fees, and decides zoning: what can be built where. Tucson runs on a charter where a city manager the council hires handles the day-to-day work, so the mayor and council decide the direction and the money rather than running departments themselves.",
      basis: "Tucson City Charter (council–manager form)",
      basisUrl:
        "https://codelibrary.amlegal.com/codes/tucson/latest/tucson_az_charter",
      readOn: "2026-08-18",
    },
  },
];

/**
 * The honest absence line for section 2. One sentence, describing OUR
 * research and never the body — the same discipline as `THIN_CANDIDATE_LINE`.
 */
export const NO_BODY_BLURB_LINE =
  "We haven't yet read the law that defines what this body can decide, so we're not going to describe it.";

/**
 * The blurb for a body, or null. The division override wins, because it exists
 * precisely for the case where the general answer is wrong.
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
