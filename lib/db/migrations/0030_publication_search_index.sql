CREATE TABLE "civic_data_publication_search" (
	"version_id" text NOT NULL,
	"record_key" text NOT NULL,
	"record_class" text NOT NULL,
	"scope" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"promoted_at" timestamp with time zone NOT NULL,
	"legacy_document" boolean NOT NULL,
	"record" jsonb NOT NULL,
	"label" text,
	"source_url" text,
	CONSTRAINT "civic_data_publication_search_version_id_record_key_pk" PRIMARY KEY("version_id","record_key"),
	CONSTRAINT "civic_data_publication_search_version_id_civic_data_candidates_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."civic_data_candidates"("id") ON DELETE restrict ON UPDATE restrict
);
--> statement-breakpoint
CREATE TABLE "civic_data_publication_search_chunks" (
	"version_id" text NOT NULL,
	"record_key" text NOT NULL,
	"chunk_ordinal" integer NOT NULL,
	"search_chunk" text NOT NULL,
	CONSTRAINT "civic_data_publication_search_chunks_version_id_record_key_chunk_ordinal_pk" PRIMARY KEY("version_id","record_key","chunk_ordinal"),
	CONSTRAINT "civic_data_publication_search_chunks_version_id_record_key_civic_data_publication_search_version_id_record_key_fk" FOREIGN KEY ("version_id","record_key") REFERENCES "public"."civic_data_publication_search"("version_id","record_key") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE "civic_data_publication_search_readiness" (
	"id" text PRIMARY KEY NOT NULL,
	"schema_version" integer NOT NULL,
	"status" text NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"parent_count" bigint NOT NULL,
	"chunk_count" bigint NOT NULL
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
CREATE OR REPLACE FUNCTION publication_search_label(p_record jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $publication_label$
DECLARE
  candidate text;
BEGIN
  candidate := coalesce(
    CASE WHEN jsonb_typeof(p_record->'name') = 'string' THEN p_record->>'name' END,
    CASE WHEN jsonb_typeof(p_record->'title') = 'string' THEN p_record->>'title' END,
    CASE WHEN jsonb_typeof(p_record->'bodyName') = 'string' THEN p_record->>'bodyName' END,
    CASE WHEN jsonb_typeof(p_record->'candidateName') = 'string' THEN p_record->>'candidateName' END,
    CASE WHEN jsonb_typeof(p_record->'candidateNameAsFiled') = 'string' THEN p_record->>'candidateNameAsFiled' END,
    CASE WHEN jsonb_typeof(p_record->'label') = 'string' THEN p_record->>'label' END
  );
  RETURN left(nullif(btrim(candidate), ''), 300);
END
$publication_label$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION publication_search_source_url(p_record jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $publication_source_url$
DECLARE
  candidate text;
BEGIN
  candidate := coalesce(
    CASE WHEN jsonb_typeof(p_record->'sourceUrl') = 'string' THEN p_record->>'sourceUrl' END,
    CASE WHEN jsonb_typeof(p_record->'provenance'->'sourceUrl') = 'string' THEN p_record->'provenance'->>'sourceUrl' END
  );
  IF candidate IS NULL OR char_length(candidate) > 2048 THEN RETURN NULL; END IF;
  RETURN candidate;
END
$publication_source_url$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION publication_search_full_text(p_version_id text, p_record_key text, p_record jsonb)
RETURNS text LANGUAGE sql IMMUTABLE AS $publication_search_full_text$
  SELECT p_version_id || ' ' || p_record_key || ' ' || p_record::text
$publication_search_full_text$;--> statement-breakpoint
-- Byte offsets avoid PostgreSQL's UTF-8 text substring path, which scans
-- from character zero for every increasing start position. Each 16 KiB unit
-- overlaps the next by at least 512 bytes. A searched literal of at most 100
-- Unicode codepoints occupies at most 400 UTF-8 bytes, so one unit contains
-- every possible match. Expand split edges outward to UTF-8 boundaries before
-- decoding; neither the first nor the final byte can be dropped.
CREATE OR REPLACE FUNCTION publication_search_chunks_from_text(p_text text)
RETURNS TABLE(chunk_ordinal integer, search_chunk text)
LANGUAGE plpgsql IMMUTABLE AS $publication_search_chunks$
DECLARE
  bytes bytea := convert_to(p_text, 'UTF8');
  byte_length integer := octet_length(bytes);
  raw_start integer := 0;
  raw_end integer;
  safe_start integer;
  safe_end integer;
BEGIN
  WHILE raw_start < byte_length LOOP
    safe_start := raw_start;
    WHILE safe_start > 0 AND get_byte(bytes, safe_start) BETWEEN 128 AND 191 LOOP
      safe_start := safe_start - 1;
    END LOOP;
    raw_end := least(byte_length, raw_start + 16384);
    safe_end := raw_end;
    WHILE safe_end < byte_length AND get_byte(bytes, safe_end) BETWEEN 128 AND 191 LOOP
      safe_end := safe_end + 1;
    END LOOP;
    chunk_ordinal := raw_start / 15872;
    search_chunk := convert_from(substring(bytes FROM safe_start + 1 FOR safe_end - safe_start), 'UTF8');
    RETURN NEXT;
    raw_start := raw_start + 15872;
  END LOOP;
END
$publication_search_chunks$;--> statement-breakpoint
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
      "captured_at","promoted_at","legacy_document","record","label","source_url")
    SELECT source_row."id", member.value->>'key', source_row."record_class", source_row."scope",
      source_row."retrieved_at", first_promoted_at, false, member.value->'record',
      publication_search_label(member.value->'record'), publication_search_source_url(member.value->'record')
    FROM jsonb_array_elements(source_row."candidate"->'civicRecords') AS member(value)
    ON CONFLICT ("version_id","record_key") DO NOTHING;
  ELSE
    INSERT INTO "civic_data_publication_search" ("version_id","record_key","record_class","scope",
      "captured_at","promoted_at","legacy_document","record","label","source_url")
    VALUES (source_row."id", 'legacy-document', source_row."record_class", source_row."scope",
      source_row."retrieved_at", first_promoted_at, true, source_row."candidate"->'readModel',
      publication_search_label(source_row."candidate"->'readModel'), publication_search_source_url(source_row."candidate"->'readModel'))
    ON CONFLICT ("version_id","record_key") DO NOTHING;
  END IF;
  WITH full_texts AS MATERIALIZED (
    SELECT "version_id","record_key",publication_search_full_text("version_id","record_key","record") AS full_text
    FROM "civic_data_publication_search" WHERE "version_id" = p_version_id
  )
  INSERT INTO "civic_data_publication_search_chunks" ("version_id","record_key","chunk_ordinal","search_chunk")
  SELECT full_texts."version_id",full_texts."record_key",chunks.chunk_ordinal,chunks.search_chunk
  FROM full_texts CROSS JOIN LATERAL publication_search_chunks_from_text(full_texts.full_text) AS chunks
  ON CONFLICT ("version_id","record_key","chunk_ordinal") DO NOTHING;
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
CREATE INDEX "civic_data_publication_search_time_idx" ON "civic_data_publication_search" USING btree ("promoted_at" DESC NULLS LAST,"version_id","record_key");--> statement-breakpoint
CREATE INDEX "civic_data_publication_search_scope_idx" ON "civic_data_publication_search" USING btree ("record_class","scope");--> statement-breakpoint
