CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"message" text NOT NULL,
	"surface" text NOT NULL,
	"run_class" text DEFAULT 'ORGANIC' NOT NULL,
	"run_id" text,
	"suspect_reason" text
);
--> statement-breakpoint
CREATE INDEX "feedback_received_at_idx" ON "feedback" USING btree ("received_at");