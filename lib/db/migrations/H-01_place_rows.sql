CREATE TABLE "civic_data_place_rows" (
  "record_class" text NOT NULL,
  "scope" text NOT NULL,
  "collection" text NOT NULL,
  "group_key" text NOT NULL,
  "version_id" text NOT NULL,
  "keys" text[] NOT NULL,
  "digest" text NOT NULL,
  "members" jsonb NOT NULL,
  PRIMARY KEY ("record_class", "scope", "collection", "group_key")
);
--> statement-breakpoint
CREATE INDEX "civic_data_place_rows_keys" ON "civic_data_place_rows" USING gin ("keys");
--> statement-breakpoint
CREATE TABLE "civic_data_place_changes" (
  "record_class" text NOT NULL,
  "scope" text NOT NULL,
  "division_id" text NOT NULL,
  "digest" text NOT NULL,
  "changed_at" timestamptz NOT NULL,
  PRIMARY KEY ("record_class", "scope", "division_id")
);
--> statement-breakpoint
CREATE INDEX "civic_data_place_changes_changed_at" ON "civic_data_place_changes" ("changed_at");
