CREATE TABLE count_hour (
  hour timestamptz NOT NULL,
  state text NOT NULL,
  family text NOT NULL,
  stage text NOT NULL,
  delta bigint NOT NULL DEFAULT 0,
  incoming bigint NOT NULL DEFAULT 0,
  outgoing bigint NOT NULL DEFAULT 0,
  changed bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (hour,state,family,stage)
);
--> statement-breakpoint
CREATE FUNCTION count_state(scope text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT upper(coalesce(
    substring(normalized FROM '(?:state:|district:|territory:|us-)([a-z]{2})(?:[^a-z]|$)'),
    substring(normalized FROM '^([a-z]{2})(?:[:/]|$)'), 'US'))
  FROM (SELECT replace(replace(replace(replace(lower(scope),'%2f','/'),'%3a',':'),'%23','#'),'%2d','-') AS normalized) decoded
$$;
--> statement-breakpoint
CREATE FUNCTION count_hour_add(place text, family_name text, step text, amount bigint,
  n_in bigint DEFAULT 0,n_out bigint DEFAULT 0,n_changed bigint DEFAULT 0) RETURNS void LANGUAGE sql AS $$
  INSERT INTO count_hour(hour,state,family,stage,delta,incoming,outgoing,changed)
  VALUES(date_trunc('hour',statement_timestamp()),count_state(place),coalesce(nullif(family_name,''),'Other facts'),step,amount,n_in,n_out,n_changed)
  ON CONFLICT(hour,state,family,stage) DO UPDATE SET
    delta=count_hour.delta+excluded.delta,incoming=count_hour.incoming+excluded.incoming,
    outgoing=count_hour.outgoing+excluded.outgoing,changed=count_hour.changed+excluded.changed
$$;
--> statement-breakpoint
CREATE TABLE line_keeper_run (
  hour timestamptz PRIMARY KEY,
  checked_at timestamptz NOT NULL,
  problems integer NOT NULL,
  bytes_read bigint NOT NULL,
  CHECK (problems >= 0 AND bytes_read >= 0)
);
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='readonly') THEN
    GRANT SELECT ON count_hour,line_keeper_run TO readonly;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='wtp_cp_release_readonly') THEN
    GRANT SELECT ON count_hour,line_keeper_run TO wtp_cp_release_readonly;
  END IF;
END $$;
-- RB-A8 shared schema ends here.
--> statement-breakpoint
CREATE FUNCTION count_fact_dimension(row_value jsonb, entity_value jsonb DEFAULT NULL) RETURNS TABLE(state text,family text,stage text) LANGUAGE sql STABLE AS $$
  SELECT coalesce(e.state,'US'),CASE
    WHEN row_value->>'field' LIKE 'campaign-money:%' THEN 'Campaign money'
    WHEN row_value->>'field' LIKE 'member:%' OR e.kind='person' THEN 'Officials and members'
    WHEN row_value->>'field' LIKE 'comment:%' THEN 'Taking part'
    WHEN e.kind='meeting' AND row_value->>'field'='agenda_url' THEN 'Agendas'
    WHEN e.kind='meeting' THEN 'Meetings'
    WHEN e.kind='body' THEN 'Government bodies'
    ELSE coalesce(e.kind,'Other facts') END,
    'fact:'||coalesce(row_value->>'status','unknown')
  FROM (SELECT CASE WHEN entity_value IS NULL THEN current_entity.state::text ELSE entity_value->>'state' END AS state,
    CASE WHEN entity_value IS NULL THEN current_entity.kind ELSE entity_value->>'kind' END AS kind
    FROM entity current_entity WHERE current_entity.id=row_value->>'entity_id') e
$$;
--> statement-breakpoint
CREATE FUNCTION count_fact_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE before_row record; after_row record;
BEGIN
  IF TG_OP <> 'INSERT' THEN SELECT * INTO before_row FROM count_fact_dimension(to_jsonb(OLD)); END IF;
  IF TG_OP <> 'DELETE' THEN SELECT * INTO after_row FROM count_fact_dimension(to_jsonb(NEW)); END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD IS NOT DISTINCT FROM NEW THEN RETURN NEW; END IF;
    IF (before_row.state,before_row.family,before_row.stage) IS NOT DISTINCT FROM
      (after_row.state,after_row.family,after_row.stage) THEN
      PERFORM count_hour_add(after_row.state,after_row.family,after_row.stage,0,0,0,1);
      RETURN NEW;
    END IF;
  END IF;
  IF TG_OP <> 'INSERT' THEN PERFORM count_hour_add(before_row.state,before_row.family,before_row.stage,-1,0,1); END IF;
  IF TG_OP <> 'DELETE' THEN PERFORM count_hour_add(after_row.state,after_row.family,after_row.stage,1,1,0); END IF;
  RETURN coalesce(NEW,OLD);
END $$;
--> statement-breakpoint
CREATE TRIGGER count_hour_fact AFTER INSERT OR UPDATE OR DELETE ON fact FOR EACH ROW EXECUTE FUNCTION count_fact_write();
--> statement-breakpoint
INSERT INTO count_hour(hour,state,family,stage,delta)
 SELECT date_trunc('hour',statement_timestamp()),count_state(d.state),d.family,d.stage,count(*)
 FROM fact f CROSS JOIN LATERAL count_fact_dimension(to_jsonb(f)) d GROUP BY 2,3,4;
--> statement-breakpoint
CREATE FUNCTION count_pointer_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM count_hour_add(OLD.scope,OLD.record_class,'published sets',-1,0,1);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM count_hour_add(NEW.scope,NEW.record_class,'published sets',1,1,0);
  END IF;
  RETURN coalesce(NEW,OLD);
END $$;
--> statement-breakpoint
CREATE TRIGGER count_hour_pointer AFTER INSERT OR UPDATE OR DELETE ON civic_data_promotions
 FOR EACH ROW EXECUTE FUNCTION count_pointer_write();
--> statement-breakpoint
INSERT INTO count_hour(hour,state,family,stage,delta)
 SELECT date_trunc('hour',statement_timestamp()),count_state(scope),record_class,'published sets',count(*)
 FROM civic_data_promotions GROUP BY 2,3;

--> statement-breakpoint
CREATE FUNCTION count_entity_move() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d record;
BEGIN
  FOR d IN SELECT dimension.state,dimension.family,dimension.stage,count(*)::bigint n FROM fact f
    CROSS JOIN LATERAL count_fact_dimension(to_jsonb(f),to_jsonb(OLD)) dimension
    WHERE f.entity_id=NEW.id GROUP BY 1,2,3 LOOP
    PERFORM count_hour_add(d.state,d.family,d.stage,-d.n);
  END LOOP;
  FOR d IN SELECT dimension.state,dimension.family,dimension.stage,count(*)::bigint n FROM fact f
    CROSS JOIN LATERAL count_fact_dimension(to_jsonb(f),to_jsonb(NEW)) dimension
    WHERE f.entity_id=NEW.id GROUP BY 1,2,3 LOOP
    PERFORM count_hour_add(d.state,d.family,d.stage,d.n);
  END LOOP;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER count_hour_entity AFTER UPDATE OF state,kind ON entity FOR EACH ROW
  WHEN ((OLD.state,OLD.kind) IS DISTINCT FROM (NEW.state,NEW.kind)) EXECUTE FUNCTION count_entity_move();
