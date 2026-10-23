

export interface RunClassCensus {
  organic: number;
  synthetic: number;
  unknown: number;
  /** The author using his own product — excluded, and named rather than hidden. */
  author: number;
  total: number;
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
