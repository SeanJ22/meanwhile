CREATE FUNCTION write_civic_data_prl_row(p_key text,p_class text,p_scope text,p_version text,p_at timestamptz,
  p_collection text,p_ordinal bigint,p_identity text,p_value jsonb) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO civic_data_rows(promotion_key,record_class,scope,version_id,promoted_at,collection,ordinal,row_id,value,content_hash)
    VALUES(p_key,p_class,p_scope,p_version,p_at,p_collection,p_ordinal,p_identity,p_value,
      encode(sha256(convert_to(p_value::text,'UTF8')),'hex'))
    ON CONFLICT(promotion_key,collection,ordinal) DO UPDATE SET record_class=excluded.record_class,scope=excluded.scope,
      version_id=excluded.version_id,promoted_at=excluded.promoted_at,row_id=excluded.row_id,value=excluded.value,content_hash=excluded.content_hash,
      change_id=CASE WHEN (civic_data_rows.row_id,civic_data_rows.value,civic_data_rows.scope)
        IS DISTINCT FROM (excluded.row_id,excluded.value,excluded.scope) THEN nextval('civic_data_row_change') ELSE civic_data_rows.change_id END;
END $$;
--> statement-breakpoint
CREATE FUNCTION refresh_civic_data_prl_rows(p_key text,p_class text,p_scope text,p_version text,p_at timestamptz,p_payload jsonb)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE root jsonb:=reader_payload_node(p_payload); datasets jsonb; dataset record; receipt jsonb; header jsonb;
  profiles jsonb; member record; profile jsonb; identity text; collection_name text; dataset_ordinal bigint:=0; last_profile bigint;
  collections text[]:='{}'::text[]; profile_shape text; misses_shape text;
