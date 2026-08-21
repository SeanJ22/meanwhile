CREATE TABLE "write_alarm" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"raised_at" timestamp with time zone NOT NULL,
	"store" text NOT NULL,
	"error_code" text,
	"error_message" text,
	CONSTRAINT "write_alarm_store_known" CHECK ("write_alarm"."store" IN ('search_log', 'reactions'))
);
--> statement-breakpoint
CREATE INDEX "write_alarm_raised_at_idx" ON "write_alarm" USING btree ("raised_at");