CREATE FUNCTION refresh_lookup_rows(p_key text,p_class text,p_scope text,p_version text,p_at timestamptz,p_payload jsonb)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE root jsonb:=reader_payload_node(p_payload); collection_name text; collections text[]; list jsonb; member record;
  document jsonb; identity text; body text; row_state text; names text[];
BEGIN
  collections:=CASE p_class WHEN 'REGISTRY_RUNTIME_BINDING' THEN ARRAY['registry.executives','registry.candidacies','registry.rosterMembers','registry.rosterDispositions']
    WHEN 'FEDERAL_DIRECTORY' THEN ARRAY['federalPeople','federalCommittees']
    WHEN 'OPERATIONAL_REFERENCE' THEN ARRAY['operationalGovernments']
    WHEN 'CURATED_READER_RECORD' THEN CASE WHEN root->>'kind'='meeting-source-wiring' THEN ARRAY['derivedWiring'] ELSE '{}'::text[] END
    ELSE '{}'::text[] END;
  DELETE FROM civic_data_rows WHERE promotion_key=p_key AND collection IN
    ('registry.executives','registry.candidacies','registry.rosterMembers','registry.rosterDispositions','federalPeople','federalCommittees','operationalGovernments','derivedWiring');
  IF p_class='REGISTRY_RUNTIME_BINDING' THEN
    UPDATE civic_data_rows SET label_key=trim(regexp_replace(lower(reader_payload_value(value->'name')#>>'{}'),'[^[:alnum:]]+',' ','g'))
      WHERE promotion_key=p_key AND collection='registry.bodies';
  END IF;
  FOREACH collection_name IN ARRAY collections LOOP
    list:=CASE collection_name WHEN 'registry.executives' THEN root->'statewideExecutives'
      WHEN 'registry.candidacies' THEN reader_payload_node(root->'officialCandidacies')->'rows'
      WHEN 'registry.rosterDispositions' THEN root->'rosterReaderDispositions'
      WHEN 'federalPeople' THEN reader_payload_node(root->'roster')->'officeholders'
      WHEN 'derivedWiring' THEN root->'records' ELSE NULL END;
    FOR member IN
      SELECT m.ordinal_index AS ordinal,m.item,NULL::text AS state_code FROM reader_payload_members(list) m
      UNION ALL SELECT r.ordinal_index*1000000000+m.ordinal_index,
        jsonb_build_object('bodyId',reader_payload_node(r.item)->'bodyId','roster',reader_payload_node(r.item)-'members','member',reader_payload_node(m.item)),NULL::text
        FROM reader_payload_members(root->'bodyRosters') r,
          LATERAL reader_payload_members(reader_payload_node(r.item)->'members') m WHERE collection_name='registry.rosterMembers'
      UNION ALL SELECT row_number() OVER(ORDER BY c.key),reader_payload_node(c.value)||jsonb_build_object('id',c.key),NULL::text
        FROM jsonb_each(coalesce(reader_payload_node(reader_payload_node(root->'directory')->'committees'),'{}'::jsonb)) c
        WHERE collection_name='federalCommittees'
      UNION ALL SELECT r.ordinality*1000000000+j.ordinal_index,
        jsonb_build_object('row',reader_payload_node(j.item),'checkedAt',reader_payload_node(r.value)->'generatedOn'),upper(r.key)
        FROM jsonb_each(coalesce(reader_payload_node(root->'registries'),'{}'::jsonb)) WITH ORDINALITY r(key,value,ordinality),
          LATERAL reader_payload_members(reader_payload_node(r.value)->'jurisdictions') j WHERE collection_name='operationalGovernments'
    LOOP
      document:=reader_payload_node(member.item);
      identity:=coalesce(document->>'id',reader_payload_node(document->'member')->>'id',reader_payload_node(document->'holder')->>'id',
        reader_payload_node(document->'row')->>'id',document->>'sourceId',member.ordinal::text);
      body:=coalesce(document->>'bodyId',reader_payload_node(document->'row')->>'bodyId');
      row_state:=regexp_replace(upper(coalesce(member.state_code,document->>'state',reader_payload_node(document->'row')->>'state',substring(p_scope FROM '^US-([A-Z]{2})'))),'^US-','');
      names:=array_remove(ARRAY[identity,document->>'jurisdictionId',reader_payload_node(document->'member')->>'personId',document->>'personId'],NULL);
      INSERT INTO civic_data_rows(promotion_key,record_class,scope,version_id,promoted_at,collection,ordinal,row_id,body_id,state,label_key,aliases,value,content_hash)
        VALUES(p_key,p_class,p_scope,p_version,p_at,collection_name,member.ordinal,identity,body,row_state,
          trim(regexp_replace(lower(reader_payload_value(document->'name')#>>'{}'),'[^[:alnum:]]+',' ','g')),names,document,
          encode(sha256(convert_to(document::text,'UTF8')),'hex'));
    END LOOP;
  END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION lookup_rows_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM refresh_lookup_rows(NEW.key,NEW.record_class,NEW.scope,NEW.current_version_id,NEW.promoted_at,NEW.payload);
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER zz_lookup_rows_changed AFTER INSERT OR UPDATE OF key,record_class,scope,current_version_id,promoted_at,payload
  ON civic_data_promotions FOR EACH ROW EXECUTE FUNCTION lookup_rows_changed();
--> statement-breakpoint
CREATE INDEX civic_data_rows_registry_census ON civic_data_rows(promotion_key,(value->>'censusId')) WHERE collection='registry.bodies';
--> statement-breakpoint
CREATE INDEX civic_data_rows_version_member ON civic_data_rows(version_id,collection,row_id);
--> statement-breakpoint
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT key,record_class,scope,current_version_id,promoted_at,payload FROM civic_data_promotions
    WHERE record_class IN ('REGISTRY_RUNTIME_BINDING','FEDERAL_DIRECTORY','OPERATIONAL_REFERENCE')
      OR record_class='CURATED_READER_RECORD' AND scope='US:meeting-source-wiring' LOOP
    PERFORM refresh_lookup_rows(p.key,p.record_class,p.scope,p.current_version_id,p.promoted_at,p.payload);
  END LOOP;
END $$;
