-- THE DEFAULT COMES OFF, once the code that fills the column is serving
-- (Prompt C item 3.4, 2026-08-20).
--
-- Read `0013`'s header first; this is its other half. `0013` put the default
-- back so the build that was live at the time could keep recording while it
-- knew nothing about this column. This removes it again.
--
-- **APPLY THIS ONLY AFTER `/api/build` REPORTS THE COMMIT THAT WRITES
-- `coverage_tier_distribution`.** Applied before that, it breaks every insert
-- into both sold stores, silently, exactly as the sequence that produced
-- `0013` did — the route catches the failure and a reader sees a working
-- search while nothing is recorded.
--
-- With the default gone, item 3.4 holds as written: a write that does not
-- state the distribution FAILS rather than landing as `UNKNOWN` and being
-- read by a buyer as a measurement.

ALTER TABLE "reactions" ALTER COLUMN "coverage_tier_distribution" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "search_log" ALTER COLUMN "coverage_tier_distribution" DROP DEFAULT;
