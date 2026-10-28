CREATE FUNCTION refresh_venue_rows(p_key text,p_class text,p_scope text,p_version text,p_at timestamptz,p_payload jsonb)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE root jsonb:=reader_payload_node(p_payload); member record; document jsonb; identity text; body text;
BEGIN
  DELETE FROM civic_data_rows WHERE promotion_key=p_key AND collection='venues';
  IF p_class<>'CURATED_READER_RECORD' OR root->>'kind' IS DISTINCT FROM 'venue-resolutions' THEN RETURN; END IF;
  FOR member IN SELECT ordinal_index,item FROM reader_payload_members(root->'records') ORDER BY ordinal_index LOOP
    document:=reader_payload_node(member.item);
    body:=document->>'bodyOcdId';
    identity:=coalesce(document->>'id',concat_ws(':',p_scope,document->>'sourceId',body,document->>'tenant',document->>'match'));
    INSERT INTO civic_data_rows(promotion_key,record_class,scope,version_id,promoted_at,collection,ordinal,row_id,body_id,state,label_key,aliases,value,content_hash)
      VALUES(p_key,p_class,p_scope,p_version,p_at,'venues',member.ordinal_index,identity,body,
        upper(substring(body FROM '/(?:state|territory|district):([a-z]{2})')),
        trim(regexp_replace(lower(reader_payload_value(document->'name')#>>'{}'),'[^[:alnum:]]+',' ','g')),
        array_remove(ARRAY[identity,document->>'sourceId'],NULL),document,encode(sha256(convert_to(document::text,'UTF8')),'hex'));
  END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION venue_rows_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM refresh_venue_rows(NEW.key,NEW.record_class,NEW.scope,NEW.current_version_id,NEW.promoted_at,NEW.payload);
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER zzz_venue_rows_changed AFTER INSERT OR UPDATE OF key,record_class,scope,current_version_id,promoted_at,payload
  ON civic_data_promotions FOR EACH ROW EXECUTE FUNCTION venue_rows_changed();
--> statement-breakpoint
CREATE INDEX civic_data_rows_venue_source_body ON civic_data_rows(promotion_key,(value->>'sourceId'),body_id,(value->>'tenant')) WHERE collection='venues';
--> statement-breakpoint
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT key,record_class,scope,current_version_id,promoted_at,payload FROM civic_data_promotions
    WHERE record_class='CURATED_READER_RECORD' AND reader_payload_node(payload)->>'kind'='venue-resolutions' LOOP
    PERFORM refresh_venue_rows(p.key,p.record_class,p.scope,p.current_version_id,p.promoted_at,p.payload);
  END LOOP;
END $$;
