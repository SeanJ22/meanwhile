import { and, eq, sql, type SQL } from "drizzle-orm";

import { searchLog } from "../db/schema.ts";

/**
 * The only door into the search log for anything that aggregates. Our own automated traffic must never
 * be in anything sold, so the filter is not a convention: it is the only exported way to build a query
 * against this table, `tests/search-log-exclusion.test.ts` asserts no other module reads `search_log`,
 * and every aggregate reports the ORGANIC count and says so in words.
 *
 * `UNKNOWN` (rows predating the marker, or declaring automation without a usable run id) is excluded, not
 * merged into organic: an undercount stated honestly beats an overcount.
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
 * The run-class census. Deliberately not filtered: it describes the whole table, including our own
 * traffic, and is a report, not a sold number. Every class appears, so the parts sum to `total`.
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
 * The same census over a date window, as raw SQL for callers that use the Neon HTTP driver. Lives here
 * because this module is the only door into the table. Not filtered; nothing it returns may be
 * presented as a reader count without `organicDenominatorSentence` beside it. Two positional parameters:
 * inclusive start and exclusive end, ISO timestamps.
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
