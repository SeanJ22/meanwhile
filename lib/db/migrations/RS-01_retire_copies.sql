-- Readers now read canonical source partitions and live facts directly.
-- Source candidates, acquisitions, validation evidence and history remain intact.
DROP TRIGGER IF EXISTS meeting_pointer_created ON civic_data_promotions;
--> statement-breakpoint
DROP TRIGGER IF EXISTS meeting_pointer_advanced ON civic_data_promotions;
--> statement-breakpoint
DROP TRIGGER IF EXISTS meeting_version_confirmed ON civic_data_candidate_events;
--> statement-breakpoint
DROP FUNCTION IF EXISTS meeting_pointer_moved();
--> statement-breakpoint
DROP FUNCTION IF EXISTS meeting_version_confirmed();
--> statement-breakpoint
DROP FUNCTION IF EXISTS queue_meeting_scope(text);
--> statement-breakpoint
DROP TABLE IF EXISTS meeting_publication_queue;
--> statement-breakpoint
DROP TABLE IF EXISTS civic_data_reader_projections;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION fact_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'live' AND (TG_OP = 'INSERT' OR OLD.status <> 'live') THEN RETURN NULL; END IF;
  INSERT INTO fact_watermark (scope, version)
    SELECT scope, 1 FROM unnest(ARRAY[(SELECT state FROM entity WHERE id = NEW.entity_id), CASE WHEN NEW.field LIKE 'comment:%' THEN 'comment' END]) AS scope
    WHERE scope IS NOT NULL
    ON CONFLICT (scope) DO UPDATE SET version = fact_watermark.version + 1;
  RETURN NULL;
END $$;
--> statement-breakpoint
DROP TABLE IF EXISTS rebuild_queue;
--> statement-breakpoint
-- This transaction removes only obsolete projections, retaining the ordinary
-- prohibition on deleting canonical civic source pointers.
ALTER TABLE civic_data_promotions DISABLE TRIGGER civic_data_promotions_no_delete_or_rewrite;
--> statement-breakpoint
DELETE FROM civic_data_promotions
WHERE record_class='MEETING' AND (scope='supported-bodies'
  OR scope ~ '^US-[A-Z]{2}:meetings-(index|family)$'
  OR scope ~ '^US-[A-Z]{2}:meetings-body:');
--> statement-breakpoint
ALTER TABLE civic_data_promotions ENABLE TRIGGER civic_data_promotions_no_delete_or_rewrite;
--> statement-breakpoint
DELETE FROM pass_cursor WHERE name IN ('reader-edge','reader-edge:pieces','reader-edge:owed') OR name LIKE 'state-facts:%';
