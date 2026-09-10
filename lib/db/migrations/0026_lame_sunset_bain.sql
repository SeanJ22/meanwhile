DO $pdc_preflight$
DECLARE
  legacy_reattested_predecessor_ids text[];
  repeated_event record;
  repeated_evidence jsonb;
  repeated_observed_at timestamptz;
BEGIN
  -- The one permitted legacy exception is immutable history which has already
  -- been superseded by an exact, PROMOTED PDC re-attestation successor. New
  -- writes remain subject to the canonical clock triggers below.
  SELECT coalesce(array_agg(predecessor."id"), ARRAY[]::text[])
  INTO legacy_reattested_predecessor_ids
  FROM "civic_data_candidates" predecessor
  WHERE predecessor."state" = 'PROMOTED'
    AND (
      EXISTS (
        SELECT 1 FROM "civic_data_candidates" successor
        WHERE successor."state" = 'PROMOTED'
        AND successor."promoted_version_id" = successor."id"
        AND successor."last_known_good_version_id" = successor."id"
        AND successor."source_id" = predecessor."source_id"
        AND successor."record_class" = predecessor."record_class"
        AND successor."scope" = predecessor."scope"
        AND successor."candidate"#>>'{bootstrapImport,kind}' = 'TRUSTED_LKG_REATTESTATION'
        AND successor."candidate"#>>'{bootstrapImport,contractVersion}' = '1'
        AND successor."candidate"#>>'{bootstrapImport,authorization}' = 'PDC_V2_FROZEN_LKG_CUTOVER'
        AND successor."candidate"#>>'{bootstrapImport,purpose}' = 'RE_ATTEST_EXISTING_DURABLE_LKG_TO_PERMANENT_INTEGRITY_CONTRACT'
        AND successor."candidate"#>'{bootstrapImport,sourceAuthenticated}' = 'false'::jsonb
        AND successor."candidate"#>>'{bootstrapImport,predecessorVersionId}' = predecessor."id"
        AND successor."candidate"#>>'{bootstrapImport,sourceId}' = predecessor."source_id"
        AND successor."candidate"#>>'{bootstrapImport,recordClass}' = predecessor."record_class"
        AND successor."candidate"#>>'{bootstrapImport,scope}' = predecessor."scope"
          AND successor."candidate"#>>'{bootstrapImport,predecessorCandidateRecordSha256}' ~ '^[0-9a-f]{64}$'
      )
      OR predecessor."id" IN (
        -- The importer sets this transaction-local custom value only after it
        -- has read/proved every current pointer and built its exact immutable
        -- successor, but before its first write. Normal migration application
        -- never sets it, so only already-durable successors are grandfathered.
        SELECT jsonb_array_elements_text(
          coalesce(
            nullif(current_setting('wtp.pdc_v2_prospective_reattestation_ids', true), ''),
            '[]'
          )::jsonb
        )
      )
    );
  -- Exact parity for civic_data_candidates_identity_idx plus the event FK and
  -- row CHECK constraints. These scans make the contract migration refuse
  -- before ALTER TABLE can fail midway through its DDL sequence.
  IF EXISTS (
    SELECT 1 FROM "civic_data_candidates"
    GROUP BY "id", "source_id", "record_class", "scope" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'PDC 0026 preflight: candidate composite identity is duplicated' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "civic_data_candidate_events" event
    LEFT JOIN "civic_data_candidates" candidate ON candidate."id" = event."candidate_id"
    WHERE candidate."id" IS NULL
       OR event."sequence" <= 0
       OR event."state" NOT IN ('FETCHED', 'SOURCE_BLOCKED', 'NORMALIZED', 'PARSE_INVALID', 'IDENTITY_UNRESOLVED', 'TEMPORAL_INVALID', 'SEMANTIC_INVALID', 'HORIZON_UNRESOLVED', 'DEPENDENT_CONSUMER_INVALID', 'CANNOT_TELL', 'VALIDATED', 'PROMOTED')
       OR length(btrim(event."detail")) <= 0
  ) THEN
    RAISE EXCEPTION 'PDC 0026 preflight: candidate event violates its candidate FK, positive sequence, known state, or nonempty detail constraint' USING ERRCODE = '23514';
  END IF;
  -- Exact parity for every civic_data_candidates ADD CHECK. The receipt clock
  -- cast is safe here because the canonical/future scan below refuses every
  -- non-readable non-grandfathered value before DDL begins; a cast error is
  -- itself still a pre-DDL refusal.
  IF EXISTS (
    SELECT 1 FROM "civic_data_candidates" candidate
    WHERE candidate."state" NOT IN ('FETCHED', 'SOURCE_BLOCKED', 'NORMALIZED', 'PARSE_INVALID', 'IDENTITY_UNRESOLVED', 'TEMPORAL_INVALID', 'SEMANTIC_INVALID', 'HORIZON_UNRESOLVED', 'DEPENDENT_CONSUMER_INVALID', 'CANNOT_TELL', 'VALIDATED', 'PROMOTED')
       OR NOT ((
         candidate."state" = 'PROMOTED'
         AND candidate."promoted_version_id" IS NOT DISTINCT FROM candidate."id"
         AND candidate."last_known_good_version_id" IS NOT DISTINCT FROM candidate."id"
       ) OR (
         candidate."state" <> 'PROMOTED'
         AND candidate."promoted_version_id" IS NULL
       ))
       OR NOT (
         jsonb_typeof(candidate."candidate") IS NOT DISTINCT FROM 'object'
         AND (candidate."candidate"->>'id') IS NOT DISTINCT FROM candidate."id"
         AND (candidate."candidate"->>'sourceId') IS NOT DISTINCT FROM candidate."source_id"
         AND (candidate."candidate"->>'recordClass') IS NOT DISTINCT FROM candidate."record_class"
         AND (candidate."candidate"->>'scope') IS NOT DISTINCT FROM candidate."scope"
         AND (((candidate."candidate"#>>'{retrieval,retrievedAt}')::timestamptz) IS NOT DISTINCT FROM candidate."retrieved_at")
         AND (candidate."candidate"#>>'{temporal,sourceThrough}') IS NOT DISTINCT FROM candidate."source_through"
         AND (candidate."candidate"#>>'{normalization,parserVersion}') IS NOT DISTINCT FROM candidate."parser_version"
         AND (candidate."candidate"#>'{retrieval,succeeded}') IS NOT DISTINCT FROM to_jsonb(candidate."acquisition_succeeded")
         AND (candidate."candidate"#>>'{retrieval,rawHash}') IS NOT DISTINCT FROM candidate."raw_hash"
         AND (candidate."candidate"#>>'{normalization,normalizedHash}') IS NOT DISTINCT FROM candidate."normalized_hash"
         AND (candidate."candidate"->'identities') IS NOT DISTINCT FROM candidate."identity"
       )
       OR NOT ((
         candidate."state" IN ('FETCHED', 'NORMALIZED')
         AND candidate."validation_receipt" IS NULL
         AND candidate."failure_code" IS NULL
         AND candidate."failure_detail" IS NULL
       ) OR (
         candidate."state" IN ('VALIDATED', 'PROMOTED')
         AND jsonb_typeof(candidate."validation_receipt") IS NOT DISTINCT FROM 'object'
         AND (candidate."validation_receipt"->'contractVersion') IS NOT DISTINCT FROM '2'::jsonb
         AND (candidate."validation_receipt"->>'decision') IS NOT DISTINCT FROM 'GOOD'
         AND (candidate."validation_receipt"->>'candidateId') IS NOT DISTINCT FROM candidate."id"
         AND (candidate."validation_receipt"->>'sourceId') IS NOT DISTINCT FROM candidate."source_id"
         AND (candidate."validation_receipt"->>'recordClass') IS NOT DISTINCT FROM candidate."record_class"
         AND (candidate."validation_receipt"->>'scope') IS NOT DISTINCT FROM candidate."scope"
         AND ((((candidate."validation_receipt"->>'validatedAt')::timestamptz >= candidate."retrieved_at") IS TRUE))
         AND candidate."failure_code" IS NULL
         AND candidate."failure_detail" IS NULL
       ) OR (
         candidate."state" IN ('SOURCE_BLOCKED', 'PARSE_INVALID', 'IDENTITY_UNRESOLVED', 'TEMPORAL_INVALID', 'SEMANTIC_INVALID', 'HORIZON_UNRESOLVED', 'DEPENDENT_CONSUMER_INVALID', 'CANNOT_TELL')
         AND jsonb_typeof(candidate."validation_receipt") IS NOT DISTINCT FROM 'object'
         AND (candidate."validation_receipt"->'contractVersion') IS NOT DISTINCT FROM '2'::jsonb
         AND ((candidate."validation_receipt"->>'decision') IN ('FAIL', 'CANNOT_TELL')) IS TRUE
         AND (candidate."validation_receipt"->>'candidateId') IS NOT DISTINCT FROM candidate."id"
         AND (candidate."validation_receipt"->>'sourceId') IS NOT DISTINCT FROM candidate."source_id"
         AND (candidate."validation_receipt"->>'recordClass') IS NOT DISTINCT FROM candidate."record_class"
         AND (candidate."validation_receipt"->>'scope') IS NOT DISTINCT FROM candidate."scope"
         AND ((length(btrim(candidate."failure_code")) > 0) IS TRUE)
         AND ((length(btrim(candidate."failure_detail")) > 0) IS TRUE)
         AND jsonb_typeof(jsonb_path_query_first(candidate."validation_receipt", '$.checks[*] ? (@.verdict != "PASS")')) IS NOT DISTINCT FROM 'object'
         AND (jsonb_path_query_first(candidate."validation_receipt", '$.checks[*] ? (@.verdict != "PASS")')->>'code') IS NOT DISTINCT FROM candidate."failure_code"
         AND (jsonb_path_query_first(candidate."validation_receipt", '$.checks[*] ? (@.verdict != "PASS")')->>'detail') IS NOT DISTINCT FROM candidate."failure_detail"
       ))
  ) THEN
    RAISE EXCEPTION 'PDC 0026 preflight: candidate violates state, promotion-field, envelope-identity, or disposition-receipt CHECK parity' USING ERRCODE = '23514';
  END IF;
  -- Exact parity for all civic_data_promotions ADD CHECK constraints. The
  -- current/LKG composite FKs are proved by the exact joined pointer scan
  -- below, and the candidate LKG composite FK by its dedicated scan.
  IF EXISTS (
    SELECT 1 FROM "civic_data_promotions" promotion
    WHERE promotion."key" <> promotion."record_class" || ':' || promotion."scope"
       OR promotion."current_version_id" <> promotion."last_known_good_version_id"
       OR NOT (
         jsonb_typeof(promotion."validation_receipt") IS NOT DISTINCT FROM 'object'
         AND (promotion."validation_receipt"->>'decision') IS NOT DISTINCT FROM 'GOOD'
         AND (promotion."validation_receipt"->>'candidateId') IS NOT DISTINCT FROM promotion."current_version_id"
         AND (promotion."validation_receipt"->>'sourceId') IS NOT DISTINCT FROM promotion."source_id"
         AND (promotion."validation_receipt"->>'recordClass') IS NOT DISTINCT FROM promotion."record_class"
         AND (promotion."validation_receipt"->>'scope') IS NOT DISTINCT FROM promotion."scope"
         AND (promotion."validation_receipt"->'contractVersion') IS NOT DISTINCT FROM '2'::jsonb
         AND ((((promotion."validation_receipt"->>'validatedAt')::timestamptz <= promotion."promoted_at") IS TRUE))
       )
  ) THEN
    RAISE EXCEPTION 'PDC 0026 preflight: promotion violates key, current/LKG, or receipt-identity CHECK parity' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "civic_data_candidate_events" GROUP BY "candidate_id"
    HAVING min("sequence") IS DISTINCT FROM 1 OR max("sequence") IS DISTINCT FROM count(*)
  ) THEN
    RAISE EXCEPTION 'PDC 0026 preflight: candidate event history is not contiguous from sequence 1' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT "candidate_id", "sequence", "state",
             lag("state") OVER (PARTITION BY "candidate_id" ORDER BY "sequence") AS prior_state
      FROM "civic_data_candidate_events"
    ) transitions
    WHERE prior_state IS NOT NULL
      AND NOT (
        (prior_state = 'FETCHED' AND "state" IN (
          'NORMALIZED','SOURCE_BLOCKED','PARSE_INVALID','IDENTITY_UNRESOLVED','TEMPORAL_INVALID',
          'SEMANTIC_INVALID','HORIZON_UNRESOLVED','DEPENDENT_CONSUMER_INVALID','CANNOT_TELL'
        ))
        OR (prior_state = 'NORMALIZED' AND "state" IN (
          'VALIDATED','SOURCE_BLOCKED','PARSE_INVALID','IDENTITY_UNRESOLVED','TEMPORAL_INVALID',
          'SEMANTIC_INVALID','HORIZON_UNRESOLVED','DEPENDENT_CONSUMER_INVALID','CANNOT_TELL'
        ))
        OR (prior_state = 'VALIDATED' AND "state" IN (
          'PROMOTED','SOURCE_BLOCKED','PARSE_INVALID','IDENTITY_UNRESOLVED','TEMPORAL_INVALID',
          'SEMANTIC_INVALID','HORIZON_UNRESOLVED','DEPENDENT_CONSUMER_INVALID','CANNOT_TELL'
        ))
        OR (prior_state = 'PROMOTED' AND "state" = 'PROMOTED')
      )
  ) THEN
    RAISE EXCEPTION 'PDC 0026 preflight: candidate event history contains an illegal state transition' USING ERRCODE = '23514';
  END IF;
  -- Exact parity for the installed event trigger's repeated-PROMOTED rule.
  -- Reader readbacks are the only steady-state repeated PROMOTED evidence. The
  -- one narrowly typed PDC aggregate-retirement receipt is historical proof
  -- created before this migration installs the no-delete promotion trigger;
  -- the installed trigger cannot create another one afterward.
  FOR repeated_event IN
    SELECT transitioned."candidate_id", transitioned."sequence", transitioned."state",
           transitioned."at", transitioned."detail", transitioned.prior_state,
           candidate."source_id", candidate."record_class", candidate."scope"
    FROM (
      SELECT event.*,
             lag(event."state") OVER (
               PARTITION BY event."candidate_id" ORDER BY event."sequence"
             ) AS prior_state
      FROM "civic_data_candidate_events" event
    ) transitioned
    JOIN "civic_data_candidates" candidate ON candidate."id" = transitioned."candidate_id"
    WHERE (transitioned.prior_state = 'PROMOTED' AND transitioned."state" = 'PROMOTED')
       OR left(transitioned."detail", length('READER_PROJECTION_READBACK_V2 ')) =
            'READER_PROJECTION_READBACK_V2 '
       OR left(transitioned."detail", length('PDC_V2_LEGACY_MEETINGS_AGGREGATE_RETIREMENT ')) =
            'PDC_V2_LEGACY_MEETINGS_AGGREGATE_RETIREMENT '
  LOOP
    IF repeated_event.prior_state IS DISTINCT FROM 'PROMOTED'
       OR repeated_event."state" IS DISTINCT FROM 'PROMOTED'
    THEN
      RAISE EXCEPTION 'PDC 0026 preflight: typed operational evidence is not a repeated PROMOTED event' USING ERRCODE = '23514';
    END IF;
    repeated_evidence := NULL;
    repeated_observed_at := NULL;
    IF left(repeated_event."detail", length('READER_PROJECTION_READBACK_V2 ')) =
         'READER_PROJECTION_READBACK_V2 '
    THEN
      BEGIN
        repeated_evidence := substring(
          repeated_event."detail" from length('READER_PROJECTION_READBACK_V2 ') + 1
        )::jsonb;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'PDC 0026 preflight: Reader evidence is not valid JSON' USING ERRCODE = '23514';
      END;
      IF jsonb_typeof(repeated_evidence) IS DISTINCT FROM 'object'
         OR repeated_evidence->'contractVersion' IS DISTINCT FROM '2'::jsonb
         OR repeated_evidence->>'kind' IS DISTINCT FROM 'READER_PROJECTION_READBACK'
         OR repeated_evidence->>'sourceId' IS DISTINCT FROM repeated_event."source_id"
         OR repeated_evidence->>'recordClass' IS DISTINCT FROM repeated_event."record_class"
         OR repeated_evidence->>'scope' IS DISTINCT FROM repeated_event."scope"
         OR repeated_evidence->>'versionId' IS DISTINCT FROM repeated_event."candidate_id"
         OR repeated_evidence->>'pointerKey' IS DISTINCT FROM repeated_event."record_class" || ':' || repeated_event."scope"
         OR repeated_evidence->>'evidenceKind' IS DISTINCT FROM 'TYPED_READER_READ_MODEL'
         OR coalesce(repeated_evidence->>'contractId', '') = ''
         OR coalesce(repeated_evidence->>'projectionId', '') = ''
         OR coalesce(repeated_evidence->>'verifierId', '') = ''
         OR coalesce(repeated_evidence->>'verifierCodeSha', '') !~ '^[0-9a-f]{40}$'
         OR coalesce(repeated_evidence->>'status', '') NOT IN ('PASS', 'FAIL')
         OR coalesce(repeated_evidence->>'detail', '') = ''
      THEN
        RAISE EXCEPTION 'PDC 0026 preflight: Reader evidence is not bound to its candidate identity' USING ERRCODE = '23514';
      END IF;
      BEGIN
        repeated_observed_at := (repeated_evidence->>'observedAt')::timestamptz;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'PDC 0026 preflight: Reader evidence has no readable operational clock' USING ERRCODE = '23514';
      END;
      IF repeated_observed_at IS DISTINCT FROM repeated_event."at"
         OR NOT (
           EXISTS (
             SELECT 1 FROM "civic_data_promotions" pointer
             WHERE pointer."source_id" = repeated_event."source_id"
               AND pointer."record_class" = repeated_event."record_class"
               AND pointer."scope" = repeated_event."scope"
               AND pointer."current_version_id" = pointer."last_known_good_version_id"
               AND (
                 pointer."current_version_id" = repeated_event."candidate_id"
                 OR pointer."promoted_at" >= repeated_event."at"
               )
           )
           OR (
             repeated_event."source_id" = 'meetings-public-bodies'
             AND repeated_event."record_class" = 'MEETING'
             AND repeated_event."scope" = 'supported-bodies'
             AND EXISTS (
               SELECT 1 FROM "civic_data_candidate_events" retirement
               WHERE retirement."candidate_id" = repeated_event."candidate_id"
                 AND retirement."sequence" > repeated_event."sequence"
                 AND retirement."at" >= repeated_event."at"
                 AND left(retirement."detail", length('PDC_V2_LEGACY_MEETINGS_AGGREGATE_RETIREMENT ')) =
                   'PDC_V2_LEGACY_MEETINGS_AGGREGATE_RETIREMENT '
             )
           )
         )
      THEN
        RAISE EXCEPTION 'PDC 0026 preflight: Reader evidence is not bound to its current canonical projection' USING ERRCODE = '23514';
      END IF;
    ELSIF left(repeated_event."detail", length('PDC_V2_LEGACY_MEETINGS_AGGREGATE_RETIREMENT ')) =
            'PDC_V2_LEGACY_MEETINGS_AGGREGATE_RETIREMENT '
    THEN
      BEGIN
        repeated_evidence := substring(
          repeated_event."detail" from length('PDC_V2_LEGACY_MEETINGS_AGGREGATE_RETIREMENT ') + 1
        )::jsonb;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'PDC 0026 preflight: legacy aggregate retirement evidence is not valid JSON' USING ERRCODE = '23514';
      END;
      IF jsonb_typeof(repeated_evidence) IS DISTINCT FROM 'object'
         OR (repeated_evidence - ARRAY[
           'kind','legacyKey','legacySourceId','legacyRecordClass','legacyScope','legacyVersionId',
           'legacyPointerSha256','legacyCandidateRecordSha256','legacyHistorySha256',
           'legacyHistoryEventCount','legacyHistoryLastSequence',
           'replacementFullPointerSetSha256','replacementCandidateRecordSetSha256',
           'replacementHistoryWitnesses','replacementHistorySetSha256','replacementAuthoritySha256',
           'retiredAt','contractVersion','frozenBaseSha','importerCodeSha','legacyMeetingFactSha256',
           'replacementPointerSha256','replacementPartitionCount','absentPartitionCount',
           'meetingRowCount','agendaDocumentRowCount'
         ]) IS DISTINCT FROM '{}'::jsonb
         OR EXISTS (
           SELECT 1 FROM jsonb_each(repeated_evidence) scalar
           WHERE scalar."key" = ANY(ARRAY[
             'kind','legacyKey','legacySourceId','legacyRecordClass','legacyScope','legacyVersionId',
             'legacyPointerSha256','legacyCandidateRecordSha256','legacyHistorySha256',
             'replacementFullPointerSetSha256','replacementCandidateRecordSetSha256',
             'replacementHistorySetSha256','replacementAuthoritySha256','retiredAt','frozenBaseSha',
             'importerCodeSha','legacyMeetingFactSha256','replacementPointerSha256'
           ])
             AND jsonb_typeof(scalar."value") IS DISTINCT FROM 'string'
         )
         OR EXISTS (
           SELECT 1 FROM jsonb_each(repeated_evidence) scalar
           WHERE scalar."key" = ANY(ARRAY[
             'contractVersion','legacyHistoryEventCount','legacyHistoryLastSequence',
             'replacementPartitionCount','absentPartitionCount','meetingRowCount',
             'agendaDocumentRowCount'
           ])
             AND jsonb_typeof(scalar."value") IS DISTINCT FROM 'number'
         )
         OR repeated_evidence->>'kind' IS DISTINCT FROM 'LEGACY_MEETINGS_AGGREGATE_RETIRED'
         OR repeated_evidence->>'legacyKey' IS DISTINCT FROM 'MEETING:supported-bodies'
         OR repeated_evidence->>'legacySourceId' IS DISTINCT FROM 'meetings-public-bodies'
         OR repeated_evidence->>'legacyRecordClass' IS DISTINCT FROM 'MEETING'
         OR repeated_evidence->>'legacyScope' IS DISTINCT FROM 'supported-bodies'
         OR repeated_evidence->>'legacyVersionId' IS DISTINCT FROM repeated_event."candidate_id"
         OR repeated_evidence->'contractVersion' IS DISTINCT FROM '1'::jsonb
         OR coalesce(repeated_evidence->>'retiredAt', '') !~
              '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
         OR coalesce(repeated_evidence->>'frozenBaseSha', '') !~ '^[0-9a-f]{40}$'
         OR coalesce(repeated_evidence->>'importerCodeSha', '') !~ '^[0-9a-f]{40}$'
         OR coalesce(repeated_evidence->>'legacyMeetingFactSha256', '') !~ '^[0-9a-f]{64}$'
         OR coalesce(repeated_evidence->>'legacyPointerSha256', '') !~ '^[0-9a-f]{64}$'
         OR coalesce(repeated_evidence->>'legacyCandidateRecordSha256', '') !~ '^[0-9a-f]{64}$'
         OR coalesce(repeated_evidence->>'legacyHistorySha256', '') !~ '^[0-9a-f]{64}$'
         OR coalesce(repeated_evidence->>'replacementFullPointerSetSha256', '') !~ '^[0-9a-f]{64}$'
         OR coalesce(repeated_evidence->>'replacementCandidateRecordSetSha256', '') !~ '^[0-9a-f]{64}$'
         OR jsonb_typeof(repeated_evidence->'replacementHistoryWitnesses') IS DISTINCT FROM 'array'
         OR jsonb_array_length(CASE
           WHEN jsonb_typeof(repeated_evidence->'replacementHistoryWitnesses') = 'array'
             THEN repeated_evidence->'replacementHistoryWitnesses'
           ELSE '[]'::jsonb
         END) <> 83
         OR EXISTS (
           SELECT 1
           FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(repeated_evidence->'replacementHistoryWitnesses') = 'array'
               THEN repeated_evidence->'replacementHistoryWitnesses' ELSE '[]'::jsonb END
           ) WITH ORDINALITY AS replacement_history(witness, ordinal)
           WHERE jsonb_typeof(witness) IS DISTINCT FROM 'object'
              OR (witness - ARRAY[
                'scope','versionId','historySha256','historyEventCount','historyLastSequence'
              ]) IS DISTINCT FROM '{}'::jsonb
              OR jsonb_typeof(witness->'scope') IS DISTINCT FROM 'string'
              OR jsonb_typeof(witness->'versionId') IS DISTINCT FROM 'string'
              OR jsonb_typeof(witness->'historySha256') IS DISTINCT FROM 'string'
              OR jsonb_typeof(witness->'historyEventCount') IS DISTINCT FROM 'number'
              OR jsonb_typeof(witness->'historyLastSequence') IS DISTINCT FROM 'number'
              OR coalesce(witness->>'scope', '') = ''
              OR coalesce(witness->>'versionId', '') = ''
              OR coalesce(witness->>'historySha256', '') !~ '^[0-9a-f]{64}$'
              OR coalesce(witness->>'historyEventCount', '') !~ '^([5-9]|[1-9][0-9]+)$'
              OR coalesce(witness->>'historyLastSequence', '') !~ '^([5-9]|[1-9][0-9]+)$'
              OR (witness->>'historyEventCount')::integer IS DISTINCT FROM
                   (witness->>'historyLastSequence')::integer
         )
         OR (
           SELECT count(DISTINCT witness->>'scope')
           FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(repeated_evidence->'replacementHistoryWitnesses') = 'array'
               THEN repeated_evidence->'replacementHistoryWitnesses' ELSE '[]'::jsonb END
           ) witness
         ) <> 83
         OR (
           SELECT count(DISTINCT witness->>'versionId')
           FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(repeated_evidence->'replacementHistoryWitnesses') = 'array'
               THEN repeated_evidence->'replacementHistoryWitnesses' ELSE '[]'::jsonb END
           ) witness
         ) <> 83
         OR EXISTS (
           SELECT 1
           FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(repeated_evidence->'replacementHistoryWitnesses') = 'array'
               THEN repeated_evidence->'replacementHistoryWitnesses' ELSE '[]'::jsonb END
           ) WITH ORDINALITY AS current_history(witness, ordinal)
           JOIN jsonb_array_elements(
             CASE WHEN jsonb_typeof(repeated_evidence->'replacementHistoryWitnesses') = 'array'
               THEN repeated_evidence->'replacementHistoryWitnesses' ELSE '[]'::jsonb END
           ) WITH ORDINALITY AS prior_history(prior_witness, prior_ordinal)
             ON prior_ordinal = ordinal - 1
           WHERE (prior_witness->>'scope') COLLATE "C" >= (witness->>'scope') COLLATE "C"
         )
         OR coalesce(repeated_evidence->>'replacementHistorySetSha256', '') !~ '^[0-9a-f]{64}$'
         OR coalesce(repeated_evidence->>'replacementAuthoritySha256', '') !~ '^[0-9a-f]{64}$'
         OR coalesce(repeated_evidence->>'legacyHistoryEventCount', '') !~ '^([4-9]|[1-9][0-9]+)$'
         OR coalesce(repeated_evidence->>'legacyHistoryLastSequence', '') !~ '^([4-9]|[1-9][0-9]+)$'
         OR (repeated_evidence->>'legacyHistoryEventCount')::integer IS DISTINCT FROM
              (repeated_evidence->>'legacyHistoryLastSequence')::integer
         OR coalesce(repeated_evidence->>'replacementPointerSha256', '') !~ '^[0-9a-f]{64}$'
         OR coalesce(repeated_evidence->>'replacementPartitionCount', '') !~ '^[1-9][0-9]*$'
         OR coalesce(repeated_evidence->>'absentPartitionCount', '') !~ '^(0|[1-9][0-9]*)$'
         OR coalesce(repeated_evidence->>'meetingRowCount', '') !~ '^[1-9][0-9]*$'
         OR coalesce(repeated_evidence->>'agendaDocumentRowCount', '') !~ '^(0|[1-9][0-9]*)$'
         OR repeated_event."source_id" IS DISTINCT FROM 'meetings-public-bodies'
         OR repeated_event."record_class" IS DISTINCT FROM 'MEETING'
         OR repeated_event."scope" IS DISTINCT FROM 'supported-bodies'
      THEN
        RAISE EXCEPTION 'PDC 0026 preflight: legacy aggregate retirement evidence is not exact' USING ERRCODE = '23514';
      END IF;
      BEGIN
        repeated_observed_at := (repeated_evidence->>'retiredAt')::timestamptz;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'PDC 0026 preflight: legacy aggregate retirement evidence has no readable clock' USING ERRCODE = '23514';
      END;
      IF repeated_observed_at IS DISTINCT FROM repeated_event."at"
         OR (repeated_evidence->>'replacementPartitionCount')::integer +
              (repeated_evidence->>'absentPartitionCount')::integer <> 124
         OR (repeated_evidence->>'replacementPartitionCount')::integer IS DISTINCT FROM (
           SELECT count(*)::integer FROM "civic_data_promotions" permanent
           WHERE permanent."source_id" = 'meetings-public-bodies'
             AND permanent."record_class" = 'MEETING'
             AND permanent."scope" <> 'supported-bodies'
         )
         OR (
           SELECT count(*)
           FROM jsonb_array_elements(repeated_evidence->'replacementHistoryWitnesses') witness
           JOIN "civic_data_promotions" permanent
             ON permanent."key" = 'MEETING:' || (witness->>'scope')
            AND permanent."source_id" = 'meetings-public-bodies'
            AND permanent."record_class" = 'MEETING'
            AND permanent."scope" = witness->>'scope'
            AND permanent."scope" <> 'supported-bodies'
            AND permanent."current_version_id" = witness->>'versionId'
            AND permanent."last_known_good_version_id" = witness->>'versionId'
         ) <> 83
         OR EXISTS (
           SELECT 1 FROM "civic_data_promotions" obsolete
           WHERE obsolete."key" = 'MEETING:supported-bodies'
              OR (obsolete."record_class" = 'MEETING' AND obsolete."scope" = 'supported-bodies')
         )
         OR (SELECT count(*) FROM "civic_data_candidate_events" receipt
             WHERE left(receipt."detail", length('PDC_V2_LEGACY_MEETINGS_AGGREGATE_RETIREMENT ')) =
               'PDC_V2_LEGACY_MEETINGS_AGGREGATE_RETIREMENT ') <> 1
      THEN
        RAISE EXCEPTION 'PDC 0026 preflight: legacy aggregate retirement is not the unique terminal authority-transfer receipt' USING ERRCODE = '23514';
      END IF;
    ELSE
      RAISE EXCEPTION 'PDC 0026 preflight: repeated PROMOTED event is not typed Reader evidence' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM (
      SELECT "candidate_id", "at", lag("at") OVER (PARTITION BY "candidate_id" ORDER BY "sequence") AS prior_at
      FROM "civic_data_candidate_events"
    ) ordered_events WHERE prior_at IS NOT NULL AND "at" < prior_at
  ) THEN
    RAISE EXCEPTION 'PDC 0026 preflight: candidate event time moves backward by sequence' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM "civic_data_candidate_events" WHERE "at" > clock_timestamp() + interval '5 minutes')
     OR EXISTS (
       SELECT 1 FROM "civic_data_candidates"
       WHERE "validation_receipt" IS NOT NULL
         AND CASE
           WHEN coalesce("validation_receipt"->>'validatedAt', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
             THEN ("validation_receipt"->>'validatedAt')::timestamptz > clock_timestamp() + interval '5 minutes'
           ELSE true
         END
         AND NOT ("id" = ANY(legacy_reattested_predecessor_ids))
     )
     OR EXISTS (SELECT 1 FROM "civic_data_promotions" WHERE "promoted_at" > clock_timestamp() + interval '5 minutes')
  THEN
    RAISE EXCEPTION 'PDC 0026 preflight: durable operational, validation, or promotion clock is invalid or materially in the future' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "civic_data_candidates" candidate
    LEFT JOIN LATERAL (
      SELECT event."candidate_id", event."sequence", event."state", event."at"
      FROM "civic_data_candidate_events" event
      WHERE event."candidate_id" = candidate."id" ORDER BY event."sequence" ASC LIMIT 1
    ) first_event ON true
    LEFT JOIN LATERAL (
      SELECT event."state", event."at" FROM "civic_data_candidate_events" event
      WHERE event."candidate_id" = candidate."id" ORDER BY event."sequence" DESC LIMIT 1
    ) latest_event ON true
    WHERE first_event."candidate_id" IS NULL
       OR first_event."sequence" IS DISTINCT FROM 1
       OR first_event."state" IS DISTINCT FROM CASE WHEN candidate."acquisition_succeeded" THEN 'FETCHED' ELSE 'SOURCE_BLOCKED' END
       OR latest_event."state" IS DISTINCT FROM candidate."state"
       OR (
         candidate."state" IN ('SOURCE_BLOCKED', 'PARSE_INVALID', 'IDENTITY_UNRESOLVED', 'TEMPORAL_INVALID', 'SEMANTIC_INVALID', 'HORIZON_UNRESOLVED', 'DEPENDENT_CONSUMER_INVALID', 'CANNOT_TELL', 'VALIDATED')
         AND latest_event."at" IS DISTINCT FROM (candidate."validation_receipt"->>'validatedAt')::timestamptz
       )
       OR (
         candidate."state" = 'PROMOTED'
         AND NOT EXISTS (
           SELECT 1 FROM "civic_data_candidate_events" validation_event
           WHERE validation_event."candidate_id" = candidate."id"
             AND validation_event."state" = 'VALIDATED'
             AND validation_event."at" = (candidate."validation_receipt"->>'validatedAt')::timestamptz
         )
         AND NOT (candidate."id" = ANY(legacy_reattested_predecessor_ids))
       )
  ) THEN
    RAISE EXCEPTION 'PDC 0026 preflight: candidate row and append-only state history disagree' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "civic_data_candidates" candidate
    LEFT JOIN "civic_data_candidates" base
      ON base."id" = candidate."last_known_good_version_id"
     AND base."source_id" = candidate."source_id"
     AND base."record_class" = candidate."record_class"
     AND base."scope" = candidate."scope"
    WHERE candidate."last_known_good_version_id" IS NOT NULL
      AND (base."id" IS NULL OR base."state" <> 'PROMOTED'
        OR base."promoted_version_id" IS DISTINCT FROM base."id"
        OR base."last_known_good_version_id" IS DISTINCT FROM base."id")
  ) THEN
    RAISE EXCEPTION 'PDC 0026 preflight: candidate LKG base is absent, cross-contract, or not a durable promotion' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "civic_data_promotions" promotion
    LEFT JOIN "civic_data_candidates" candidate
      ON candidate."id" = promotion."current_version_id"
     AND candidate."source_id" = promotion."source_id"
     AND candidate."record_class" = promotion."record_class"
     AND candidate."scope" = promotion."scope"
    WHERE candidate."id" IS NULL
       OR promotion."current_version_id" IS DISTINCT FROM promotion."last_known_good_version_id"
       OR candidate."state" <> 'PROMOTED'
       OR candidate."promoted_version_id" IS DISTINCT FROM candidate."id"
       OR candidate."last_known_good_version_id" IS DISTINCT FROM candidate."id"
       OR promotion."payload" IS DISTINCT FROM candidate."candidate"->'readModel'
       OR promotion."validation_receipt" IS DISTINCT FROM candidate."validation_receipt"
       OR candidate."retrieved_at" > (candidate."validation_receipt"->>'validatedAt')::timestamptz
       OR (candidate."validation_receipt"->>'validatedAt')::timestamptz > promotion."promoted_at"
       OR NOT EXISTS (
         SELECT 1 FROM "civic_data_candidate_events" promoted_event
         WHERE promoted_event."candidate_id" = candidate."id"
           AND promoted_event."state" = 'PROMOTED'
           AND promoted_event."at" = promotion."promoted_at"
           AND promoted_event."sequence" = (
             SELECT min(first_promoted."sequence") FROM "civic_data_candidate_events" first_promoted
             WHERE first_promoted."candidate_id" = candidate."id" AND first_promoted."state" = 'PROMOTED'
           )
       )
  ) THEN
    RAISE EXCEPTION 'PDC 0026 preflight: canonical promotion is not the exact candidate payload, receipt, clock, and atomic event' USING ERRCODE = '23514';
  END IF;
