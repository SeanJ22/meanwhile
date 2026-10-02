/**
 * **THE REFUSAL SHAPES — what a declining sentence looks like, so it can be
 * found without knowing its words.** (Item 1, 2026-08-23.)
 *
 * One definition, two callers: `scripts/sweep-refusal-copy.mts` reports, and
 * `tests/refusal-copy.test.ts` gates. A second copy of a matcher is a copy
 * that drifts, and a matcher that stops matching does not fail — it quietly
 * stops finding things, which is this project's own name for a false zero.
 *
 * ## What is a refusal and what is a NAMED GAP
 *
 * They use nearly the same words, and confusing them would delete a rule
 * rather than enforce one. The render-default rule REQUIRES a null to render
 * as its named gap, attributed: *"we haven't recorded this chamber's vote on
 * this yet"* is mandatory, not a defect. What is forbidden is the sentence
 * that states an INTENTION not to tell the reader — the product declining to
 * describe, explain or characterise something instead of saying what it knows.
 *
 * So every shape below fires only on a declared refusal, never on an
 * attribution of absence. `KNOWN_GOOD` holds the honest lines this project
 * ships today, and the test asserts none of them matches — a matcher that
 * flagged them would be pressure to delete the attribution rule.
 */

export interface RefusalShape {
  id: string;
  /** Plain words, printed by the sweep so the report can state the SHAPES. */
  what: string;
  pattern: RegExp;
}

