ALTER TABLE owner_flag ALTER COLUMN fact_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE owner_flag ADD COLUMN reader_family text;
--> statement-breakpoint
ALTER TABLE owner_flag ADD COLUMN reader_id text;
--> statement-breakpoint
ALTER TABLE owner_flag ADD COLUMN observed_value jsonb;
--> statement-breakpoint
ALTER TABLE owner_flag ADD COLUMN reason text;
--> statement-breakpoint
ALTER TABLE owner_flag ADD COLUMN source_url text;
--> statement-breakpoint
ALTER TABLE owner_flag ADD COLUMN resolved_at timestamptz;
--> statement-breakpoint
ALTER TABLE owner_flag ADD COLUMN owner_values jsonb;
--> statement-breakpoint
ALTER TABLE owner_flag ADD COLUMN owner_source_url text;
--> statement-breakpoint
CREATE INDEX owner_flag_open ON owner_flag (id) WHERE resolved IS NULL;
--> statement-breakpoint
CREATE INDEX owner_flag_reader ON owner_flag (reader_family, reader_id, resolved_at DESC) WHERE resolved IS NOT NULL;
