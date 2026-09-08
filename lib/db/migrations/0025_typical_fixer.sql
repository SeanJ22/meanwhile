CREATE TABLE "civic_data_candidate_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"state" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"detail" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "civic_data_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"record_class" text NOT NULL,
	"scope" text NOT NULL,
	"state" text NOT NULL,
	"acquisition_succeeded" boolean NOT NULL,
	"raw_hash" text,
	"normalized_hash" text,
	"retrieved_at" timestamp with time zone NOT NULL,
	"source_through" text NOT NULL,
	"parser_version" text NOT NULL,
	"identity" jsonb NOT NULL,
	"candidate" jsonb NOT NULL,
	"validation_receipt" jsonb,
	"promoted_version_id" text,
	"last_known_good_version_id" text,
	"failure_code" text,
	"failure_detail" text
);
--> statement-breakpoint
CREATE TABLE "civic_data_promotions" (
	"key" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"record_class" text NOT NULL,
	"scope" text NOT NULL,
	"current_version_id" text NOT NULL,
	"last_known_good_version_id" text NOT NULL,
	"promoted_at" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	"validation_receipt" jsonb NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "civic_data_candidate_events_sequence_idx" ON "civic_data_candidate_events" USING btree ("candidate_id","sequence");--> statement-breakpoint
CREATE INDEX "civic_data_candidates_projection_idx" ON "civic_data_candidates" USING btree ("record_class","scope","retrieved_at");--> statement-breakpoint
CREATE INDEX "civic_data_candidates_source_idx" ON "civic_data_candidates" USING btree ("source_id","retrieved_at");--> statement-breakpoint
CREATE UNIQUE INDEX "civic_data_promotions_record_scope_idx" ON "civic_data_promotions" USING btree ("record_class","scope");