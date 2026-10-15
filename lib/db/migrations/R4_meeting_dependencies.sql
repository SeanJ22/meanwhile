CREATE TABLE civic_meeting_dependencies (
  kind text NOT NULL,
  member_id text NOT NULL,
  scope text NOT NULL,
  pointer_scope text NOT NULL,
  version_id text NOT NULL,
  value jsonb NOT NULL,
  PRIMARY KEY (kind, member_id)
);
--> statement-breakpoint
CREATE INDEX civic_meeting_dependencies_scope ON civic_meeting_dependencies (kind, scope);

--> statement-breakpoint
CREATE FUNCTION expand_meeting_dependency_payload(input jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE stored jsonb; result jsonb; item record; groups jsonb; ordering jsonb;
BEGIN
  IF jsonb_typeof(input) = 'object' AND input ? '$civicPayloadPart' AND input = jsonb_build_object('$civicPayloadPart',input->'$civicPayloadPart') THEN
    SELECT payload INTO STRICT stored FROM civic_data_payload_parts WHERE hash = input->>'$civicPayloadPart';
    IF stored->>'kind' = 'object' THEN RETURN expand_meeting_dependency_payload(stored->'value'); END IF;
    IF stored->>'kind' = 'string' THEN
      SELECT to_jsonb(string_agg(expand_meeting_dependency_payload(value)#>>'{}', '' ORDER BY ord)) INTO result
      FROM jsonb_array_elements(stored->'chunks') WITH ORDINALITY AS chunks(value,ord);
      RETURN result;
    END IF;
    IF stored->>'kind' = 'array' THEN
      groups := expand_meeting_dependency_payload(stored->'groups');
      ordering := (expand_meeting_dependency_payload(stored->'order')#>>'{}')::jsonb;
      SELECT coalesce(jsonb_agg(groups->group_id->offset_at ORDER BY ord), '[]') INTO result
      FROM (SELECT (value#>>'{}')::integer AS group_id, ord,
        (row_number() OVER (PARTITION BY value ORDER BY ord)-1)::integer AS offset_at
        FROM jsonb_array_elements(ordering) WITH ORDINALITY AS indexes(value,ord)) indexed;
      RETURN result;
    END IF;
    RETURN expand_meeting_dependency_payload(stored);
  END IF;
  IF jsonb_typeof(input) = 'array' THEN
    SELECT coalesce(jsonb_agg(expand_meeting_dependency_payload(value) ORDER BY ord), '[]') INTO result
    FROM jsonb_array_elements(input) WITH ORDINALITY AS children(value,ord);
    RETURN result;
  END IF;
  IF jsonb_typeof(input) = 'object' THEN
    result := '{}';
    FOR item IN SELECT key,value FROM jsonb_each(input) LOOP
      result := result || jsonb_build_object(item.key,expand_meeting_dependency_payload(item.value));
    END LOOP;
    RETURN result;
  END IF;
  RETURN input;
END $$;

--> statement-breakpoint
CREATE FUNCTION project_meeting_dependencies(class_name text, source_scope text, version text, document jsonb) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE expanded jsonb;
BEGIN
  IF class_name NOT IN ('REGISTRY_RUNTIME_BINDING','REGISTRATION') AND NOT (class_name = 'CURATED_READER_RECORD' AND (source_scope LIKE '%venue-resolutions%' OR source_scope = 'US:meeting-source-wiring')) THEN RETURN; END IF;
  expanded := expand_meeting_dependency_payload(document);
  IF class_name = 'REGISTRY_RUNTIME_BINDING' THEN
    DELETE FROM civic_meeting_dependencies WHERE kind IN ('body','division','registry') AND pointer_scope = source_scope;
    INSERT INTO civic_meeting_dependencies VALUES ('registry',source_scope,source_scope,source_scope,version,jsonb_build_object('generatedAt',expanded->'registry'->'generatedAt'));
    INSERT INTO civic_meeting_dependencies
      SELECT 'body',row->>'id',coalesce('US-' || upper(substring(coalesce(row->>'ocdId',row->>'id') from '/(?:state|district|territory):([a-z]{2})')), 'US'),source_scope,version,row FROM jsonb_array_elements(expanded->'registry'->'bodies') row
      UNION ALL SELECT 'division',row->>'ocdId',row->>'ocdId',source_scope,version,row FROM jsonb_array_elements(expanded->'registry'->'divisions') row
      ON CONFLICT (kind,member_id) DO UPDATE SET scope=EXCLUDED.scope,pointer_scope=EXCLUDED.pointer_scope,version_id=EXCLUDED.version_id,value=EXCLUDED.value;
  ELSIF class_name = 'REGISTRATION' THEN
    DELETE FROM civic_meeting_dependencies WHERE kind IN ('registered-body','registered-division') AND pointer_scope = source_scope;
    INSERT INTO civic_meeting_dependencies
      SELECT 'registered-body',row->>'id','US-' || upper(expanded->>'state'),source_scope,version,row FROM jsonb_array_elements(expanded->'bodies') row
      UNION ALL SELECT 'registered-division',row->>'ocdId',row->>'ocdId',source_scope,version,row FROM jsonb_array_elements(expanded->'divisions') row
      ON CONFLICT (kind,member_id) DO UPDATE SET scope=EXCLUDED.scope,pointer_scope=EXCLUDED.pointer_scope,version_id=EXCLUDED.version_id,value=EXCLUDED.value;
  ELSIF expanded->>'kind' = 'meeting-source-wiring' THEN
    DELETE FROM civic_meeting_dependencies WHERE kind = 'wiring' AND pointer_scope = source_scope;
    INSERT INTO civic_meeting_dependencies
      SELECT 'wiring',row->>'id',row->'row'->>'state',source_scope,version,row FROM jsonb_array_elements(expanded->'records') row
      ON CONFLICT (kind,member_id) DO UPDATE SET scope=EXCLUDED.scope,pointer_scope=EXCLUDED.pointer_scope,version_id=EXCLUDED.version_id,value=EXCLUDED.value;
  ELSIF expanded->>'kind' = 'venue-resolutions' THEN
    DELETE FROM civic_meeting_dependencies WHERE kind = 'venue' AND (pointer_scope = source_scope
      OR (source_scope LIKE 'US:venue-resolutions:%' AND scope = substring(source_scope from length('US:venue-resolutions:')+1)));
    INSERT INTO civic_meeting_dependencies
      SELECT 'venue',row->>'id',coalesce(row->>'bodyOcdId','tenant:' || (row->>'tenant')),source_scope,version,row FROM jsonb_array_elements(expanded->'records') row
      ON CONFLICT (kind,member_id) DO UPDATE SET scope=EXCLUDED.scope,pointer_scope=EXCLUDED.pointer_scope,version_id=EXCLUDED.version_id,value=EXCLUDED.value;
  END IF;
END $$;

--> statement-breakpoint
CREATE FUNCTION refresh_meeting_dependencies() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM project_meeting_dependencies(NEW.record_class,NEW.scope,NEW.current_version_id,NEW.payload);
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER civic_meeting_dependencies_refresh AFTER INSERT OR UPDATE OF payload ON civic_data_promotions
  FOR EACH ROW EXECUTE FUNCTION refresh_meeting_dependencies();
--> statement-breakpoint
SELECT project_meeting_dependencies(record_class,scope,current_version_id,payload) FROM civic_data_promotions
  WHERE record_class IN ('REGISTRY_RUNTIME_BINDING','REGISTRATION') OR (record_class = 'CURATED_READER_RECORD' AND (scope LIKE '%venue-resolutions%' OR scope = 'US:meeting-source-wiring'));
