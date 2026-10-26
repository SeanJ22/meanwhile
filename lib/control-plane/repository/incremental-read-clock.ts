/** Overlap the database read clock so a concurrent, later commit is not missed. */
export const INCREMENTAL_READS_SLACK_MS = 120_000;
