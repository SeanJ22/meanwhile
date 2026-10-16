CREATE OR REPLACE FUNCTION reader_payload_members(value jsonb) RETURNS TABLE(ordinal_index bigint,item jsonb) LANGUAGE plpgsql STABLE AS $$
DECLARE node jsonb:=reader_payload_node(value);
BEGIN
  IF node->>'kind'='array' THEN
    RETURN QUERY WITH positions AS (
      SELECT n AS ordinal,(v#>>'{}')::integer AS group_id,
        row_number() OVER (PARTITION BY v ORDER BY n)-1 AS position
      FROM jsonb_array_elements((reader_payload_value(node->'order')#>>'{}')::jsonb) WITH ORDINALITY e(v,n)
    ), groups AS MATERIALIZED (
      SELECT (n-1)::integer AS group_id,reader_payload_node(v) AS members
      FROM jsonb_array_elements(node->'groups') WITH ORDINALITY e(v,n)
    ) SELECT p.ordinal,g.members->p.position::integer FROM positions p JOIN groups g USING(group_id) ORDER BY p.ordinal;
  ELSE RETURN QUERY SELECT n,v FROM jsonb_array_elements(node) WITH ORDINALITY e(v,n);
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE reader_place_roots (
  pointer_key text PRIMARY KEY,
  version_id text NOT NULL,
  base jsonb NOT NULL,
  temporal jsonb,
  retrieved_at timestamptz
);
--> statement-breakpoint
CREATE TABLE reader_place_records (
  pointer_key text NOT NULL,
  path jsonb NOT NULL,
  selectors text[] NOT NULL,
  follows text[] NOT NULL,
  payload jsonb NOT NULL,
  initialize boolean NOT NULL DEFAULT false,
  owner_key text NOT NULL DEFAULT '',
  location point,
  PRIMARY KEY (pointer_key,path)
);
--> statement-breakpoint
CREATE INDEX reader_place_records_selectors ON reader_place_records USING gin(selectors);
--> statement-breakpoint
CREATE INDEX reader_place_records_shared ON reader_place_records(pointer_key,path) WHERE selectors @> ARRAY['shared'];
--> statement-breakpoint
CREATE INDEX reader_place_records_location ON reader_place_records USING gist(location);
--> statement-breakpoint
CREATE FUNCTION reader_record_states(path jsonb,selectors text[],payload jsonb) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(array_agg(DISTINCT state ORDER BY state),ARRAY['us']) FROM (
    SELECT lower(COALESCE(
      substring(tag FROM '(?:state|territory|district):([a-zA-Z]{2})\M'),
      substring(tag FROM '^(?:government:(?:US-)?|statewide:|state:)([a-zA-Z]{2})\M'),
      substring(tag FROM '^([a-zA-Z]{2}):[0-9]{4}'),
      substring(tag FROM '\mUS-([a-zA-Z]{2})\M'),
      substring(tag FROM '^(?:curated:|plural:|legiscan:|roster:curated:)([a-zA-Z]{2})(?::|/)'),
      substring(tag FROM '^ballot-([a-zA-Z]{2})[:-]'))) state
    FROM unnest(selectors||ARRAY(SELECT jsonb_array_elements_text(path))||
      CASE WHEN payload->>'state' ~ '^[a-zA-Z]{2}$' THEN ARRAY['state:'||(payload->>'state')] ELSE '{}' END) tag
  ) states WHERE state IS NOT NULL
$$;
--> statement-breakpoint
CREATE INDEX reader_place_records_states ON reader_place_records USING gin(reader_record_states(path,selectors,payload));
--> statement-breakpoint
CREATE FUNCTION reader_record_owner(path jsonb,selectors text[],payload jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(NULLIF(payload->>'ocdId',''),NULLIF(payload->>'divisionId',''),
    CASE WHEN payload->>'bodyId' LIKE 'ocd-division/%' THEN split_part(payload->>'bodyId','#',1) END,
    (SELECT split_part(tag,'#',1) FROM unnest(selectors) tag WHERE tag LIKE 'ocd-division/%' ORDER BY length(split_part(tag,'#',1)) DESC,tag LIMIT 1),
    selectors[1],'path:'||path::text)
$$;
--> statement-breakpoint
CREATE INDEX reader_place_records_owner ON reader_place_records(pointer_key,owner_key,path);
--> statement-breakpoint
CREATE TABLE reader_place_versions (
  pointer_key text NOT NULL,
  state text NOT NULL,
  owner_key text NOT NULL,
  version text NOT NULL,
  PRIMARY KEY(pointer_key,state,owner_key)
);
--> statement-breakpoint
CREATE TABLE reader_place_couplings (
  pointer_key text NOT NULL,
  contract_id text NOT NULL,
  selectors text[] NOT NULL,
  coupling jsonb NOT NULL,
  PRIMARY KEY(pointer_key,contract_id)
);
--> statement-breakpoint
CREATE INDEX reader_place_couplings_selectors ON reader_place_couplings USING gin(selectors);
--> statement-breakpoint
CREATE FUNCTION reader_decode_component(value text) RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT convert_from(decode(string_agg(CASE WHEN left(part[1],1)='%' THEN substring(part[1] FROM 2)
    ELSE encode(convert_to(part[1],'UTF8'),'hex') END,''),'hex'),'UTF8')
  FROM regexp_matches(value,'(%[0-9A-Fa-f]{2}|[^%]+)','g') part
$$;
--> statement-breakpoint
CREATE FUNCTION reader_selected_couplings(pointer text,wanted text[]) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(coupling ORDER BY contract_id),'[]') FROM reader_place_couplings
    WHERE pointer_key=pointer AND selectors && (wanted||'shared'::text)
$$;
--> statement-breakpoint
CREATE INDEX reader_place_records_vote_positions ON reader_place_records(pointer_key,(payload->>'voteId')) WHERE path->>-2='positions';
--> statement-breakpoint
CREATE FUNCTION reader_government_key(state text, name text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE normalized text; inverted text[];
BEGIN
  normalized:=trim(regexp_replace(regexp_replace(replace(upper(name),'&',' AND '),'[^A-Z0-9, ]',' ','g'),'\s+',' ','g'));
  inverted:=regexp_match(normalized,'^(.+?),\s*(CITY|TOWN|TOWNSHIP|VILLAGE|BOROUGH|COUNTY)\s+OF$');
  IF inverted IS NOT NULL THEN normalized:=inverted[2]||' OF '||inverted[1]; END IF;
  RETURN 'government:'||upper(state)||':'||trim(regexp_replace(replace(normalized,',',''),'\s+',' ','g'));
END $$;
--> statement-breakpoint
CREATE FUNCTION reader_identity_keys(value jsonb, field text DEFAULT '') RETURNS text[] LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE result text[]:='{}'; k text; v jsonb;
BEGIN
  IF jsonb_typeof(value)='object' THEN
    FOR k,v IN SELECT * FROM jsonb_each(value) LOOP
      CONTINUE WHEN k=ANY(ARRAY['provenance','fieldSources','membershipSource','source','receipt','temporal','acquisition','evidence','election','door','provider']);
      result:=result||reader_identity_keys(v,k);
    END LOOP;
    IF jsonb_typeof(value->'state')='string' AND (jsonb_typeof(value->'organization')='string' OR value->>'kind'='GOVERNMENT' AND jsonb_typeof(value->'name')='string') THEN
      result:=result||reader_government_key(value->>'state',COALESCE(value->>'name',value->>'organization'));
    END IF;
    IF jsonb_typeof(value->'organization')='string' AND jsonb_typeof(value->'domain')='string' THEN result:=result||('domain:'||lower(value->>'domain')); END IF;
  ELSIF jsonb_typeof(value)='array' THEN
    FOR v IN SELECT * FROM jsonb_array_elements(value) LOOP result:=result||reader_identity_keys(v,field); END LOOP;
  ELSIF jsonb_typeof(value)='string' AND field=ANY(ARRAY['id','ocdId','contestId','candidacyId','personId','bodyId','officeholderId','meetingId','subjectId','divisionId','stateOcdId',
    'alsoServesOcdIds','divisions','divisionIds','candidateKey','targetKeys','member','bioguideId']) THEN result:=ARRAY[value#>>'{}'];
  END IF;
  RETURN result;
END $$;
--> statement-breakpoint
CREATE FUNCTION reader_follow_keys(tags text[]) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(array_agg(DISTINCT key),'{}') FROM (
    SELECT tag key FROM unnest(tags) tag WHERE (tag NOT LIKE 'ocd-division/%' OR tag LIKE '%#%') AND tag<>'shared' AND tag NOT LIKE 'inventory:%'
    UNION SELECT substring(tag FROM 10) FROM unnest(tags) tag WHERE tag LIKE 'congress:%'
  ) keys
$$;
--> statement-breakpoint
CREATE FUNCTION reader_index_node(pointer text, value jsonb, path jsonb DEFAULT '[]', owners text[] DEFAULT '{}', metadata text[] DEFAULT '{}') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE node jsonb:=reader_payload_node(value); result jsonb; k text; v jsonb; row_value jsonb; row_path jsonb;
  tags text[]; selectors text[]; follows text[]; extra text[]; district_families jsonb; n integer; terminal boolean; frame text; member text; position jsonb;
BEGIN
  IF pointer LIKE 'REGISTRY_RUNTIME_BINDING:%' AND path->>0=ANY(ARRAY['bodyRosters','rosterReaderDispositions']) THEN RETURN '[]'::jsonb;
  ELSIF path->>-1='entries' AND (jsonb_typeof(node)='array' OR node->>'kind'='array') THEN
    result:='[]';
    FOR n,v IN SELECT ordinal_index-1,item FROM reader_payload_members(value) LOOP
      result:=result||jsonb_build_array(reader_index_node(pointer,v,path||to_jsonb(n),owners,metadata));
    END LOOP;
    RETURN result;
  ELSIF jsonb_typeof(node)='array' OR node->>'kind'='array' THEN
    IF NOT EXISTS(SELECT 1 FROM reader_payload_members(value) WHERE jsonb_typeof(reader_payload_node(item)) IN ('object','array')) THEN RETURN reader_payload_value(value); END IF;
    result:='[]';
    FOR n,v IN SELECT ordinal_index-1,item FROM reader_payload_members(value) LOOP
      row_value:=reader_payload_value(v); row_path:=path||to_jsonb(n);
      tags:=reader_identity_keys(row_value)||owners;
      IF path->>-1='rosterReaderDispositions' THEN
        SELECT tags||COALESCE(array_agg(ids.tag),'{}') INTO tags FROM unnest(ARRAY[row_value->>'sourceId',row_value->>'canonicalId']) ids(tag) WHERE ids.tag IS NOT NULL;
      END IF;
      IF path->>-1='hunts' AND row_value->>'key' ~ '^(ballot-|ocd-|roster:|congress:|fec:|statewide:)' THEN tags:=tags||(row_value->>'key'); END IF;
      IF path->>-1='containers' THEN tags:=tags||('container:'||n); END IF;
      IF path->>0='governments' THEN tags:=tags||('inventory:'||(n/50)); END IF;
      SELECT COALESCE(array_agg(DISTINCT x),'{}') INTO tags FROM unnest(tags) x;
      selectors:=CASE WHEN cardinality(tags)=0 THEN ARRAY['shared'] ELSE tags END;
      terminal:=path ?| ARRAY['containers','rollCalls','votes','profiles','snapshots','statements'];
      follows:=CASE WHEN terminal THEN '{}' ELSE reader_follow_keys(tags) END;
      IF path->>-1='positions' AND jsonb_typeof(row_value->'voteId')='string' THEN follows:=follows||(row_value->>'voteId'); END IF;
      IF path->>-1='positions' AND jsonb_typeof(row_value->'rollCallId')='string' THEN follows:=follows||(row_value->>'rollCallId'); END IF;
      INSERT INTO reader_place_records(pointer_key,path,selectors,follows,payload,location) VALUES(pointer,row_path,selectors,follows||metadata,row_value,
        CASE WHEN path->>-1='meetings' AND jsonb_typeof(row_value->'location'->'lat')='number' AND jsonb_typeof(row_value->'location'->'lng')='number'
          THEN point((row_value->'location'->>'lng')::float8,(row_value->'location'->>'lat')::float8) ELSE NULL END)
        ON CONFLICT ON CONSTRAINT reader_place_records_pkey DO UPDATE SET selectors=excluded.selectors,follows=excluded.follows,payload=excluded.payload,location=excluded.location
        WHERE reader_place_records.payload IS DISTINCT FROM excluded.payload OR reader_place_records.selectors IS DISTINCT FROM excluded.selectors OR reader_place_records.follows IS DISTINCT FROM excluded.follows;
      INSERT INTO reader_index_paths VALUES(row_path) ON CONFLICT DO NOTHING;
    END LOOP;
    RETURN result;
  ELSIF jsonb_typeof(node)='object' AND COALESCE(node->>'kind','')<>'string' THEN
    IF node->>'selectionVersion'='v1' AND node ? 'positions' THEN
      result:=reader_payload_value(node);
      FOR k,v IN SELECT * FROM jsonb_each(result#>'{positions,positions}') LOOP
        FOR member,position IN SELECT * FROM jsonb_each(v) LOOP
          row_path:=path||jsonb_build_array('positions','positions',k,member);
          INSERT INTO reader_place_records(pointer_key,path,selectors,follows,payload)
            VALUES(pointer,row_path,ARRAY[member],metadata,position)
            ON CONFLICT ON CONSTRAINT reader_place_records_pkey DO UPDATE SET selectors=excluded.selectors,follows=excluded.follows,payload=excluded.payload
            WHERE reader_place_records.payload IS DISTINCT FROM excluded.payload OR reader_place_records.follows IS DISTINCT FROM excluded.follows;
          INSERT INTO reader_index_paths VALUES(row_path) ON CONFLICT DO NOTHING;
        END LOOP;
        result:=jsonb_set(result,ARRAY['positions','positions',k],'{}');
      END LOOP;
      RETURN result;
    END IF;
    IF path->>-1=ANY(ARRAY['byMember','cards','links','rosterPhotos','codes']) AND NOT node ? (path->>-1) THEN
      result:='{}';
      FOR k,v IN SELECT * FROM jsonb_each(node) LOOP
        row_value:=reader_payload_value(v); row_path:=path||to_jsonb(k);
        tags:=reader_identity_keys(row_value)||owners||k;
        IF path->>-1='codes' THEN
          SELECT COALESCE(array_agg('container:'||(x->>0)),'{}') INTO follows FROM jsonb_array_elements(row_value) x;
          selectors:=ARRAY[k];
        ELSE selectors:=tags; follows:=reader_follow_keys(tags); END IF;
        INSERT INTO reader_place_records(pointer_key,path,selectors,follows,payload,location) VALUES(pointer,row_path,selectors,follows||metadata,row_value,
        CASE WHEN path->>-1='meetings' AND jsonb_typeof(row_value->'location'->'lat')='number' AND jsonb_typeof(row_value->'location'->'lng')='number'
          THEN point((row_value->'location'->>'lng')::float8,(row_value->'location'->>'lat')::float8) ELSE NULL END)
          ON CONFLICT ON CONSTRAINT reader_place_records_pkey DO UPDATE SET selectors=excluded.selectors,follows=excluded.follows,payload=excluded.payload,location=excluded.location
          WHERE reader_place_records.payload IS DISTINCT FROM excluded.payload OR reader_place_records.selectors IS DISTINCT FROM excluded.selectors OR reader_place_records.follows IS DISTINCT FROM excluded.follows;
        INSERT INTO reader_index_paths VALUES(row_path) ON CONFLICT DO NOTHING;
      END LOOP;
      RETURN result;
    END IF;
    IF path->>-2='ballots' THEN frame:='frame:'||path::text; metadata:=metadata||frame; END IF;
    extra:=owners;
    FOR k IN SELECT unnest(ARRAY['officeholderId','personId','member']) LOOP
      IF jsonb_typeof(node->k)='string' THEN extra:=extra||(node->>k); END IF;
    END LOOP;
    result:='{}';
    FOR k,v IN SELECT * FROM jsonb_each(node) LOOP
      row_value:=reader_index_node(pointer,v,path||to_jsonb(k),extra,metadata);
      IF row_value IS NOT NULL THEN result:=result||jsonb_build_object(k,row_value); END IF;
    END LOOP;
    IF path='[]' AND node ? 'governments' THEN
      SELECT result||jsonb_build_object('governmentCount',count(*)) INTO result FROM reader_payload_members(node->'governments');
    END IF;
    IF node ? 'election' AND node ? 'contests' THEN
      SELECT COALESCE(jsonb_agg(DISTINCT m[1]||'/'||m[2]),'[]') INTO district_families FROM (
        SELECT regexp_match(reader_payload_node(item)->>'ocdId','^ocd-division/country:us/(?:state|territory|district):([a-z]{2})/(cd|sldu|sldl):[^/]+$') m
        FROM reader_payload_members(node->'contests')
        UNION ALL
        SELECT regexp_match(reader_payload_node(item)->>'ocdId','^ocd-division/country:us/(?:state|territory|district):([a-z]{2})/(cd|sldu|sldl):[^/]+$') m
        FROM reader_payload_members(COALESCE(node->'heldContests','[]'))
      ) families WHERE m IS NOT NULL;
      result:=result||jsonb_build_object('districtFamilies',district_families);
    END IF;
    IF frame IS NOT NULL THEN
      INSERT INTO reader_place_records(pointer_key,path,selectors,follows,payload,initialize)
        VALUES(pointer,path,ARRAY[frame],array_remove(metadata,frame),result,true)
        ON CONFLICT ON CONSTRAINT reader_place_records_pkey DO UPDATE SET selectors=excluded.selectors,follows=excluded.follows,payload=excluded.payload,initialize=true
        WHERE reader_place_records.payload IS DISTINCT FROM excluded.payload OR reader_place_records.follows IS DISTINCT FROM excluded.follows;
      INSERT INTO reader_index_paths VALUES(path) ON CONFLICT DO NOTHING;
      RETURN NULL;
    END IF;
    RETURN result;
  END IF;
  RETURN reader_payload_value(value);
END $$;
--> statement-breakpoint
CREATE FUNCTION reader_index_projection(pointer text, version text, source_payload jsonb, temporal jsonb DEFAULT NULL, retrieved timestamptz DEFAULT NULL, couplings jsonb DEFAULT '[]') RETURNS void LANGUAGE plpgsql AS $$
DECLARE base jsonb;
BEGIN
  IF pointer LIKE 'CENSUS_REFERENCE:%' THEN RETURN; END IF;
  IF pointer LIKE 'prepared:%' THEN
    INSERT INTO reader_place_couplings
      SELECT pointer,c->>'contractId',CASE WHEN c->>'contractId' LIKE 'meetings:%' THEN
        ARRAY[reader_decode_component(split_part(c->>'contractId',':',3)),split_part(reader_decode_component(split_part(c->>'contractId',':',3)),'#',1)]
        ELSE ARRAY['shared'] END,c FROM jsonb_array_elements(couplings) c
      ON CONFLICT(pointer_key,contract_id) DO UPDATE SET selectors=excluded.selectors,coupling=excluded.coupling
      WHERE reader_place_couplings.coupling IS DISTINCT FROM excluded.coupling;
    DELETE FROM reader_place_couplings WHERE pointer_key=pointer AND NOT contract_id IN (SELECT c->>'contractId' FROM jsonb_array_elements(couplings) c);
  END IF;
  CREATE TEMP TABLE IF NOT EXISTS reader_index_paths(path jsonb PRIMARY KEY) ON COMMIT DROP;
  TRUNCATE reader_index_paths;
  base:=reader_index_node(pointer,source_payload);
  IF base ? 'meetings' AND base ? 'counts' THEN
    SELECT base||jsonb_build_object('carriedSummary',jsonb_build_object('count',count(*),'lastFreshAt',
      CASE WHEN min(substring(payload->'carried'->>'lastFreshAt',1,10))=max(substring(payload->'carried'->>'lastFreshAt',1,10))
        THEN min(payload->'carried'->>'lastFreshAt') ELSE NULL END)) INTO base
      FROM reader_place_records WHERE pointer_key=pointer AND path->>0='meetings' AND payload->'carried'->>'lastFreshAt' IS NOT NULL HAVING count(*)>0;
    IF base IS NULL THEN base:=reader_index_node(pointer,source_payload); END IF;
  END IF;
  DELETE FROM reader_place_records r WHERE r.pointer_key=pointer AND NOT EXISTS(SELECT 1 FROM reader_index_paths p WHERE p.path=r.path);
  UPDATE reader_place_records SET owner_key=reader_record_owner(path,selectors,payload)
    WHERE pointer_key=pointer AND owner_key IS DISTINCT FROM reader_record_owner(path,selectors,payload);
  CREATE TEMP TABLE IF NOT EXISTS reader_owner_tags(tag text PRIMARY KEY,owner_key text NOT NULL) ON COMMIT DROP;
  TRUNCATE reader_owner_tags;
  INSERT INTO reader_owner_tags
    SELECT DISTINCT ON (tag) tag,owner_key FROM reader_place_records CROSS JOIN LATERAL unnest(selectors) tag
      WHERE pointer_key=pointer AND owner_key LIKE 'ocd-division/%' ORDER BY tag,length(owner_key) DESC,owner_key;
  UPDATE reader_place_records r SET owner_key=COALESCE((
    SELECT m.owner_key FROM unnest(r.selectors) ids(tag) CROSS JOIN LATERAL (
      SELECT owner_key FROM reader_owner_tags WHERE tag=ids.tag LIMIT 1
    ) m ORDER BY length(m.owner_key) DESC,m.owner_key LIMIT 1
  ),r.owner_key) WHERE r.pointer_key=pointer AND r.owner_key NOT LIKE 'ocd-division/%' AND NOT r.initialize;
  INSERT INTO reader_place_versions(pointer_key,state,owner_key,version)
    SELECT pointer,st,owner_key,md5(string_agg(md5(payload::text||path::text||selectors::text||follows::text),'' ORDER BY path))
    FROM reader_place_records CROSS JOIN LATERAL unnest(reader_record_states(path,selectors||owner_key,payload)) st
    WHERE pointer_key=pointer AND (pointer NOT LIKE 'REGISTRY_RUNTIME_BINDING:%' OR NOT path->>0=ANY(ARRAY['bodyRosters','rosterReaderDispositions','officialPhotos','rosterPhotos']))
    GROUP BY st,owner_key ON CONFLICT(pointer_key,state,owner_key) DO UPDATE SET version=excluded.version
    WHERE reader_place_versions.version IS DISTINCT FROM excluded.version;
  DELETE FROM reader_place_versions v WHERE v.pointer_key=pointer AND NOT EXISTS(
    SELECT 1 FROM reader_place_records r WHERE r.pointer_key=pointer AND r.owner_key=v.owner_key);
  INSERT INTO reader_place_roots VALUES(pointer,version,base,temporal,retrieved)
    ON CONFLICT(pointer_key) DO UPDATE SET version_id=excluded.version_id,base=excluded.base,temporal=excluded.temporal,retrieved_at=excluded.retrieved_at;
END $$;
--> statement-breakpoint
CREATE FUNCTION reader_index_projection() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE temporal jsonb; retrieved timestamptz;
BEGIN
  IF TG_TABLE_NAME='civic_data_promotions' THEN
    SELECT reader_payload_value(reader_payload_node(candidate)->'temporal'),retrieved_at INTO temporal,retrieved FROM civic_data_candidates WHERE id=NEW.current_version_id;
    PERFORM reader_index_projection(NEW.key,NEW.current_version_id,NEW.payload,temporal,retrieved);
  ELSE PERFORM reader_index_projection('prepared:'||NEW.key,NEW.sequence::text,NEW.payload,NULL,NULL,NEW.composed_from); END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER reader_index_promotion AFTER INSERT OR UPDATE OF payload,current_version_id ON civic_data_promotions FOR EACH ROW EXECUTE FUNCTION reader_index_projection();
--> statement-breakpoint
CREATE TRIGGER reader_index_prepared AFTER INSERT OR UPDATE OF payload,sequence ON civic_data_reader_projections FOR EACH ROW EXECUTE FUNCTION reader_index_projection();
--> statement-breakpoint
CREATE FUNCTION reader_nearby_box(near_point jsonb, shift integer, radius_km double precision) RETURNS box LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT box(point((near_point->>0)::float8+shift-dx,(near_point->>1)::float8-radius_km/110),
    point((near_point->>0)::float8+shift+dx,(near_point->>1)::float8+radius_km/110))
    FROM (SELECT radius_km/(110*GREATEST(0.01,cos(radians(LEAST(90,abs((near_point->>1)::float8)+radius_km/110))))) dx) radius
$$;
--> statement-breakpoint
CREATE FUNCTION reader_selected_records(pointer text, wanted text[], near_point jsonb DEFAULT NULL, include_agenda boolean DEFAULT true, meeting_id text DEFAULT NULL, near_radius_km double precision DEFAULT 150) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE pending text[]:=wanted||'shared'::text; queried text[]:='{}'; seen text[]:='{}'; result jsonb[]:='{}';
  next_keys text[]; row record; pin record;
BEGIN
  IF near_point IS NOT NULL THEN
    FOR pin IN EXECUTE $nearby$
      SELECT path,payload,follows,initialize FROM reader_place_records WHERE pointer_key=$1 AND
        ($2 IS NULL OR payload->>'id'=$2) AND (location <@ reader_nearby_box($3,-360,$4) OR location <@ reader_nearby_box($3,0,$4) OR location <@ reader_nearby_box($3,360,$4))
      $nearby$ USING pointer,meeting_id,near_point,near_radius_km LOOP
      seen:=seen||pin.path::text;
      result:=array_append(result,jsonb_build_object('path',pin.path,'value',pin.payload,'tags',pin.follows,'initialize',pin.initialize));
      pending:=pending||pin.follows;
    END LOOP;
  END IF;
  LOOP
    SELECT COALESCE(array_agg(DISTINCT key),'{}') INTO pending FROM unnest(pending) key WHERE NOT key=ANY(queried);
    EXIT WHEN cardinality(pending)=0;
    queried:=queried||pending; next_keys:='{}';
    -- Plan with actual keys and read a division once, rather than probing each of its records through the tag index.
    FOR row IN EXECUTE $selected$
      WITH owned AS MATERIALIZED (
        SELECT path,payload,follows,initialize,selectors,true whole FROM reader_place_records
          WHERE pointer_key=$1 AND owner_key=ANY($2) AND ($3 OR path->>0<>'agendaDocuments')
            AND ($4 IS NULL OR path->>0 NOT IN ('meetings','agendaDocuments') OR payload->>'id'=$4 OR payload->>'meetingId'=$4)
      ), selected AS (
        SELECT * FROM owned
        UNION ALL
        SELECT path,payload,follows,initialize,selectors,false FROM reader_place_records
          WHERE pointer_key=$1 AND selectors && ARRAY(SELECT key FROM unnest($2) key WHERE key<>'shared'
            AND NOT EXISTS(SELECT 1 FROM owned WHERE key=ANY(selectors)))
        UNION ALL
        SELECT path,payload,follows,initialize,selectors,false FROM reader_place_records
          WHERE pointer_key=$1 AND 'shared'=ANY($2) AND selectors @> ARRAY['shared']
      ) SELECT * FROM selected WHERE ($3 OR path->>0<>'agendaDocuments')
        AND ($4 IS NULL OR path->>0 NOT IN ('meetings','agendaDocuments') OR payload->>'id'=$4 OR payload->>'meetingId'=$4)
      $selected$ USING pointer,pending,include_agenda,meeting_id LOOP
      CONTINUE WHEN row.path::text=ANY(seen);
      seen:=seen||row.path::text;
      IF row.whole THEN queried:=queried||row.selectors; END IF;
      IF row.path->>-2='votes' AND row.payload->>'id' ~ '^(house|senate):' THEN
        SELECT row.payload||jsonb_build_object('readerPartyVoters',jsonb_build_object(
          'yes',COALESCE(jsonb_agg(payload->>'officeholderId') FILTER(WHERE payload->>'position'='YES'),'[]'),
          'no',COALESCE(jsonb_agg(payload->>'officeholderId') FILTER(WHERE payload->>'position'='NO'),'[]')))
          INTO row.payload FROM reader_place_records WHERE pointer_key=pointer AND path->>-2='positions' AND payload->>'voteId'=row.payload->>'id';
      END IF;
      result:=array_append(result,jsonb_build_object('path',row.path,'value',row.payload,'tags',row.follows,'initialize',row.initialize));
      next_keys:=next_keys||row.follows;
    END LOOP;
    pending:=next_keys;
  END LOOP;
  RETURN to_jsonb(result);
END $$;
