CREATE SEQUENCE civic_data_row_change;
--> statement-breakpoint
CREATE TABLE civic_data_rows (
  promotion_key text NOT NULL,
  record_class text NOT NULL,
  scope text NOT NULL,
  version_id text NOT NULL,
  promoted_at timestamptz NOT NULL,
  collection text NOT NULL,
  ordinal bigint NOT NULL,
  row_id text NOT NULL,
  body_id text,
  state text,
  aliases text[] NOT NULL DEFAULT '{}',
  value jsonb NOT NULL,
  content_hash text NOT NULL,
  change_id bigint NOT NULL DEFAULT nextval('civic_data_row_change'),
  PRIMARY KEY (promotion_key, collection, ordinal)
);
--> statement-breakpoint
CREATE INDEX civic_data_rows_identity ON civic_data_rows (record_class, scope, collection, row_id);
--> statement-breakpoint
CREATE INDEX civic_data_rows_body ON civic_data_rows (collection, body_id, promotion_key);
--> statement-breakpoint
CREATE INDEX civic_data_rows_state ON civic_data_rows (collection, state, row_id);
--> statement-breakpoint
CREATE INDEX civic_data_rows_aliases ON civic_data_rows USING gin (aliases);
--> statement-breakpoint
CREATE INDEX civic_data_rows_changes ON civic_data_rows (change_id) INCLUDE (collection, body_id);
--> statement-breakpoint
CREATE FUNCTION refresh_civic_data_rows(p_key text, p_class text, p_scope text, p_version text, p_at timestamptz, p_payload jsonb)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE root jsonb:=reader_payload_node(p_payload); registry jsonb; list jsonb; member record;
  collection_name text; collections text[]; document jsonb; identity text; body text; row_state text; names text[]; last_ordinal bigint;
BEGIN
  collections:=CASE p_class WHEN 'REGISTRATION' THEN ARRAY['governments']
    WHEN 'REGISTRY_RUNTIME_BINDING' THEN ARRAY['registry.bodies','registry.divisions','bodyRosters']
    WHEN 'MEETING' THEN ARRAY['meetings','agendaDocuments'] ELSE '{}'::text[] END;
  registry:=reader_payload_node(root->'registry');
  FOREACH collection_name IN ARRAY collections LOOP
    list:=CASE collection_name WHEN 'registry.bodies' THEN registry->'bodies'
      WHEN 'registry.divisions' THEN registry->'divisions' ELSE root->collection_name END;
    last_ordinal:=0;
    FOR member IN SELECT ordinal_index,item FROM reader_payload_members(list) ORDER BY ordinal_index LOOP
      document:=reader_payload_value(member.item);
      identity:=coalesce(document->>'id',document->>'ocdId',document->>'bodyId',member.ordinal_index::text);
      body:=CASE collection_name WHEN 'registry.bodies' THEN document->>'id'
        WHEN 'agendaDocuments' THEN (SELECT r.body_id FROM civic_data_rows r WHERE r.promotion_key=p_key
          AND r.collection='meetings' AND r.row_id=document->>'meetingId'
          AND r.value->>'ocdId' IS NOT DISTINCT FROM document->>'ocdId' ORDER BY r.ordinal LIMIT 1)
        ELSE document->>'bodyId' END;
      row_state:=upper(coalesce(document->>'state',substring(p_scope FROM '^US-([A-Z]{2})'),substring(body FROM '/state:([a-z]{2})')));
      SELECT coalesce(array_agg(DISTINCT name) FILTER (WHERE name IS NOT NULL),'{}'::text[]) INTO names
        FROM (SELECT identity AS name UNION ALL SELECT document->>'jurisdictionId'
          UNION ALL SELECT jsonb_array_elements_text(coalesce(document->'aliases','[]'::jsonb))
          UNION ALL SELECT jsonb_array_elements_text(coalesce(document->'bodyIds','[]'::jsonb))) identifiers;
      INSERT INTO civic_data_rows(promotion_key,record_class,scope,version_id,promoted_at,collection,ordinal,row_id,body_id,state,aliases,value,content_hash)
        VALUES(p_key,p_class,p_scope,p_version,p_at,collection_name,member.ordinal_index,identity,body,row_state,names,document,
          encode(sha256(convert_to(document::text,'UTF8')),'hex'))
        ON CONFLICT(promotion_key,collection,ordinal) DO UPDATE SET record_class=excluded.record_class,scope=excluded.scope,
          version_id=excluded.version_id,promoted_at=excluded.promoted_at,row_id=excluded.row_id,body_id=excluded.body_id,
          state=excluded.state,aliases=excluded.aliases,value=excluded.value,content_hash=excluded.content_hash,
          change_id=CASE WHEN (civic_data_rows.row_id,civic_data_rows.body_id,civic_data_rows.value,civic_data_rows.scope)
            IS DISTINCT FROM (excluded.row_id,excluded.body_id,excluded.value,excluded.scope)
            THEN nextval('civic_data_row_change') ELSE civic_data_rows.change_id END;
      last_ordinal:=member.ordinal_index;
    END LOOP;
    DELETE FROM civic_data_rows WHERE promotion_key=p_key AND collection=collection_name AND ordinal>last_ordinal;
  END LOOP;
  DELETE FROM civic_data_rows WHERE promotion_key=p_key AND NOT collection=ANY(collections);
END $$;
--> statement-breakpoint
CREATE FUNCTION civic_data_rows_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN DELETE FROM civic_data_rows WHERE promotion_key=OLD.key; RETURN OLD; END IF;
  IF TG_OP='UPDATE' AND NEW.key IS DISTINCT FROM OLD.key THEN DELETE FROM civic_data_rows WHERE promotion_key=OLD.key; END IF;
  PERFORM refresh_civic_data_rows(NEW.key,NEW.record_class,NEW.scope,NEW.current_version_id,NEW.promoted_at,NEW.payload);
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER civic_data_rows_changed AFTER INSERT OR UPDATE OF key,record_class,scope,current_version_id,promoted_at,payload OR DELETE
  ON civic_data_promotions FOR EACH ROW EXECUTE FUNCTION civic_data_rows_changed();
--> statement-breakpoint
DO $$ DECLARE promotion record; BEGIN
  FOR promotion IN SELECT key,record_class,scope,current_version_id,promoted_at,payload FROM civic_data_promotions
    WHERE record_class IN ('REGISTRATION','REGISTRY_RUNTIME_BINDING','MEETING') LOOP
    PERFORM refresh_civic_data_rows(promotion.key,promotion.record_class,promotion.scope,promotion.current_version_id,promotion.promoted_at,promotion.payload);
  END LOOP;
END $$;
