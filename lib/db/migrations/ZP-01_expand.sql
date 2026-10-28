ALTER TABLE entity ADD COLUMN page_priority integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE rebuild_queue ADD COLUMN priority integer NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE INDEX rebuild_queue_priority_ready ON rebuild_queue(priority DESC,queued_at,place_id);
