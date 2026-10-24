CREATE TABLE IF NOT EXISTS count_hour (
  state char(2) NOT NULL,
  hour timestamptz NOT NULL,
  step text NOT NULL,
  n bigint NOT NULL DEFAULT 0 CHECK (n>=0),
  PRIMARY KEY (state,hour,step)
);
--> statement-breakpoint
CREATE FUNCTION count_state(scope text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN candidate=ANY(ARRAY['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','PR','VI','AS','GU','MP','US']) THEN candidate ELSE 'US' END
  FROM (SELECT upper(coalesce(
    substring(normalized FROM '(?:state:|district:|territory:|us-)([a-z]{2})(?:[^a-z]|$)'),
    substring(normalized FROM '^([a-z]{2})(?:[:/]|$)'), 'US')) AS candidate
  FROM (SELECT replace(replace(replace(replace(lower(scope),'%2f','/'),'%3a',':'),'%23','#'),'%2d','-') AS normalized) decoded) located
$$;
--> statement-breakpoint
CREATE FUNCTION count_hour_at(place text,family_name text,stage text,effective_at timestamptz,amount bigint,
  n_in bigint DEFAULT 0,n_out bigint DEFAULT 0,n_changed bigint DEFAULT 0) RETURNS void LANGUAGE sql AS $$
  INSERT INTO count_hour(state,hour,step,n)
  SELECT count_state(place),effective_at,'v1:'||jsonb_build_array(coalesce(nullif(family_name,''),'Other facts'),stage,metric)::text,value
  FROM (VALUES ('stock in',greatest(amount,0)),('stock out',greatest(-amount,0)),('in',n_in),('out',n_out),('changed',n_changed)) metrics(metric,value)
  WHERE value>0
  ON CONFLICT(state,hour,step) DO UPDATE SET n=count_hour.n+excluded.n
$$;
--> statement-breakpoint
CREATE FUNCTION count_hour_add(place text,family_name text,stage text,amount bigint,
  n_in bigint DEFAULT 0,n_out bigint DEFAULT 0,n_changed bigint DEFAULT 0) RETURNS void LANGUAGE sql AS $$
  SELECT count_hour_at(place,family_name,stage,date_trunc('hour',statement_timestamp()),amount,n_in,n_out,n_changed)
$$;
--> statement-breakpoint
CREATE TABLE line_keeper_run (
  hour timestamptz PRIMARY KEY,
  checked_at timestamptz NOT NULL,
  problems integer NOT NULL,
  bytes_read bigint NOT NULL,
  oldest jsonb NOT NULL DEFAULT '{}'::jsonb,
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
INSERT INTO count_hour(state,hour,step,n)
 SELECT count_state(d.state),date_trunc('hour',statement_timestamp()),'v1:'||jsonb_build_array(d.family,d.stage,'stock in')::text,count(*)
 FROM fact f CROSS JOIN LATERAL count_fact_dimension(to_jsonb(f)) d GROUP BY 1,3;
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
INSERT INTO count_hour(state,hour,step,n)
 SELECT count_state(scope),date_trunc('hour',statement_timestamp()),'v1:'||jsonb_build_array(record_class,'published sets','stock in')::text,count(*)
 FROM civic_data_promotions GROUP BY 1,3;

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
--> statement-breakpoint
CREATE FUNCTION count_subject_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF OLD IS NOT DISTINCT FROM NEW THEN RETURN NEW; END IF;
    IF (OLD.state,OLD.kind) IS NOT DISTINCT FROM (NEW.state,NEW.kind) THEN
      PERFORM count_hour_add(NEW.state,NEW.kind,'subjects',0,0,0,1);
      RETURN NEW;
    END IF;
  END IF;
  IF TG_OP<>'INSERT' THEN PERFORM count_hour_add(OLD.state,OLD.kind,'subjects',-1,0,1); END IF;
  IF TG_OP<>'DELETE' THEN PERFORM count_hour_add(NEW.state,NEW.kind,'subjects',1,1,0); END IF;
  RETURN coalesce(NEW,OLD);
END $$;
--> statement-breakpoint
CREATE TRIGGER count_hour_subject AFTER INSERT OR UPDATE OR DELETE ON entity
 FOR EACH ROW EXECUTE FUNCTION count_subject_write();
--> statement-breakpoint
INSERT INTO count_hour(state,hour,step,n)
 SELECT count_state(state),date_trunc('hour',statement_timestamp()),'v1:'||jsonb_build_array(kind,'subjects','stock in')::text,count(*)
 FROM entity GROUP BY 1,3;
