DELETE FROM place_page WHERE place_id LIKE 'zip:%';
--> statement-breakpoint
DROP TABLE rebuild_queue;
--> statement-breakpoint
DROP TABLE place_page_dependency;
--> statement-breakpoint
ALTER TABLE place_page DROP COLUMN body, DROP COLUMN history_body, DROP COLUMN build_fingerprint;
