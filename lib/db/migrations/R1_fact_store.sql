CREATE TABLE "entity" (
  "id" text PRIMARY KEY NOT NULL,
  "kind" text NOT NULL CHECK ("kind" IN ('place','government','body','seat','person','meeting','agenda_item','bill','vote_event','election','contest','candidacy','measure','committee','statement','law_question','news_item')),
  "name" text NOT NULL,
  "state" char(2),
  "parent_id" text REFERENCES "entity"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "entity_parent_idx" ON "entity" ("parent_id");
--> statement-breakpoint
CREATE INDEX "entity_state_kind_idx" ON "entity" ("state", "kind");
--> statement-breakpoint
CREATE TABLE "entity_host" (
  "entity_id" text NOT NULL REFERENCES "entity"("id"),
  "host" text NOT NULL,
  "proved_by" bigint,
  PRIMARY KEY ("entity_id", "host")
);
--> statement-breakpoint
CREATE TABLE "entity_external_id" (
  "entity_id" text NOT NULL REFERENCES "entity"("id"),
  "scheme" text NOT NULL,
  "value" text NOT NULL,
  PRIMARY KEY ("scheme", "value")
);
--> statement-breakpoint
CREATE INDEX "entity_external_id_entity_idx" ON "entity_external_id" ("entity_id");
--> statement-breakpoint
CREATE TABLE "entity_place" (
  "entity_id" text NOT NULL REFERENCES "entity"("id"),
  "place_id" text NOT NULL REFERENCES "entity"("id"),
  PRIMARY KEY ("entity_id", "place_id")
);
--> statement-breakpoint
CREATE INDEX "entity_place_place_idx" ON "entity_place" ("place_id");
--> statement-breakpoint
CREATE TABLE "source_copy" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "url" text NOT NULL,
  "final_url" text NOT NULL,
  "fetched_at" timestamptz NOT NULL,
  "page_date" date,
  "http_status" integer,
  "sha256" char(64) NOT NULL,
  "blob_key" text NOT NULL,
  "text_key" text,
  "etag" text,
  "last_modified" text,
  "is_archive" boolean NOT NULL DEFAULT false,
  UNIQUE ("blob_key")
);
--> statement-breakpoint
CREATE INDEX "source_copy_url" ON "source_copy" ("url", "fetched_at" DESC);
--> statement-breakpoint
CREATE TABLE "fact" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "entity_id" text NOT NULL REFERENCES "entity"("id"),
  "field" text NOT NULL,
  "value" jsonb NOT NULL,
  "value_text" text NOT NULL,
  "status" text NOT NULL CHECK ("status" IN ('live','held','superseded','pulled')),
  "provenance_kind" text NOT NULL CHECK ("provenance_kind" IN ('OWNER','OFFICIAL','FILING','CAMPAIGN','REFERENCE','NEWS','OTHER')),
  "source_copy_id" bigint REFERENCES "source_copy"("id"),
  "quote" text NOT NULL,
  "quote_start" integer,
  "second_copy_id" bigint REFERENCES "source_copy"("id"),
  "checked_at" timestamptz NOT NULL,
  "live_at" timestamptz,
  "held_reason" text,
  "produced_by" text NOT NULL,
  "cost_usd" numeric(10,4) NOT NULL DEFAULT 0,
  CHECK ("source_copy_id" IS NOT NULL OR "provenance_kind" = 'OWNER')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "fact_one_live" ON "fact" ("entity_id", "field") WHERE "status" = 'live';
--> statement-breakpoint
CREATE INDEX "fact_entity_field_idx" ON "fact" ("entity_id", "field");
--> statement-breakpoint
CREATE INDEX "fact_live_at" ON "fact" ("live_at") WHERE "live_at" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "fact_checked" ON "fact" ("checked_at") WHERE "status" = 'live';
--> statement-breakpoint
CREATE TABLE "blank" (
  "entity_id" text NOT NULL REFERENCES "entity"("id"),
  "field" text NOT NULL,
  "stage" text NOT NULL CHECK ("stage" IN ('ACQUIRE','READ','CHECK','DECIDE','PUBLISH')),
  "reason" text NOT NULL,
  "detail" text,
  "opened_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "next_try_at" timestamptz NOT NULL DEFAULT now(),
  "attempts" integer NOT NULL DEFAULT 0,
  "reader_requests" integer NOT NULL DEFAULT 0,
  "unlock" text,
  PRIMARY KEY ("entity_id", "field")
);
--> statement-breakpoint
CREATE INDEX "blank_due" ON "blank" ("next_try_at");
--> statement-breakpoint
CREATE TABLE "owner_flag" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "fact_id" bigint NOT NULL REFERENCES "fact"("id"),
  "kind" text NOT NULL CHECK ("kind" IN ('OWNER_VALUE_CONTESTED','AUDIT_LOOKS_WRONG')),
  "opened_at" timestamptz NOT NULL DEFAULT now(),
  "resolved" text CHECK ("resolved" IN ('REMOVE','KEEP','SEND_FLEET','TYPED_VALUE'))
);
--> statement-breakpoint
CREATE TABLE "rebuild_queue" (
  "place_id" text PRIMARY KEY NOT NULL,
  "queued_at" timestamptz NOT NULL DEFAULT now()
);
