ALTER TABLE "search_log" ADD COLUMN "run_class" text DEFAULT 'ORGANIC' NOT NULL;--> statement-breakpoint
ALTER TABLE "search_log" ADD COLUMN "run_id" text;--> statement-breakpoint
CREATE INDEX "search_log_run_class_idx" ON "search_log" USING btree ("run_class");--> statement-breakpoint
-- C05 (2026-08-17). The column default is ORGANIC because that is the right
-- reading of a live request that declares nothing: a reader. It is the WRONG
-- reading of every row that already existed, and drizzle-kit cannot know the
-- difference — so this statement corrects them, in the same migration, before
-- any aggregate can read them.
--
-- Every row written before this migration is UNKNOWN. Not organic, not
-- synthetic: unknown. Roughly 537 of them are ours (local and CI Playwright
-- runs against the production database), the rest are readers, and NOTHING IN
-- THE ROW DISTINGUISHES THEM. Marking them organic would put our own robots
-- into a number a buyer pays for; marking them all synthetic would throw away
-- real reader signal and claim a certainty we do not have.
--
-- UNKNOWN is excluded from every aggregate alongside SYNTHETIC, so the honest
-- consequence is stated rather than hidden: the search log's history is not
-- sellable, and the sellable record starts here.
--
-- A row written between the ADD COLUMN above and this UPDATE would be marked
-- UNKNOWN despite being a genuine reader. That is a handful of rows at worst,
-- and it errs toward exclusion, which is the direction this whole column errs
-- in on purpose.
UPDATE "search_log" SET "run_class" = 'UNKNOWN';
