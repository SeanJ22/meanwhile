CREATE TABLE "reader_event_batches" (
  "batch_id" text PRIMARY KEY NOT NULL,
  "archive_key" text NOT NULL,
  "payload_sha256" text NOT NULL,
  "event_count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reader_event_members" (
  "period" text NOT NULL,
  "period_start" date NOT NULL,
  "zip" text NOT NULL,
  "district" text NOT NULL,
  "topic" text NOT NULL,
  "event_type" text NOT NULL,
  "reader_hash" text NOT NULL,
  PRIMARY KEY ("period", "period_start", "zip", "district", "topic", "event_type", "reader_hash")
);
--> statement-breakpoint
CREATE TABLE "reader_event_totals" (
  "period" text NOT NULL,
  "period_start" date NOT NULL,
  "zip" text NOT NULL,
  "district" text NOT NULL,
  "topic" text NOT NULL,
  "event_type" text NOT NULL,
  "events" bigint NOT NULL,
  "users" bigint NOT NULL,
  PRIMARY KEY ("period", "period_start", "zip", "district", "topic", "event_type")
);
--> statement-breakpoint
CREATE INDEX "reader_event_totals_period_idx" ON "reader_event_totals" ("period", "period_start");
