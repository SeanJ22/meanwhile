ALTER TABLE "reactions" ADD COLUMN "run_class" text DEFAULT 'UNKNOWN' NOT NULL;--> statement-breakpoint
ALTER TABLE "reactions" ADD COLUMN "run_id" text;--> statement-breakpoint
CREATE INDEX "reactions_run_class_idx" ON "reactions" USING btree ("run_class");--> statement-breakpoint
-- F01-continued session 2, item 0D (2026-08-19).
--
-- The DEFAULT here is UNKNOWN, not ORGANIC, and that is the one place this
-- column differs from the search log's. It is not a philosophical difference,
-- it is a difference in what the two tables are: a search-log row is a lookup
-- and a reactions row is the thing the business sells. So the default exists
-- only for the backfill below, and NO CODE PATH RELIES ON IT — `writeReaction`
-- refuses a write that does not declare, rather than defaulting one.
--
-- Every row written before this migration is UNKNOWN. Not organic, not
-- synthetic: unknown. The table has never carried an attribution, so the only
-- thing distinguishing our own taps from a reader's is a timestamp, and
-- attributing by timestamp is the retrospective heuristic this column exists
-- to make unnecessary. Marking them organic would put our own robots into a
-- number a buyer pays for; marking them synthetic would throw away real reader
-- signal and claim a certainty we do not have.
--
-- The ADD COLUMN above already writes UNKNOWN into every existing row, so this
-- statement changes nothing today. It is here anyway, and it is not
-- decoration: it states the intent in the migration rather than leaving it to
-- be inferred from a DEFAULT clause, and it is what makes the backfill
-- re-runnable and checkable. A migration whose behaviour depends on reading a
-- DEFAULT three lines up is a migration whose author's intent is a guess.
UPDATE "reactions" SET "run_class" = 'UNKNOWN' WHERE "run_class" IS NULL OR "run_class" = 'ORGANIC';
