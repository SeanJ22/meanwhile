CREATE TABLE "intake_limiter" (
	"digest" text PRIMARY KEY NOT NULL,
	"day_bucket" text NOT NULL,
	"day_count" integer NOT NULL,
	"minute_bucket" text NOT NULL,
	"minute_count" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reactions" ADD COLUMN "suspect_reason" text;