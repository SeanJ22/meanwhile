DO $bl30$
DECLARE
  mapping record;
  prior civic_data_promotions%ROWTYPE;
  held civic_data_candidates%ROWTYPE;
  envelope jsonb;
  receipt jsonb;
  event civic_data_candidate_events%ROWTYPE;
  confirmation jsonb;
  confirmation_prefix text;
  copied_sequence integer;
BEGIN
  FOR mapping IN SELECT * FROM (VALUES
    ('CANDIDATE_PROFILE', 'US-AZ+US-NH+US-NJ:2026-supported-candidates', 'US:candidate-profiles', 'candidate-primary-publications:trusted-lkg:ae9d4c17cc82ffd5adbc5002f259ea71', 'candidate-primary-publications:trusted-lkg:22583abd3f8886321bf13ec66c270888', '6155caeea861f19c4476d97a24ba51e958ccfec355edd7260ff8526d661aa1e2', '996b05cc1ef88ac2a5c2b4b3cb6c4ae94f9144221df409c0a81d8ee1d109c368', '["parser:candidate-primary-manual/1","reader:/ballot candidate cards","reader:Ask candidate profile evidence","source-projection:candidate-primary-publications:CANDIDATE_PROFILE:US:candidate-profiles"]'),
    ('CANDIDATE_PUBLICATION', 'US-AZ+US-NH+US-NJ:2026-supported-candidates', 'US:candidate-publications', 'candidate-primary-publications:trusted-lkg:14c9b355ba991ed29b399055b6be4e79', 'candidate-primary-publications:trusted-lkg:0446d2839f18ef0cd8a34e7a6d2a37b2', '145555d40c315080017b93596960039515c93e5a0e91dacf7315948c602edc48', '7e6c221b3c59a380fbd95bf62ea6fb82c7d10f39fe9d225e181c78a39e1474db', '["parser:candidate-primary-manual/1","reader:/api/positions and Ask corpus search","reader:/ballot positions","source-projection:candidate-primary-publications:CANDIDATE_PUBLICATION:US:candidate-publications"]'),
    ('VOTING_SITE', 'US-AZ+US-NH+US-NJ:2026-general:supported-jurisdictions', 'US:voting-sites', 'cv-018510f253fab5e40b4728a5a72d6de5', 'cv-b0f2c0d2f2ef5062b0abd18b002d7b10', NULL, NULL, NULL)
  ) AS scopes(record_class, old_scope, new_scope, old_id, new_id, old_envelope_hash, new_envelope_hash, validator_ids)
  LOOP
    SELECT * INTO prior FROM civic_data_promotions
      WHERE record_class = mapping.record_class AND scope = mapping.old_scope FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;
    SELECT * INTO STRICT held FROM civic_data_candidates WHERE id = prior.current_version_id;
    IF held.id IS DISTINCT FROM mapping.old_id OR held.state IS DISTINCT FROM 'PROMOTED'
      OR (mapping.old_envelope_hash IS NOT NULL AND (
        held.candidate#>>'{bootstrapImport,candidateEnvelopeSha256}' IS DISTINCT FROM mapping.old_envelope_hash
        OR held.candidate#>>'{bootstrapImport,kind}' IS DISTINCT FROM 'TRUSTED_LKG_IMPORT'))
      OR prior.payload IS DISTINCT FROM held.candidate->'readModel'
      OR prior.validation_receipt IS DISTINCT FROM held.validation_receipt
    THEN RAISE EXCEPTION 'BL-30 candidate scope source changed: %', mapping.record_class; END IF;
    envelope := held.candidate || jsonb_build_object(
      'id', mapping.new_id, 'scope', mapping.new_scope,
      'sourceProjectionEvidence', held.candidate->'sourceProjectionEvidence' || jsonb_build_object('scope', mapping.new_scope));
    IF mapping.old_envelope_hash IS NOT NULL THEN
      envelope := envelope || jsonb_build_object('bootstrapImport', held.candidate->'bootstrapImport' || jsonb_build_object(
        'scope', mapping.new_scope, 'candidateEnvelopeSha256', mapping.new_envelope_hash,
        'validatorIds', mapping.validator_ids::jsonb));
    END IF;
    receipt := held.validation_receipt || jsonb_build_object('candidateId', mapping.new_id, 'scope', mapping.new_scope);
    IF EXISTS (SELECT 1 FROM civic_data_promotions WHERE record_class = mapping.record_class AND scope = mapping.new_scope) THEN
      IF NOT EXISTS (SELECT 1 FROM civic_data_promotions WHERE record_class = mapping.record_class AND scope = mapping.new_scope
        AND current_version_id = mapping.new_id AND payload = prior.payload AND validation_receipt = receipt)
      THEN RAISE EXCEPTION 'BL-30 national candidate scope conflicts: %', mapping.record_class; END IF;
      CONTINUE;
    END IF;
    INSERT INTO civic_data_candidates (id, source_id, record_class, scope, state, acquisition_succeeded,
      raw_hash, normalized_hash, retrieved_at, source_through, parser_version, identity, candidate,
      validation_receipt, promoted_version_id, last_known_good_version_id, failure_code, failure_detail)
    VALUES (mapping.new_id, held.source_id, held.record_class, mapping.new_scope, held.state, held.acquisition_succeeded,
      held.raw_hash, held.normalized_hash, held.retrieved_at, held.source_through, held.parser_version, held.identity, envelope,
      receipt, mapping.new_id, mapping.new_id, held.failure_code, held.failure_detail);
    FOR event IN SELECT * FROM civic_data_candidate_events WHERE candidate_id = held.id AND sequence <= 4 ORDER BY sequence
    LOOP
      INSERT INTO civic_data_candidate_events (id, candidate_id, sequence, state, at, detail)
      VALUES (gen_random_uuid(), mapping.new_id, event.sequence, event.state, event.at,
        CASE WHEN event.state = 'PROMOTED' THEN 'BL-30 preserved candidate authority from ' || held.id || ' at ' || mapping.new_scope || '.'
          ELSE event.detail END);
    END LOOP;
    INSERT INTO civic_data_promotions (key, source_id, record_class, scope, current_version_id,
      last_known_good_version_id, promoted_at, payload, validation_receipt)
    VALUES (mapping.record_class || ':' || mapping.new_scope, prior.source_id, prior.record_class, mapping.new_scope,
      mapping.new_id, mapping.new_id, prior.promoted_at, prior.payload, receipt);
    copied_sequence := 4;
    FOR event IN SELECT * FROM civic_data_candidate_events
      WHERE candidate_id = held.id AND sequence > 4 AND (
        left(detail, length('UNCHANGED_CONFIRMATION_V1 ')) = 'UNCHANGED_CONFIRMATION_V1 '
        OR left(detail, length('UNCHANGED_CONFIRMATION_SOURCES_V1 ')) = 'UNCHANGED_CONFIRMATION_SOURCES_V1 ')
      ORDER BY sequence
    LOOP
      confirmation_prefix := CASE WHEN left(event.detail, length('UNCHANGED_CONFIRMATION_V1 ')) = 'UNCHANGED_CONFIRMATION_V1 '
        THEN 'UNCHANGED_CONFIRMATION_V1 ' ELSE 'UNCHANGED_CONFIRMATION_SOURCES_V1 ' END;
      confirmation := substring(event.detail from length(confirmation_prefix) + 1)::jsonb
        || jsonb_build_object('versionId', mapping.new_id);
      IF confirmation_prefix = 'UNCHANGED_CONFIRMATION_V1 ' THEN
        confirmation := confirmation || jsonb_build_object('scope', mapping.new_scope,
          'pointerKey', mapping.record_class || ':' || mapping.new_scope);
      END IF;
      copied_sequence := copied_sequence + 1;
      INSERT INTO civic_data_candidate_events (id, candidate_id, sequence, state, at, detail)
      VALUES (gen_random_uuid(), mapping.new_id, copied_sequence, event.state, event.at, confirmation_prefix || confirmation::text);
    END LOOP;
  END LOOP;
END
$bl30$;
