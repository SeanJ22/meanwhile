WITH RECURSIVE selected AS MATERIALIZED (
  SELECT jsonb_build_object(
    'projection',jsonb_build_object('key',p.key,'recordClass',p.record_class,'scope',p.scope,'sourceId',p.source_id,
      'versionId',p.current_version_id,'lastKnownGoodVersionId',p.last_known_good_version_id,
      'promotedAt',p.promoted_at,'payload',p.payload,'receipt',p.validation_receipt),
    'candidate',jsonb_build_object('candidate',c.candidate,'state',c.state,'acquisitionSucceeded',c.acquisition_succeeded,'promotedVersion',c.promoted_version_id,
      'lastKnownGoodVersion',c.last_known_good_version_id,'failureCode',c.failure_code,'failureDetail',c.failure_detail)) AS roots,
    (c.id=p.current_version_id AND c.source_id=p.source_id AND c.record_class=p.record_class AND c.scope=p.scope
      AND p.current_version_id=p.last_known_good_version_id AND c.promoted_version_id=c.id AND c.last_known_good_version_id=c.id
      AND c.state='PROMOTED' AND c.acquisition_succeeded AND c.candidate#>'{normalization,succeeded}'='true'::jsonb
      AND c.normalized_hash ~ '^[a-f0-9]{64}$' AND p.validation_receipt=c.validation_receipt
      AND p.validation_receipt->>'decision'='GOOD' AND p.validation_receipt->>'candidateId'=c.id
      AND p.validation_receipt->>'sourceId'=c.source_id AND p.validation_receipt->>'recordClass'=c.record_class
      AND p.validation_receipt->>'scope'=c.scope AND p.payload=c.candidate->'readModel') AS proof_valid,
    (SELECT detail FROM civic_data_candidate_events e WHERE e.candidate_id=p.current_version_id
      AND left(e.detail,26)='UNCHANGED_CONFIRMATION_V1 ' ORDER BY sequence DESC LIMIT 1) AS confirmation
  FROM civic_data_promotions p LEFT JOIN civic_data_candidates c ON c.id=p.current_version_id
  WHERE p.key='BALLOT_CANDIDACY:US-CA:state-election-ballots'
), hashes(hash) AS (
  SELECT ref#>>'{}' FROM selected,LATERAL jsonb_path_query(roots,'strict $.**."$civicPayloadPart"','{}',true) ref WHERE proof_valid
  UNION
  SELECT ref#>>'{}' FROM hashes JOIN civic_data_payload_parts part USING(hash),
    LATERAL jsonb_path_query(part.payload,'strict $.**."$civicPayloadPart"','{}',true) ref
)
SELECT roots,proof_valid,confirmation,
  COALESCE((SELECT jsonb_object_agg(part.hash,part.payload) FROM hashes JOIN civic_data_payload_parts part USING(hash)),'{}'::jsonb) AS parts
FROM selected
