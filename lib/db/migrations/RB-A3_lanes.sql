-- One fact-table hook records stock and publications through each door lane.
CREATE OR REPLACE FUNCTION count_fact_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE before_row record; after_row record; publication_lane text;
BEGIN
  IF TG_OP='INSERT' THEN
    publication_lane := current_setting('meanwhile.fact_lane',true);
    PERFORM set_config('meanwhile.fact_lane','',true);
  END IF;
  IF TG_OP <> 'INSERT' THEN SELECT * INTO before_row FROM count_fact_dimension(to_jsonb(OLD)); END IF;
  IF TG_OP <> 'DELETE' THEN SELECT * INTO after_row FROM count_fact_dimension(to_jsonb(NEW)); END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD IS NOT DISTINCT FROM NEW THEN RETURN NEW; END IF;
    IF (before_row.state,before_row.family,before_row.stage) IS NOT DISTINCT FROM
      (after_row.state,after_row.family,after_row.stage) THEN
      IF (to_jsonb(OLD)->'value',OLD.entity_id,OLD.field) IS DISTINCT FROM (to_jsonb(NEW)->'value',NEW.entity_id,NEW.field) THEN
        PERFORM count_hour_add(after_row.state,after_row.family,after_row.stage,0,0,0,1);
      END IF;
      RETURN NEW;
    END IF;
  END IF;
  IF TG_OP <> 'INSERT' THEN PERFORM count_hour_add(before_row.state,before_row.family,before_row.stage,-1,0,1); END IF;
  IF TG_OP <> 'DELETE' THEN PERFORM count_hour_add(after_row.state,after_row.family,after_row.stage,1,1,0); END IF;
  IF TG_OP='INSERT' AND NEW.status='live' AND publication_lane IN ('official','checked') THEN
    PERFORM count_hour_add(after_row.state,after_row.family,'publication:'||publication_lane,1,1,0);
  END IF;
  RETURN coalesce(NEW,OLD);
END $$;
--> statement-breakpoint
INSERT INTO count_hour(state,hour,step,n) VALUES('US',statement_timestamp(),'publication start',0);
