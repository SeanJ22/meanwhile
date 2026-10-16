ALTER TABLE database_transfer_daily ADD COLUMN reads jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
CREATE FUNCTION reader_payload_value(value jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE part jsonb; child jsonb; result jsonb; groups jsonb; ordinal_indexs integer[]; ordinal integer; member jsonb;
BEGIN
  IF value ? '$civicPayloadPart' THEN
    SELECT payload INTO part FROM civic_data_payload_parts WHERE hash=value->>'$civicPayloadPart';
    IF part IS NULL THEN RAISE EXCEPTION 'CIVIC_PAYLOAD_PART_MISSING'; END IF;
    IF part->>'kind'='string' THEN
      result:='""'::jsonb;
      FOR child IN SELECT v FROM jsonb_array_elements(part->'chunks') e(v) LOOP
        result:=to_jsonb((result#>>'{}')||(reader_payload_value(child)#>>'{}'));
      END LOOP;
      RETURN result;
    ELSIF part->>'kind'='object' THEN RETURN reader_payload_value(part->'value');
    ELSIF part->>'kind'='array' THEN
      groups:=reader_payload_value(part->'groups');
      ordinal_indexs:=array_fill(0,ARRAY[jsonb_array_length(groups)]);
      result:='[]'::jsonb;
      FOR member IN SELECT v FROM jsonb_array_elements((reader_payload_value(part->'order')#>>'{}')::jsonb) e(v) LOOP
        ordinal:=(member#>>'{}')::integer;
        result:=result||jsonb_build_array(groups->ordinal->ordinal_indexs[ordinal+1]);
        ordinal_indexs[ordinal+1]:=ordinal_indexs[ordinal+1]+1;
      END LOOP;
      RETURN result;
    ELSE RETURN reader_payload_value(part); END IF;
  ELSIF jsonb_typeof(value)='object' THEN
    SELECT COALESCE(jsonb_object_agg(k,reader_payload_value(v)),'{}'::jsonb) INTO result FROM jsonb_each(value) e(k,v);
    RETURN result;
  ELSIF jsonb_typeof(value)='array' THEN
    SELECT COALESCE(jsonb_agg(reader_payload_value(v) ORDER BY n),'[]'::jsonb) INTO result FROM jsonb_array_elements(value) WITH ORDINALITY e(v,n);
    RETURN result;
  END IF;
  RETURN value;
END $$;
--> statement-breakpoint
CREATE FUNCTION reader_record_keys(value jsonb, field text DEFAULT '') RETURNS text[] LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE result text[]:='{}'; k text; v jsonb; tag text;
BEGIN
  IF field IN ('rollCalls','votes','profiles','snapshots','statements') THEN RETURN result; END IF;
  IF jsonb_typeof(value)='object' THEN
    FOR k,v IN SELECT * FROM jsonb_each(value) LOOP
      IF k ~ '^(ocd-person/|congress:|nh-general-court:|[A-Z][0-9]{6}$)' THEN result:=result||k; END IF;
      result:=result||reader_record_keys(v,k);
    END LOOP;
  ELSIF jsonb_typeof(value)='array' THEN
    FOR v IN SELECT * FROM jsonb_array_elements(value) LOOP result:=result||reader_record_keys(v,field); END LOOP;
  ELSIF jsonb_typeof(value)='string' AND field !~* '^(source|parent|version|committee|eventItem)' AND field ~* '(id|ids|key|keys|bioguide)$' THEN
    tag:=value#>>'{}';
    result:=result||tag;
  END IF;
  RETURN result;
END $$;
--> statement-breakpoint
CREATE FUNCTION reader_payload_node(value jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE part jsonb;
BEGIN
  IF value IS NULL OR NOT value ? '$civicPayloadPart' THEN RETURN value; END IF;
  SELECT payload INTO part FROM civic_data_payload_parts WHERE hash=value->>'$civicPayloadPart';
  IF part IS NULL THEN RAISE EXCEPTION 'CIVIC_PAYLOAD_PART_MISSING'; END IF;
  IF part->>'kind'='object' THEN RETURN part->'value'; END IF;
  RETURN part;
END $$;
--> statement-breakpoint
CREATE FUNCTION reader_payload_members(value jsonb) RETURNS TABLE(ordinal_index bigint,item jsonb) LANGUAGE plpgsql STABLE AS $$
DECLARE node jsonb:=reader_payload_node(value); groups jsonb; member jsonb; offsets integer[]; group_id integer;
BEGIN
  IF node->>'kind'='array' THEN
    SELECT jsonb_agg(reader_payload_node(v) ORDER BY n) INTO groups FROM jsonb_array_elements(node->'groups') WITH ORDINALITY e(v,n);
    offsets:=array_fill(0,ARRAY[jsonb_array_length(groups)]);
    ordinal_index:=0;
    FOR member IN SELECT v FROM jsonb_array_elements((reader_payload_value(node->'order')#>>'{}')::jsonb) e(v) LOOP
      group_id:=(member#>>'{}')::integer;
      item:=groups->group_id->offsets[group_id+1];
      offsets[group_id+1]:=offsets[group_id+1]+1;
      ordinal_index:=ordinal_index+1;
      RETURN NEXT;
    END LOOP;
  ELSE
    RETURN QUERY SELECT n,v FROM jsonb_array_elements(node) WITH ORDINALITY e(v,n);
  END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION reader_payload_nearby(value jsonb, point jsonb) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE location jsonb:=reader_payload_node(value);
BEGIN
  IF point IS NULL OR jsonb_typeof(location->'lat') IS DISTINCT FROM 'number' OR jsonb_typeof(location->'lng') IS DISTINCT FROM 'number' THEN RETURN false; END IF;
  RETURN abs((location->>'lat')::double precision-(point->>1)::double precision)<=150.0/110 AND
    LEAST(abs((location->>'lng')::double precision-(point->>0)::double precision),
      360-abs((location->>'lng')::double precision-(point->>0)::double precision))<=
      150.0/(110*GREATEST(0.01,cos(radians(LEAST(90,abs((point->>1)::double precision)+150.0/110)))));
END $$;
--> statement-breakpoint
CREATE FUNCTION reader_payload_slice(value jsonb, wanted text[], field text DEFAULT '', point jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE node jsonb:=reader_payload_node(value); result jsonb; child jsonb; header jsonb; k text; v jsonb;
BEGIN
  IF jsonb_typeof(node)='array' OR node->>'kind'='array' THEN
    result:='[]'::jsonb;
    FOR child IN SELECT item FROM reader_payload_members(value) ORDER BY ordinal_index LOOP
      header:=reader_payload_node(child);
      IF jsonb_typeof(header) NOT IN ('array','object') OR cardinality(reader_record_keys(header))=0 OR
        EXISTS(SELECT 1 FROM jsonb_path_query(header,'$.**') e(v) WHERE e.v#>>'{}'=ANY(wanted)) OR field='meetings' AND reader_payload_nearby(header->'location',point) THEN
        result:=result||jsonb_build_array(reader_payload_value(child));
      END IF;
    END LOOP;
    RETURN result;
  ELSIF jsonb_typeof(node)='object' AND COALESCE(node->>'kind','')<>'string' THEN
    result:='{}'::jsonb;
    FOR k,v IN SELECT * FROM jsonb_each(node) LOOP
      IF field IN ('byMember','cards','links','rosterPhotos','codes') AND NOT node ? field THEN
        IF k=ANY(wanted) THEN result:=result||jsonb_build_object(k,reader_payload_value(v)); END IF;
      ELSE result:=result||jsonb_build_object(k,reader_payload_slice(v,wanted,k,point)); END IF;
    END LOOP;
    RETURN result;
  END IF;
  RETURN reader_payload_value(value);
END $$;
--> statement-breakpoint
CREATE FUNCTION reader_place_payload(value jsonb, wanted text[], point jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE result jsonb; previous integer; tag text; header jsonb; stamp text; earliest text; first_day text; same_day boolean:=true; carried_count integer:=0;
BEGIN
  IF reader_payload_node(value)->>'officeholderId'=ANY(wanted) THEN RETURN reader_payload_value(value); END IF;
  LOOP
    previous:=cardinality(wanted);
    result:=reader_payload_slice(value,wanted,'',point);
    FOR tag IN SELECT DISTINCT unnest(reader_record_keys(result)) LOOP
      CONTINUE WHEN tag LIKE 'ocd-division/%' AND tag NOT LIKE '%#%';
      IF NOT tag=ANY(wanted) THEN wanted:=wanted||tag; END IF;
      IF tag LIKE 'congress:%' AND NOT substring(tag FROM 10)=ANY(wanted) THEN wanted:=wanted||substring(tag FROM 10); END IF;
    END LOOP;
    EXIT WHEN cardinality(wanted)=previous;
  END LOOP;
  IF result ? 'meetings' AND result ? 'counts' THEN
    FOR header IN SELECT reader_payload_node(item) FROM reader_payload_members(reader_payload_node(value)->'meetings') LOOP
      stamp:=reader_payload_node(header->'carried')->>'lastFreshAt';
      CONTINUE WHEN stamp IS NULL;
      carried_count:=carried_count+1;
      IF first_day IS NULL THEN first_day:=substring(stamp,1,10); END IF;
      IF first_day<>substring(stamp,1,10) THEN same_day:=false; END IF;
      IF earliest IS NULL OR stamp::timestamptz<earliest::timestamptz THEN earliest:=stamp; END IF;
    END LOOP;
    IF carried_count>0 THEN result:=result||jsonb_build_object('carriedSummary',jsonb_build_object('count',carried_count,
      'lastFreshAt',CASE WHEN same_day THEN earliest ELSE NULL END)); END IF;
  END IF;
  RETURN result;
END $$;
--> statement-breakpoint
CREATE FUNCTION reader_inventory_payload(value jsonb, page_offset integer, page_size integer) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE node jsonb:=reader_payload_node(value); selected jsonb; total integer;
BEGIN
  SELECT COALESCE(jsonb_agg(reader_payload_value(item) ORDER BY ordinal_index) FILTER
    (WHERE ordinal_index>page_offset AND ordinal_index<=page_offset+page_size),'[]'::jsonb),count(*) INTO selected,total
    FROM reader_payload_members(node->'governments');
  RETURN reader_payload_value(node-'governments')||jsonb_build_object('governments',selected,'governmentCount',total);
END $$;
