ALTER TABLE work_row
  ADD COLUMN field text,
  ADD COLUMN value jsonb NOT NULL DEFAULT 'null'::jsonb,
  ADD COLUMN quote text,
  ADD COLUMN content_version integer NOT NULL DEFAULT 1,
  ADD COLUMN lease_version integer,
  ADD COLUMN received_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN done_at timestamptz,
  ADD COLUMN refused_at timestamptz;
--> statement-breakpoint

CREATE INDEX work_row_claim_ready ON work_row (kind, priority DESC, not_before, id) WHERE state = 'ready';
--> statement-breakpoint
CREATE INDEX work_row_expired ON work_row (lease_until, id) WHERE state = 'taken';
--> statement-breakpoint

CREATE FUNCTION count_work_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE region text; event text;
BEGIN
  region := cp_control_state(jsonb_build_object('subjectId', coalesce(NEW.place_id, NEW.subject_id)));
  IF TG_OP = 'INSERT' THEN event := 'work_in';
  ELSIF NEW.state = 'done' AND OLD.state <> 'done' THEN event := 'work_done';
  ELSIF NEW.state = 'refused' AND OLD.state <> 'refused' THEN event := 'work_refused';
  ELSE RETURN NEW;
  END IF;
  INSERT INTO count_hour(state, hour, step, n)
    VALUES(region, date_trunc('hour', CASE event WHEN 'work_in' THEN NEW.received_at WHEN 'work_done' THEN NEW.done_at ELSE NEW.refused_at END), event, 1)
    ON CONFLICT (state, hour, step) DO UPDATE SET n = count_hour.n + 1;
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE TRIGGER work_row_counts AFTER INSERT OR UPDATE ON work_row
FOR EACH ROW EXECUTE FUNCTION count_work_transition();
