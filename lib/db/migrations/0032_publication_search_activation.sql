-- Install the event-table trigger only after the long backfill and index
-- builds. This DDL briefly blocks event writers until this transaction commits.
DO $publication_search_require_backfill$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "civic_data_publication_search_readiness"
    WHERE "id" = 'publication-history' AND "schema_version" = 2 AND "status" = 'BACKFILLED')
  THEN RAISE EXCEPTION 'publication search backfill receipt is missing' USING ERRCODE = '23514'; END IF;
END
$publication_search_require_backfill$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER civic_data_publication_search_from_promoted_event
AFTER INSERT ON "civic_data_candidate_events" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW WHEN (NEW."state" = 'PROMOTED') EXECUTE FUNCTION index_civic_publication_from_event();--> statement-breakpoint
-- Catch promotions committed between the first backfill snapshot and the
-- trigger lock. The lock now prevents a publisher from crossing this gap.
DO $publication_search_catchup$
DECLARE
  missing_version_id text;
BEGIN
  FOR missing_version_id IN
    SELECT c."id" FROM "civic_data_candidates" c
    WHERE c."state" = 'PROMOTED' AND c."validation_receipt"->>'decision' = 'GOOD'
      AND c."promoted_version_id" = c."id"
      AND EXISTS (SELECT 1 FROM "civic_data_candidate_events" e WHERE e."candidate_id" = c."id" AND e."state" = 'PROMOTED')
      AND NOT EXISTS (SELECT 1 FROM "civic_data_publication_search" p WHERE p."version_id" = c."id")
  LOOP
    PERFORM index_civic_publication_candidate(missing_version_id);
    IF EXISTS (SELECT 1 FROM "civic_data_publication_search" p
      WHERE p."version_id" = missing_version_id AND NOT EXISTS (
        SELECT 1 FROM "civic_data_publication_search_chunks" chunk
        WHERE chunk."version_id" = p."version_id" AND chunk."record_key" = p."record_key"))
    THEN RAISE EXCEPTION 'publication search catch-up lacks a chunk for %', missing_version_id USING ERRCODE = '23514'; END IF;
  END LOOP;
END
$publication_search_catchup$;--> statement-breakpoint
UPDATE "civic_data_publication_search_readiness" SET "status" = 'READY'
WHERE "id" = 'publication-history' AND "schema_version" = 2 AND "status" = 'BACKFILLED';--> statement-breakpoint
CREATE TRIGGER civic_data_publication_search_immutable BEFORE INSERT OR UPDATE OR DELETE ON "civic_data_publication_search"
FOR EACH ROW EXECUTE FUNCTION verify_civic_publication_search_row();--> statement-breakpoint
CREATE TRIGGER civic_data_publication_search_chunks_immutable BEFORE INSERT OR UPDATE OR DELETE ON "civic_data_publication_search_chunks"
FOR EACH ROW EXECUTE FUNCTION verify_civic_publication_search_row();--> statement-breakpoint
CREATE TRIGGER civic_data_publication_search_readiness_immutable BEFORE INSERT OR UPDATE OR DELETE ON "civic_data_publication_search_readiness"
FOR EACH ROW EXECUTE FUNCTION verify_civic_publication_search_row();
