CREATE TABLE "civic_data_reader_projections" (
	"key" text PRIMARY KEY NOT NULL,
	"record_class" text NOT NULL,
	"scope" text NOT NULL,
	"sequence" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"composed_from" jsonb NOT NULL,
	"fact_sha256" text NOT NULL,
	"generated_at" text NOT NULL,
	"composed_at" timestamp with time zone NOT NULL,
	"source_through" text,
	"retrieved_at" text,
	"promoted_through" text,
	CONSTRAINT "civic_data_reader_projections_key_coherent" CHECK ("civic_data_reader_projections"."key" = "civic_data_reader_projections"."record_class" || ':' || "civic_data_reader_projections"."scope"),
	CONSTRAINT "civic_data_reader_projections_sequence_positive" CHECK ("civic_data_reader_projections"."sequence" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "civic_data_reader_projections_record_scope_idx" ON "civic_data_reader_projections" USING btree ("record_class","scope");