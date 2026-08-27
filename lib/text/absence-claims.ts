/**
 * AN ABSENCE MAY DESCRIBE OUR SOURCING. IT MAY NEVER ASSERT A FACT ABOUT A
 * PERSON. (2026-08-26, the sources-and-incumbency session. Item 13.)
 *
 * The instance: the ballot card's Voting record section rendered
 *
 *     "People who have not held this office don't have a voting record to show."
 *
 * on Karen Ebel's card. She is the sitting Deputy Speaker of the New Hampshire
 * House. **That is not an empty state — it is the product telling a reader
 * something untrue about a named person, in a live race.**
 *
 * ---
 *
 * ## The distinction, and it is the whole of the rule
 *
 * | Shape | Verdict |
 * |---|---|
 * | *We haven't sourced a voting record for this person yet* | **HONEST.** A fact about us |
 * | *People who have not held this office don't have a voting record to show* | **FORBIDDEN.** A fact about them |
 * | *We haven't recorded this chamber's vote on this yet* | **REQUIRED** by the render-default rule |
 *
 * The middle one is what this sweep exists to catch, and the third is why the
 * sweep is written BY SHAPE with the honest lines planted beside the defects
 * (RULING 110). An instrument that flagged the third would become pressure to
 * delete the attribution rule instead of the claim — which is exactly the
 * mistake RULING 139 was careful not to make when it took *"that is a gap on
 * our side"* out and left the attribution in.
 *
 * ## What this is NOT
 *
 * It is not RULING 139's sweep. That one removes the product ANNOUNCING ITS OWN
 * FAILURE — *that is a gap on our side, not a finding about those districts* —
 * where the attribution alone was enough. This one removes the product making a
 * CLAIM ABOUT A PERSON in order to explain an empty section. They live in
 * different files because they are different defects, and a single sweep would
 * have to carry both sets of exceptions.
 */

/** One forbidden shape, with why it is forbidden. */
export interface ClaimShape {
  readonly id: string;
  readonly why: string;
  readonly re: RegExp;
}

/**
 * SHAPES, NOT STRINGS. A shape is the pattern the claim takes — *a sentence
 * explaining an empty section by asserting something about the subject's life*
 * — never one particular spelling.
 */
