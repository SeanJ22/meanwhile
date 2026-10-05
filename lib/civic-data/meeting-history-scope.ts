/**
 * A partition's durable history lives at its own scope plus this suffix, under the same record class (DB-06):
 * `source:<s>:body:<b>:history`. Kept in a module of its own so the validator and the partition contracts agree on it
 * without either importing the other.
 */
export const MEETING_HISTORY_SCOPE_SUFFIX = ":history" as const;
