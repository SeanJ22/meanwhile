-- Preserve every 0026 history assertion. Resolve NEW fields only in the
-- branch for its actual table; CASE plans both incompatible row shapes.
CREATE OR REPLACE FUNCTION assert_civic_data_candidate_history_integrity()
RETURNS trigger LANGUAGE plpgsql AS $pdc_candidate_history$
DECLARE
  checked_candidate_id text;
  candidate_row "civic_data_candidates"%ROWTYPE;
  first_event "civic_data_candidate_events"%ROWTYPE;
  latest_event "civic_data_candidate_events"%ROWTYPE;
  expected_initial_state text;
  base_row "civic_data_candidates"%ROWTYPE;
  receipt_at timestamptz;
BEGIN
  IF TG_TABLE_NAME = 'civic_data_candidates' THEN
    checked_candidate_id := NEW."id";
  ELSE
    checked_candidate_id := NEW."candidate_id";
  END IF;
  SELECT * INTO candidate_row FROM "civic_data_candidates" WHERE "id" = checked_candidate_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'candidate % disappeared from its durable event history', checked_candidate_id USING ERRCODE = '23503'; END IF;
  SELECT * INTO first_event FROM "civic_data_candidate_events" WHERE "candidate_id" = checked_candidate_id ORDER BY "sequence" ASC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'candidate % has no first append-only event', checked_candidate_id USING ERRCODE = '23514'; END IF;
  SELECT * INTO latest_event FROM "civic_data_candidate_events" WHERE "candidate_id" = checked_candidate_id ORDER BY "sequence" DESC LIMIT 1;
  expected_initial_state := CASE WHEN candidate_row."acquisition_succeeded" THEN 'FETCHED' ELSE 'SOURCE_BLOCKED' END;
  IF first_event."sequence" <> 1 OR first_event."state" IS DISTINCT FROM expected_initial_state
     OR latest_event."state" IS DISTINCT FROM candidate_row."state"
  THEN
    RAISE EXCEPTION 'candidate % row and append-only history do not describe one disposition', checked_candidate_id USING ERRCODE = '23514';
  END IF;
  IF candidate_row."state" IN ('SOURCE_BLOCKED', 'PARSE_INVALID', 'IDENTITY_UNRESOLVED', 'TEMPORAL_INVALID', 'SEMANTIC_INVALID', 'HORIZON_UNRESOLVED', 'DEPENDENT_CONSUMER_INVALID', 'CANNOT_TELL', 'VALIDATED') THEN
    IF coalesce(candidate_row."validation_receipt"->>'validatedAt', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$' THEN
      RAISE EXCEPTION 'candidate % validation receipt clock is not canonical UTC', checked_candidate_id USING ERRCODE = '23514';
    END IF;
    BEGIN
      receipt_at := (candidate_row."validation_receipt"->>'validatedAt')::timestamptz;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'candidate % validation receipt has no readable operational clock', checked_candidate_id USING ERRCODE = '23514';
    END;
    IF receipt_at IS NULL OR latest_event."at" IS DISTINCT FROM receipt_at THEN
      RAISE EXCEPTION 'candidate % terminal/validation row is not bound to its exact disposition event clock', checked_candidate_id USING ERRCODE = '23514';
    END IF;
  ELSIF candidate_row."state" = 'PROMOTED' THEN
    IF coalesce(candidate_row."validation_receipt"->>'validatedAt', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$' THEN
      RAISE EXCEPTION 'candidate % validation receipt clock is not canonical UTC', checked_candidate_id USING ERRCODE = '23514';
    END IF;
    BEGIN
      receipt_at := (candidate_row."validation_receipt"->>'validatedAt')::timestamptz;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'candidate % validation receipt has no readable operational clock', checked_candidate_id USING ERRCODE = '23514';
    END;
    IF receipt_at IS NULL OR NOT EXISTS (
      SELECT 1 FROM "civic_data_candidate_events" validation_event
      WHERE validation_event."candidate_id" = checked_candidate_id
        AND validation_event."state" = 'VALIDATED' AND validation_event."at" = receipt_at
    ) THEN
      RAISE EXCEPTION 'promoted candidate % is not bound to its exact validation event clock', checked_candidate_id USING ERRCODE = '23514';
    END IF;
  END IF;
  IF candidate_row."last_known_good_version_id" IS NOT NULL THEN
    SELECT * INTO base_row FROM "civic_data_candidates"
    WHERE "id" = candidate_row."last_known_good_version_id" AND "source_id" = candidate_row."source_id"
      AND "record_class" = candidate_row."record_class" AND "scope" = candidate_row."scope";
    IF NOT FOUND OR base_row."state" <> 'PROMOTED' OR base_row."promoted_version_id" IS DISTINCT FROM base_row."id"
       OR base_row."last_known_good_version_id" IS DISTINCT FROM base_row."id"
    THEN
      RAISE EXCEPTION 'candidate % LKG base is not an exact durable promotion', checked_candidate_id USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END
$pdc_candidate_history$;