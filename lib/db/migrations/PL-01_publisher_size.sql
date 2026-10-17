CREATE TABLE "publisher_size" (
  "state" char(2) NOT NULL,
  "dataset" text NOT NULL,
  "source_row" integer NOT NULL,
  "host" text NOT NULL,
  "release" text NOT NULL,
  "holding" jsonb NOT NULL,
  PRIMARY KEY ("state", "dataset", "source_row")
);
--> statement-breakpoint
CREATE INDEX "publisher_size_host_idx" ON "publisher_size" ("state", "host");
