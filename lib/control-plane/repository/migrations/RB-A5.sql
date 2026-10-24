ALTER TABLE work_row
  ADD COLUMN status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','taken','done','refused')),
  ADD COLUMN reports jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(reports)='array'),
  ADD COLUMN field text,
  ADD COLUMN value jsonb NOT NULL DEFAULT 'null'::jsonb,
  ADD COLUMN quote text,
  ADD COLUMN content_version integer NOT NULL DEFAULT 1,
  ADD COLUMN lease_version integer,
  ADD COLUMN received_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN done_at timestamptz,
  ADD COLUMN refused_at timestamptz;
--> statement-breakpoint
UPDATE work_row SET status = CASE WHEN lease_until IS NOT NULL THEN 'taken' WHEN refusal IS NOT NULL THEN 'refused' ELSE 'ready' END;
--> statement-breakpoint
DROP INDEX work_row_ready;
--> statement-breakpoint

CREATE INDEX work_row_claim_ready ON work_row (kind, priority DESC, not_before, id) WHERE status = 'ready';
--> statement-breakpoint
CREATE INDEX work_row_expired ON work_row (lease_until, id) WHERE status = 'taken';
--> statement-breakpoint

CREATE FUNCTION count_work_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event text;
BEGIN
  IF TG_OP = 'INSERT' THEN event := 'work_in';
  ELSIF NEW.status = 'done' AND OLD.status <> 'done' THEN event := 'work_done';
  ELSIF NEW.status = 'refused' AND OLD.status <> 'refused' THEN event := 'work_refused';
  ELSE RETURN NEW;
  END IF;
  INSERT INTO count_hour(state, hour, step, n)
    VALUES(NEW.state, date_trunc('hour', CASE event WHEN 'work_in' THEN NEW.received_at WHEN 'work_done' THEN NEW.done_at ELSE NEW.refused_at END), event, 1)
    ON CONFLICT (state, hour, step) DO UPDATE SET n = count_hour.n + 1;
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE TRIGGER work_row_counts AFTER INSERT OR UPDATE ON work_row
FOR EACH ROW EXECUTE FUNCTION count_work_transition();
--> statement-breakpoint
INSERT INTO count_hour(state,hour,step,n)
SELECT state,date_trunc('hour',received_at),'work_in',count(*) FROM work_row GROUP BY 1,2
ON CONFLICT(state,hour,step) DO UPDATE SET n=count_hour.n+EXCLUDED.n;