END
$pdc_preflight$;--> statement-breakpoint
DO $pdc_authority_transfer$
BEGIN
  -- The permanent partition authorities must already have replaced and
  -- retired the obsolete aggregate before the no-delete promotion trigger is
  -- installed. Otherwise 0026 would make the transition authority permanent.
  IF EXISTS (
    SELECT 1 FROM "civic_data_promotions"
    WHERE "key" = 'MEETING:supported-bodies'
       OR ("record_class" = 'MEETING' AND "scope" = 'supported-bodies')
  ) THEN
    RAISE EXCEPTION 'PDC 0026 cutover preflight: obsolete MEETING:supported-bodies authority still exists' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "civic_data_candidates"
    WHERE "source_id" = 'meetings-public-bodies'
      AND "record_class" = 'MEETING'
      AND "scope" = 'supported-bodies'
  ) AND (
    SELECT count(*) FROM "civic_data_candidate_events"
    WHERE left("detail", length('PDC_V2_LEGACY_MEETINGS_AGGREGATE_RETIREMENT ')) =
      'PDC_V2_LEGACY_MEETINGS_AGGREGATE_RETIREMENT '
  ) <> 1 THEN
    RAISE EXCEPTION 'PDC 0026 cutover preflight: obsolete aggregate history has no unique retirement receipt' USING ERRCODE = '23514';
  END IF;
