/**
 * **PARTIAL EXTRACTION THAT RECONCILES** — RULING 100, 2026-08-23.
 *
 * ## The failure this exists to catch, and why nothing already caught it
 *
 * `lib/extract/types.ts` refuses a zero-row extraction inside the constructor:
 * a layer cannot report success with an empty list even by accident. That
 * guard is real and it has caught things. It is also blind to the failure NJ
 * Hunt 6 found three times in one session:
 *
 * - A stray `<br id="isPasted">` in Rockaway Township's wikitext ended the
 *   roster sentence early. **Four of nine council members vanished. The parse
 *   reported five rows and exited clean.**
 * - A filter that required a party letter, a term year or a seat deleted the
 *   two Mount Olive members the article says least about — the two least-
 *   documented people on the body, which is the equal-effort failure pointed
 *   the other way.
 * - Pequannock's council sentence used the past-tense copula `was composed
 *   of`. **Five sitting members read as an empty body** — that one the
 *   zero-row guard did catch, which is exactly why the other two are the
 *   interesting cases.
 *
 * None of the three threw. Two of the three returned a NON-ZERO row count. So
 * every instrument in this repo reported a healthy extraction, because every
 * instrument was asking *did you get something* rather than *did you get what
 * the document says is there*.
 *
 * **A total that reconciles is not a total that is correct.** The document
 * frequently states its own denominator — *nine members, with one member
 * elected from each of six wards* — and where it does, that number is the only
 * check worth having.
 *
 * ## The two states, and the second one is the point
 *
 * 1. **The source states a count.** Extraction yielding fewer is `SHORT` and
 *    it FAILS. Not a warning, not a note in a log: the outcome carried by the
 *    result is `PARTIAL`, and a caller has to handle it.
 * 2. **The source states no count.** That is `NOT_ASSERTABLE` — a distinct,
 *    named, reportable state, never a silent pass. A session reporting
 *    coverage says how many of its extractions could be checked at all, which
 *    is a fact about the corpus rather than about the parser.
 *
 * The second state is the load-bearing half. A guard that only spoke up when
 * it had a number would let every unassertable extraction read as verified,
 * and the count of those would be invisible — the same shape as a clip that
 * reports success.
 *
 * ## What this module does NOT do
 *
 * It does not go looking for more rows, and it never invents one. Its whole
 * job is to say *the document says nine and you have five*. Closing the gap is
 * the parser's problem, and a `SHORT` verdict is the record that the gap was
 * seen rather than reconciled away.
 */

/** What the comparison said. */
export type CountVerdict =
  /** The source stated a count and extraction produced exactly that many. */
  | "MATCHED"
  /**
   * The source stated a count and extraction produced FEWER. A failed
   * extraction, whatever the row count looks like on its own.
   */
  | "SHORT"
  /**
   * The source stated a count and extraction produced MORE. Not a failure by
   * itself — a roster sentence naming nine members can sit beside a table that
   * also carries the clerk — but it is never silent, because the commonest
   * cause is a parser reading prose as people.
   */
  | "OVER"
  /**
   * The source states no count this module can read. Reported, never assumed
   * to be fine.
   */
  | "NOT_ASSERTABLE";

export interface CountAssertion {
  verdict: CountVerdict;
  /** The count the SOURCE states. Null only on `NOT_ASSERTABLE`. */
  stated: number | null;
  /**
   * The evidence for `stated` — the clause it was read out of, or a
   * description of the structure it was counted from. Null on
   * `NOT_ASSERTABLE`, where there is nothing to quote.
   */
  statedBy: string | null;
  /** What extraction actually produced. */
  extracted: number;
  /** One sentence, in the register a report can print unedited. */
  reason: string;
}

/**
 * The source stated no count. `why` names what was looked at, so a reader of
 * the report can tell "this page has no membership sentence" from "this layer
 * never looks for one".
 */
export function notAssertable(extracted: number, why: string): CountAssertion {
  return {
    verdict: "NOT_ASSERTABLE",
    stated: null,
    statedBy: null,
    extracted,
    reason: `no count is stated by the source — ${why}`,
  };
}

/**
 * Compare what was extracted against what the source says is there.
 *
 * `stated` of `null` is `NOT_ASSERTABLE` rather than a pass, which is the
 * whole reason this takes a nullable number instead of making the caller
 * branch.
 */
