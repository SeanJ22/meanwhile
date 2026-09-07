import { and, eq, sql, type SQL } from "drizzle-orm";

import { searchLog } from "../db/schema.ts";

/**
 * THE ONLY DOOR INTO THE SEARCH LOG FOR ANYTHING THAT AGGREGATES (C05).
 *
 * Roughly 537 rows on production are ours — written by local and CI Playwright
 * runs — and every walk adds about 28 more. Nothing sold may ever contain
 * them. A filter that each aggregate remembers to apply is a filter one
 * aggregate will forget, and the forgetting is invisible: the number just
 * comes out slightly too high, in our favour, on the thing we are selling.
 *
 * So the filter is not a convention. It is the only exported way to build a
 * query against this table, `tests/search-log-exclusion.test.ts` asserts that
 * no other module reads `search_log` without going through here, and the
 * denominator every aggregate reports is the ORGANIC count and says so in
 * words wherever it is rendered or exported.
 *
 * ## Why UNKNOWN is excluded and not merged into organic
 *
 * `UNKNOWN` means the row predates the marker, or arrived declaring itself
 * automated without a usable run id. Counting it as a reader would be a guess
 * in our own favour on a number a buyer pays for. Excluding it is a guess in
 * the other direction, and that is the direction the product has to err in:
 * an undercount stated honestly is a smaller number, while an overcount is a
 * false claim about a district. Every row written before 2026-08-17 is
 * UNKNOWN, and the honest reading of the historical log is that it is not
 * sellable.
 */

/** The classes an aggregate may count. Exactly one. */
export const COUNTABLE_RUN_CLASSES = ["ORGANIC"] as const;

/**
 * The predicate every sold read carries. Nothing else in this repo may write
 * `eq(searchLog.runClass, ...)` — the guard test enforces it.
 */
export const ORGANIC_ONLY: SQL = eq(searchLog.runClass, "ORGANIC");

/** The same predicate as raw SQL, for the scripts that hand-write queries. */
export const ORGANIC_ONLY_SQL = "run_class = 'ORGANIC'";

/**
 * Add the exclusion to a caller's own conditions.
 *
 * The exclusion is always the FIRST condition and cannot be dropped by the
 * caller — there is no parameter that turns it off, because a parameter that
 * turns it off is a parameter someone will pass.
 */
export function organicOnly(...conditions: Array<SQL | undefined>): SQL {
  const kept = conditions.filter((c): c is SQL => c !== undefined);
  return kept.length === 0 ? ORGANIC_ONLY : (and(ORGANIC_ONLY, ...kept) as SQL);
}

export interface RunClassCensus {
  organic: number;
  synthetic: number;
  unknown: number;
  /** The author using his own product — excluded, and named rather than hidden. */
  author: number;
  total: number;
}

/**
 * The counts, which the brief requires stating and which every export's
 * confidence mix should carry.
 *
 * Deliberately NOT filtered: this is the one read whose job is to describe the
 * whole table, including the part that is ours. It reports rather than
 * aggregates, so it is not a sold number and does not go through the filter.
 *
 * `author` joined the census on 2026-08-17 with the class itself. A class that
 * exists in the data and not in the census is a row the census cannot account
 * for — `organic + synthetic + unknown` would simply stop summing to `total`,
 * and a census that does not reconcile is worse than no census.
 */
export function runClassCensusQuery(): SQL {
  return sql`
    SELECT
      COUNT(*) FILTER (WHERE run_class = 'ORGANIC')   AS organic,
      COUNT(*) FILTER (WHERE run_class = 'SYNTHETIC') AS synthetic,
      COUNT(*) FILTER (WHERE run_class = 'UNKNOWN')   AS unknown,
      COUNT(*) FILTER (WHERE run_class = 'AUTHOR')    AS author,
      COUNT(*)                                        AS total
    FROM search_log
  `;
}

/**
 * **THE SAME CENSUS, OVER A DATE WINDOW, AS RAW SQL** (MAPQ-7, 2026-09-07).
 *
 * The MapTiler usage panel compares what the provider billed us for against
 * what OUR OWN declared actor classes did over the same billing window. That
 * comparison needs the census restricted to a window, and it needs it as a
 * string because `scripts/maptiler-usage.mts` speaks to the production replica
 * through the Neon HTTP driver rather than through Drizzle.
 *
 * It lives HERE, beside `runClassCensusQuery`, because this module is the only
 * door into this table and `tests/search-log-exclusion.test.ts` enforces that.
 * A windowed census hand-written inside a script would be a second reader of
 * `search_log` that nothing checks — which is exactly the shape of forgetting
 * the guard exists to prevent, even though a census is a report rather than a
 * sold number.
 *
 * Like `runClassCensusQuery`, it is deliberately NOT filtered: its job is to
 * describe the whole window, including the part that is ours. Nothing it
 * returns may be presented as a reader count without the exclusions stated
 * beside it, and `organicDenominatorSentence` is how that is said.
 *
 * Two positional parameters: the inclusive start and the exclusive end, as ISO
 * timestamps. Parameterised rather than interpolated, so a window can never
 * become SQL.
 */
export const RUN_CLASS_CENSUS_WINDOW_SQL = `
  SELECT run_class, COUNT(*)::int AS n
    FROM search_log
   WHERE occurred_at >= $1
     AND occurred_at <  $2
   GROUP BY run_class
`;

/**
 * The sentence that must accompany any rendered or exported figure drawn from
 * this table. Stating the denominator in words is the rule; this makes the
 * words impossible to get wrong.
 */
export function organicDenominatorSentence(census: RunClassCensus): string {
  // Every non-organic class, so the sentence reconciles against `total`. A
  // hand-written sum here is how a later class gets silently left out of the
  // excluded figure while still sitting in the table.
  const excluded = census.total - census.organic;
  const authorClause =
    census.author > 0
      ? `, and ${census.author} the author using his own product on his own statement`
      : "";
  return (
    `Counted from ${census.organic} reader ${census.organic === 1 ? "event" : "events"}. ` +
    `${excluded} further ${excluded === 1 ? "row is" : "rows are"} excluded — ` +
    `${census.synthetic} written by our own automated runs, ${census.unknown} ` +
    `that predate the marker and cannot be attributed either way${authorClause}. ` +
    `An unattributable row is never counted as a reader.`
  );
}
