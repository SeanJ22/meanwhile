ALTER TABLE entity_place ADD COLUMN boundary_year integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE entity_place DROP CONSTRAINT entity_place_pkey,
  ADD PRIMARY KEY (entity_id,place_id,boundary_year);
--> statement-breakpoint
ALTER TABLE entity DROP CONSTRAINT entity_kind_check,
  ADD CONSTRAINT entity_kind_check CHECK (kind IN ('place','government','body','seat','person','meeting','agenda_item','bill','vote_event','election','contest','candidacy','measure','measure_provision','committee','statement','law_question','news_item'));
--> statement-breakpoint
CREATE TABLE zip_place (
  zip text NOT NULL CHECK (zip ~ '^[0-9]{5}$'),
  place_id text NOT NULL REFERENCES entity(id),
  share double precision NOT NULL CHECK (share>0 AND share<=1),
  boundary_year integer NOT NULL,
  PRIMARY KEY (zip,place_id,boundary_year)
);
--> statement-breakpoint
CREATE INDEX zip_place_place ON zip_place(place_id,boundary_year);
--> statement-breakpoint
CREATE TABLE zcta_place (
  zcta text NOT NULL CHECK (zcta ~ '^[0-9]{5}$'),
  place_id text NOT NULL REFERENCES entity(id),
  share double precision NOT NULL CHECK (share>0 AND share<=1),
  boundary_year integer NOT NULL,
  PRIMARY KEY (zcta,place_id,boundary_year)
);
--> statement-breakpoint
CREATE INDEX zcta_place_place ON zcta_place(place_id,boundary_year);
--> statement-breakpoint
CREATE TABLE place_page (
  place_id text PRIMARY KEY REFERENCES entity(id),
  version bigint NOT NULL DEFAULT 1,
  built_at timestamptz NOT NULL DEFAULT now(),
  body jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX entity_external_id_value ON entity_external_id(value,entity_id);
--> statement-breakpoint
CREATE FUNCTION reader_resolve_id(any_id text) RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE matches text[];
BEGIN
  SELECT array_agg(DISTINCT id) INTO matches FROM (
    SELECT id FROM entity WHERE id=any_id
    UNION SELECT entity_id FROM entity_external_id WHERE value=any_id
    UNION SELECT entity_id FROM entity_external_id WHERE scheme='fec'
      AND value=substring(any_id FROM '^fec:([HSP][0-9][A-Z]{2}[0-9]{5})$')
  ) found;
  IF cardinality(matches)>1 THEN RAISE EXCEPTION 'Ambiguous reader entity id: %',any_id; END IF;
  RETURN matches[1];
END $$;
--> statement-breakpoint
CREATE FUNCTION reader_bind_id(any_id text, subject_kind text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE found text; native text; parent text; st text; candidate jsonb; targets text[]; matches text[];
BEGIN
  found:=reader_resolve_id(any_id);
  IF found IS NOT NULL THEN RETURN found; END IF;
  IF any_id ~ '^(house|senate):[0-9]+-[12]:[0-9]+$' THEN
    INSERT INTO entity(id,kind,name) VALUES(any_id,'vote_event',any_id) ON CONFLICT DO NOTHING;
  ELSIF any_id ~ '^.+#[^#]+$' AND (subject_kind='MEASURE_PROVISION'
    OR any_id ~ '^ballot-[a-z]{2}-.+#[^#]+$'
    OR EXISTS(SELECT 1 FROM entity WHERE id=split_part(any_id,'#',1) AND kind='measure')) THEN
    parent:=split_part(any_id,'#',1);
    SELECT state INTO st FROM entity WHERE id=parent;
    st:=coalesce(st,upper(substring(any_id FROM '^ballot-([a-z]{2})-')));
    INSERT INTO entity(id,kind,name,state) VALUES(parent,'measure',parent,st) ON CONFLICT DO NOTHING;
    INSERT INTO entity(id,kind,name,state,parent_id) VALUES(any_id,'measure_provision',any_id,st,parent) ON CONFLICT DO NOTHING;
  ELSIF any_id ~ '^(fec:)?[HSP][0-9][A-Z]{2}[0-9]{5}$' THEN
    native:=regexp_replace(any_id,'^fec:','');
    -- Existing aliases survive source refreshes; missing ones follow the held source's exact crosswalk.
    FOR candidate IN SELECT reader_payload_node(c.item)
      FROM civic_data_promotions p,LATERAL reader_payload_members(reader_payload_node(p.payload)->'candidates') c
      WHERE p.record_class='FEC_FUNDING' AND reader_payload_node(c.item)->>'fecCandidateId'=native
    LOOP
      SELECT array_agg(v.item#>>'{}') INTO targets FROM reader_payload_members(candidate->'targetKeys') v;
      SELECT array_agg(DISTINCT id) INTO matches FROM (
        SELECT id FROM entity WHERE kind='person' AND id=ANY(targets)
        UNION SELECT e.id FROM entity_external_id x JOIN entity e ON e.id=x.entity_id
          WHERE e.kind='person' AND x.value=ANY(targets)
      ) people;
      -- A source's exact reader target takes precedence over another source's spelling of the same native id.
      IF coalesce(cardinality(matches),0)=0 THEN
        SELECT array_agg(DISTINCT id) INTO matches FROM (
          SELECT id FROM entity WHERE kind='person' AND id IN (
            SELECT 'congress-api:'||substring(value FROM '^congress:([A-Z][0-9]{6})$') FROM unnest(targets) value)
          UNION SELECT e.id FROM entity_external_id x JOIN entity e ON e.id=x.entity_id WHERE e.kind='person'
            AND x.value IN(SELECT substring(value FROM '^congress:([A-Z][0-9]{6})$') FROM unnest(targets) value)
        ) native_people;
      END IF;
      IF cardinality(matches)>1 THEN RAISE EXCEPTION 'Ambiguous FEC person: %',native; END IF;
      found:=matches[1];
      IF found IS NULL THEN
        SELECT min(value) INTO found FROM unnest(targets) value WHERE value ~ '^congress:[A-Z][0-9]{6}$';
        found:=coalesce(found,'fec:'||native);
        INSERT INTO entity(id,kind,name,state) VALUES(found,'person',candidate->>'name',candidate->>'state') ON CONFLICT DO NOTHING;
      END IF;
      INSERT INTO entity_external_id(entity_id,scheme,value) VALUES(found,'fec',native) ON CONFLICT DO NOTHING;
      RETURN reader_resolve_id(any_id);
    END LOOP;
  END IF;
  RETURN reader_resolve_id(any_id);
END $$;
--> statement-breakpoint
CREATE FUNCTION reader_sync_ids() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE subject record; resolved integer:=0;
BEGIN
  FOR subject IN
    SELECT target_id AS id,target_type AS kind FROM reactions
    UNION SELECT subject_id,subject_type FROM speak_your_mind
    UNION SELECT subject_id,subject_type FROM demand_signals
    UNION SELECT s.item#>>'{}','ASK' FROM ask_interactions a,LATERAL reader_payload_members(a.subject_ids) s
  LOOP
    IF reader_bind_id(subject.id,subject.kind) IS NOT NULL THEN resolved:=resolved+1; END IF;
  END LOOP;
  RETURN resolved;
END $$;
--> statement-breakpoint
SELECT reader_sync_ids();
