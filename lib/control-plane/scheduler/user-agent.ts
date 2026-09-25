/**
 * How the project identifies itself to a publisher: one string, in a leaf module, so a research fetch can send it
 * without reaching the scheduler's executors (the civic-data firewall follows every import). Re-exported by
 * `route-executor.ts`, where it was first defined.
 */
export const DEFAULT_USER_AGENT =
  "we-the-people-freshness/1.0 (civic records refresh; public data; contact via repository)";
