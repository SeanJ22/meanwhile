CREATE TABLE "agenda_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"meeting_id" text NOT NULL,
	"ocd_id" text NOT NULL,
	"division_vintage" text NOT NULL,
	"document_url" text NOT NULL,
	"content_hash" text NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	"content_type" text NOT NULL,
	"text" text,
	"extraction" text NOT NULL,
	"extraction_note" text,
	"source_url" text NOT NULL,
	"source_org" text NOT NULL,
	"collected_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" text PRIMARY KEY NOT NULL,
	"ocd_id" text NOT NULL,
	"division_vintage" text NOT NULL,
	"body_name" text NOT NULL,
	"title" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"time_zone" text NOT NULL,
	"location_name" text NOT NULL,
	"location_address" text,
	"location_lat" double precision NOT NULL,
	"location_lng" double precision NOT NULL,
	"agenda_url" text,
	"jurisdiction" text NOT NULL,
	"status" text NOT NULL,
	"source_url" text,
	"source_org" text NOT NULL,
	"collected_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "search_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"event_type" text NOT NULL,
	"approximate_location" text,
	"ocd_ids" jsonb NOT NULL,
	"division_vintage" text NOT NULL,
	"detail" jsonb
);
--> statement-breakpoint
CREATE INDEX "agenda_documents_meeting_id_idx" ON "agenda_documents" USING btree ("meeting_id");--> statement-breakpoint
CREATE INDEX "meetings_ocd_id_idx" ON "meetings" USING btree ("ocd_id");--> statement-breakpoint
CREATE INDEX "meetings_starts_at_idx" ON "meetings" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "search_log_occurred_at_idx" ON "search_log" USING btree ("occurred_at");