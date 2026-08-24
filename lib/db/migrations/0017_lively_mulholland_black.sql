CREATE TABLE "feedback_contact" (
	"contact_ref" text PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "contact_ref" text;--> statement-breakpoint
CREATE INDEX "feedback_contact_received_at_idx" ON "feedback_contact" USING btree ("received_at");--> statement-breakpoint
-- A-001 · BACKFILL. Hand-added to a generated migration, deliberately.
--
-- drizzle-kit writes schema changes and cannot write a data move. Every row
-- that already carries a reply address gets a RANDOM handle and its address is
-- filed in the delivery store under that handle. `gen_random_uuid()` rather
-- than a digest of the address, for the reason the schema note gives: a
-- deterministic hash on both sides is the same join key relocated.
--
-- Idempotent by construction — it only touches rows whose handle is still
-- null — so re-running the migration on a partially-applied database cannot
-- mint a second handle for the same row.
UPDATE "feedback"
   SET "contact_ref" = gen_random_uuid()::text
 WHERE "reply_to" IS NOT NULL
   AND "reply_to" <> ''
   AND "contact_ref" IS NULL;--> statement-breakpoint
INSERT INTO "feedback_contact" ("contact_ref", "address", "received_at")
SELECT "contact_ref", "reply_to", "received_at"
  FROM "feedback"
 WHERE "contact_ref" IS NOT NULL
   AND "reply_to" IS NOT NULL
   AND "reply_to" <> ''
ON CONFLICT ("contact_ref") DO NOTHING;
