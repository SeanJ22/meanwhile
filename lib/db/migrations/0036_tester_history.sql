-- Sean, October 1, 2026: retain tester history, exclude it from sold data.
-- Before today means before midnight Arizona MST, not midnight UTC.
UPDATE "search_log" SET "run_class" = 'TESTER'
WHERE "occurred_at" < TIMESTAMPTZ '2026-10-01 00:00:00-07' AND "run_class" <> 'TESTER';
--> statement-breakpoint
ALTER TABLE "reader_event_batches" ADD COLUMN "run_class" text DEFAULT 'UNKNOWN' NOT NULL;
--> statement-breakpoint
ALTER TABLE "reader_event_members" ADD COLUMN "run_class" text DEFAULT 'UNKNOWN' NOT NULL;
--> statement-breakpoint
ALTER TABLE "reader_event_totals" ADD COLUMN "run_class" text DEFAULT 'UNKNOWN' NOT NULL;
--> statement-breakpoint
-- Event capture has not been activated: any existing classless event rows
-- belong to staging/tests. Retain them, including their day/week counts.
UPDATE "reader_event_batches" SET "run_class" = 'TESTER';
--> statement-breakpoint
UPDATE "reader_event_members" SET "run_class" = 'TESTER';
--> statement-breakpoint
UPDATE "reader_event_totals" SET "run_class" = 'TESTER';
--> statement-breakpoint
ALTER TABLE "reader_event_members" DROP CONSTRAINT "reader_event_members_pkey";
--> statement-breakpoint
ALTER TABLE "reader_event_members" ADD PRIMARY KEY ("period", "period_start", "zip", "district", "topic", "event_type", "run_class", "reader_hash");
--> statement-breakpoint
ALTER TABLE "reader_event_totals" DROP CONSTRAINT "reader_event_totals_pkey";
--> statement-breakpoint
ALTER TABLE "reader_event_totals" ADD PRIMARY KEY ("period", "period_start", "zip", "district", "topic", "event_type", "run_class");
--> statement-breakpoint
UPDATE "reactions" SET "run_class" = 'TESTER'
WHERE "occurred_at" < TIMESTAMPTZ '2026-10-01 00:00:00-07' AND "run_class" <> 'TESTER';
--> statement-breakpoint
UPDATE "feedback" SET "run_class" = 'TESTER'
WHERE "received_at" < TIMESTAMPTZ '2026-10-01 00:00:00-07' AND "run_class" <> 'TESTER';
--> statement-breakpoint
UPDATE "speak_your_mind" SET "run_class" = 'TESTER'
WHERE "occurred_at" < TIMESTAMPTZ '2026-10-01 00:00:00-07' AND "run_class" <> 'TESTER';
--> statement-breakpoint
UPDATE "ask_interactions" SET "run_class" = 'TESTER'
WHERE "occurred_at" < TIMESTAMPTZ '2026-10-01 00:00:00-07' AND "run_class" <> 'TESTER';
--> statement-breakpoint
UPDATE "demand_signals" SET "run_class" = 'TESTER'
WHERE "occurred_at" < TIMESTAMPTZ '2026-10-01 00:00:00-07' AND "run_class" <> 'TESTER';