export const CLAIM_SHAPES: readonly ClaimShape[] = [
  {
    id: "never-held-office",
    why:
      "asserts that the person has not held the office. We usually cannot know that, and on the day " +
      "this was written the product was saying it about a sitting Deputy Speaker.",
    re: /\b(people|candidates|those|anyone|someone)\b[^.]{0,60}\b(who|that)\b[^.]{0,40}\b(have|has|had)\s+not\s+held\b/i,
  },
  {
    id: "never-held-office-direct",
    why: "the same claim in the second or third person — 'they have never held this office'.",
    re: /\b(they|he|she|this (?:person|candidate))\b[^.]{0,40}\b(?:has|have)\s+(?:never|not)\s+held\b/i,
  },
  {
    id: "therefore-has-nothing",
    why:
      "derives an absence from a claim about the person's life — 'so there is no record to show'. " +
      "The honest form states what WE have not sourced and stops there.",
    re: /\b(?:do|does)(?:n't| not)\s+have\s+(?:a\s+)?(?:voting\s+)?record\b/i,
  },
  {
    id: "asserted-nothing-filed",
    why:
      "asserts the person filed or reported nothing, where all we know is that we did not find it. " +
      "'We found no committee registered with the FEC' is the same fact, honestly attributed.",
    re: /^\s*(?:no|none)\s+(?:campaign\s+money|contributions?|filings?|committees?)\s+reported\b/i,
  },
  {
    /*
     * **THE SAME DEFECT, ABOUT A GOVERNMENT INSTEAD OF A PERSON.**
     * (2026-08-27, the coverage-truth session.)
     *
     * Every shape above guards a claim about a PERSON, and the sweep reported
     * a clean 0 while four documents in this repository carried
     *
     *   "It will never have a website. It has no staff to build one."
     *
     * about Empire Elementary School District No. 37. The evidence behind that
     * sentence is real and it is narrower than the sentence: the district is
     * transportation-only, it operates no schools, it employs no staff, and
     * two official enumerations record its website field as BLANK. None of
     * that establishes that it can never publish one.
     *
     * **A plausible cause is not a verified permanent fact**, and the harm is
     * specific: a permanent absence retires the recheck. `RECHECK_DUE` exists
     * because a government's publishing can change, and a document that says
     * "never" tells every later session not to look.
     *
     * Deliberately narrow. It catches a FUTURE-TENSE claim of permanent
     * absence about a thing a government could publish or hold. It does not
     * catch the honest forms — "we have not found one", "the field is blank",
     * "no source we reached publishes it" — which are the sentences this
     * product must be able to say, and which are planted in `KNOWN_GOOD`.
     */
    id: "asserted-permanent-absence",
    why:
      "asserts that a government will NEVER have something. We can know a field is blank today; we " +
      "cannot know it is blank forever, and 'never' retires the recheck on a fact that can change.",
    /*
     * TWO NARROWINGS, both learned by running it over 90,721 prose sentences:
     *
     * - **`would` is out.** "Reading the register would never have surfaced
     *   it" is a counterfactual about an instrument, not a claim about a
     *   government's future, and it appears in five governance documents.
     * - **The verb must take an OBJECT** — an article or a possessive. That is
     *   what separates "will never have a website" from "would never have
     *   surfaced it", where `have` is an auxiliary rather than the claim.
     */
    re: /\b(?:will|can|shall)\s+never\s+(?:have|publish|post|maintain|operate|hold)\s+(?:a|an|its|their|one)\b/i,
  },
];

/**
 * A sentence that QUOTES a claim in order to correct it.
 *
 * A repository that records what it fixed will keep the wrong sentence on the
 * page, in quotes, beside the right one — which is the whole point of
 * recording it. A sweep with no notion of this either flags every correction
 * forever or gets loosened until it stops working, and the second is how a
 * guard dies. Same reasoning as `SPECIMEN_FILES` in the sweep script, at
 * sentence rather than file scale.
 */
const CORRECTION_MARKERS =
  /\bcorrected\s+\d{4}-\d{2}-\d{2}|\bthis\s+(?:read|said)\b|\bpreviously\s+read\b|\bused\s+to\s+(?:read|say)\b/i;

export function isCorrectionNote(text: string): boolean {
  return CORRECTION_MARKERS.test(text);
}

/**
 * Lines that MUST NOT be flagged. Planted here, beside the defects, so the
 * instrument can never become pressure to delete the attribution rule.
 *
 * Every one of these is a sentence this product is REQUIRED to be able to say.
 */
export const KNOWN_GOOD: readonly string[] = [
  "We haven't sourced a voting record for this person yet.",
  "We haven't collected this person's voting record yet.",
  "We haven't recorded this chamber's vote on this yet.",
  "We haven't sourced who holds this seat yet",
  "Nothing on this card has a source record yet.",
  "We could not place this address on the map, so it has no pin.",
  "We found no committee registered with the FEC for this candidacy.",
  "Candidates who raise or spend under $5,000 don't have to register.",
  /* The honest forms of the Empire sentence — every one is a fact about a
   * measurement or about us, and every one must stay sayable. */
  "Two official enumerations record this district's website field as blank.",
  "We have not found a website for this district.",
  "No source we reached publishes a website for this body.",
  "This district operates no schools and employs no staff.",
];

export interface ClaimHit {
  readonly shape: string;
  readonly why: string;
  readonly text: string;
}

/** Every forbidden shape this text matches. Empty is a clean line. */
export function claimsInText(text: string): ClaimHit[] {
  return CLAIM_SHAPES.filter((s) => s.re.test(text)).map((s) => ({ shape: s.id, why: s.why, text }));
}
