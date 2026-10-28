CREATE FUNCTION rp01_reader_fact(p_key text,p_class text,p_scope text,p_version text,p_at timestamptz,
  p_collection text,p_ordinal bigint,p_id text,p_body text,p_state text,p_aliases text[],p_value jsonb)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO civic_data_rows(promotion_key,record_class,scope,version_id,promoted_at,collection,ordinal,row_id,body_id,state,aliases,value,content_hash)
    VALUES(p_key,p_class,p_scope,p_version,p_at,p_collection,p_ordinal,p_id,p_body,p_state,coalesce(p_aliases,'{}'),p_value,
      encode(sha256(convert_to(p_value::text,'UTF8')),'hex'))
    ON CONFLICT(promotion_key,collection,ordinal) DO UPDATE SET version_id=excluded.version_id,promoted_at=excluded.promoted_at,
      row_id=excluded.row_id,body_id=excluded.body_id,state=excluded.state,aliases=excluded.aliases,value=excluded.value,content_hash=excluded.content_hash,
      change_id=CASE WHEN civic_data_rows.content_hash IS DISTINCT FROM excluded.content_hash
        THEN nextval('civic_data_row_change') ELSE civic_data_rows.change_id END;
$$;
--> statement-breakpoint
CREATE FUNCTION rp01_reader_facts(p_key text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE p civic_data_promotions%ROWTYPE;c civic_data_candidates%ROWTYPE;root jsonb;header jsonb;metadata jsonb;
  member record;site record;v jsonb;j jsonb;collection text;collections text[];row_state text;identity text;body text;aliases text[];n bigint;
BEGIN
  SELECT key,source_id,record_class,scope,current_version_id,last_known_good_version_id,promoted_at,payload,validation_receipt,payload_fingerprint
    INTO p.key,p.source_id,p.record_class,p.scope,p.current_version_id,p.last_known_good_version_id,p.promoted_at,p.payload,p.validation_receipt,p.payload_fingerprint
    FROM civic_data_promotions WHERE key=p_key;
  IF NOT FOUND OR p.record_class NOT IN ('STATE_BILL','MEETING_OUTCOME','VOTING_SITE','FEC_FUNDING','STATE_CAMPAIGN_FINANCE','FEDERAL_KEY_VOTE') AND NOT (p.record_class='CURATED_READER_RECORD' AND p.scope IN ('epa-echo:national','socrata-discovery:national')) THEN RETURN;END IF;
  SELECT id,source_id,record_class,scope,state,acquisition_succeeded,retrieved_at,promoted_version_id,last_known_good_version_id,read_model_fingerprint,validation_receipt,normalized_hash,candidate
    INTO c.id,c.source_id,c.record_class,c.scope,c.state,c.acquisition_succeeded,c.retrieved_at,c.promoted_version_id,c.last_known_good_version_id,c.read_model_fingerprint,c.validation_receipt,c.normalized_hash,c.candidate
    FROM civic_data_candidates WHERE id=p.current_version_id;
  root:=reader_payload_node(p.payload);
  collections:=CASE p.record_class WHEN 'STATE_BILL' THEN ARRAY['bills','sponsors','datasets']
    WHEN 'MEETING_OUTCOME' THEN ARRAY['sittings'] WHEN 'VOTING_SITE' THEN ARRAY['jurisdictions']
    WHEN 'FEC_FUNDING' THEN ARRAY['candidates','absences','secondHop'] WHEN 'FEDERAL_KEY_VOTE' THEN '{}'::text[]
    WHEN 'CURATED_READER_RECORD' THEN ARRAY['partitions'] ELSE ARRAY['records'] END;
  header:=reader_payload_value(root-collections-CASE WHEN p.record_class='FEDERAL_KEY_VOTE' THEN ARRAY['positions'] ELSE '{}'::text[] END);
  IF p.record_class='FEDERAL_KEY_VOTE' THEN header:=header||jsonb_build_object('positions',reader_payload_value(reader_payload_node(root->'positions')-ARRAY['positions','retiredMappings']));END IF;
  SELECT coalesce(array_agg(field),'{}') INTO collections FROM unnest(collections) field WHERE root ? field;
  metadata:=jsonb_build_object('key',p.key,'record_class',p.record_class,'scope',p.scope,'source_id',p.source_id,
    'current_version_id',p.current_version_id,'last_known_good_version_id',p.last_known_good_version_id,'promoted_at',p.promoted_at,
    'retrieved_at',c.retrieved_at,'validation_receipt',reader_payload_value(p.validation_receipt-'excludedFacts')||jsonb_build_object('excludedFacts','[]'::jsonb),
    'payload',header,'collections',to_jsonb(collections),'sittingShape',jsonb_typeof(root)='object' AND root ? 'sittings' AND root ? 'tenants','temporal',reader_payload_node(c.candidate)->'temporal','confirmation',(SELECT detail FROM civic_data_candidate_events WHERE candidate_id=p.current_version_id
      AND left(detail,26)='UNCHANGED_CONFIRMATION_V1 ' ORDER BY sequence DESC LIMIT 1),
    'published',coalesce(p.current_version_id=p.last_known_good_version_id AND c.id=p.current_version_id AND c.source_id=p.source_id
      AND c.record_class=p.record_class AND c.scope=p.scope AND c.state='PROMOTED' AND c.acquisition_succeeded
      AND c.promoted_version_id=c.id AND c.last_known_good_version_id=c.id AND p.payload_fingerprint IS NOT DISTINCT FROM c.read_model_fingerprint
      AND p.validation_receipt=c.validation_receipt AND c.normalized_hash=reader_payload_node(reader_payload_node(c.candidate)->'normalization')->>'normalizedHash'
      AND p.validation_receipt->>'decision'='GOOD' AND p.validation_receipt->>'candidateId'=c.id
      AND p.validation_receipt->>'sourceId'=c.source_id AND p.validation_receipt->>'recordClass'=c.record_class AND p.validation_receipt->>'scope'=c.scope,false));
  row_state:=upper(substring(p.scope FROM '^US-([A-Z]{2})'));
  PERFORM rp01_reader_fact(p.key,p.record_class,p.scope,p.current_version_id,p.promoted_at,'rp01.header',0,p.key,NULL,row_state,'{}',metadata);
  DELETE FROM civic_data_rows r WHERE r.promotion_key=p.key AND r.collection LIKE 'rp01.%' AND r.collection<>'rp01.header';
  IF p.record_class='FEDERAL_KEY_VOTE' THEN
    n:=0;
    FOR member IN SELECT key,value FROM jsonb_each(reader_payload_value(reader_payload_node(root->'positions')->'positions')) LOOP
      FOR site IN SELECT key,value FROM jsonb_each(member.value) LOOP
        n:=n+1;
        PERFORM rp01_reader_fact(p.key,p.record_class,p.scope,p.current_version_id,p.promoted_at,'rp01.positions',n,site.key,site.key,NULL,
          ARRAY[site.key],jsonb_build_object('roll',member.key,'member',site.key,'position',site.value));
      END LOOP;
    END LOOP;
  END IF;
  FOREACH collection IN ARRAY collections LOOP
    FOR member IN SELECT ordinal_index,item FROM reader_payload_members(root->collection) ORDER BY ordinal_index LOOP
      v:=reader_payload_value(member.item);body:=v->>'bodyId';
      identity:=coalesce(v->>'id',v->>'meetingId',v->>'peopleId',v->>'session_id',member.ordinal_index::text);
      row_state:=upper(coalesce(v->>'state',substring(body FROM '/(?:state|territory|district):([a-z]{2})(?:/|$)'),substring(p.scope FROM '^US-([A-Z]{2})')));
      SELECT coalesce(array_agg(DISTINCT value#>>'{}'),'{}') INTO aliases FROM jsonb_path_query(v,'$.** ? (@.type() == "string")') leaf(value) WHERE length(value#>>'{}')<=1024;
      IF collection='candidates' AND v->>'fecCandidateId' IS NOT NULL THEN aliases:=aliases||('fec:'||(v->>'fecCandidateId'));END IF;
      IF collection='partitions' THEN aliases:=aliases||split_part(identity,':state:',1);END IF;
      IF collection='sponsors' THEN body:='legiscan:'||(v->>'peopleId');END IF;
      IF collection='bills' THEN
        SELECT coalesce(array_agg('sponsor:'||value),'{}') INTO aliases FROM jsonb_array_elements_text(coalesce(v->'sponsorRefs','[]'::jsonb));
      END IF;
      IF collection='jurisdictions' THEN
        j:=v;body:=coalesce(j->>'id',j->>'ocdId',member.ordinal_index::text);
        PERFORM rp01_reader_fact(p.key,p.record_class,p.scope,p.current_version_id,p.promoted_at,'rp01.jurisdictions',member.ordinal_index,
          body,body,row_state,ARRAY[j->>'countyFips',j->>'countySubdivisionGeoid'],j-'sites');
        FOR site IN SELECT value,ordinality FROM jsonb_array_elements(coalesce(j->'sites','[]'::jsonb)) WITH ORDINALITY LOOP
          n:=(member.ordinal_index-1)*1000000+site.ordinality;
          PERFORM rp01_reader_fact(p.key,p.record_class,p.scope,p.current_version_id,p.promoted_at,'rp01.sites',n,
            coalesce(site.value->>'id',site.ordinality::text),body,row_state,ARRAY[site.value->>'countyFips'],site.value);
        END LOOP;
      ELSE
        PERFORM rp01_reader_fact(p.key,p.record_class,p.scope,p.current_version_id,p.promoted_at,'rp01.'||collection,member.ordinal_index,
          identity,body,row_state,aliases,v);
      END IF;
    END LOOP;
  END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION rp01_reader_facts_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RETURN OLD;END IF;
  PERFORM rp01_reader_facts(NEW.key);RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER zz_rp01_reader_facts_changed AFTER INSERT OR UPDATE ON civic_data_promotions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION rp01_reader_facts_changed();
--> statement-breakpoint
CREATE FUNCTION rp01_reader_fact_checked() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF left(NEW.detail,26)='UNCHANGED_CONFIRMATION_V1 ' THEN
    UPDATE civic_data_rows SET value=jsonb_set(value,'{confirmation}',to_jsonb(NEW.detail)),
      content_hash=encode(sha256(convert_to(jsonb_set(value,'{confirmation}',to_jsonb(NEW.detail))::text,'UTF8')),'hex'),change_id=nextval('civic_data_row_change')
      WHERE collection='rp01.header' AND version_id=NEW.candidate_id;
  END IF;RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER zz_rp01_reader_fact_checked AFTER INSERT ON civic_data_candidate_events
  FOR EACH ROW EXECUTE FUNCTION rp01_reader_fact_checked();
--> statement-breakpoint
CREATE INDEX civic_data_rows_rp01_header ON civic_data_rows(record_class,scope) WHERE collection='rp01.header';
--> statement-breakpoint
CREATE INDEX civic_data_rows_rp01_sitting ON civic_data_rows(row_id,promotion_key) WHERE collection='rp01.sittings';
--> statement-breakpoint
DO $$DECLARE source_key text;BEGIN
  FOR source_key IN SELECT key FROM civic_data_promotions WHERE record_class IN ('STATE_BILL','MEETING_OUTCOME','VOTING_SITE','FEC_FUNDING','STATE_CAMPAIGN_FINANCE','FEDERAL_KEY_VOTE') OR record_class='CURATED_READER_RECORD' AND scope IN ('epa-echo:national','socrata-discovery:national') LOOP
    PERFORM rp01_reader_facts(source_key);
  END LOOP;
END $$;
--> statement-breakpoint
-- Publication owns this guard. Reading an exact source check never opens its source envelope.
CREATE FUNCTION rp01_prune_source_checks() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM civic_data_source_checks s WHERE
    (TG_TABLE_NAME='civic_data_promotions' AND s.record_class=NEW.record_class AND s.scope=NEW.scope
      OR TG_TABLE_NAME='civic_data_candidates' AND s.pointer_version_id=to_jsonb(NEW)->>'id')
    AND NOT EXISTS(SELECT 1 FROM civic_data_promotions p JOIN civic_data_candidates c ON c.id=p.current_version_id
      WHERE p.record_class=s.record_class AND p.scope=s.scope AND s.source_id=p.source_id
        AND p.last_known_good_version_id=p.current_version_id AND c.source_id=p.source_id AND c.record_class=p.record_class AND c.scope=p.scope
        AND c.state='PROMOTED' AND c.acquisition_succeeded AND c.parser_version=s.parser_version
        AND c.candidate#>>'{retrieval,rawHashBasis}'='SOURCE_CONTENT_V1'
        AND ((s.source_raw_hash IS NULL AND reader_payload_node(p.payload)->>'sourceManifestVersion'='1'
          AND reader_payload_node(reader_payload_node(p.payload)->'sourceHashes')->>s.source_key=s.raw_hash)
          OR s.source_raw_hash IS NOT NULL AND c.raw_hash=s.source_raw_hash)
        AND NOT (c.candidate ? 'bootstrapImport') AND coalesce(c.candidate#>>'{stateRetirement,kind}','')<>'STATE_AUTHORITY_RETIREMENT');
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER zz_rp01_prune_source_checks AFTER UPDATE ON civic_data_promotions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION rp01_prune_source_checks();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER zz_rp01_prune_candidate_checks AFTER UPDATE ON civic_data_candidates
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION rp01_prune_source_checks();
