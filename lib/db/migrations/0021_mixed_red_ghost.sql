CREATE TABLE "ask_interactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"question_scrubbed" text NOT NULL,
	"self_disclosure" jsonb NOT NULL,
	"intent" text NOT NULL,
	"temporal_kind" text NOT NULL,
	"subject_ids" jsonb NOT NULL,
	"resolution_state" text NOT NULL,
	"answer_mode" text NOT NULL,
	"answer_text" text,
	"answer_model" text,
	"validation_passed" boolean,
	"evidence_record_count" integer DEFAULT 0 NOT NULL,
	"evidence_source_count" integer DEFAULT 0 NOT NULL,
	"named_gap_count" integer DEFAULT 0 NOT NULL,
	"surface" text NOT NULL,
	"approximate_location" text,
	"ocd_ids" jsonb NOT NULL,
	"division_vintage" text NOT NULL,
	"residency_relation" text NOT NULL,
	"location_confidence" text NOT NULL,
	"coverage_tier" text NOT NULL,
	"coverage_tier_distribution" text NOT NULL,
	"ask_key_hash" text NOT NULL,
	"run_class" text DEFAULT 'UNKNOWN' NOT NULL,
	"run_id" text
);
--> statement-breakpoint
CREATE INDEX "ask_interactions_occurred_idx" ON "ask_interactions" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "ask_interactions_mode_idx" ON "ask_interactions" USING btree ("answer_mode");--> statement-breakpoint
CREATE INDEX "ask_interactions_surface_idx" ON "ask_interactions" USING btree ("surface");