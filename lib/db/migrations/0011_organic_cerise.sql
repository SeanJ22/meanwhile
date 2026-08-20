-- THE COVERAGE TIER ON THE TWO SOLD STORES (RULING 6, Prompt B item 8,
-- 2026-08-20).
--
-- Hand-corrected from what `drizzle-kit generate` emitted, and the correction
-- is the whole point of the migration. Drizzle wrote:
--
--     ALTER TABLE "reactions" ADD COLUMN "coverage_tier" text NOT NULL;
--
-- which Postgres REFUSES on a table that already holds rows: there is no value
-- to put in the new column for them. Run as generated, this migration fails on
-- production and succeeds on an empty local branch — the exact shape of a gate
-- that is green everywhere except where it matters.
--
-- Two statements per table instead of one, and they do different jobs:
--
--   1. ADD COLUMN ... DEFAULT 'UNKNOWN' NOT NULL — this is item 8.2, the
--      BACKFILL. Every row written before this column existed gets `UNKNOWN`.
--      Not a tier, and never ordered against the four: it is the named gap,
--      because those rows were written before any zip had a stamped tier at
--      all and there is nothing to recover. Backfilling them optimistically —
--      to TIER_0, or to today's tier for their zip — would be inventing a
--      measurement a buyer would then weight by.
--
--   2. ALTER COLUMN ... DROP DEFAULT — this is item 8.3. With the default
--      gone, a write that does not state a tier FAILS instead of quietly
--      landing as `UNKNOWN`. The default exists only long enough to fill the
--      rows that already existed; leaving it in place would mean every future
--      caller could forget the column and never find out.

ALTER TABLE "reactions" ADD COLUMN "coverage_tier" text DEFAULT 'UNKNOWN' NOT NULL;--> statement-breakpoint
ALTER TABLE "reactions" ALTER COLUMN "coverage_tier" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "search_log" ADD COLUMN "coverage_tier" text DEFAULT 'UNKNOWN' NOT NULL;--> statement-breakpoint
ALTER TABLE "search_log" ALTER COLUMN "coverage_tier" DROP DEFAULT;
