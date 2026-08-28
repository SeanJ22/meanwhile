ALTER TABLE "ask_interactions" ADD COLUMN "evidence_record_refs" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ask_interactions" ADD COLUMN "evidence_source_urls" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ask_interactions" ADD COLUMN "evidence_source_orgs" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ask_interactions" ADD COLUMN "evidence_retrieved_from" text;--> statement-breakpoint
ALTER TABLE "ask_interactions" ADD COLUMN "evidence_retrieved_to" text;