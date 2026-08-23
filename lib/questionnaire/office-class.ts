/**
 * **WHICH INSTRUMENT A CONTEST GETS — resolved from the DIVISION first, and
 * from the office title only where the division genuinely cannot say.**
 * (Built 2026-08-23, the questionnaire-and-corpora brief, item 1.)
 *
 * `CLAUDE.md`: *OCD-IDs are the universal join key. Never join on name
 * strings.* So the office class is read off the OCD-ID's own division type
 * wherever that division type has exactly one office class in it — a
 * `school_district` contest is a school board contest, structurally, and no
 * string is consulted to establish that.
 *
 * **Two division types are genuinely ambiguous and the ambiguity is real
 * rather than a gap in this file.** A contest at `state:nj` may be for a United
 * States Senate seat, a state legislative seat or a statewide executive office,
 * and the division cannot tell them apart because all three are elected at that
 * division. A contest at `county:morris` may be for the governing board or for
 * a county row office, likewise. For those two, and only those two, the office
 * TITLE is consulted — and a title that matches nothing returns `other` rather
 * than a guess.
 *
 * **`other` costs nothing.** It is a real class with a complete five-question
 * instrument, so a contest that lands there is fully invited and fully
 * symmetric with every other candidate in it. What it loses is the sharper
 * class question, which is a quality difference and not a coverage one — and
 * `classifyBasis` reports which contests took it, so the number is visible
 * rather than assumed to be zero.
 */

import type { OfficeClass } from "./instrument.ts";

/** Where the answer came from. Reported, never inferred by a reader. */
export type OfficeClassBasis = "division" | "office-title" | "fallback";

export interface OfficeClassVerdict {
  officeClass: OfficeClass;
  basis: OfficeClassBasis;
  /** The division type read off the OCD-ID, for reporting. */
  divisionType: string | null;
}

/**
 * The last segment's type in an OCD-ID — `place`, `county`, `school_district`,
 * `cd`, `sldu`, `sldl`, `state`. Structural; never a name string.
 */
export function divisionTypeOf(ocdId: string): string | null {
  const last = ocdId.split("/").pop();
  if (!last) return null;
  const type = last.split(":")[0];
  return type === "" ? null : type;
}

/**
 * Title patterns for the two ambiguous divisions only.
 *
 * These are SHAPES rather than exact strings (RULING 110): *a title naming the
 * United States Senate*, not the one spelling Morris County happens to use.
 * Order matters — the federal patterns are tested before the state ones because
 * "Senate" appears in both and "United States" is the discriminator.
 */
const STATE_DIVISION_PATTERNS: ReadonlyArray<[RegExp, OfficeClass]> = [
  [/\b(united states|u\.?s\.?)\s+senate\b/i, "federal_legislative"],
  [/\bhouse of representatives\b/i, "federal_legislative"],
  [/\b(state senate|general assembly|state assembly|state house)\b/i, "state_legislative"],
  [/\b(governor|lieutenant governor|attorney general|secretary of state|state treasurer)\b/i, "state_executive"],
];

/**
 * **THE PLURAL IS PART OF THE SHAPE, and leaving it out is RULING 110 in
 * miniature.** The first version of this list read `\bcommissioner\b`, which
 * cannot match *"Member of the Board of County Commissioners"* — the word
 * boundary after `commissioner` is defeated by the `s`. Every Morris County
 * commissioner contest fell to `other` and the run reported a clean 272 while
 * doing it, because a fallback that works is invisible. Searched the right
 * place, wrong form.
 */
const COUNTY_DIVISION_PATTERNS: ReadonlyArray<[RegExp, OfficeClass]> = [
  [/\b(commissioners?|freeholders?|supervisors?|county council|county board|county executive)\b/i, "county_governing"],
  [/\b(clerk|sheriff|surrogate|register|assessor|treasurer|recorder|coroner|prosecutor)s?\b/i, "county_row_office"],
];

/**
 * The whole answer for one contest.
 *
 * `title` is only ever read for `state` and `county` divisions. Everywhere else
 * it is ignored entirely, which is what stops a renamed council changing which
 * questions its candidates are asked.
 */
export function officeClassFor(input: {
  ocdId: string;
  title: string;
}): OfficeClassVerdict {
  const divisionType = divisionTypeOf(input.ocdId);

  switch (divisionType) {
    case "school_district":
      return { officeClass: "school_board", basis: "division", divisionType };
    case "place":
      return { officeClass: "municipal_governing", basis: "division", divisionType };
    case "cd":
      return { officeClass: "federal_legislative", basis: "division", divisionType };
    case "sldu":
    case "sldl":
      return { officeClass: "state_legislative", basis: "division", divisionType };
    case "state": {
      for (const [pattern, officeClass] of STATE_DIVISION_PATTERNS) {
        if (pattern.test(input.title)) {
          return { officeClass, basis: "office-title", divisionType };
        }
      }
      return { officeClass: "other", basis: "fallback", divisionType };
    }
    case "county": {
      for (const [pattern, officeClass] of COUNTY_DIVISION_PATTERNS) {
        if (pattern.test(input.title)) {
          return { officeClass, basis: "office-title", divisionType };
        }
      }
      return { officeClass: "other", basis: "fallback", divisionType };
    }
    default:
      return { officeClass: "other", basis: "fallback", divisionType };
  }
}
