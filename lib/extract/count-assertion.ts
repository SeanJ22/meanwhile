/**
 * Partial extraction that reconciles. A non-zero row count can still be
 * missing people; where the document states its own count, that number is the
 * check.
 *
 * 1. The source states a count: fewer extracted is `SHORT`, a failure.
 * 2. The source states no count: `NOT_ASSERTABLE`, a named, reportable state,
 *    never a silent pass.
 *
 * This never looks for more rows and never invents one.
 */

/** What the comparison said. */
export type CountVerdict =
  /** The source stated a count and extraction produced exactly that many. */
  | "MATCHED"
  /** The source stated a count and extraction produced fewer: a failed extraction. */
  | "SHORT"
  /**
   * The source stated a count and extraction produced more. Not a failure by
   * itself, but never silent: the commonest cause is reading prose as people.
   */
  | "OVER"
  /** The source states no count this module can read. Reported, never assumed fine. */
  | "NOT_ASSERTABLE";

export interface CountAssertion {
  verdict: CountVerdict;
  /** The count the SOURCE states. Null only on `NOT_ASSERTABLE`. */
  stated: number | null;
  /**
  /** The clause `stated` was read out of, or the structure it was counted from. Null on `NOT_ASSERTABLE`. */
  statedBy: string | null;
  /** What extraction actually produced. */
  extracted: number;
  /** One sentence, in the register a report can print unedited. */
  reason: string;
}

/** The source stated no count; `why` names what was looked at. */
export function notAssertable(extracted: number, why: string): CountAssertion {
  return {
    verdict: "NOT_ASSERTABLE",
    stated: null,
    statedBy: null,
    extracted,
    reason: `no count is stated by the source — ${why}`,
  };
}

/** Compare what was extracted against what the source says is there. `null` stated is `NOT_ASSERTABLE`. */
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
 * Append-only, each with an id a report can name. Every shape is anchored: a
 * bare "nine members" in prose ("nine members of the public spoke") must not
 * become a seat count.
 */
const STATED_COUNT_SHAPES: ReadonlyArray<readonly [string, RegExp]> = [
  // "nine members, with one member elected from each of six wards"
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
 * Read a stated membership count out of a body's own prose: the first shape
 * that yields a count from 2 to 200.
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
