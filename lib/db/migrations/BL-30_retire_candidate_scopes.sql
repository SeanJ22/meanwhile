CREATE OR REPLACE FUNCTION enforce_civic_data_promotion_mutation()
RETURNS trigger LANGUAGE plpgsql AS $pdc_promotion_mutation$
BEGIN
  IF TG_OP = 'DELETE' AND EXISTS (SELECT 1 FROM civic_data_candidates preserved
    WHERE preserved.id = OLD.current_version_id AND preserved.state = 'PROMOTED'
      AND preserved.source_id = OLD.source_id AND preserved.record_class = OLD.record_class AND preserved.scope = OLD.scope
      AND preserved.candidate->'readModel' = OLD.payload AND preserved.validation_receipt = OLD.validation_receipt AND (
      (OLD.record_class = 'BALLOT_CANDIDACY' AND OLD.scope = 'US-AZ:2026-general:supported-ballot'
        AND OLD.current_version_id = 'az-election-authorities:trusted-lkg-reattested:69b0ac533b8b46e8029701bc1bf01e7c') OR
      (OLD.record_class = 'BALLOT_CANDIDACY' AND OLD.scope = 'US-NH:merrimack:2026-general'
        AND OLD.current_version_id = 'nh-election-authorities:trusted-lkg-reattested:be36ccf6eba3efead342ab06fe78784a') OR
      (OLD.record_class = 'BALLOT_FILING' AND OLD.scope = 'US-NJ:county:morris:2026-general'
        AND OLD.current_version_id = 'cv-e2c449f1d9a0ae325da26cbf40bc7d49')
      ))
  THEN RETURN OLD; END IF;
  IF TG_OP = 'DELETE'
    AND EXISTS (SELECT 1 FROM civic_data_promotions replacement
      JOIN civic_data_candidates preserved ON preserved.scope = replacement.scope
        AND preserved.record_class = replacement.record_class AND preserved.source_id = replacement.source_id
      WHERE replacement.source_id = OLD.source_id AND replacement.record_class = OLD.record_class
        AND preserved.state = 'PROMOTED' AND preserved.candidate->'readModel' = OLD.payload AND (
      (OLD.record_class = 'CANDIDATE_PROFILE' AND OLD.scope = 'US-AZ+US-NH+US-NJ:2026-supported-candidates' AND OLD.current_version_id = 'candidate-primary-publications:trusted-lkg:ae9d4c17cc82ffd5adbc5002f259ea71'
        AND replacement.scope = 'US:candidate-profiles' AND preserved.id = 'candidate-primary-publications:trusted-lkg:22583abd3f8886321bf13ec66c270888') OR
      (OLD.record_class = 'CANDIDATE_PUBLICATION' AND OLD.scope = 'US-AZ+US-NH+US-NJ:2026-supported-candidates' AND OLD.current_version_id = 'candidate-primary-publications:trusted-lkg:14c9b355ba991ed29b399055b6be4e79'
        AND replacement.scope = 'US:candidate-publications' AND preserved.id = 'candidate-primary-publications:trusted-lkg:0446d2839f18ef0cd8a34e7a6d2a37b2') OR
      (OLD.record_class = 'VOTING_SITE' AND OLD.scope = 'US-AZ+US-NH+US-NJ:2026-general:supported-jurisdictions' AND OLD.current_version_id = 'cv-018510f253fab5e40b4728a5a72d6de5'
        AND replacement.scope = 'US:voting-sites' AND preserved.id = 'cv-b0f2c0d2f2ef5062b0abd18b002d7b10')
      ))
  THEN RETURN OLD; END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'civic_data_promotions is the live LKG authority; DELETE is forbidden' USING ERRCODE = '55000';
  END IF;
  IF ROW(NEW."key", NEW."source_id", NEW."record_class", NEW."scope") IS DISTINCT FROM ROW(OLD."key", OLD."source_id", OLD."record_class", OLD."scope") THEN
    RAISE EXCEPTION 'civic_data_promotions projection authority identity cannot be rewritten' USING ERRCODE = '55000';
  END IF;
  IF NEW."current_version_id" IS NOT DISTINCT FROM OLD."current_version_id" OR NEW."promoted_at" < OLD."promoted_at" THEN
    RAISE EXCEPTION 'civic_data_promotions may only advance to a distinct, non-backdated version' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$pdc_promotion_mutation$;--> statement-breakpoint
DELETE FROM civic_data_promotions
WHERE (scope = 'US-AZ+US-NH+US-NJ:2026-supported-candidates' AND record_class IN ('CANDIDATE_PROFILE', 'CANDIDATE_PUBLICATION'))
  OR (scope = 'US-AZ+US-NH+US-NJ:2026-general:supported-jurisdictions' AND record_class = 'VOTING_SITE')
  OR (scope IN ('US-AZ:2026-general:supported-ballot', 'US-NH:merrimack:2026-general') AND record_class = 'BALLOT_CANDIDACY')
  OR (scope = 'US-NJ:county:morris:2026-general' AND record_class = 'BALLOT_FILING');--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_civic_data_promotion_mutation()
RETURNS trigger LANGUAGE plpgsql AS $pdc_promotion_mutation$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'civic_data_promotions is the live LKG authority; DELETE is forbidden' USING ERRCODE = '55000';
  END IF;
  IF ROW(NEW."key", NEW."source_id", NEW."record_class", NEW."scope") IS DISTINCT FROM ROW(OLD."key", OLD."source_id", OLD."record_class", OLD."scope") THEN
    RAISE EXCEPTION 'civic_data_promotions projection authority identity cannot be rewritten' USING ERRCODE = '55000';
  END IF;
  IF NEW."current_version_id" IS NOT DISTINCT FROM OLD."current_version_id" OR NEW."promoted_at" < OLD."promoted_at" THEN
    RAISE EXCEPTION 'civic_data_promotions may only advance to a distinct, non-backdated version' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$pdc_promotion_mutation$;
