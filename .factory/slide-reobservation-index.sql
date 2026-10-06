-- Proposal for River's schema/migration path only. Not applied by slide.
-- Production EXPLAIN currently scans 43,022 Attempts for this membership read.
-- The literal predicates exactly match postgres-evidence.ts. Default jsonb
-- GIN operators support ?|; jsonb_path_ops does not.
CREATE INDEX CONCURRENTLY IF NOT EXISTS cp_attempts_acquirer_artifact_ids
  ON cp_attempts USING gin ((value -> 'artifactIds'))
  WHERE value #>> '{worker,role}' = 'ACQUIRER'
    AND value ->> 'outcome' = 'COMPLETED';
-- Preserve River's online-DDL handling and numbered bootstrap/migration path.
-- Read-only EXPLAIN after application must choose the relevant index for
-- representative artifact ids. Do not claim the index is live from this file.
