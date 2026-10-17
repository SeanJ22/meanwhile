CREATE OR REPLACE FUNCTION enforce_civic_data_promotion_mutation()
RETURNS trigger LANGUAGE plpgsql AS $pdc_promotion_mutation$
DECLARE
  state_codes text[];
  suffix text;
  expected_class text;
  expected_source text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    expected_class := OLD.record_class;
    expected_source := NULL;
    state_codes := ARRAY['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];
    CASE OLD.record_class || ':' || OLD.scope
      WHEN 'BALLOT_CANDIDACY:US:state-election-ballots' THEN suffix := 'state-election-ballots'; expected_source := 'official-ballot-authorities';
      WHEN 'BALLOT_CANDIDACY:US-AZ:2026-general:supported-ballot' THEN suffix := 'state-election-ballots'; expected_source := 'official-ballot-authorities'; state_codes := ARRAY['AZ'];
      WHEN 'BALLOT_CANDIDACY:US-NH:merrimack:2026-general' THEN suffix := 'state-election-ballots'; expected_source := 'official-ballot-authorities'; state_codes := ARRAY['NH'];
      WHEN 'BALLOT_FILING:US-NJ:county:morris:2026-general' THEN suffix := 'state-election-ballots'; expected_class := 'BALLOT_CANDIDACY'; expected_source := 'official-ballot-authorities'; state_codes := ARRAY['NJ'];
      WHEN 'CANDIDATE_PROFILE:US-AZ+US-NH+US-NJ:2026-supported-candidates' THEN suffix := 'candidate-profiles'; expected_source := 'candidate-primary-publications';
      WHEN 'CANDIDATE_PUBLICATION:US-AZ+US-NH+US-NJ:2026-supported-candidates' THEN suffix := 'candidate-publications'; expected_source := 'candidate-primary-publications';
      WHEN 'VOTING_SITE:US-AZ+US-NH+US-NJ:2026-general:supported-jurisdictions' THEN suffix := 'voting-sites'; expected_source := 'voting-sites';
      WHEN 'CURATED_READER_RECORD:US:candidate-campaign-sites-derived' THEN suffix := 'candidate-campaign-sites-derived'; expected_source := 'candidate-campaign-site-chain';
      WHEN 'REGISTRY_RUNTIME_BINDING:US:reader-registry-runtime-bindings' THEN
        suffix := 'reader-registry-runtime'; expected_source := 'registry-reviewed-bindings'; state_codes := state_codes || ARRAY['PR','VI','AS','GU','MP'];
      ELSE RAISE EXCEPTION 'civic_data_promotions is the live LKG authority; DELETE is forbidden' USING ERRCODE = '55000';
    END CASE;
    IF EXISTS (
      SELECT 1 FROM unnest(state_codes) AS states(code)
      LEFT JOIN civic_data_promotions p ON p.key = expected_class || ':US-' || states.code || ':' || suffix
      LEFT JOIN civic_data_candidates c ON c.id = p.current_version_id
      WHERE p.current_version_id IS NULL OR p.current_version_id IS DISTINCT FROM p.last_known_good_version_id
        OR p.record_class IS DISTINCT FROM expected_class OR p.scope IS DISTINCT FROM 'US-' || states.code || ':' || suffix
        OR p.source_id IS DISTINCT FROM expected_source OR p.validation_receipt->>'decision' IS DISTINCT FROM 'GOOD'
        OR c.source_id IS DISTINCT FROM p.source_id OR c.record_class IS DISTINCT FROM p.record_class OR c.scope IS DISTINCT FROM p.scope
        OR c.state IS DISTINCT FROM 'PROMOTED' OR c.promoted_version_id IS DISTINCT FROM c.id
        OR c.last_known_good_version_id IS DISTINCT FROM c.id OR c.validation_receipt->>'decision' IS DISTINCT FROM 'GOOD'
    ) THEN
      RAISE EXCEPTION 'state authority replacements are not all GOOD for %', OLD.key USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
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
