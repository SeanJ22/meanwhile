CREATE INDEX rb_a7_bootstrap_zip_dependency ON place_page_dependency(entity_id,page_id) WHERE page_id LIKE 'zip:%';
--> statement-breakpoint
CREATE INDEX rb_a7_bootstrap_host_lookup ON entity_host(host,entity_id);
--> statement-breakpoint
CREATE FUNCTION rb_a7_bootstrap_queue_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- The preceding publisher inserts several unordered ancestor places. A single
  -- temporary mutex also covers two first inserts before either row exists.
  PERFORM pg_advisory_xact_lock(hashtextextended('rb-a7-bootstrap-queue',0));
  UPDATE rebuild_queue SET generation=generation+1 WHERE place_id=NEW.place_id;
  IF FOUND THEN RETURN NULL; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION rb_a7_bootstrap_queue_dependents() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- A local door queues its state and country ancestors too. Those ancestors
  -- must not turn every local fact into a rebuild of the entire country.
  IF NEW.place_id LIKE 'zip:%' OR NEW.place_id ~ '^ocd-division/country:us(/(state|territory|district):[a-z]{2})?$' THEN RETURN NEW; END IF;
  INSERT INTO rebuild_queue(place_id,queued_at)
    SELECT d.page_id,clock_timestamp() FROM place_page_dependency d
    WHERE d.entity_id=NEW.place_id AND d.page_id LIKE 'zip:%'
    ORDER BY d.page_id
    ON CONFLICT(place_id) DO UPDATE SET generation=rebuild_queue.generation+1;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER rb_a7_bootstrap_queue_before BEFORE INSERT ON rebuild_queue
  FOR EACH ROW EXECUTE FUNCTION rb_a7_bootstrap_queue_insert();
--> statement-breakpoint
CREATE TRIGGER rb_a7_bootstrap_queue_inserted AFTER INSERT ON rebuild_queue
  FOR EACH ROW EXECUTE FUNCTION rb_a7_bootstrap_queue_dependents();
--> statement-breakpoint
CREATE TRIGGER rb_a7_bootstrap_queue_updated AFTER UPDATE OF generation ON rebuild_queue
  FOR EACH ROW EXECUTE FUNCTION rb_a7_bootstrap_queue_dependents();
