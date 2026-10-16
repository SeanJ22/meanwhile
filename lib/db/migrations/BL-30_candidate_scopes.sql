CREATE OR REPLACE FUNCTION civic_authority_members(value jsonb) RETURNS TABLE(ordinal_index bigint,item jsonb) LANGUAGE sql STABLE AS $$
  WITH node AS (SELECT reader_payload_node(value) v), ordering AS MATERIALIZED (
    SELECT (x#>>'{}')::integer group_id,n,row_number() OVER(PARTITION BY x ORDER BY n) position
    FROM node,LATERAL jsonb_array_elements((reader_payload_value(v->'order')#>>'{}')::jsonb) WITH ORDINALITY a(x,n) WHERE v->>'kind'='array')
  SELECT n,x FROM node,LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(v)='array' THEN v ELSE '[]' END) WITH ORDINALITY a(x,n)
  UNION ALL
  SELECT o.n,m.x FROM node,LATERAL jsonb_array_elements(CASE WHEN v->>'kind'='array' THEN v->'groups' ELSE '[]' END) WITH ORDINALITY g(ref,group_id),
    LATERAL jsonb_array_elements(reader_payload_node(ref)) WITH ORDINALITY m(x,position)
    , ordering o WHERE o.group_id=g.group_id-1 AND o.position=m.position;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION civic_authority_decode(value jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE node jsonb:=reader_payload_node(value); result jsonb;
BEGIN
  IF node->>'kind'='string' THEN
    SELECT to_jsonb(string_agg(civic_authority_decode(v)#>>'{}','' ORDER BY n)) INTO result FROM jsonb_array_elements(node->'chunks') WITH ORDINALITY a(v,n); RETURN result;
  ELSIF node->>'kind'='array' OR jsonb_typeof(node)='array' THEN
    SELECT COALESCE(jsonb_agg(civic_authority_decode(item) ORDER BY ordinal_index),'[]') INTO result FROM civic_authority_members(node); RETURN result;
  ELSIF jsonb_typeof(node)='object' THEN
    SELECT COALESCE(jsonb_object_agg(k,civic_authority_decode(v)),'{}') INTO result FROM jsonb_each(node) a(k,v); RETURN result;
  END IF;
  RETURN node;
END
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION civic_authority_state(key text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(upper((regexp_match(key,'(?:/state:|^US-|^(?:ballot-)?|campaign-site:)([a-z]{2})(?:[-:/]|$)','i'))[1]),'US');
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION civic_authority_member_state(member jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT civic_authority_state(COALESCE(member->>'key',member->>'candidateKey',member->>'id',''));
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION civic_authority_name(value text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(regexp_replace(regexp_replace(value,'[,[:space:]]+(jr|sr|ii|iii|iv)\.?$','','i'),'[^[:alnum:]]','','g'));
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION civic_authority_name_bindings() RETURNS jsonb LANGUAGE sql STABLE AS $$
  WITH latest AS MATERIALIZED (SELECT DISTINCT ON (scope) scope,candidate FROM civic_data_candidates
    WHERE scope IN ('US-AZ:2026-general:supported-ballot','US-NH:merrimack:2026-general','US-NJ:county:morris:2026-general') AND state='PROMOTED'
    ORDER BY scope,retrieved_at DESC,id DESC), names AS (
    SELECT civic_authority_name(COALESCE(reader_payload_node(item)->>'name',concat_ws(' ',reader_payload_node(item)->>'givenName',reader_payload_node(item)->>'familyName'))) name,min(civic_authority_state(scope)) state,count(DISTINCT scope) states
    FROM latest,LATERAL civic_authority_members(reader_payload_node(reader_payload_node(candidate->'readModel')->'ballot')->'candidacies')
    GROUP BY civic_authority_name(COALESCE(reader_payload_node(item)->>'name',concat_ws(' ',reader_payload_node(item)->>'givenName',reader_payload_node(item)->>'familyName'))))
  SELECT COALESCE(jsonb_object_agg(name,state),'{}') FROM names WHERE states=1 AND name IS NOT NULL;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION civic_authority_origin(family text) RETURNS TABLE(record_class text, scope text, suffix text) LANGUAGE sql IMMUTABLE AS $$
  SELECT record_class,scope,suffix FROM (VALUES
    ('ballot-contests','BALLOT_CANDIDACY','US:state-election-ballots','state-election-ballots'),
    ('candidate-profiles','CANDIDATE_PROFILE','US-AZ+US-NH+US-NJ:2026-supported-candidates','candidate-profiles'),
    ('candidate-corpus','CANDIDATE_PUBLICATION','US-AZ+US-NH+US-NJ:2026-supported-candidates','candidate-publications'),
    ('voting-sites','VOTING_SITE','US-AZ+US-NH+US-NJ:2026-general:supported-jurisdictions','voting-sites'),
    ('candidate-campaign-sites-derived','CURATED_READER_RECORD','US:candidate-campaign-sites-derived','candidate-campaign-sites-derived')
  ) v(family,record_class,scope,suffix) WHERE v.family=$1;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION civic_authority_partition(family text, stored jsonb, state text) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE payload jsonb:=reader_payload_node(stored); result jsonb; name text; rows jsonb; hunts jsonb; documents jsonb; failures jsonb; container jsonb; bindings jsonb;
BEGIN
  IF family='ballot-contests' THEN
    SELECT COALESCE(jsonb_object_agg(k,civic_authority_decode(v)),'{}') INTO rows FROM jsonb_each(reader_payload_node(payload->'ballots')) a(k,v)
      WHERE reader_payload_node(reader_payload_node(v)->'election')->>'state'=state;
    RETURN civic_authority_decode(payload-'ballots')||jsonb_build_object('ballots',rows);
  ELSIF family='candidate-profiles' THEN
    result := '{}'; bindings:=civic_authority_name_bindings();
    FOREACH name IN ARRAY ARRAY['cards','links'] LOOP
      container:=reader_payload_node(payload->name);
      IF EXISTS(SELECT 1 FROM civic_authority_members(container->'hunts') WHERE
        COALESCE(civic_authority_member_state(reader_payload_node(item)),bindings->>civic_authority_name(reader_payload_node(item)->>'name')) IS NULL)
      THEN RAISE EXCEPTION 'State authority hunt jurisdiction is unresolved'; END IF;
      SELECT COALESCE(jsonb_object_agg(k,civic_authority_decode(v)),'{}') INTO rows FROM jsonb_each(reader_payload_node(container->name)) a(k,v) WHERE civic_authority_state(k)=state;
      SELECT COALESCE(jsonb_agg(civic_authority_decode(item) ORDER BY ordinal_index),'[]') INTO hunts FROM civic_authority_members(container->'hunts')
        WHERE COALESCE(civic_authority_member_state(reader_payload_node(item)),bindings->>civic_authority_name(reader_payload_node(item)->>'name'))=state;
      result:=result||jsonb_build_object(name,civic_authority_decode(container-ARRAY[name,'hunts'])||jsonb_build_object(name,rows,'hunts',hunts));
    END LOOP;
    RETURN result;
  ELSIF family='candidate-corpus' THEN
    SELECT COALESCE(jsonb_agg(civic_authority_decode(item) ORDER BY ordinal_index),'[]') INTO documents FROM civic_authority_members(payload->'documents') WHERE civic_authority_member_state(reader_payload_node(item))=state;
    SELECT COALESCE(jsonb_agg(civic_authority_decode(item) ORDER BY ordinal_index),'[]') INTO failures FROM civic_authority_members(payload->'failures') WHERE civic_authority_member_state(reader_payload_node(item))=state;
    RETURN civic_authority_decode(payload-ARRAY['documents','failures'])||jsonb_build_object('documents',documents,'failures',failures,'attempted',
      (SELECT count(DISTINCT v->>'candidateKey') FROM jsonb_array_elements(documents||failures) a(v)));
  ELSIF family='voting-sites' THEN
    SELECT COALESCE(jsonb_agg(civic_authority_decode(item) ORDER BY ordinal_index),'[]') INTO rows FROM civic_authority_members(payload->'jurisdictions') WHERE reader_payload_node(item)->>'state'=state;
    RETURN civic_authority_decode(payload-'jurisdictions')||jsonb_build_object('jurisdictions',rows);
  ELSIF family='candidate-campaign-sites-derived' THEN
    result := civic_authority_decode(payload-ARRAY['records','portraits']);
    FOREACH name IN ARRAY ARRAY['records','portraits'] LOOP
      IF payload ? name THEN
        SELECT COALESCE(jsonb_agg(civic_authority_decode(item) ORDER BY ordinal_index),'[]') INTO rows FROM civic_authority_members(payload->name) WHERE civic_authority_member_state(reader_payload_node(item))=state;
        result:=result||jsonb_build_object(name,rows);
      END IF;
    END LOOP;
    RETURN result;
  END IF;
  RAISE EXCEPTION 'Unknown state authority family %',family;
END
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION civic_authority_state_source(family text, state text) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE origin record; held civic_data_candidates%ROWTYPE; pointer civic_data_promotions%ROWTYPE;
  envelope jsonb; payload jsonb; normalized jsonb; identities jsonb; exclusions jsonb; rows jsonb; receipt jsonb;
BEGIN
  IF state !~ '^[A-Z]{2}$' THEN RAISE EXCEPTION 'Invalid authority state'; END IF;
  SELECT * INTO STRICT origin FROM civic_authority_origin(family);
  SELECT * INTO pointer FROM civic_data_promotions p WHERE p.record_class=origin.record_class AND p.scope=origin.scope;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO STRICT held FROM civic_data_candidates WHERE id=pointer.current_version_id;
  IF held.state<>'PROMOTED' OR held.validation_receipt->>'decision'<>'GOOD'
    OR pointer.payload IS DISTINCT FROM held.candidate->'readModel' OR pointer.validation_receipt IS DISTINCT FROM held.validation_receipt
  THEN RAISE EXCEPTION 'State partition source proof is invalid'; END IF;
  payload := civic_authority_partition(family,held.candidate->'readModel',state);
  SELECT COALESCE(jsonb_agg(civic_authority_decode(v)||jsonb_build_object('jurisdiction','US-'||state) ORDER BY n),'[]') INTO identities
    FROM civic_authority_members(held.candidate->'identities') a(n,item),LATERAL (SELECT reader_payload_node(item) v) b
    WHERE v->>'jurisdiction'='US-'||state OR v->>'jurisdiction'='US' AND civic_authority_state(v->>'subjectId')=state;
  IF identities='[]'::jsonb THEN RETURN NULL; END IF;
  envelope := civic_authority_decode(held.candidate - ARRAY['readModel','normalizedPayload','civicRecords','changeSet','identities','excludedFacts','retrieval']);
  SELECT COALESCE(jsonb_agg(civic_authority_decode(v) ORDER BY n),'[]') INTO exclusions FROM civic_authority_members(COALESCE(held.candidate->'excludedFacts','[]')) a(n,item),LATERAL (SELECT reader_payload_node(item) v) b
    WHERE civic_authority_member_state(v)=state;
  IF family='voting-sites' THEN
    normalized := reader_payload_node(held.candidate->'normalizedPayload');
    SELECT COALESCE(jsonb_agg(v ORDER BY n),'[]') INTO rows FROM civic_authority_members(normalized->'carriedJurisdictionIds') a(n,v) WHERE civic_authority_state(v#>>'{}')=state;
    normalized := civic_authority_decode(normalized-ARRAY['projection','carriedJurisdictionIds'])||jsonb_build_object('carriedJurisdictionIds',rows);
  ELSIF family='candidate-campaign-sites-derived' THEN
    normalized := reader_payload_node(held.candidate->'normalizedPayload');
    SELECT COALESCE(jsonb_object_agg(k,filtered),'{}') INTO rows FROM jsonb_each(reader_payload_node(normalized->'decisions')) a(k,v),LATERAL (
      SELECT COALESCE(jsonb_agg(x ORDER BY n),'[]') filtered FROM civic_authority_members(v) b(n,x)
      WHERE civic_authority_state(regexp_replace(x#>>'{}','^[A-Z_]+:',''))=state) b;
    normalized := civic_authority_decode(normalized-ARRAY['readModel','decisions'])||jsonb_build_object('decisions',rows);
  ELSE normalized := '{}'::jsonb;
  END IF;
  envelope := envelope||jsonb_build_object('retrieval',reader_payload_node(held.candidate->'retrieval'));
  IF family='ballot-contests' THEN
    WITH urls AS MATERIALIZED (SELECT DISTINCT url#>>'{}' url FROM jsonb_path_query(payload,'strict $.** ? (@.type() == "string")') u(url))
    SELECT COALESCE(jsonb_agg(civic_authority_decode(v) ORDER BY n),'[]') INTO rows FROM civic_authority_members(reader_payload_node(envelope#>'{retrieval,manualSourceReceipt}')->'sources') a(n,item),LATERAL (SELECT reader_payload_node(item) v) b
      WHERE v->>'requestedUrl' IN (SELECT url FROM urls) OR v->>'finalUrl' IN (SELECT url FROM urls);
    envelope := jsonb_set(envelope,'{retrieval,manualSourceReceipt}',civic_authority_decode(reader_payload_node(envelope#>'{retrieval,manualSourceReceipt}')-'sources')||jsonb_build_object('sources',rows));
  END IF;
  envelope := envelope||jsonb_build_object('retrieval',civic_authority_decode(envelope->'retrieval'),'identities',identities,'excludedFacts',exclusions);
  receipt := held.validation_receipt||jsonb_build_object('excludedFacts',exclusions);
  RETURN jsonb_build_object('originId',held.id,'originScope',held.scope,'originHash',held.normalized_hash,
    'promotedAt',pointer.promoted_at,'candidate',envelope,'receipt',receipt,'payload',payload,'normalizedMetadata',normalized);
END
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION civic_authority_expand(template jsonb, source jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE result jsonb;
BEGIN
  IF jsonb_typeof(template)='object' AND template ? '$stateAuthorityFrom' THEN
    RETURN source #> ARRAY(SELECT jsonb_array_elements_text(template->'$stateAuthorityFrom'));
  ELSIF jsonb_typeof(template)='object' THEN
    SELECT COALESCE(jsonb_object_agg(k,civic_authority_expand(v,source)),'{}') INTO result FROM jsonb_each(template) a(k,v); RETURN result;
  ELSIF jsonb_typeof(template)='array' THEN
    SELECT COALESCE(jsonb_agg(civic_authority_expand(v,source) ORDER BY n),'[]') INTO result FROM jsonb_array_elements(template) WITH ORDINALITY a(v,n); RETURN result;
  END IF;
  RETURN template;
END
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION civic_authority_partition_publish(family text, state text, origin_id text, template jsonb) RETURNS text LANGUAGE plpgsql AS $$
DECLARE source jsonb; origin record; pointer civic_data_promotions%ROWTYPE; event civic_data_candidate_events%ROWTYPE;
  envelope jsonb; receipt jsonb; expanded jsonb; expected_normalized jsonb; prefix text; confirmation jsonb; event_sequence integer := 4; target_scope text; trace text;
BEGIN
  SELECT * INTO STRICT origin FROM civic_authority_origin(family); target_scope := 'US-'||state||':'||origin.suffix;
  PERFORM pg_advisory_xact_lock(hashtextextended(origin.record_class||':'||target_scope,0));
  SELECT * INTO pointer FROM civic_data_promotions p WHERE p.record_class=origin.record_class AND p.scope=target_scope;
  IF FOUND THEN RETURN pointer.current_version_id; END IF;
  PERFORM 1 FROM civic_data_promotions p WHERE p.record_class=origin.record_class AND p.scope=origin.scope AND p.current_version_id=origin_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'State partition origin changed'; END IF;
  source := civic_authority_state_source(family,state);
  expanded := civic_authority_expand(template,source); envelope := expanded->'candidate'; receipt := expanded->'receipt';
  expected_normalized := CASE WHEN family='voting-sites' THEN (source->'normalizedMetadata')||jsonb_build_object('projection',source->'payload')
    WHEN family='candidate-campaign-sites-derived' THEN (source->'normalizedMetadata')||jsonb_build_object('readModel',source->'payload') ELSE source->'payload' END;
  IF source IS NULL OR source->>'originId' IS DISTINCT FROM origin_id
    OR envelope->>'scope' IS DISTINCT FROM target_scope OR envelope->>'recordClass' IS DISTINCT FROM origin.record_class
    OR envelope->>'sourceId' IS DISTINCT FROM source#>>'{candidate,sourceId}'
    OR envelope->'readModel' IS DISTINCT FROM source->'payload'
    OR envelope->'normalizedPayload' IS DISTINCT FROM expected_normalized
    OR envelope->'identities' IS DISTINCT FROM source#>'{candidate,identities}'
    OR envelope->'excludedFacts' IS DISTINCT FROM source#>'{candidate,excludedFacts}'
    OR (envelope-ARRAY['id','scope','readModel','normalizedPayload','civicRecords','changeSet','normalization','horizon','retrieval','sourceProjectionEvidence','bootstrapImport','temporal'])
      IS DISTINCT FROM ((source->'candidate')-ARRAY['id','scope','normalization','horizon','retrieval','sourceProjectionEvidence','bootstrapImport','temporal'])
    OR (envelope->'sourceProjectionEvidence')-'scope' IS DISTINCT FROM (source#>'{candidate,sourceProjectionEvidence}')-'scope'
    OR (envelope->'normalization')-ARRAY['inputRecords','outputRecords','droppedRecords','normalizedHash','normalizedPayloadHash']
      IS DISTINCT FROM (source#>'{candidate,normalization}')-ARRAY['inputRecords','outputRecords','droppedRecords','normalizedHash','normalizedPayloadHash']
    OR (envelope->'horizon')-'returnedRecords' IS DISTINCT FROM (source#>'{candidate,horizon}')-'returnedRecords'
    OR (envelope->'temporal')-(CASE WHEN family='candidate-campaign-sites-derived' THEN ARRAY['version','expectedVersion'] ELSE ARRAY[]::text[] END)
      IS DISTINCT FROM (source#>'{candidate,temporal}')-(CASE WHEN family='candidate-campaign-sites-derived' THEN ARRAY['version','expectedVersion'] ELSE ARRAY[]::text[] END)
    OR (envelope->'retrieval')-(CASE WHEN family='ballot-contests' THEN ARRAY['rawHash','requestedUrl','finalUrl','httpStatus'] WHEN family='candidate-campaign-sites-derived' THEN ARRAY['requestedUrl'] ELSE ARRAY[]::text[] END)
      IS DISTINCT FROM (source#>'{candidate,retrieval}')-(CASE WHEN family='ballot-contests' THEN ARRAY['rawHash','requestedUrl','finalUrl','httpStatus'] WHEN family='candidate-campaign-sites-derived' THEN ARRAY['requestedUrl'] ELSE ARRAY[]::text[] END)
    OR (receipt-ARRAY['candidateId','scope','checks']) IS DISTINCT FROM ((source->'receipt')-ARRAY['candidateId','scope','checks'])
    OR (SELECT jsonb_agg(v-'detail' ORDER BY n) FROM jsonb_array_elements(receipt->'checks') WITH ORDINALITY a(v,n))
      IS DISTINCT FROM (SELECT jsonb_agg(v-'detail' ORDER BY n) FROM jsonb_array_elements(source#>'{receipt,checks}') WITH ORDINALITY a(v,n))
    OR envelope#>>'{retrieval,retrievedAt}' IS DISTINCT FROM source#>>'{candidate,retrieval,retrievedAt}'
    OR receipt->>'decision' IS DISTINCT FROM 'GOOD' OR receipt->>'candidateId' IS DISTINCT FROM envelope->>'id'
    OR receipt->>'scope' IS DISTINCT FROM target_scope OR receipt->>'validatedAt' IS DISTINCT FROM source#>>'{receipt,validatedAt}'
  THEN RAISE EXCEPTION 'State partition changed held evidence'; END IF;
  trace := 'STATE_AUTHORITY_PARTITION_V1 '||jsonb_build_object('originId',origin_id,'originScope',origin.scope,'family',family,'state',state)::text;
  INSERT INTO civic_data_candidates(id,source_id,record_class,scope,state,acquisition_succeeded,raw_hash,normalized_hash,retrieved_at,source_through,parser_version,identity,candidate,validation_receipt,promoted_version_id,last_known_good_version_id,failure_code,failure_detail)
    VALUES(envelope->>'id',envelope->>'sourceId',origin.record_class,target_scope,'PROMOTED',true,envelope#>>'{retrieval,rawHash}',envelope#>>'{normalization,normalizedHash}',
      (envelope#>>'{retrieval,retrievedAt}')::timestamptz,envelope#>>'{temporal,sourceThrough}',envelope#>>'{normalization,parserVersion}',envelope->'identities',envelope,receipt,envelope->>'id',envelope->>'id',NULL,NULL);
  FOR event IN SELECT * FROM civic_data_candidate_events WHERE candidate_id=origin_id AND sequence<=4 ORDER BY sequence LOOP
    INSERT INTO civic_data_candidate_events(candidate_id,sequence,state,at,detail) VALUES(envelope->>'id',event.sequence,event.state,event.at,trace);
  END LOOP;
  INSERT INTO civic_data_promotions(key,source_id,record_class,scope,current_version_id,last_known_good_version_id,promoted_at,payload,validation_receipt)
    VALUES(origin.record_class||':'||target_scope,envelope->>'sourceId',origin.record_class,target_scope,envelope->>'id',envelope->>'id',(source->>'promotedAt')::timestamptz,envelope->'readModel',receipt);
  FOR event IN SELECT * FROM civic_data_candidate_events WHERE candidate_id=origin_id AND sequence>4 AND
    (detail LIKE 'UNCHANGED_CONFIRMATION_V1 %' OR detail LIKE 'UNCHANGED_CONFIRMATION_SOURCES_V1 %') ORDER BY sequence LOOP
    prefix := CASE WHEN event.detail LIKE 'UNCHANGED_CONFIRMATION_V1 %' THEN 'UNCHANGED_CONFIRMATION_V1 ' ELSE 'UNCHANGED_CONFIRMATION_SOURCES_V1 ' END;
    confirmation := substring(event.detail from length(prefix)+1)::jsonb||jsonb_build_object('versionId',envelope->>'id');
    IF prefix='UNCHANGED_CONFIRMATION_V1 ' THEN
      confirmation := confirmation||jsonb_build_object('scope',target_scope,'pointerKey',origin.record_class||':'||target_scope,'readModelHash',envelope#>>'{normalization,normalizedHash}');
      IF confirmation#>'{retrieval,httpStatus}'='null'::jsonb THEN
        confirmation := jsonb_set(confirmation,'{retrieval,requestedUrl}',to_jsonb('derived:'||(envelope->>'sourceId')||':'||target_scope));
      END IF;
    END IF;
    event_sequence := event_sequence+1;
    INSERT INTO civic_data_candidate_events(candidate_id,sequence,state,at,detail) VALUES(envelope->>'id',event_sequence,event.state,event.at,prefix||confirmation::text);
  END LOOP;
  RETURN envelope->>'id';
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION civic_authority_required_states(record_class text, scope text, version_id text) RETURNS text[] LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN $2 IN ('US-AZ:2026-general:supported-ballot','US-NH:merrimack:2026-general','US-NJ:county:morris:2026-general') THEN ARRAY[civic_authority_state($2)]
    ELSE (SELECT array_agg(state ORDER BY state) FROM (
      SELECT DISTINCT COALESCE(civic_authority_state(v->>'jurisdiction'),civic_authority_state(v->>'subjectId')) state
      FROM civic_data_candidates c,LATERAL civic_authority_members(c.candidate->'identities') a,LATERAL (SELECT reader_payload_node(item) v) b
      WHERE c.id=$3 AND c.record_class=$1 AND c.scope=$2) states WHERE state IS NOT NULL) END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION civic_authority_retirable(record_class text, scope text, version_id text) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE origin record; held civic_data_candidates%ROWTYPE; states text[]; state text; target text; child civic_data_promotions%ROWTYPE; prior jsonb; next jsonb;
BEGIN
  SELECT * INTO held FROM civic_data_candidates c WHERE c.id=version_id AND c.record_class=$1 AND c.scope=$2 AND c.state='PROMOTED' AND c.validation_receipt->>'decision'='GOOD';
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM civic_data_promotions p WHERE p.record_class=$1 AND p.scope=$2 AND p.current_version_id=version_id
    AND p.payload=held.candidate->'readModel' AND p.validation_receipt=held.validation_receipt) THEN RETURN false; END IF;
  SELECT * INTO origin FROM (SELECT f.family,o.* FROM unnest(ARRAY['ballot-contests','candidate-profiles','candidate-corpus','voting-sites','candidate-campaign-sites-derived']) f(family),LATERAL civic_authority_origin(f.family) o) all_origins
    WHERE all_origins.record_class=$1 AND all_origins.scope=$2;
  IF FOUND THEN
    states := civic_authority_required_states($1,$2,$3);
    IF array_length(states,1) IS NULL THEN RETURN false; END IF;
    FOREACH state IN ARRAY states LOOP
      target := 'US-'||state||':'||origin.suffix;
      IF NOT EXISTS(SELECT 1 FROM civic_data_promotions p JOIN civic_data_candidates c ON c.id=p.current_version_id
        WHERE p.record_class=$1 AND p.scope=target AND c.state='PROMOTED' AND c.validation_receipt->>'decision'='GOOD'
          AND p.payload=c.candidate->'readModel' AND p.validation_receipt=c.validation_receipt) THEN RETURN false; END IF;
      IF NOT EXISTS(SELECT 1 FROM civic_data_candidates c JOIN civic_data_candidate_events e ON e.candidate_id=c.id AND e.sequence=1
        WHERE c.record_class=$1 AND c.scope=target AND c.state='PROMOTED' AND c.validation_receipt->>'decision'='GOOD'
          AND left(e.detail,length('STATE_AUTHORITY_PARTITION_V1 '))='STATE_AUTHORITY_PARTITION_V1 '
          AND substring(e.detail from length('STATE_AUTHORITY_PARTITION_V1 ')+1)::jsonb->>'originId'=version_id) THEN RETURN false; END IF;
    END LOOP;
    RETURN true;
  END IF;
  IF NOT (($1='BALLOT_CANDIDACY' AND $2 IN ('US-AZ:2026-general:supported-ballot','US-NH:merrimack:2026-general'))
    OR ($1='BALLOT_FILING' AND $2='US-NJ:county:morris:2026-general')) THEN RETURN false; END IF;
  state := civic_authority_state($2); target := 'US-'||state||':state-election-ballots';
  SELECT p.* INTO child FROM civic_data_promotions p JOIN civic_data_candidates c ON c.id=p.current_version_id
    WHERE p.record_class='BALLOT_CANDIDACY' AND p.scope=target AND c.state='PROMOTED' AND c.validation_receipt->>'decision'='GOOD'
      AND p.payload=c.candidate->'readModel' AND p.validation_receipt=c.validation_receipt AND NOT c.candidate ? 'bootstrapImport';
  IF NOT FOUND THEN RETURN false; END IF;
  prior := reader_payload_node(reader_payload_node(held.candidate->'readModel')->'ballot'); next := reader_payload_node(child.payload);
  IF prior IS NULL THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM civic_authority_members(prior->'measures') old_measure
    WHERE NOT EXISTS(SELECT 1 FROM jsonb_each(reader_payload_node(next->'ballots')) b(k,stored),LATERAL civic_authority_members(reader_payload_node(stored)->'measures') new_measure
      WHERE civic_authority_decode(old_measure.item)=civic_authority_decode(new_measure.item))) THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM civic_authority_members(reader_payload_node(reader_payload_node(held.candidate->'readModel')->'measureAnalyses')->'analyses') old_analysis
    WHERE NOT EXISTS(SELECT 1 FROM jsonb_each(reader_payload_node(next->'ballots')) b(k,stored),LATERAL civic_authority_members(reader_payload_node(reader_payload_node(stored)->'measureAnalyses')->'analyses') new_analysis
      WHERE civic_authority_decode(old_analysis.item)=civic_authority_decode(new_analysis.item))) THEN RETURN false; END IF;

  RETURN NOT EXISTS(SELECT 1 FROM (SELECT reader_payload_node(item)->>'id' id FROM civic_authority_members(prior->'contests') UNION ALL SELECT reader_payload_node(item)->>'id' FROM civic_authority_members(prior->'candidacies')) a
    WHERE NOT EXISTS(SELECT 1 FROM jsonb_each(reader_payload_node(next->'ballots')) b(k,stored),LATERAL (SELECT reader_payload_node(stored) ballot) header,
      LATERAL (SELECT reader_payload_node(item)->>'id' id FROM civic_authority_members(ballot->'contests') UNION ALL SELECT reader_payload_node(item)->>'id' FROM civic_authority_members(ballot->'candidacies') UNION ALL SELECT reader_payload_node(item)->>'id' FROM civic_authority_members(ballot->'filingCandidacies')) n WHERE n.id=a.id));
END
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_civic_data_promotion_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF civic_authority_retirable(OLD.record_class,OLD.scope,OLD.current_version_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'civic_data_promotions is the live LKG authority; DELETE is forbidden' USING ERRCODE='55000';
  END IF;
  IF ROW(NEW.key,NEW.source_id,NEW.record_class,NEW.scope) IS DISTINCT FROM ROW(OLD.key,OLD.source_id,OLD.record_class,OLD.scope) THEN
    RAISE EXCEPTION 'civic_data_promotions projection authority identity cannot be rewritten' USING ERRCODE='55000';
  END IF;
  IF NEW.current_version_id IS NOT DISTINCT FROM OLD.current_version_id OR NEW.promoted_at<OLD.promoted_at THEN
    RAISE EXCEPTION 'civic_data_promotions may only advance to a distinct, non-backdated version' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION civic_authority_retire(state text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE pointer civic_data_promotions%ROWTYPE; count integer := 0;
BEGIN
  IF state !~ '^[A-Z]{2}$' THEN RAISE EXCEPTION 'Invalid authority state'; END IF;
  FOR pointer IN SELECT p.* FROM civic_data_promotions p WHERE
    EXISTS(SELECT 1 FROM unnest(ARRAY['ballot-contests','candidate-profiles','candidate-corpus','voting-sites','candidate-campaign-sites-derived']) f(family),LATERAL civic_authority_origin(f.family) o WHERE o.record_class=p.record_class AND o.scope=p.scope)
    OR civic_authority_state(p.scope)=state AND p.scope IN ('US-AZ:2026-general:supported-ballot','US-NH:merrimack:2026-general','US-NJ:county:morris:2026-general')
    ORDER BY p.key FOR UPDATE LOOP
    IF civic_authority_retirable(pointer.record_class,pointer.scope,pointer.current_version_id) THEN
      DELETE FROM civic_data_promotions WHERE key=pointer.key AND current_version_id=pointer.current_version_id;
      count := count+1;
    END IF;
  END LOOP;
  RETURN count;
END
$$;
