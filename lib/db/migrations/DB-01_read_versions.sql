CREATE TABLE database_transfer_hourly (
  hour timestamptz NOT NULL,
  database_name text NOT NULL,
  requests bigint NOT NULL DEFAULT 0,
  request_bytes bigint NOT NULL DEFAULT 0,
  response_bytes bigint NOT NULL DEFAULT 0,
  reads jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (hour, database_name)
);
--> statement-breakpoint
CREATE TABLE civic_data_clock_versions (
  record_class text NOT NULL,
  scope text NOT NULL,
  version bigint NOT NULL,
  PRIMARY KEY (record_class, scope)
);
--> statement-breakpoint
CREATE FUNCTION civic_data_clock_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  changed_class text;
  changed_scope text;
BEGIN
  IF TG_TABLE_NAME = 'civic_data_candidate_events' THEN
    SELECT record_class, scope INTO changed_class, changed_scope FROM civic_data_candidates
      WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.candidate_id ELSE NEW.candidate_id END;
  ELSE
    IF TG_OP = 'UPDATE' AND (OLD.record_class, OLD.scope) IS DISTINCT FROM (NEW.record_class, NEW.scope) THEN
      INSERT INTO civic_data_clock_versions VALUES (OLD.record_class, OLD.scope, 1)
        ON CONFLICT (record_class, scope) DO UPDATE SET version = civic_data_clock_versions.version + 1;
    END IF;
    changed_class := CASE WHEN TG_OP = 'DELETE' THEN OLD.record_class ELSE NEW.record_class END;
    changed_scope := CASE WHEN TG_OP = 'DELETE' THEN OLD.scope ELSE NEW.scope END;
  END IF;
  IF changed_class IS NOT NULL THEN
    INSERT INTO civic_data_clock_versions VALUES (changed_class, changed_scope, 1)
      ON CONFLICT (record_class, scope) DO UPDATE SET version = civic_data_clock_versions.version + 1;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER civic_data_candidate_clock_changed AFTER INSERT OR UPDATE OR DELETE ON civic_data_candidates
  FOR EACH ROW EXECUTE FUNCTION civic_data_clock_changed();
--> statement-breakpoint
CREATE TRIGGER civic_data_event_clock_changed AFTER INSERT OR UPDATE OR DELETE ON civic_data_candidate_events
  FOR EACH ROW EXECUTE FUNCTION civic_data_clock_changed();
--> statement-breakpoint
CREATE TRIGGER civic_data_pointer_clock_changed AFTER INSERT OR UPDATE OR DELETE ON civic_data_promotions
  FOR EACH ROW EXECUTE FUNCTION civic_data_clock_changed();
--> statement-breakpoint
CREATE INDEX owner_flag_open_fact ON owner_flag (fact_id) WHERE resolved IS NULL;
--> statement-breakpoint
CREATE INDEX owner_flag_open_reader ON owner_flag (reader_family, reader_id) WHERE resolved IS NULL;
