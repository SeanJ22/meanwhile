-- Expand the writer format before new candidates omit their rebuildable model.
-- Legacy rows and their exact-payload guard remain untouched.
CREATE OR REPLACE FUNCTION assert_civic_data_promotion_integrity()
RETURNS trigger LANGUAGE plpgsql AS $pdc_promotion_integrity$
DECLARE
  candidate_row "civic_data_candidates"%ROWTYPE;
  first_promoted_event "civic_data_candidate_events"%ROWTYPE;
BEGIN
  SELECT * INTO candidate_row FROM "civic_data_candidates"
  WHERE "id" = NEW."current_version_id" AND "source_id" = NEW."source_id"
    AND "record_class" = NEW."record_class" AND "scope" = NEW."scope";
  IF NOT FOUND OR NEW."current_version_id" IS DISTINCT FROM NEW."last_known_good_version_id"
     OR candidate_row."state" <> 'PROMOTED' OR candidate_row."promoted_version_id" IS DISTINCT FROM candidate_row."id"
     OR candidate_row."last_known_good_version_id" IS DISTINCT FROM candidate_row."id"
     OR (CASE WHEN candidate_row."candidate" ? 'readModel'
        THEN NEW."payload" IS DISTINCT FROM candidate_row."candidate"->'readModel'
        ELSE candidate_row."read_model_fingerprint" IS NULL OR
          NEW."payload_fingerprint" IS DISTINCT FROM candidate_row."read_model_fingerprint" OR
          candidate_row."candidate"#>>'{vault,readModel,fingerprint}' IS DISTINCT FROM candidate_row."read_model_fingerprint"
        END)
     OR NEW."validation_receipt" IS DISTINCT FROM candidate_row."validation_receipt"
     OR candidate_row."retrieved_at" > (candidate_row."validation_receipt"->>'validatedAt')::timestamptz
     OR (candidate_row."validation_receipt"->>'validatedAt')::timestamptz > NEW."promoted_at"
     OR NEW."promoted_at" > clock_timestamp() + interval '5 minutes'
  THEN
    RAISE EXCEPTION 'promotion % is not the exact proof-consistent candidate payload, receipt, clock, and LKG', NEW."key" USING ERRCODE = '23514';
  END IF;
  SELECT * INTO first_promoted_event FROM "civic_data_candidate_events"
    WHERE "candidate_id" = candidate_row."id" AND "state" = 'PROMOTED' ORDER BY "sequence" ASC LIMIT 1;
  IF NOT FOUND OR first_promoted_event."at" IS DISTINCT FROM NEW."promoted_at" THEN
    RAISE EXCEPTION 'promotion % has no exact atomic first PROMOTED event', NEW."key" USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END
$pdc_promotion_integrity$;