--> statement-breakpoint
CREATE FUNCTION rb_a7_bootstrap_publication(family text,publication_scope text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE state_code text; body_id text; all_places boolean:=false;
BEGIN
  IF family NOT IN ('REGISTRATION','REGISTRY_RUNTIME_BINDING','MEETING','DOTGOV_REFERENCE')
    AND NOT (family='CURATED_READER_RECORD' AND publication_scope='US-AZ+US-NH+US-NJ:everyday-service-routing:v1') THEN RETURN; END IF;
  -- Both these projections are read through a single shared pointer by every page.
  all_places:=family='DOTGOV_REFERENCE' OR family='CURATED_READER_RECORD';
  state_code:=count_state(publication_scope);
  IF NOT all_places AND state_code='US' AND family='MEETING' THEN
    body_id:=split_part(publication_scope,':',4);
    body_id:=replace(replace(replace(replace(replace(replace(body_id,'%2F','/'),'%2f','/'),'%3A',':'),'%3a',':'),'%23','#'),'%20',' ');
    SELECT e.state INTO state_code FROM entity e WHERE e.id=body_id
      OR e.id=(SELECT entity_id FROM entity_external_id WHERE scheme='body-alias' AND value=body_id)
      ORDER BY (e.id=body_id) DESC LIMIT 1;
    state_code:=coalesce(state_code,count_state(body_id));
  END IF;
  all_places:=all_places OR state_code='US';
  -- Include pending pages: a version arriving during its first snapshot must
  -- move that request's generation even before place_page has its first row.
  INSERT INTO rebuild_queue(place_id,queued_at)
    SELECT e.id,clock_timestamp() FROM entity e
    WHERE e.kind IN ('place','body') AND (all_places OR e.state=state_code)
    ORDER BY e.id
    ON CONFLICT(place_id) DO UPDATE SET generation=rebuild_queue.generation+1;
END $$;
--> statement-breakpoint
CREATE FUNCTION rb_a7_bootstrap_pointer_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND (OLD.record_class,OLD.scope,OLD.current_version_id,OLD.payload)
    IS NOT DISTINCT FROM (NEW.record_class,NEW.scope,NEW.current_version_id,NEW.payload) THEN RETURN NEW; END IF;
  IF TG_OP='DELETE' OR TG_OP='UPDATE' AND (OLD.record_class,OLD.scope) IS DISTINCT FROM (NEW.record_class,NEW.scope) THEN
    PERFORM rb_a7_bootstrap_publication(OLD.record_class,OLD.scope);
  END IF;
  IF TG_OP<>'DELETE' THEN PERFORM rb_a7_bootstrap_publication(NEW.record_class,NEW.scope); END IF;
  RETURN coalesce(NEW,OLD);
END $$;
--> statement-breakpoint
CREATE TRIGGER rb_a7_bootstrap_pointer AFTER INSERT OR UPDATE OR DELETE ON civic_data_promotions
  FOR EACH ROW EXECUTE FUNCTION rb_a7_bootstrap_pointer_changed();
--> statement-breakpoint
CREATE FUNCTION rb_a7_bootstrap_confirmed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE publication record;
BEGIN
  IF left(NEW.detail,26)<>'UNCHANGED_CONFIRMATION_V1 ' THEN RETURN NEW; END IF;
  FOR publication IN SELECT record_class,scope FROM civic_data_promotions WHERE current_version_id=NEW.candidate_id LOOP
    PERFORM rb_a7_bootstrap_publication(publication.record_class,publication.scope);
  END LOOP;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER rb_a7_bootstrap_confirmation AFTER INSERT ON civic_data_candidate_events
  FOR EACH ROW EXECUTE FUNCTION rb_a7_bootstrap_confirmed();
--> statement-breakpoint
CREATE FUNCTION rb_a7_bootstrap_subject(subject_id text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  WITH RECURSIVE seeds AS (
    SELECT subject_id AS id
    UNION SELECT entity_id FROM fact WHERE status='live' AND field LIKE 'member:%' AND field='member:'||subject_id
    UNION SELECT other.entity_id FROM entity_host own JOIN entity_host other ON other.host=own.host
      JOIN entity source ON source.id=own.entity_id JOIN entity target ON target.id=other.entity_id
      WHERE own.entity_id=subject_id AND source.state IS NOT DISTINCT FROM target.state
  ), ancestors AS (
    SELECT e.id,e.kind,e.parent_id,ARRAY[e.id] AS path FROM entity e JOIN seeds s ON s.id=e.id
    UNION ALL SELECT e.id,e.kind,e.parent_id,a.path||e.id FROM entity e JOIN ancestors a ON e.id=a.parent_id
      WHERE NOT e.id=ANY(a.path)
  ), targets AS (
    SELECT id FROM ancestors WHERE kind IN ('place','body')
    UNION SELECT ep.place_id FROM entity_place ep JOIN ancestors a ON a.id=ep.entity_id
    UNION SELECT d.page_id FROM place_page_dependency d JOIN ancestors a ON a.id=d.entity_id
      WHERE a.id !~ '^ocd-division/country:us(/(state|territory|district):[a-z]{2})?$'
  ) INSERT INTO rebuild_queue(place_id,queued_at)
    SELECT e.id,clock_timestamp() FROM targets t JOIN entity e ON e.id=t.id WHERE e.kind IN ('place','body')
    ORDER BY e.id ON CONFLICT(place_id) DO UPDATE SET generation=rebuild_queue.generation+1;
END $$;
--> statement-breakpoint
CREATE FUNCTION rb_a7_bootstrap_fact_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND (OLD.entity_id,OLD.field,OLD.value,OLD.value_text,OLD.status,OLD.source_copy_id,
    OLD.second_copy_id,OLD.quote,OLD.checked_at,OLD.provenance_kind) IS NOT DISTINCT FROM
    (NEW.entity_id,NEW.field,NEW.value,NEW.value_text,NEW.status,NEW.source_copy_id,
    NEW.second_copy_id,NEW.quote,NEW.checked_at,NEW.provenance_kind) THEN RETURN NEW; END IF;
  IF TG_OP<>'INSERT' AND OLD.status='live' THEN PERFORM rb_a7_bootstrap_subject(OLD.entity_id); END IF;
  IF TG_OP<>'DELETE' AND NEW.status='live' AND (TG_OP='INSERT' OR OLD.status<>'live' OR OLD.entity_id<>NEW.entity_id) THEN
    PERFORM rb_a7_bootstrap_subject(NEW.entity_id);
  END IF;
  RETURN coalesce(NEW,OLD);
END $$;
--> statement-breakpoint
CREATE TRIGGER rb_a7_bootstrap_fact AFTER INSERT OR UPDATE OR DELETE ON fact
  FOR EACH ROW EXECUTE FUNCTION rb_a7_bootstrap_fact_changed();
--> statement-breakpoint
CREATE FUNCTION rb_a7_bootstrap_entity_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE held jsonb; subject_id text;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF TG_TABLE_NAME='entity' THEN
      IF (OLD.name,OLD.kind,OLD.parent_id,OLD.state) IS NOT DISTINCT FROM (NEW.name,NEW.kind,NEW.parent_id,NEW.state) THEN RETURN NEW; END IF;
    ELSIF to_jsonb(OLD) IS NOT DISTINCT FROM to_jsonb(NEW) THEN RETURN NEW;
    END IF;
  END IF;
  held:=CASE WHEN TG_WHEN='BEFORE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  IF TG_TABLE_NAME='entity' THEN
    IF held->>'kind' NOT IN ('place','body','government') OR held->>'id' LIKE 'zip:%' THEN RETURN coalesce(NEW,OLD); END IF;
    subject_id:=held->>'id';
  ELSE subject_id:=held->>'entity_id';
  END IF;
  PERFORM rb_a7_bootstrap_subject(subject_id);
  IF TG_TABLE_NAME='entity_place' THEN PERFORM rb_a7_bootstrap_subject(held->>'place_id'); END IF;
  IF TG_TABLE_NAME='entity' AND TG_OP='DELETE' THEN
    DELETE FROM rebuild_queue WHERE place_id=subject_id;
  END IF;
  RETURN coalesce(NEW,OLD);
END $$;
--> statement-breakpoint
CREATE TRIGGER rb_a7_bootstrap_entity_before BEFORE UPDATE OR DELETE ON entity
  FOR EACH ROW EXECUTE FUNCTION rb_a7_bootstrap_entity_changed();
--> statement-breakpoint
CREATE TRIGGER rb_a7_bootstrap_entity_after AFTER INSERT OR UPDATE ON entity
  FOR EACH ROW EXECUTE FUNCTION rb_a7_bootstrap_entity_changed();
--> statement-breakpoint
CREATE TRIGGER rb_a7_bootstrap_place_before BEFORE UPDATE OR DELETE ON entity_place
  FOR EACH ROW EXECUTE FUNCTION rb_a7_bootstrap_entity_changed();
--> statement-breakpoint
CREATE TRIGGER rb_a7_bootstrap_place_after AFTER INSERT OR UPDATE ON entity_place
  FOR EACH ROW EXECUTE FUNCTION rb_a7_bootstrap_entity_changed();
--> statement-breakpoint
CREATE TRIGGER rb_a7_bootstrap_host_before BEFORE UPDATE OR DELETE ON entity_host
  FOR EACH ROW EXECUTE FUNCTION rb_a7_bootstrap_entity_changed();
--> statement-breakpoint
CREATE TRIGGER rb_a7_bootstrap_host_after AFTER INSERT OR UPDATE ON entity_host
  FOR EACH ROW EXECUTE FUNCTION rb_a7_bootstrap_entity_changed();
--> statement-breakpoint
CREATE TRIGGER rb_a7_bootstrap_alias_before BEFORE UPDATE OR DELETE ON entity_external_id
  FOR EACH ROW EXECUTE FUNCTION rb_a7_bootstrap_entity_changed();
--> statement-breakpoint
CREATE TRIGGER rb_a7_bootstrap_alias_after AFTER INSERT OR UPDATE ON entity_external_id
  FOR EACH ROW EXECUTE FUNCTION rb_a7_bootstrap_entity_changed();
