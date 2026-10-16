CREATE SEQUENCE reader_fact_revision;
--> statement-breakpoint
CREATE TABLE reader_fact_state_versions (
  state text NOT NULL,
  family text NOT NULL,
  revision bigint NOT NULL DEFAULT nextval('reader_fact_revision'),
  PRIMARY KEY(state,family)
);
--> statement-breakpoint
CREATE TABLE reader_fact_place_versions (
  family text NOT NULL,
  state text NOT NULL,
  owner_key text NOT NULL,
  revision bigint NOT NULL,
  PRIMARY KEY(family,state,owner_key)
);
--> statement-breakpoint
CREATE FUNCTION reader_entity_places(entity_key text,only_body text DEFAULT NULL) RETURNS TABLE(owner_key text,state text) LANGUAGE sql STABLE AS $$
  WITH bodies AS MATERIALIZED (
    SELECT entity_key AS id
    UNION
    SELECT entity_id FROM fact WHERE status='live' AND field LIKE 'member:%' AND field='member:'||entity_key
  )
  SELECT DISTINCT COALESCE(r.owner_key,p.place_id,split_part(e.id,'#',1)),st
    FROM bodies b JOIN entity e ON e.id=b.id LEFT JOIN entity_place p ON p.entity_id=e.id
    LEFT JOIN LATERAL (
      SELECT owner_key,selectors FROM reader_place_records WHERE pointer_key LIKE 'REGISTRY_RUNTIME_BINDING:%'
        AND selectors && ARRAY[e.id] AND path->>-2='bodies' LIMIT 1
    ) r ON true
    CROSS JOIN LATERAL unnest(reader_record_states('[]',COALESCE(r.selectors,'{}')||ARRAY[e.id,p.place_id],jsonb_build_object('state',e.state))) st
    WHERE e.kind='body' AND (only_body IS NULL OR e.id=only_body)
$$;
--> statement-breakpoint
CREATE FUNCTION reader_fact_families(kind text,field text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT array_remove(ARRAY[
    CASE WHEN kind='body' AND (field LIKE 'member:%' OR field=ANY(ARRAY['name','homepage','meeting_cadence','agenda_url','office_address','office_phone']))
      OR kind='person' AND (field=ANY(ARRAY['name','email','phone','website']) OR field ~ '^(name|email|phone|website|office|term_note|term_start|term_end):') THEN 'registry-runtime' END,
    CASE WHEN kind='body' AND field LIKE 'comment:%' THEN 'comment-access' END
  ],NULL)
$$;
--> statement-breakpoint
CREATE INDEX reader_fact_person_memberships ON fact(field,entity_id) WHERE status='live' AND field LIKE 'member:%';
--> statement-breakpoint
CREATE FUNCTION reader_update_fact_state() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE entity_id_value text:=CASE WHEN TG_OP='DELETE' THEN OLD.entity_id ELSE NEW.entity_id END;
  field text:=CASE WHEN TG_OP='DELETE' THEN OLD.field ELSE NEW.field END; families text[]; rev bigint; only_body text;
BEGIN
  SELECT reader_fact_families(e.kind,field),CASE WHEN e.kind='person' AND field LIKE '%:%' THEN substring(field FROM position(':' IN field)+1) END
    INTO families,only_body FROM entity e WHERE e.id=entity_id_value;
  IF cardinality(families)>0 THEN
    rev:=nextval('reader_fact_revision');
    INSERT INTO reader_fact_place_versions(family,state,owner_key,revision)
      SELECT DISTINCT family,state,owner_key,rev FROM reader_entity_places(entity_id_value,only_body) CROSS JOIN unnest(families) family
      ON CONFLICT(family,state,owner_key) DO UPDATE SET revision=excluded.revision;
    INSERT INTO reader_fact_state_versions(state,family,revision)
      SELECT DISTINCT state,family,rev FROM reader_entity_places(entity_id_value,only_body) CROSS JOIN unnest(families) family
      ON CONFLICT(state,family) DO UPDATE SET revision=excluded.revision;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
--> statement-breakpoint
CREATE TRIGGER reader_fact_state_change AFTER INSERT OR UPDATE OR DELETE ON fact FOR EACH ROW EXECUTE FUNCTION reader_update_fact_state();
--> statement-breakpoint
-- Live memberships identify every body that can show person fields.
INSERT INTO reader_fact_place_versions(family,state,owner_key,revision)
  WITH bodies AS MATERIALIZED (
    SELECT DISTINCT e.id,e.state,family
      FROM fact f JOIN entity e ON e.id=f.entity_id CROSS JOIN LATERAL unnest(reader_fact_families(e.kind,f.field)) family
      WHERE e.kind='body' AND f.status='live'
  ), bindings AS MATERIALIZED (
    SELECT DISTINCT ON(payload->>'id') payload->>'id' id,owner_key,selectors FROM reader_place_records
      WHERE pointer_key LIKE 'REGISTRY_RUNTIME_BINDING:%' AND path->>-2='bodies' ORDER BY payload->>'id',pointer_key
  ), places AS (
    SELECT DISTINCT b.family,st state,COALESCE(r.owner_key,p.place_id,split_part(b.id,'#',1)) owner_key
      FROM bodies b LEFT JOIN entity_place p ON p.entity_id=b.id LEFT JOIN bindings r ON r.id=b.id
      CROSS JOIN LATERAL unnest(reader_record_states('[]',COALESCE(r.selectors,'{}')||ARRAY[b.id,p.place_id],jsonb_build_object('state',b.state))) st
  ) SELECT family,state,owner_key,nextval('reader_fact_revision') FROM places;
--> statement-breakpoint
INSERT INTO reader_fact_state_versions(state,family,revision)
  SELECT state,family,max(revision) FROM reader_fact_place_versions GROUP BY state,family;
