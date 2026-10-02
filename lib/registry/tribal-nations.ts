/**
 * **RULING 119 — A SOVEREIGN TRIBAL NATION IS ITS OWN CATEGORY OF
 * GOVERNMENT.** (2026-08-24, closing `NS08`.)
 *
 * Tribal nations are their own specific category of government — and
 * **nationally**, not an Arizona special case. New Mexico, Oklahoma and Texas
 * are coming.
 *
 * ## How this got found, which is the part worth keeping
 *
 * Nothing in this product's enumeration would have produced it. It came out of
 * the **FEC Combined Federal/State Directory**, whose Arizona entry names six
 * offices — and one of them is the **Navajo Nation Ethics and Rules Office**,
 * listed alongside the states as a jurisdiction holding administrative
 * hearings, ethics clearances and investigations under the Navajo Ethics in
 * Government Law. No municipality list, no county roster and no state register
 * carries that. RULING 93's descend-the-hierarchy move is what surfaced it.
 *
 * ## THE IDENTIFIER, AND WHY IT IS MINTED RATHER THAN LOOKED UP
 *
 * `CLAUDE.md` makes OCD-IDs the universal join key and forbids joining on name
 * strings. **The canonical `opencivicdata/ocd-division-ids` registry has no
 * tribal division type at all** — read 2026-08-24, `identifiers/country-us.csv`,
 * 21.9 MB, whose complete top-level vocabulary is `state:`, `district:`,
 * `territory:` and `court_of_appeals:`. A search for the three nations by name
 * returns only Navajo COUNTY, Arizona, and a Coconino County precinct. There is
 * nothing to look up.
 *
 * So these ids are **PROJECT-MINTED, and they say so**. They are not guesses:
 * the numeric key is the **Census AIANNH code**, and the ANSI code travels with
 * it, both read on 2026-08-24 from
 * `https://www2.census.gov/geo/docs/reference/codes2020/national_aiannh2020.txt`
 * — a keyless `.gov` publication, 704 rows, with a control search for a
 * nonsense name returning 0. A minted id whose basis is an authoritative
 * federal code is a different thing from a guessed identifier, and the
 * distinction is recorded here so a later session does not have to re-derive
 * which it was.
 *
 * A Needs Sean row carries the remaining question, which is his and not a
 * session's: whether this project proposes a tribal division type upstream.
 *
 * ## WHAT IS DELIBERATELY NOT CLAIMED
 *
 * **These are NAMED, not hunted.** RULING 57 says a body is named first and
 * hunted second, and that a body carrying only its name, its authority and the
 * enumeration that found it is more than a reader has today.
 *
 * **The govern verb does not attach** (`governVerbMayAttach: false` on
 * `SOVEREIGN_TRIBAL`). Tribal jurisdiction turns on tribal membership and on
 * land status, not on where a reader is standing, and this product resolves a
 * reader by geography alone. Asserting that one of these governs a reader
 * because a zip centroid landed inside a reservation boundary would be a claim
 * this product cannot support. Saying nothing about the relationship, while
 * naming the nation and its government, is the honest form.
 */

/** What a nation's row carries before anybody has hunted it. */
export interface TribalNation {
  /** PROJECT-MINTED. The key is the Census AIANNH code — see the module note. */
  ocdId: string;
  /** The Census AIANNH code, 2020 vintage. The basis for the id above. */
  censusAiannhCode: string;
  /** The ANSI/GNIS code, which is the stabler federal identifier of the two. */
  ansiCode: string;
  /** The nation's own name for itself where this project has read one. */
  name: string;
  /** The Census's name for the AREA, which is not the same thing as the nation. */
  censusAreaName: string;
  /** States the area falls in, per the Census file. */
  states: readonly string[];
  /** Where this row came from, per source. */
  provenance: string;
}

export const TRIBAL_NATIONS: readonly TribalNation[] = [
  {
    ocdId: "ocd-division/country:us/aiannh:2430",
    censusAiannhCode: "2430",
    ansiCode: "00041148",
    name: "Navajo Nation",
    censusAreaName: "Navajo Nation Reservation",
    states: ["AZ", "NM", "UT"],
    provenance:
      "Census 2020 AIANNH national codes file, read 2026-08-24. Named as a records-holding " +
      "jurisdiction in the FEC Combined Federal/State Directory (Navajo Nation Ethics and " +
      "Rules Office, https://nnethicsrules.navajo-nsn.gov).",
  },
  {
    ocdId: "ocd-division/country:us/aiannh:4200",
    censusAiannhCode: "4200",
    ansiCode: "00023763",
    name: "Tohono O'odham Nation",
    censusAreaName: "Tohono O'odham Nation Reservation",
    states: ["AZ"],
    provenance:
      "Census 2020 AIANNH national codes file, read 2026-08-24. Holds territory in Pima " +
      "County, where 85641 and 85701 are.",
  },
  {
    ocdId: "ocd-division/country:us/aiannh:2680",
    censusAiannhCode: "2680",
    ansiCode: "02419049",
    name: "Pascua Yaqui Tribe",
    censusAreaName: "Pascua Pueblo Yaqui Reservation",
    states: ["AZ"],
    provenance:
      "Census 2020 AIANNH national codes file, read 2026-08-24. Holds territory in Pima " +
      "County, where 85641 and 85701 are.",
  },
];

/** The nations holding territory in or adjacent to a state, by USPS code. */
export function tribalNationsInState(usps: string): readonly TribalNation[] {
  return TRIBAL_NATIONS.filter((n) => n.states.includes(usps.toUpperCase()));
}
