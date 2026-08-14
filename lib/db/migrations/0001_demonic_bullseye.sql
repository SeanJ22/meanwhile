CREATE TABLE "reactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"reaction" text NOT NULL,
	"ocd_ids" jsonb NOT NULL,
	"division_vintage" text NOT NULL,
	"verification_tier" text NOT NULL,
	"reaction_key_hash" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "reactions_key_target_unq" ON "reactions" USING btree ("reaction_key_hash","target_type","target_id");--> statement-breakpoint
CREATE INDEX "reactions_target_idx" ON "reactions" USING btree ("target_type","target_id");