export const REFUSAL_SHAPES: readonly RefusalShape[] = [
  {
    /*
     * **The verb list is DESCRIBE-family only, and dropping `say` from it was
     * a correction rather than a loosening.** The first draft matched *"so we
     * can't say"* and immediately flagged
     * `lib/meetings/jurisdiction-badge.ts` — *"No official boundary is
     * published for this body, so we can't say whether it governs your
     * area."* That sentence is the render-default rule WORKING: the body's
     * publisher has not published a boundary, and the app therefore refuses to
     * make a claim it cannot support. Declining a CLAIM is required; declining
     * a DESCRIPTION is the defect. Only the second family of verbs separates
     * them.
     */
    id: "intent-not-to-tell",
    what: "states an intention NOT to describe — the app announcing it will not describe the subject",
    pattern:
      /\b(?:so|therefore|and)\s+(?:we(?:'re| are)?\s+not\s+going\s+to|we\s+won'?t|we\s+will\s+not|we\s+(?:can'?t|cannot))\s+(?:describe|explain|characteri[sz]e|summari[sz]e)\b/i,
  },
  {
    id: "capability-denial",
    what: "denies the app's capability to describe the subject — \"can't describe it here\"",
    pattern:
      /\b(?:can'?t|cannot|unable to|not able to)\s+(?:describe|explain|characteri[sz]e|summari[sz]e)\b/i,
  },
  {
    id: "nothing-to-tell",
    what: "declares there is nothing to be told, rather than naming what is missing",
    pattern:
      /\bthere(?:'s| is| are)\s+nothing\s+(?:we\s+can\s+(?:tell|say|show)|to\s+(?:tell|say|show))\b/i,
  },

  /* ======================================================================
   * BAL-7 (2026-08-24, made product-wide) —
   * THE PRODUCT NEVER ANNOUNCES ITS OWN FAILURE.
   *
   * The site never announces that it is failing. "That is a gap on our
   * side" and every variant comes out everywhere. State what's known, offer
   * the narrowing, move on.
   *
   * ## This is a DIFFERENT family from the three above, and the line matters
   *
   * The shapes above catch the app declining to DESCRIBE something. These
   * catch the app EDITORIALISING ABOUT ITSELF — apologising, confessing,
   * blaming its own coverage — while telling the reader something true. The
   * information is not withheld; a sentence about our shortcomings is stapled
   * to it, and the reader is asked to spend attention on our feelings about a
   * gap instead of on the answer.
   *
   * ## THE ATTRIBUTION IS NOT WHAT THIS TOUCHES, and that distinction is the
   * whole reason these are patterns rather than a word list
   *
   * The render-default rule requires that a reader can tell OUR gap from THEIR
   * absence, and it says in as many words that **the rule is the ATTRIBUTION,
   * never a particular sentence**. *"We haven't recorded this chamber's vote on
   * this yet"* is attribution: it names who is missing what. *"That is a gap on
   * our side, not a finding about those districts"* is attribution PLUS a
   * verdict on ourselves, and only the second half is struck.
   *
   * Every pattern below therefore fires on the SELF-ASSESSMENT — a possessive
   * about our own shortcoming, an apology, an admission of failure — and none
   * of them can fire on "we haven't X yet". `KNOWN_GOOD` proves it, and this
   * is the same discipline RULING 110 demanded: the instrument is shown
   * catching the real instance, and shown NOT catching the honest lines.
   * ====================================================================== */
  {
    id: "blames-our-coverage",
    what: "calls a gap ours in the possessive — \"a gap on our side\", \"our fault\", \"our end\"",
    pattern:
      /\b(?:gap|failing|shortcoming|shortfall|oversight|mistake|fault)\s+(?:on|in|at)\s+(?:our|the)\s+(?:side|end|part|data|research|coverage)\b|\bour\s+(?:fault|failing|shortcoming|oversight)\b/i,
  },
  {
    id: "apologises-for-coverage",
    what: "apologises to the reader for what the product does not hold",
    /*
     * The word boundary is per-alternative, not trailing on the group. A `\b`
     * after "unfortunately," sits between a comma and a space — two non-word
     * characters, which is not a boundary — so the alternative could never
     * fire. Caught by the plant in `tests/refusal-copy.test.ts` rather than by
     * reading it, which is exactly what the plant is for: a pattern that
     * cannot match reports zero findings and reads as a clean sweep.
     */
    pattern:
      /\bwe(?:'re| are)\s+sorry\b|\bwe\s+apologi[sz]e\b|\bsorry\s+(?:about|for)\s+(?:that|this)\b|\bunfortunately\s*,/i,
  },
  {
    id: "admits-a-shortfall",
    what: "confesses a failure rather than naming what is missing — \"we should have\", \"we fell short\"",
    pattern:
      /\bwe\s+(?:should\s+have|ought\s+to\s+have|fell\s+short|have\s+fallen\s+short|failed\s+to)\b/i,
  },
];

/** Present in this file and nowhere else. See `refusalHitsIn`. */
const SELF_EXEMPT = "@refusal-shapes-definition";

export interface RefusalHit {
  line: number;
  shape: string;
  text: string;
}

/**
 * Only STRING LITERALS are considered, never comments.
 *
 * A comment explaining why a refusal was deleted contains the refusal, and a
 * matcher that flagged it would make the record of the fix into a defect —
 * which is a direct incentive to delete the record. Reader-facing copy lives
 * in literals; the rationale lives in comments; only the first is swept.
 */
export function refusalHitsIn(source: string): RefusalHit[] {
  /*
   * The shapes file states its own patterns as literals, so it matches itself.
   * A sweep that flags its own definition reports a defect that is the
   * instrument, and a marker in the file is cheaper than a path exclusion in
   * two callers that could drift apart.
   */
  if (source.includes(SELF_EXEMPT)) return [];
  const out: RefusalHit[] = [];
  const lines = source.split("\n");
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    let line = raw;
    if (inBlockComment) {
      const end = line.indexOf("*/");
      if (end === -1) continue;
      line = line.slice(end + 2);
      inBlockComment = false;
    }
    const open = line.indexOf("/*");
    if (open !== -1) {
      const close = line.indexOf("*/", open + 2);
      if (close === -1) {
        line = line.slice(0, open);
        inBlockComment = true;
      } else line = line.slice(0, open) + line.slice(close + 2);
    }
    const slash = line.indexOf("//");
    if (slash !== -1) line = line.slice(0, slash);

    for (const shape of REFUSAL_SHAPES) {
      const m = shape.pattern.exec(line);
      if (m !== null) out.push({ line: i + 1, shape: shape.id, text: line.trim().slice(0, 200) });
    }
  }
  return out;
}

/**
 * Honest lines this product ships. **None of these may ever match**, and the
 * test asserts it: they are the render-default rule working, and a matcher
 * that caught them would be enforcing the opposite of what it was built for.
 */
export const KNOWN_GOOD: readonly string[] = [
  "We haven't yet read the law that says what this office decides. What we do hold about it is below.",
  "We haven't recorded this chamber's vote on this yet.",
  "We haven't collected this person's voting record yet.",
  "We haven't found anything this person has published about where they stand.",
  "No official boundary is published for this body, so we can't say whether it governs your area.",
  "We haven't read this body's own charter yet, so the description above is what this kind of body does here.",
  "People who have not held this office don't have a voting record to show.",
  /*
   * BAL-7's neighbours. Every one of these ATTRIBUTES an absence to us, which
   * the render-default rule requires, and none of them editorialises about it.
   * If a pattern above ever starts matching one of these, the pattern is wrong
   * — this list is the brake on a sweep that would otherwise become pressure
   * to delete the attribution rule.
   */
  "We hold every one of these races in full; what we cannot tell from a zip code alone is which of them is yours.",
  "That is our coverage, not a statement that nothing is scheduled.",
  "We haven't sourced who sits on this body yet.",
  "This is not a statement that nothing is on your ballot.",
  "We haven't built the ballot for this area yet.",
];
