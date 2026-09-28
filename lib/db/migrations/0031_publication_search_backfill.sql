-- One source pass and one set insert, rather than re-reading a large candidate
-- once per member. First PROMOTED sequence supplies its immutable event time.
WITH source AS MATERIALIZED (
  SELECT c."id",c."record_class",c."scope",c."retrieved_at",event."at" AS promoted_at,
    jsonb_typeof(c."candidate"->'civicRecords') IS DISTINCT FROM 'array' AS legacy_document,
    CASE WHEN jsonb_typeof(c."candidate"->'civicRecords') = 'array'
      THEN c."candidate"->'civicRecords'
      ELSE jsonb_build_array(jsonb_build_object('key','legacy-document','record',c."candidate"->'readModel')) END AS members
  FROM "civic_data_candidates" c
  JOIN (SELECT DISTINCT ON ("candidate_id") "candidate_id","at"
    FROM "civic_data_candidate_events" WHERE "state" = 'PROMOTED'
    ORDER BY "candidate_id","sequence") event ON event."candidate_id" = c."id"
  WHERE c."state" = 'PROMOTED' AND c."validation_receipt"->>'decision' = 'GOOD'
    AND c."promoted_version_id" = c."id"
)
INSERT INTO "civic_data_publication_search" ("version_id","record_key","record_class","scope",
  "captured_at","promoted_at","legacy_document","record","label","source_url")
SELECT source."id", member.value->>'key', source."record_class", source."scope", source."retrieved_at",
  source.promoted_at, source.legacy_document,
  member.value->'record',publication_search_label(member.value->'record'),publication_search_source_url(member.value->'record')
FROM source CROSS JOIN LATERAL jsonb_array_elements(source.members) member(value)
ON CONFLICT ("version_id","record_key") DO NOTHING;--> statement-breakpoint
-- Build each full member text once. The chunk function converts it to UTF-8
-- bytes once, slices by byte offset, and expands split edges to codepoint
-- boundaries. This avoids repeated prefix scans on giant legacy documents.
WITH full_texts AS MATERIALIZED (
  SELECT "version_id","record_key",publication_search_full_text("version_id","record_key","record") AS full_text
  FROM "civic_data_publication_search"
)
INSERT INTO "civic_data_publication_search_chunks" ("version_id","record_key","chunk_ordinal","search_chunk")
SELECT full_texts."version_id",full_texts."record_key",chunks.chunk_ordinal,chunks.search_chunk
FROM full_texts CROSS JOIN LATERAL publication_search_chunks_from_text(full_texts.full_text) AS chunks
ON CONFLICT ("version_id","record_key","chunk_ordinal") DO NOTHING;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "civic_data_publication_search_chunk_trgm_idx" ON "civic_data_publication_search_chunks" USING gin ("search_chunk" gin_trgm_ops);--> statement-breakpoint
-- Certify every parent has its exact complete, ordered chunk coverage once,
-- during the heavy stage. This stage holds no publication event-table trigger
-- lock. A count alone could miss a wrong chunk with a matching ordinal.
DO $publication_search_backfill_verify$
DECLARE
  measured_parents bigint;
  measured_chunks bigint;
  expected_chunks bigint;
  mismatched_chunks bigint;
BEGIN
  SELECT count(*) INTO measured_parents FROM "civic_data_publication_search";
  SELECT count(*) INTO measured_chunks FROM "civic_data_publication_search_chunks";
  WITH full_texts AS MATERIALIZED (
    SELECT "version_id","record_key",publication_search_full_text("version_id","record_key","record") AS full_text
    FROM "civic_data_publication_search"
  )
  SELECT count(*), count(*) FILTER (WHERE actual."search_chunk" IS DISTINCT FROM chunks.search_chunk)
  INTO expected_chunks,mismatched_chunks
  FROM full_texts CROSS JOIN LATERAL publication_search_chunks_from_text(full_texts.full_text) AS chunks
  LEFT JOIN "civic_data_publication_search_chunks" actual
    ON actual."version_id" = full_texts."version_id" AND actual."record_key" = full_texts."record_key"
    AND actual."chunk_ordinal" = chunks.chunk_ordinal;
  IF measured_chunks <> expected_chunks OR mismatched_chunks <> 0 THEN
    RAISE EXCEPTION 'publication search backfill mismatch: expected %, stored %, mismatched %',
      expected_chunks, measured_chunks, mismatched_chunks USING ERRCODE = '23514';
  END IF;
  INSERT INTO "civic_data_publication_search_readiness"
    ("id","schema_version","status","verified_at","parent_count","chunk_count")
  VALUES ('publication-history',2,'BACKFILLED',now(),measured_parents,measured_chunks);
END
$publication_search_backfill_verify$;
