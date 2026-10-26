ALTER TABLE database_transfer_daily ADD COLUMN IF NOT EXISTS processes jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
ALTER TABLE database_transfer_hourly ADD COLUMN IF NOT EXISTS processes jsonb NOT NULL DEFAULT '{}'::jsonb;