export function assertCount(
  extracted: number,
  stated: number | null,
  statedBy: string | null,
): CountAssertion {
  if (stated === null) {
    return notAssertable(extracted, statedBy ?? "nothing in the document states a membership count");
  }
  const quote = statedBy === null ? "" : ` — stated by: ${statedBy}`;
  if (extracted === stated) {
    return {
      verdict: "MATCHED",
      stated,
      statedBy,
      extracted,
      reason: `the source states ${stated} and extraction produced ${stated}${quote}`,
    };
  }
  if (extracted < stated) {
    return {
      verdict: "SHORT",
      stated,
      statedBy,
      extracted,
      reason:
        `the source states ${stated} and extraction produced ${extracted} — ` +
        `${stated - extracted} missing. A partial extraction, not a short list${quote}`,
    };
  }
  return {
    verdict: "OVER",
    stated,
    statedBy,
    extracted,
    reason:
      `the source states ${stated} and extraction produced ${extracted} — ` +
      `${extracted - stated} more than the document claims${quote}`,
  };
}

/** True where the verdict means the extraction did not get what the source says exists. */
export function isShort(a: CountAssertion): boolean {
  return a.verdict === "SHORT";
}

const WORD_NUMBERS: Readonly<Record<string, number>> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  "twenty-one": 21,
  "twenty-five": 25,
  thirty: 30,
};

/** A bare integer or an English number word, or null. */
export function numberFrom(token: string | undefined): number | null {
  if (token === undefined) return null;
  const t = token.trim().toLowerCase().replace(/,/g, "");
  if (/^\d{1,3}$/.test(t)) return Number(t);
  return WORD_NUMBERS[t] ?? null;
}

const N = "(\\d{1,3}|[a-z]+(?:-[a-z]+)?)";

/**
 * The shapes a body's own page uses to state how many people sit on it.
 *
 * **Append-only, and each carries an id** so a report can say WHICH shape
 * matched — the same discipline `ROSTER_LEAD_INS` uses, and for the same
 * reason: a shape that stops appearing costs nothing to keep, and deleting one
 * is how the next state's assertion silently becomes `NOT_ASSERTABLE`.
 *
 * Every one of these is ANCHORED. A bare `nine members` floating in prose is
 * deliberately not matched: *nine members of the public spoke* would otherwise
 * become a stated seat count, and a wrong denominator is worse than none —
 * it would fail a correct extraction and send a session hunting a person who
 * does not exist.
 */
const STATED_COUNT_SHAPES: ReadonlyArray<readonly [string, RegExp]> = [
  // "nine members, with one member elected from each of six wards" — Rockaway.
  ["members-with-breakdown", new RegExp(`\\b${N}\\s+members,\\s+(?:with|of whom|including)\\b`, "i")],
  // "is composed of five members", "consists of seven members"
  [
    "copula-of-n-members",
    new RegExp(
      `\\b(?:is|are|was|were)?\\s*(?:comprised|composed|made up|consists?|consisted)\\s+of\\s+${N}\\s+members\\b`,
      "i",
    ),
  ],
  // "a nine-member Township Council", "the five-member board"
  [
    "n-member-body",
    new RegExp(
      `\\b${N}-member\\s+(?:township\\s+|borough\\s+|city\\s+|town\\s+|county\\s+|regional\\s+)?(?:council|board|committee|commission|commissioners|selectmen|selectboard|body|legislature|assembly)\\b`,
      "i",
    ),
  ],
  // "Council of nine members", "Board of Education of seven members"
  [
    "body-of-n-members",
    new RegExp(
      `\\b(?:council|board|committee|commission|selectboard)\\b[^.]{0,40}?\\bof\\s+${N}\\s+members\\b`,
      "i",
    ),
  ],
  // "governing body consists of a Mayor and eight council members"
  [
    "mayor-and-n-members",
    new RegExp(`\\bmayor\\s+and\\s+${N}\\s+(?:council\\s+)?members\\b`, "i"),
  ],
  // "seven members serve staggered terms"
  [
    "n-members-serve",
    new RegExp(`\\b${N}\\s+members\\s+(?:serve|are elected|shall be elected)\\b`, "i"),
  ],
];

export interface StatedCount {
  count: number;
  /** The clause it was read out of, trimmed for a report. */
  evidence: string;
  /** Which shape in `STATED_COUNT_SHAPES` matched. */
  shape: string;
}

/**
 * Read a stated membership count out of a body's own prose.
 *
 * Returns the FIRST shape that matches and yields a plausible seat count.
 * Anything over 200 is refused — that is a page about a legislature or a
 * mis-parse, and neither is a roster this is being asked about.
 */
export function statedCountIn(text: string): StatedCount | null {
  for (const [shape, re] of STATED_COUNT_SHAPES) {
    const m = re.exec(text);
    if (m === null) continue;
    const count = numberFrom(m[1]);
    if (count === null || count < 2 || count > 200) continue;
    return { count, evidence: m[0].replace(/\s+/g, " ").trim(), shape };
  }
  return null;
}

/** One line, in the form every adapter already reports counts. */
export function assertionLine(a: CountAssertion): string {
  const stated = a.stated === null ? "—" : String(a.stated);
  return `count ${a.verdict} stated=${stated} extracted=${a.extracted}`;
}
