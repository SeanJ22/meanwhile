CREATE TABLE "demand_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"signal" text NOT NULL,
	"ocd_ids" jsonb NOT NULL,
	"division_vintage" text NOT NULL,
	"run_class" text DEFAULT 'UNKNOWN' NOT NULL,
	"run_id" text
);
--> statement-breakpoint
CREATE INDEX "demand_signals_occurred_idx" ON "demand_signals" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "demand_signals_subject_idx" ON "demand_signals" USING btree ("subject_type","subject_id");