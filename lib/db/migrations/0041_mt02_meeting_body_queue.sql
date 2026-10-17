CREATE TABLE "meeting_publication_queue" (
  "scope" text PRIMARY KEY NOT NULL,
  "queued_at" timestamptz NOT NULL DEFAULT clock_timestamp()
);
--> statement-breakpoint
CREATE FUNCTION queue_meeting_scope(queued text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO meeting_publication_queue (scope, queued_at) VALUES (queued, clock_timestamp())
  ON CONFLICT (scope) DO UPDATE SET queued_at = EXCLUDED.queued_at
$$;
--> statement-breakpoint
CREATE FUNCTION meeting_pointer_moved() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM queue_meeting_scope(NEW.scope);
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER meeting_pointer_created AFTER INSERT ON civic_data_promotions
  FOR EACH ROW WHEN (NEW.record_class = 'MEETING') EXECUTE FUNCTION meeting_pointer_moved();
--> statement-breakpoint
CREATE TRIGGER meeting_pointer_advanced AFTER UPDATE ON civic_data_promotions
  FOR EACH ROW WHEN (NEW.record_class = 'MEETING' AND OLD.current_version_id IS DISTINCT FROM NEW.current_version_id) EXECUTE FUNCTION meeting_pointer_moved();
--> statement-breakpoint
CREATE FUNCTION meeting_version_confirmed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE confirmed text;
BEGIN
  SELECT scope INTO confirmed FROM civic_data_candidates WHERE id = NEW.candidate_id AND record_class = 'MEETING';
  IF confirmed IS NOT NULL THEN PERFORM queue_meeting_scope(confirmed); END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER meeting_version_confirmed AFTER INSERT ON civic_data_candidate_events
  FOR EACH ROW WHEN (NEW.detail LIKE 'UNCHANGED_CONFIRMATION_V1 %') EXECUTE FUNCTION meeting_version_confirmed();
