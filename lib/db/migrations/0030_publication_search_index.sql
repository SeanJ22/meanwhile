CREATE TABLE "civic_data_publication_search" (
	"version_id" text NOT NULL,
	"record_key" text NOT NULL,
	"record_class" text NOT NULL,
	"scope" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"promoted_at" timestamp with time zone NOT NULL,
	"legacy_document" boolean NOT NULL,
	"record" jsonb NOT NULL,
	"search_text" text NOT NULL,
	CONSTRAINT "civic_data_publication_search_version_id_record_key_pk" PRIMARY KEY("version_id","record_key"),
	CONSTRAINT "civic_data_publication_search_version_id_civic_data_candidates_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."civic_data_candidates"("id") ON DELETE restrict ON UPDATE restrict
);
--> statement-breakpoint
-- A row may be inserted only inside the canonical PROMOTED-event trigger.
-- Backfill runs before this guard is installed; it calls the same deriving
-- function. Every later direct hand-authored row and every edit is refused.
CREATE OR REPLACE FUNCTION verify_civic_publication_search_row()
RETURNS trigger LANGUAGE plpgsql AS $publication_search_verify$
BEGIN
  IF TG_OP = 'INSERT' AND pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'publication search rows are derived only from the promotion event and are immutable' USING ERRCODE = '55000';
END
$publication_search_verify$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION index_civic_publication_candidate(p_version_id text)
RETURNS void LANGUAGE plpgsql AS $publication_search_index$
DECLARE
  source_row "civic_data_candidates"%ROWTYPE;
  first_promoted_at timestamptz;
BEGIN
  SELECT * INTO source_row FROM "civic_data_candidates" WHERE "id" = p_version_id;
  SELECT e."at" INTO first_promoted_at FROM "civic_data_candidate_events" e
    WHERE e."candidate_id" = p_version_id AND e."state" = 'PROMOTED'
    ORDER BY e."sequence" LIMIT 1;
  IF NOT FOUND OR source_row."state" <> 'PROMOTED'
     OR source_row."validation_receipt"->>'decision' IS DISTINCT FROM 'GOOD'
     OR source_row."promoted_version_id" IS DISTINCT FROM source_row."id"
  THEN
    RAISE EXCEPTION 'publication index requires a promoted GOOD candidate and event' USING ERRCODE = '23514';
  END IF;
  IF jsonb_typeof(source_row."candidate"->'civicRecords') = 'array' THEN
    INSERT INTO "civic_data_publication_search" ("version_id","record_key","record_class","scope",
      "captured_at","promoted_at","legacy_document","record","search_text")
    SELECT source_row."id", member.value->>'key', source_row."record_class", source_row."scope",
      source_row."retrieved_at", first_promoted_at, false, member.value->'record',
      source_row."id" || ' ' || (member.value->>'key') || ' ' || (member.value->'record')::text
    FROM jsonb_array_elements(source_row."candidate"->'civicRecords') AS member(value)
    ON CONFLICT ("version_id","record_key") DO NOTHING;
  ELSE
    INSERT INTO "civic_data_publication_search" ("version_id","record_key","record_class","scope",
      "captured_at","promoted_at","legacy_document","record","search_text")
    VALUES (source_row."id", 'legacy-document', source_row."record_class", source_row."scope",
      source_row."retrieved_at", first_promoted_at, true, source_row."candidate"->'readModel',
      source_row."id" || ' legacy-document ' || (source_row."candidate"->'readModel')::text)
    ON CONFLICT ("version_id","record_key") DO NOTHING;
  END IF;
END
$publication_search_index$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION index_civic_publication_from_event()
RETURNS trigger LANGUAGE plpgsql AS $publication_search_event$
DECLARE
  first_sequence integer;
BEGIN
  SELECT e."sequence" INTO first_sequence FROM "civic_data_candidate_events" e
    WHERE e."candidate_id" = NEW."candidate_id" AND e."state" = 'PROMOTED'
    ORDER BY e."sequence" LIMIT 1;
  IF NEW."sequence" = first_sequence THEN
    PERFORM index_civic_publication_candidate(NEW."candidate_id");
  END IF;
  RETURN NULL;
END
$publication_search_event$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER civic_data_publication_search_from_promoted_event
AFTER INSERT ON "civic_data_candidate_events" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW WHEN (NEW."state" = 'PROMOTED') EXECUTE FUNCTION index_civic_publication_from_event();--> statement-breakpoint
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
)
INSERT INTO "civic_data_publication_search" ("version_id","record_key","record_class","scope",
  "captured_at","promoted_at","legacy_document","record","search_text")
SELECT source."id", member.value->>'key', source."record_class", source."scope", source."retrieved_at",
  source.promoted_at, source.legacy_document,
  member.value->'record', source."id" || ' ' || (member.value->>'key') || ' ' || (member.value->'record')::text
FROM source CROSS JOIN LATERAL jsonb_array_elements(source.members) member(value)
ON CONFLICT ("version_id","record_key") DO NOTHING;--> statement-breakpoint
CREATE TRIGGER civic_data_publication_search_immutable BEFORE INSERT OR UPDATE OR DELETE ON "civic_data_publication_search"
FOR EACH ROW EXECUTE FUNCTION verify_civic_publication_search_row();--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "civic_data_publication_search_text_trgm_idx" ON "civic_data_publication_search" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "civic_data_publication_search_time_idx" ON "civic_data_publication_search" USING btree ("promoted_at" DESC NULLS LAST,"version_id","record_key");--> statement-breakpoint
CREATE INDEX "civic_data_publication_search_scope_idx" ON "civic_data_publication_search" USING btree ("record_class","scope");
