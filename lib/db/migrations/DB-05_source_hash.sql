-- The existing unchanged event also accepts an exact source-byte match.
-- Equality with the current live source and parser is checked atomically.
CREATE OR REPLACE FUNCTION enforce_civic_data_candidate_event_insert()
RETURNS trigger LANGUAGE plpgsql AS $pdc_event_insert$
DECLARE
  candidate_row "civic_data_candidates"%ROWTYPE;
  prior_event "civic_data_candidate_events"%ROWTYPE;
  expected_sequence integer;
  expected_initial_state text;
  receipt_at timestamptz;
  readback jsonb;
  confirmation jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."candidate_id", 0));
  SELECT * INTO candidate_row FROM "civic_data_candidates" WHERE "id" = NEW."candidate_id";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'candidate event % has no candidate row', NEW."candidate_id" USING ERRCODE = '23503';
  END IF;
  SELECT * INTO prior_event FROM "civic_data_candidate_events"
    WHERE "candidate_id" = NEW."candidate_id" ORDER BY "sequence" DESC LIMIT 1;
  IF NOT FOUND THEN
    expected_sequence := 1;
    expected_initial_state := CASE WHEN candidate_row."acquisition_succeeded" THEN 'FETCHED' ELSE 'SOURCE_BLOCKED' END;
    IF NEW."state" IS DISTINCT FROM expected_initial_state THEN
      RAISE EXCEPTION 'candidate % first event must be %, received %', NEW."candidate_id", expected_initial_state, NEW."state" USING ERRCODE = '23514';
    END IF;
  ELSE
    expected_sequence := prior_event."sequence" + 1;
    IF NOT (
      (prior_event."state" = 'FETCHED' AND NEW."state" IN ('NORMALIZED', 'SOURCE_BLOCKED', 'PARSE_INVALID', 'IDENTITY_UNRESOLVED', 'TEMPORAL_INVALID', 'SEMANTIC_INVALID', 'HORIZON_UNRESOLVED', 'DEPENDENT_CONSUMER_INVALID', 'CANNOT_TELL'))
      OR (prior_event."state" = 'NORMALIZED' AND NEW."state" IN ('VALIDATED', 'SOURCE_BLOCKED', 'PARSE_INVALID', 'IDENTITY_UNRESOLVED', 'TEMPORAL_INVALID', 'SEMANTIC_INVALID', 'HORIZON_UNRESOLVED', 'DEPENDENT_CONSUMER_INVALID', 'CANNOT_TELL'))
      OR (prior_event."state" = 'VALIDATED' AND NEW."state" IN ('PROMOTED', 'SOURCE_BLOCKED', 'PARSE_INVALID', 'IDENTITY_UNRESOLVED', 'TEMPORAL_INVALID', 'SEMANTIC_INVALID', 'HORIZON_UNRESOLVED', 'DEPENDENT_CONSUMER_INVALID', 'CANNOT_TELL'))
      OR (prior_event."state" = 'PROMOTED' AND NEW."state" = 'PROMOTED')
    ) THEN
      RAISE EXCEPTION 'candidate % event transition % -> % is forbidden', NEW."candidate_id", prior_event."state", NEW."state" USING ERRCODE = '23514';
    END IF;
    IF prior_event."state" = 'PROMOTED' AND NEW."state" = 'PROMOTED' THEN
      IF left(NEW."detail", length('READER_PROJECTION_READBACK_V2 ')) = 'READER_PROJECTION_READBACK_V2 ' THEN
        BEGIN
          readback := substring(NEW."detail" from length('READER_PROJECTION_READBACK_V2 ') + 1)::jsonb;
        EXCEPTION WHEN others THEN
          RAISE EXCEPTION 'candidate % Reader evidence is not valid JSON', NEW."candidate_id" USING ERRCODE = '23514';
        END;
        IF jsonb_typeof(readback) IS DISTINCT FROM 'object'
           OR readback->'contractVersion' IS DISTINCT FROM '2'::jsonb
           OR readback->>'kind' IS DISTINCT FROM 'READER_PROJECTION_READBACK'
           OR readback->>'sourceId' IS DISTINCT FROM candidate_row."source_id"
           OR readback->>'recordClass' IS DISTINCT FROM candidate_row."record_class"
           OR readback->>'scope' IS DISTINCT FROM candidate_row."scope"
           OR readback->>'versionId' IS DISTINCT FROM candidate_row."id"
           OR readback->>'pointerKey' IS DISTINCT FROM candidate_row."record_class" || ':' || candidate_row."scope"
           OR (readback->>'observedAt')::timestamptz IS DISTINCT FROM NEW."at"
           OR readback->>'evidenceKind' IS DISTINCT FROM 'TYPED_READER_READ_MODEL'
           OR coalesce(readback->>'contractId', '') = '' OR coalesce(readback->>'projectionId', '') = ''
           OR coalesce(readback->>'verifierId', '') = '' OR coalesce(readback->>'verifierCodeSha', '') !~ '^[0-9a-f]{40}$'
           OR coalesce(readback->>'status', '') NOT IN ('PASS', 'FAIL') OR coalesce(readback->>'detail', '') = ''
           OR NOT EXISTS (
             SELECT 1 FROM "civic_data_promotions" pointer
             WHERE pointer."source_id" = candidate_row."source_id" AND pointer."record_class" = candidate_row."record_class"
               AND pointer."scope" = candidate_row."scope" AND pointer."current_version_id" = candidate_row."id"
               AND pointer."last_known_good_version_id" = candidate_row."id"
           )
        THEN
          RAISE EXCEPTION 'candidate % Reader evidence is not bound to its current canonical projection', NEW."candidate_id" USING ERRCODE = '23514';
        END IF;
      ELSIF left(NEW."detail", length('UNCHANGED_CONFIRMATION_V1 ')) = 'UNCHANGED_CONFIRMATION_V1 ' THEN
        BEGIN
          confirmation := substring(NEW."detail" from length('UNCHANGED_CONFIRMATION_V1 ') + 1)::jsonb;
        EXCEPTION WHEN others THEN
          RAISE EXCEPTION 'candidate % unchanged confirmation is not valid JSON', NEW."candidate_id" USING ERRCODE = '23514';
        END;
        -- Shapes first: nothing below is cast until every value is the expected kind.
        IF jsonb_typeof(confirmation) IS DISTINCT FROM 'object'
           OR confirmation->>'kind' IS DISTINCT FROM 'UNCHANGED_CONFIRMATION_V1'
           OR confirmation->>'sourceId' IS DISTINCT FROM candidate_row."source_id"
           OR confirmation->>'recordClass' IS DISTINCT FROM candidate_row."record_class"
           OR confirmation->>'scope' IS DISTINCT FROM candidate_row."scope"
           OR confirmation->>'versionId' IS DISTINCT FROM candidate_row."id"
           OR confirmation->>'pointerKey' IS DISTINCT FROM candidate_row."record_class" || ':' || candidate_row."scope"
           OR confirmation->>'readModelHash' IS DISTINCT FROM candidate_row."normalized_hash"
           OR coalesce(confirmation->>'basis', '') NOT IN ('READ_MODEL_RECOMPUTED', 'CHANGE_SET_UNCHANGED', 'PUBLISHER_STAMPS_UNCHANGED', 'RAW_HASH_UNCHANGED')
           OR coalesce(confirmation->>'parserVersion', '') = ''
           OR (confirmation->>'basis' = 'RAW_HASH_UNCHANGED' AND (
             confirmation#>>'{retrieval,rawHash}' IS DISTINCT FROM candidate_row."raw_hash"
             OR confirmation->>'parserVersion' IS DISTINCT FROM candidate_row."parser_version"
             OR coalesce(candidate_row."candidate"#>>'{stateRetirement,kind}', '') = 'STATE_AUTHORITY_RETIREMENT'))
           OR jsonb_typeof(confirmation->'retrieval') IS DISTINCT FROM 'object'
           OR coalesce(confirmation#>>'{retrieval,rawHash}', '') !~ '^[a-f0-9]{64}$'
           -- An HTTP status, or none only for this version's own derived retrieval
           -- (derived:<source>:<scope>, no final URL of its own): a derived family
           -- or wiring version is built from promoted inputs and fetches nothing.
           OR NOT coalesce(
                jsonb_typeof(confirmation#>'{retrieval,httpStatus}') = 'number'
                OR (jsonb_typeof(confirmation#>'{retrieval,httpStatus}') = 'null'
                    AND confirmation#>>'{retrieval,requestedUrl}' = 'derived:' || candidate_row."source_id" || ':' || candidate_row."scope"
                    AND coalesce(confirmation#>>'{retrieval,finalUrl}', confirmation#>>'{retrieval,requestedUrl}') = confirmation#>>'{retrieval,requestedUrl}'),
                false)
           OR coalesce(confirmation#>>'{retrieval,retrievedAt}', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}'
           OR coalesce(confirmation->>'observedAt', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}'
           OR (confirmation->>'basis' = 'PUBLISHER_STAMPS_UNCHANGED' AND CASE
                 WHEN jsonb_typeof(confirmation->'stamps') = 'array' THEN jsonb_array_length(confirmation->'stamps') = 0
                 ELSE true
               END)
           OR candidate_row."candidate" ? 'bootstrapImport'
        THEN
          RAISE EXCEPTION 'candidate % unchanged confirmation does not name this live version and its read model', NEW."candidate_id" USING ERRCODE = '23514';
        END IF;
        IF (jsonb_typeof(confirmation#>'{retrieval,httpStatus}') = 'number'
            AND (confirmation#>>'{retrieval,httpStatus}')::numeric NOT BETWEEN 200 AND 299)
           OR (confirmation->>'observedAt')::timestamptz IS DISTINCT FROM NEW."at"
           OR (confirmation#>>'{retrieval,retrievedAt}')::timestamptz > NEW."at"
           OR NOT EXISTS (
             SELECT 1 FROM "civic_data_promotions" pointer
             WHERE pointer."source_id" = candidate_row."source_id" AND pointer."record_class" = candidate_row."record_class"
               AND pointer."scope" = candidate_row."scope" AND pointer."current_version_id" = candidate_row."id"
               AND pointer."last_known_good_version_id" = candidate_row."id"
           )
        THEN
          RAISE EXCEPTION 'candidate % unchanged confirmation is not bound to its current canonical projection', NEW."candidate_id" USING ERRCODE = '23514';
        END IF;
      ELSIF left(NEW."detail", length('UNCHANGED_CONFIRMATION_SOURCES_V1 ')) = 'UNCHANGED_CONFIRMATION_SOURCES_V1 ' THEN
        BEGIN
          confirmation := substring(NEW."detail" from length('UNCHANGED_CONFIRMATION_SOURCES_V1 ') + 1)::jsonb;
        EXCEPTION WHEN others THEN
          RAISE EXCEPTION 'candidate % unchanged confirmation sources are not valid JSON', NEW."candidate_id" USING ERRCODE = '23514';
        END;
        -- Only directly after its own receipt, at the receipt's instant.
        IF left(prior_event."detail", length('UNCHANGED_CONFIRMATION_V1 ')) IS DISTINCT FROM 'UNCHANGED_CONFIRMATION_V1 '
           OR prior_event."at" IS DISTINCT FROM NEW."at"
           OR jsonb_typeof(confirmation) IS DISTINCT FROM 'object'
           OR confirmation->>'versionId' IS DISTINCT FROM candidate_row."id"
           OR jsonb_typeof(confirmation->'retainedSourceResponses') IS DISTINCT FROM 'array'
           OR coalesce(confirmation->>'observedAt', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}'
        THEN
          RAISE EXCEPTION 'candidate % unchanged confirmation sources do not follow their own confirmation', NEW."candidate_id" USING ERRCODE = '23514';
        END IF;
        IF (confirmation->>'observedAt')::timestamptz IS DISTINCT FROM NEW."at" THEN
          RAISE EXCEPTION 'candidate % unchanged confirmation sources do not follow their own confirmation', NEW."candidate_id" USING ERRCODE = '23514';
        END IF;
      ELSE
        RAISE EXCEPTION 'candidate % repeated PROMOTED event is not typed Reader evidence', NEW."candidate_id" USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  IF NEW."sequence" IS DISTINCT FROM expected_sequence THEN
    RAISE EXCEPTION 'candidate % event sequence %, expected %', NEW."candidate_id", NEW."sequence", expected_sequence USING ERRCODE = '23514';
  END IF;
  IF NEW."state" IN ('SOURCE_BLOCKED', 'PARSE_INVALID', 'IDENTITY_UNRESOLVED', 'TEMPORAL_INVALID', 'SEMANTIC_INVALID', 'HORIZON_UNRESOLVED', 'DEPENDENT_CONSUMER_INVALID', 'CANNOT_TELL', 'VALIDATED') THEN
    IF coalesce(candidate_row."validation_receipt"->>'validatedAt', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$' THEN
      RAISE EXCEPTION 'candidate % validation receipt clock is not canonical UTC', NEW."candidate_id" USING ERRCODE = '23514';
    END IF;
    BEGIN
      receipt_at := (candidate_row."validation_receipt"->>'validatedAt')::timestamptz;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'candidate % validation receipt has no readable operational clock', NEW."candidate_id" USING ERRCODE = '23514';
    END;
    IF receipt_at IS NULL OR NEW."at" IS DISTINCT FROM receipt_at THEN
      RAISE EXCEPTION 'candidate % disposition event clock does not equal its validation receipt', NEW."candidate_id" USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW."at" > clock_timestamp() + interval '5 minutes'
     OR (prior_event."id" IS NOT NULL AND NEW."at" < prior_event."at")
  THEN
    RAISE EXCEPTION 'candidate % event clock is materially future or moves before its prior sequence', NEW."candidate_id" USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$pdc_event_insert$;
