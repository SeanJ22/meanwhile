/**
 * An absence may describe our sourcing; it may never assert a fact about a
 * person or a government to explain an empty section.
 *
 * | Shape | Verdict |
 * |---|---|
 * | *We haven't sourced a voting record for this person yet* | **HONEST.** A fact about us |
 * | *People who have not held this office don't have a voting record to show* | **FORBIDDEN.** A fact about them |
 * | *We haven't recorded this chamber's vote on this yet* | **REQUIRED** by the render-default rule |
 *
 * The sweep is written by shape, with the honest lines planted beside the
 * defects so it can never become pressure to delete the attribution rule.
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
     * The same defect about a government: a future-tense claim of permanent
     * absence ("It will never have a website") about something a government
     * could publish or hold. A plausible cause is not a verified permanent
     * fact, and "never" retires the recheck. The honest forms ("we have not
     * found one", "the field is blank") are planted in `KNOWN_GOOD`.
     */
    id: "asserted-permanent-absence",
    why:
      "asserts that a government will NEVER have something. We can know a field is blank today; we " +
      "cannot know it is blank forever, and 'never' retires the recheck on a fact that can change.",
    /*
     * Two narrowings: `would` is out ("would never have surfaced it" is a
     * counterfactual about an instrument), and the verb must take an OBJECT (an
     * article or a possessive), so `have` as an auxiliary does not match.
     */
    re: /\b(?:will|can|shall)\s+never\s+(?:have|publish|post|maintain|operate|hold)\s+(?:a|an|its|their|one)\b/i,
  },
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