END
$pdc_authority_transfer$;--> statement-breakpoint
CREATE UNIQUE INDEX "civic_data_candidates_identity_idx" ON "civic_data_candidates" USING btree ("id","source_id","record_class","scope");--> statement-breakpoint
ALTER TABLE "civic_data_candidate_events" ADD CONSTRAINT "civic_data_candidate_events_candidate_id_civic_data_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."civic_data_candidates"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "civic_data_candidates" ADD CONSTRAINT "civic_data_candidates_lkg_candidate_fk" FOREIGN KEY ("last_known_good_version_id","source_id","record_class","scope") REFERENCES "public"."civic_data_candidates"("id","source_id","record_class","scope") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "civic_data_promotions" ADD CONSTRAINT "civic_data_promotions_current_candidate_fk" FOREIGN KEY ("current_version_id","source_id","record_class","scope") REFERENCES "public"."civic_data_candidates"("id","source_id","record_class","scope") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "civic_data_promotions" ADD CONSTRAINT "civic_data_promotions_lkg_candidate_fk" FOREIGN KEY ("last_known_good_version_id","source_id","record_class","scope") REFERENCES "public"."civic_data_candidates"("id","source_id","record_class","scope") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "civic_data_candidate_events" ADD CONSTRAINT "civic_data_candidate_events_positive_sequence" CHECK ("civic_data_candidate_events"."sequence" > 0);--> statement-breakpoint
ALTER TABLE "civic_data_candidate_events" ADD CONSTRAINT "civic_data_candidate_events_state_known" CHECK ("civic_data_candidate_events"."state" IN ('FETCHED', 'SOURCE_BLOCKED', 'NORMALIZED', 'PARSE_INVALID', 'IDENTITY_UNRESOLVED', 'TEMPORAL_INVALID', 'SEMANTIC_INVALID', 'HORIZON_UNRESOLVED', 'DEPENDENT_CONSUMER_INVALID', 'CANNOT_TELL', 'VALIDATED', 'PROMOTED'));--> statement-breakpoint
ALTER TABLE "civic_data_candidate_events" ADD CONSTRAINT "civic_data_candidate_events_detail_nonempty" CHECK (length(btrim("civic_data_candidate_events"."detail")) > 0);--> statement-breakpoint
ALTER TABLE "civic_data_candidates" ADD CONSTRAINT "civic_data_candidates_state_known" CHECK ("civic_data_candidates"."state" IN ('FETCHED', 'SOURCE_BLOCKED', 'NORMALIZED', 'PARSE_INVALID', 'IDENTITY_UNRESOLVED', 'TEMPORAL_INVALID', 'SEMANTIC_INVALID', 'HORIZON_UNRESOLVED', 'DEPENDENT_CONSUMER_INVALID', 'CANNOT_TELL', 'VALIDATED', 'PROMOTED'));--> statement-breakpoint
ALTER TABLE "civic_data_candidates" ADD CONSTRAINT "civic_data_candidates_promotion_fields_coherent" CHECK ((
  "civic_data_candidates"."state" = 'PROMOTED'
  AND "civic_data_candidates"."promoted_version_id" IS NOT DISTINCT FROM "civic_data_candidates"."id"
  AND "civic_data_candidates"."last_known_good_version_id" IS NOT DISTINCT FROM "civic_data_candidates"."id"
) OR (
  "civic_data_candidates"."state" <> 'PROMOTED'
  AND "civic_data_candidates"."promoted_version_id" IS NULL
));--> statement-breakpoint
ALTER TABLE "civic_data_candidates" ADD CONSTRAINT "civic_data_candidates_envelope_identity_coherent" CHECK (
  jsonb_typeof("civic_data_candidates"."candidate") IS NOT DISTINCT FROM 'object'
  AND ("civic_data_candidates"."candidate"->>'id') IS NOT DISTINCT FROM "civic_data_candidates"."id"
  AND ("civic_data_candidates"."candidate"->>'sourceId') IS NOT DISTINCT FROM "civic_data_candidates"."source_id"
  AND ("civic_data_candidates"."candidate"->>'recordClass') IS NOT DISTINCT FROM "civic_data_candidates"."record_class"
  AND ("civic_data_candidates"."candidate"->>'scope') IS NOT DISTINCT FROM "civic_data_candidates"."scope"
  AND (("civic_data_candidates"."candidate"#>>'{retrieval,retrievedAt}')::timestamptz) IS NOT DISTINCT FROM "civic_data_candidates"."retrieved_at"
  AND ("civic_data_candidates"."candidate"#>>'{temporal,sourceThrough}') IS NOT DISTINCT FROM "civic_data_candidates"."source_through"
  AND ("civic_data_candidates"."candidate"#>>'{normalization,parserVersion}') IS NOT DISTINCT FROM "civic_data_candidates"."parser_version"
  AND ("civic_data_candidates"."candidate"#>'{retrieval,succeeded}') IS NOT DISTINCT FROM to_jsonb("civic_data_candidates"."acquisition_succeeded")
  AND ("civic_data_candidates"."candidate"#>>'{retrieval,rawHash}') IS NOT DISTINCT FROM "civic_data_candidates"."raw_hash"
  AND ("civic_data_candidates"."candidate"#>>'{normalization,normalizedHash}') IS NOT DISTINCT FROM "civic_data_candidates"."normalized_hash"
  AND ("civic_data_candidates"."candidate"->'identities') IS NOT DISTINCT FROM "civic_data_candidates"."identity"
);--> statement-breakpoint
ALTER TABLE "civic_data_candidates" ADD CONSTRAINT "civic_data_candidates_disposition_receipt_coherent" CHECK ((
  "civic_data_candidates"."state" IN ('FETCHED', 'NORMALIZED')
  AND "civic_data_candidates"."validation_receipt" IS NULL
  AND "civic_data_candidates"."failure_code" IS NULL
  AND "civic_data_candidates"."failure_detail" IS NULL
) OR (
  "civic_data_candidates"."state" IN ('VALIDATED', 'PROMOTED')
  AND jsonb_typeof("civic_data_candidates"."validation_receipt") IS NOT DISTINCT FROM 'object'
  AND ("civic_data_candidates"."validation_receipt"->'contractVersion') IS NOT DISTINCT FROM '2'::jsonb
  AND ("civic_data_candidates"."validation_receipt"->>'decision') IS NOT DISTINCT FROM 'GOOD'
  AND ("civic_data_candidates"."validation_receipt"->>'candidateId') IS NOT DISTINCT FROM "civic_data_candidates"."id"
  AND ("civic_data_candidates"."validation_receipt"->>'sourceId') IS NOT DISTINCT FROM "civic_data_candidates"."source_id"
  AND ("civic_data_candidates"."validation_receipt"->>'recordClass') IS NOT DISTINCT FROM "civic_data_candidates"."record_class"
  AND ("civic_data_candidates"."validation_receipt"->>'scope') IS NOT DISTINCT FROM "civic_data_candidates"."scope"
  AND ((("civic_data_candidates"."validation_receipt"->>'validatedAt')::timestamptz >= "civic_data_candidates"."retrieved_at") IS TRUE)
  AND "civic_data_candidates"."failure_code" IS NULL
  AND "civic_data_candidates"."failure_detail" IS NULL
) OR (
  "civic_data_candidates"."state" IN ('SOURCE_BLOCKED', 'PARSE_INVALID', 'IDENTITY_UNRESOLVED', 'TEMPORAL_INVALID', 'SEMANTIC_INVALID', 'HORIZON_UNRESOLVED', 'DEPENDENT_CONSUMER_INVALID', 'CANNOT_TELL')
  AND jsonb_typeof("civic_data_candidates"."validation_receipt") IS NOT DISTINCT FROM 'object'
  AND ("civic_data_candidates"."validation_receipt"->'contractVersion') IS NOT DISTINCT FROM '2'::jsonb
  AND (("civic_data_candidates"."validation_receipt"->>'decision') IN ('FAIL', 'CANNOT_TELL')) IS TRUE
  AND ("civic_data_candidates"."validation_receipt"->>'candidateId') IS NOT DISTINCT FROM "civic_data_candidates"."id"
  AND ("civic_data_candidates"."validation_receipt"->>'sourceId') IS NOT DISTINCT FROM "civic_data_candidates"."source_id"
  AND ("civic_data_candidates"."validation_receipt"->>'recordClass') IS NOT DISTINCT FROM "civic_data_candidates"."record_class"
  AND ("civic_data_candidates"."validation_receipt"->>'scope') IS NOT DISTINCT FROM "civic_data_candidates"."scope"
  AND ((length(btrim("civic_data_candidates"."failure_code")) > 0) IS TRUE)
  AND ((length(btrim("civic_data_candidates"."failure_detail")) > 0) IS TRUE)
  AND jsonb_typeof(jsonb_path_query_first("civic_data_candidates"."validation_receipt", '$.checks[*] ? (@.verdict != "PASS")')) IS NOT DISTINCT FROM 'object'
  AND (jsonb_path_query_first("civic_data_candidates"."validation_receipt", '$.checks[*] ? (@.verdict != "PASS")')->>'code') IS NOT DISTINCT FROM "civic_data_candidates"."failure_code"
  AND (jsonb_path_query_first("civic_data_candidates"."validation_receipt", '$.checks[*] ? (@.verdict != "PASS")')->>'detail') IS NOT DISTINCT FROM "civic_data_candidates"."failure_detail"
));--> statement-breakpoint
ALTER TABLE "civic_data_promotions" ADD CONSTRAINT "civic_data_promotions_key_coherent" CHECK ("civic_data_promotions"."key" = "civic_data_promotions"."record_class" || ':' || "civic_data_promotions"."scope");--> statement-breakpoint
ALTER TABLE "civic_data_promotions" ADD CONSTRAINT "civic_data_promotions_lkg_is_current" CHECK ("civic_data_promotions"."current_version_id" = "civic_data_promotions"."last_known_good_version_id");--> statement-breakpoint
ALTER TABLE "civic_data_promotions" ADD CONSTRAINT "civic_data_promotions_receipt_identity_coherent" CHECK (
  jsonb_typeof("civic_data_promotions"."validation_receipt") IS NOT DISTINCT FROM 'object'
  AND ("civic_data_promotions"."validation_receipt"->>'decision') IS NOT DISTINCT FROM 'GOOD'
  AND ("civic_data_promotions"."validation_receipt"->>'candidateId') IS NOT DISTINCT FROM "civic_data_promotions"."current_version_id"
  AND ("civic_data_promotions"."validation_receipt"->>'sourceId') IS NOT DISTINCT FROM "civic_data_promotions"."source_id"
  AND ("civic_data_promotions"."validation_receipt"->>'recordClass') IS NOT DISTINCT FROM "civic_data_promotions"."record_class"
  AND ("civic_data_promotions"."validation_receipt"->>'scope') IS NOT DISTINCT FROM "civic_data_promotions"."scope"
  AND ("civic_data_promotions"."validation_receipt"->'contractVersion') IS NOT DISTINCT FROM '2'::jsonb
  AND ((("civic_data_promotions"."validation_receipt"->>'validatedAt')::timestamptz <= "civic_data_promotions"."promoted_at") IS TRUE)
);--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_civic_data_candidate_event_insert()
RETURNS trigger LANGUAGE plpgsql AS $pdc_event_insert$
DECLARE
  candidate_row "civic_data_candidates"%ROWTYPE;
  prior_event "civic_data_candidate_events"%ROWTYPE;
  expected_sequence integer;
  expected_initial_state text;
  receipt_at timestamptz;
  readback jsonb;
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
      IF left(NEW."detail", length('READER_PROJECTION_READBACK_V2 ')) <> 'READER_PROJECTION_READBACK_V2 ' THEN
        RAISE EXCEPTION 'candidate % repeated PROMOTED event is not typed Reader evidence', NEW."candidate_id" USING ERRCODE = '23514';
      END IF;
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
$pdc_event_insert$;--> statement-breakpoint
CREATE TRIGGER civic_data_candidate_events_insert_integrity BEFORE INSERT ON "civic_data_candidate_events"
FOR EACH ROW EXECUTE FUNCTION enforce_civic_data_candidate_event_insert();--> statement-breakpoint
CREATE OR REPLACE FUNCTION refuse_civic_data_candidate_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $pdc_event_immutable$
BEGIN
  RAISE EXCEPTION 'civic_data_candidate_events is append-only; % is forbidden', TG_OP USING ERRCODE = '55000';
END
$pdc_event_immutable$;--> statement-breakpoint
CREATE TRIGGER civic_data_candidate_events_append_only BEFORE UPDATE OR DELETE ON "civic_data_candidate_events"
FOR EACH ROW EXECUTE FUNCTION refuse_civic_data_candidate_event_mutation();--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_civic_data_candidate_mutation()
RETURNS trigger LANGUAGE plpgsql AS $pdc_candidate_mutation$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'civic_data_candidates is immutable evidence; DELETE is forbidden' USING ERRCODE = '55000';
  END IF;
  IF ROW(NEW."id", NEW."source_id", NEW."record_class", NEW."scope", NEW."acquisition_succeeded", NEW."raw_hash", NEW."normalized_hash", NEW."retrieved_at", NEW."source_through", NEW."parser_version", NEW."identity", NEW."candidate")
     IS DISTINCT FROM
     ROW(OLD."id", OLD."source_id", OLD."record_class", OLD."scope", OLD."acquisition_succeeded", OLD."raw_hash", OLD."normalized_hash", OLD."retrieved_at", OLD."source_through", OLD."parser_version", OLD."identity", OLD."candidate")
  THEN
    RAISE EXCEPTION 'civic_data_candidates immutable identity/acquisition/evidence fields cannot be rewritten' USING ERRCODE = '55000';
  END IF;
  IF NOT (
    (OLD."state" = 'FETCHED' AND NEW."state" IN ('NORMALIZED', 'SOURCE_BLOCKED', 'PARSE_INVALID', 'IDENTITY_UNRESOLVED', 'TEMPORAL_INVALID', 'SEMANTIC_INVALID', 'HORIZON_UNRESOLVED', 'DEPENDENT_CONSUMER_INVALID', 'CANNOT_TELL'))
    OR (OLD."state" = 'NORMALIZED' AND NEW."state" IN ('VALIDATED', 'SOURCE_BLOCKED', 'PARSE_INVALID', 'IDENTITY_UNRESOLVED', 'TEMPORAL_INVALID', 'SEMANTIC_INVALID', 'HORIZON_UNRESOLVED', 'DEPENDENT_CONSUMER_INVALID', 'CANNOT_TELL'))
    OR (OLD."state" = 'VALIDATED' AND NEW."state" IN ('PROMOTED', 'SOURCE_BLOCKED', 'PARSE_INVALID', 'IDENTITY_UNRESOLVED', 'TEMPORAL_INVALID', 'SEMANTIC_INVALID', 'HORIZON_UNRESOLVED', 'DEPENDENT_CONSUMER_INVALID', 'CANNOT_TELL'))
  ) THEN
    RAISE EXCEPTION 'civic_data_candidates disposition transition % -> % is forbidden', OLD."state", NEW."state" USING ERRCODE = '23514';
  END IF;
  IF NEW."state" <> 'PROMOTED' AND NEW."last_known_good_version_id" IS DISTINCT FROM OLD."last_known_good_version_id" THEN
    RAISE EXCEPTION 'candidate LKG base may change only during the VALIDATED -> PROMOTED pointer transaction' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$pdc_candidate_mutation$;--> statement-breakpoint
CREATE TRIGGER civic_data_candidates_immutable_evidence BEFORE UPDATE OR DELETE ON "civic_data_candidates"
FOR EACH ROW EXECUTE FUNCTION enforce_civic_data_candidate_mutation();--> statement-breakpoint
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
  checked_candidate_id := CASE WHEN TG_TABLE_NAME = 'civic_data_candidates' THEN NEW."id" ELSE NEW."candidate_id" END;
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
$pdc_candidate_history$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER civic_data_candidates_history_matches_row AFTER INSERT OR UPDATE ON "civic_data_candidates"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_civic_data_candidate_history_integrity();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER civic_data_candidate_events_match_candidate AFTER INSERT ON "civic_data_candidate_events"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_civic_data_candidate_history_integrity();--> statement-breakpoint
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
$pdc_promotion_mutation$;--> statement-breakpoint
CREATE TRIGGER civic_data_promotions_no_delete_or_rewrite BEFORE UPDATE OR DELETE ON "civic_data_promotions"
FOR EACH ROW EXECUTE FUNCTION enforce_civic_data_promotion_mutation();--> statement-breakpoint
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
     OR NEW."payload" IS DISTINCT FROM candidate_row."candidate"->'readModel'
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
$pdc_promotion_integrity$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER civic_data_promotions_exact_candidate_proof AFTER INSERT OR UPDATE ON "civic_data_promotions"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_civic_data_promotion_integrity();
