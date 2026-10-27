-- Expand only: existing versions and their payloads stay untouched.
ALTER TABLE civic_data_candidates ADD COLUMN read_model_fingerprint text
  CHECK (read_model_fingerprint IS NULL OR read_model_fingerprint ~ '^[a-f0-9]{64}$');
--> statement-breakpoint
ALTER TABLE civic_data_promotions ADD COLUMN payload_fingerprint text
  CHECK (payload_fingerprint IS NULL OR payload_fingerprint ~ '^[a-f0-9]{64}$');
--> statement-breakpoint
CREATE FUNCTION civic_candidate_fingerprint_integrity() RETURNS trigger LANGUAGE plpgsql AS $body$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.read_model_fingerprint IS DISTINCT FROM OLD.read_model_fingerprint THEN
    RAISE EXCEPTION 'candidate content fingerprint is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.read_model_fingerprint IS NOT NULL AND
     (NEW.read_model_fingerprint IS DISTINCT FROM NEW.normalized_hash OR
      NEW.read_model_fingerprint IS DISTINCT FROM NEW.candidate#>>'{normalization,normalizedHash}') THEN
    RAISE EXCEPTION 'candidate content fingerprint differs from its normalized model' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$body$;
--> statement-breakpoint
CREATE TRIGGER civic_candidate_fingerprint_integrity BEFORE INSERT OR UPDATE OF read_model_fingerprint
ON civic_data_candidates FOR EACH ROW EXECUTE FUNCTION civic_candidate_fingerprint_integrity();
--> statement-breakpoint
CREATE FUNCTION civic_promotion_fingerprint_integrity() RETURNS trigger LANGUAGE plpgsql AS $body$
DECLARE expected text;
BEGIN
  SELECT read_model_fingerprint INTO expected FROM civic_data_candidates WHERE id = NEW.current_version_id;
  IF NEW.payload_fingerprint IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'promotion payload fingerprint differs from its candidate' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$body$;
--> statement-breakpoint
CREATE TRIGGER civic_promotion_fingerprint_integrity BEFORE INSERT OR UPDATE ON civic_data_promotions
FOR EACH ROW EXECUTE FUNCTION civic_promotion_fingerprint_integrity();
