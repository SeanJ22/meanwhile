CREATE TABLE "speak_your_mind" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"ocd_ids" jsonb NOT NULL,
	"division_vintage" text NOT NULL,
	"text" text NOT NULL,
	"self_disclosure" jsonb NOT NULL,
	"review_state" text DEFAULT 'NONE' NOT NULL,
	"review_reason" text,
	"speak_key_hash" text NOT NULL,
	"suspect_reason" text,
	"run_class" text DEFAULT 'UNKNOWN' NOT NULL,
	"run_id" text
);
--> statement-breakpoint
CREATE INDEX "speak_your_mind_subject_idx" ON "speak_your_mind" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "speak_your_mind_review_idx" ON "speak_your_mind" USING btree ("review_state");--> statement-breakpoint
CREATE INDEX "speak_your_mind_occurred_idx" ON "speak_your_mind" USING btree ("occurred_at");