BEGIN
  IF p_class='PRL_PROFILE' THEN
    profiles:=reader_payload_node(root->'profiles');
    profile_shape:=CASE WHEN profiles->>'kind'='array' THEN 'array' ELSE coalesce(jsonb_typeof(profiles),'missing') END;
    misses_shape:=CASE WHEN reader_payload_node(root->'rosterMisses')->>'kind'='array' THEN 'array'
      ELSE coalesce(jsonb_typeof(reader_payload_node(root->'rosterMisses')),'missing') END;
    SELECT coalesce(jsonb_object_agg(k,v),'{}'::jsonb) INTO header FROM jsonb_each(root) e(k,v)
      WHERE k=ANY(ARRAY['formatVersion','fetchedAt','sourceFile','sourceUrl','rowsInFile','rowsWithStatements','attribution']);
    header:=header||jsonb_build_object('profileShape',profile_shape,'rosterMissesShape',misses_shape);
    PERFORM write_civic_data_prl_row(p_key,p_class,p_scope,p_version,p_at,'prl.snapshot',1,'metadata',header);
    collections:=ARRAY['prl.snapshot','prl.profiles'];last_profile:=0;
    IF profile_shape='array' THEN
      FOR member IN SELECT ordinal_index,item FROM reader_payload_members(root->'profiles') ORDER BY ordinal_index LOOP
        profile:=reader_payload_node(member.item);identity:=reader_payload_value(profile->'bioguideId')#>>'{}';
        IF identity IS NULL THEN identity:='unidentified:'||member.ordinal_index::text; END IF;
        PERFORM write_civic_data_prl_row(p_key,p_class,p_scope,p_version,p_at,'prl.profiles',member.ordinal_index,identity,profile);
        last_profile:=member.ordinal_index;
      END LOOP;
    END IF;
    DELETE FROM civic_data_rows WHERE promotion_key=p_key AND collection='prl.profiles' AND ordinal>last_profile;
  ELSIF p_class='PRL_ARCHIVE' THEN
    datasets:=reader_payload_node(root->'datasets');collections:=ARRAY['prl.datasets'];
    IF jsonb_typeof(datasets)='object' THEN
      FOR dataset IN SELECT k,v FROM jsonb_each(datasets) e(k,v) ORDER BY k LOOP
        dataset_ordinal:=dataset_ordinal+1;receipt:=reader_payload_node(dataset.v);profiles:=reader_payload_node(receipt->'profiles');
        profile_shape:=CASE WHEN profiles->>'kind'='array' THEN 'array' ELSE coalesce(jsonb_typeof(profiles),'missing') END;
        SELECT coalesce(jsonb_object_agg(k,v),'{}'::jsonb) INTO header FROM jsonb_each(receipt) e(k,v)
          WHERE k=ANY(ARRAY['formatVersion','parserVersion','sourceBytes','objectRoot','subjectCount','datasetId','scope','title','target',
            'sourceUrl','sourceFinalUrl','sourceSha256','member','cursorField','fetchedAt','highWaterMark','previousMark','rowsSeen',
            'rowsWritten','rowsAfterNow','rowsUnparseableCursor','coverageFrom','coverageThrough','objectStore','profileKind','attribution']);
        header:=header||jsonb_build_object('profileShape',profile_shape);
        PERFORM write_civic_data_prl_row(p_key,p_class,p_scope,p_version,p_at,'prl.datasets',dataset_ordinal,dataset.k,header);
        collection_name:='prl.profiles:'||dataset.k;collections:=collections||collection_name;last_profile:=0;
        IF profile_shape='array' THEN
          FOR member IN SELECT ordinal_index,item FROM reader_payload_members(receipt->'profiles') ORDER BY ordinal_index LOOP
            profile:=reader_payload_node(member.item);
            identity:=coalesce(reader_payload_value(profile->'openstatesId')#>>'{}',reader_payload_value(profile->'candidateId')#>>'{}',
              reader_payload_value(profile->'bioguideId')#>>'{}','unidentified:'||member.ordinal_index::text);
            PERFORM write_civic_data_prl_row(p_key,p_class,p_scope,p_version,p_at,collection_name,member.ordinal_index,identity,profile);
            last_profile:=member.ordinal_index;
          END LOOP;
        END IF;
        DELETE FROM civic_data_rows WHERE promotion_key=p_key AND collection=collection_name AND ordinal>last_profile;
      END LOOP;
    END IF;
    DELETE FROM civic_data_rows WHERE promotion_key=p_key AND collection='prl.datasets' AND ordinal>dataset_ordinal;
  ELSE RETURN;
  END IF;
  DELETE FROM civic_data_rows WHERE promotion_key=p_key AND collection LIKE 'prl.%' AND NOT collection=ANY(collections);
END $$;
--> statement-breakpoint
CREATE FUNCTION civic_data_prl_rows_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN DELETE FROM civic_data_rows WHERE promotion_key=OLD.key AND collection LIKE 'prl.%';RETURN OLD;END IF;
  IF TG_OP='UPDATE' AND NEW.key IS DISTINCT FROM OLD.key THEN DELETE FROM civic_data_rows WHERE promotion_key=OLD.key AND collection LIKE 'prl.%';END IF;
  PERFORM refresh_civic_data_prl_rows(NEW.key,NEW.record_class,NEW.scope,NEW.current_version_id,NEW.promoted_at,NEW.payload);RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER zz_prl_civic_data_rows_changed AFTER INSERT OR UPDATE OF key,record_class,scope,current_version_id,promoted_at,payload OR DELETE
  ON civic_data_promotions FOR EACH ROW EXECUTE FUNCTION civic_data_prl_rows_changed();
--> statement-breakpoint
DO $$ DECLARE promotion record; BEGIN
  FOR promotion IN SELECT key,record_class,scope,current_version_id,promoted_at,payload FROM civic_data_promotions WHERE record_class IN ('PRL_PROFILE','PRL_ARCHIVE') LOOP
    PERFORM refresh_civic_data_prl_rows(promotion.key,promotion.record_class,promotion.scope,promotion.current_version_id,promotion.promoted_at,promotion.payload);
  END LOOP;
END $$;
