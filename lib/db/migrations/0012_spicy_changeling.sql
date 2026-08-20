-- THE PER-GOVERNMENT TIER DISTRIBUTION ON THE TWO SOLD STORES
-- (Prompt C item 3, 2026-08-20).
--
-- HAND-CORRECTED from what `drizzle-kit generate` emitted, and the correction
-- is the same one 0011 had to make. Drizzle wrote:
--
--     ALTER TABLE "reactions" ADD COLUMN "coverage_tier_distribution" text NOT NULL;
--
-- which Postgres REFUSES on a table that already holds rows: there is no value
-- to put in the new column for them. Run as generated, this migration fails on
-- production and succeeds on an empty local branch — the exact shape of a gate
-- that is green everywhere except where it matters.
--
-- Two statements per table instead of one, and they do different jobs:
--
--   1. ADD COLUMN ... DEFAULT 'UNKNOWN' NOT NULL — this is item 3.3, the
--      BACKFILL. Every row written before this column existed gets `UNKNOWN`.
--
--      NOT ZEROS. `T0:0,T1:0,T2:0,T3:0` would read as "we counted this place's
--      governments and found none", which is a measurement, and inventing one
--      a buyer would then weight by is precisely the failure this column
--      exists to avoid. `UNKNOWN` is the named gap.
--
--      AND NOT TODAY'S DISTRIBUTION EITHER. Item 3.3 asks for the value as of
--      the RECORD'S OWN DATE where recoverable. It is not recoverable: the
--      ledger is stamped once and carries no history, so nothing knows what
--      the distribution was on the day an old row was written. `UNKNOWN` for
--      every pre-existing row is the honest answer, stated here rather than
--      left looking like an oversight.
--
--   2. ALTER COLUMN ... DROP DEFAULT — this is item 3.4. With the default
--      gone, a write that does not state the distribution FAILS instead of
--      quietly landing as `UNKNOWN`. The default exists only long enough to
--      fill the rows that already existed; leaving it in place would mean
--      every future caller could forget the column and never find out.

ALTER TABLE "reactions" ADD COLUMN "coverage_tier_distribution" text DEFAULT 'UNKNOWN' NOT NULL;--> statement-breakpoint
ALTER TABLE "reactions" ALTER COLUMN "coverage_tier_distribution" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "search_log" ADD COLUMN "coverage_tier_distribution" text DEFAULT 'UNKNOWN' NOT NULL;--> statement-breakpoint
ALTER TABLE "search_log" ALTER COLUMN "coverage_tier_distribution" DROP DEFAULT;
