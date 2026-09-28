-- DRAFT ONLY. Not in the Drizzle journal and not authorized for database apply.
-- This is an additive candidate index over the complete v2 publication chunks.
-- The original candidate/event and each v2 chunk remain authoritative. A
-- candidate from this index MUST pass exact escaped search_chunk ILIKE before
-- it contributes to the full distinct-record count or a page.
--
-- Stage A: commit this short setup before any long backfill. The AFTER INSERT
-- trigger makes subsequent canonical promotion writes atomically derive their
-- signatures. Existing v2 reads do not use these tables.

CREATE OR REPLACE FUNCTION publication_search_short_gram_code(p_gram text)
RETURNS bigint LANGUAGE plpgsql IMMUTABLE STRICT AS $short_gram_code$
DECLARE
  length integer := char_length(p_gram);
BEGIN
  IF length = 1 THEN RETURN ascii(p_gram)::bigint; END IF;
  IF length = 2 THEN
    RETURN 2097152::bigint + ascii(substr(p_gram, 1, 1))::bigint * 2097152
      + ascii(substr(p_gram, 2, 1))::bigint;
  END IF;
  RAISE EXCEPTION 'a short publication gram must have one or two Unicode codepoints'
    USING ERRCODE = '22023';
END
$short_gram_code$;

CREATE TABLE civic_data_publication_search_short_vocabulary (
  gram_code bigint PRIMARY KEY,
  gram text NOT NULL UNIQUE,
  CONSTRAINT publication_short_gram_length CHECK (char_length(gram) BETWEEN 1 AND 2),
  CONSTRAINT publication_short_gram_code CHECK
    (gram_code = publication_search_short_gram_code(gram))
);

CREATE TABLE civic_data_publication_search_short_signatures (
  version_id text NOT NULL,
  record_key text NOT NULL,
  chunk_ordinal integer NOT NULL,
  gram_codes bigint[] NOT NULL,
  PRIMARY KEY (version_id, record_key, chunk_ordinal),
  FOREIGN KEY (version_id, record_key, chunk_ordinal)
    REFERENCES civic_data_publication_search_chunks
      (version_id, record_key, chunk_ordinal) ON DELETE NO ACTION,
  CONSTRAINT publication_short_signature_nonempty CHECK (cardinality(gram_codes) > 0)
);

CREATE TABLE civic_data_publication_search_short_readiness (
  id text PRIMARY KEY,
  schema_version integer NOT NULL,
  status text NOT NULL,
  verified_at timestamptz NOT NULL,
  chunk_count bigint NOT NULL,
  vocabulary_count bigint NOT NULL
);

-- One regex split and one window pass over a bounded UTF-8-safe v2 chunk.
-- DISTINCT keeps one code for each one/two-codepoint spelling per chunk.
-- The gram spelling is retained so PostgreSQL, not JavaScript, decides ILIKE
-- equivalence under the same database collation as the final exact recheck.
CREATE OR REPLACE FUNCTION publication_search_short_grams(p_text text)
RETURNS TABLE(gram_code bigint, gram text)
LANGUAGE sql IMMUTABLE STRICT AS $short_grams$
  WITH characters AS MATERIALIZED (
    SELECT character, lead(character) OVER (ORDER BY position) AS next_character
    FROM regexp_split_to_table(p_text, '') WITH ORDINALITY AS split(character, position)
  ), spellings AS (
    SELECT character AS gram FROM characters
    UNION ALL
    SELECT character || next_character FROM characters WHERE next_character IS NOT NULL
  )
  SELECT DISTINCT publication_search_short_gram_code(gram), gram FROM spellings
$short_grams$;

CREATE OR REPLACE FUNCTION index_civic_publication_short_chunk()
RETURNS trigger LANGUAGE plpgsql AS $index_short_chunk$
DECLARE
  codes bigint[];
  spellings text[];
BEGIN
  SELECT array_agg(gram_code ORDER BY gram_code), array_agg(gram ORDER BY gram_code)
    INTO codes, spellings
  FROM publication_search_short_grams(NEW.search_chunk);
  -- Every v2 chunk has at least one character; refuse a malformed empty unit.
  IF codes IS NULL OR cardinality(codes) = 0 THEN
    RAISE EXCEPTION 'publication search chunk has no short grams' USING ERRCODE = '23514';
  END IF;
  INSERT INTO civic_data_publication_search_short_vocabulary(gram_code, gram)
    SELECT entry.code, entry.spelling
    FROM unnest(codes, spellings) AS entry(code, spelling)
    ON CONFLICT (gram_code) DO NOTHING;
  INSERT INTO civic_data_publication_search_short_signatures
    (version_id, record_key, chunk_ordinal, gram_codes)
    VALUES (NEW.version_id, NEW.record_key, NEW.chunk_ordinal, codes)
    ON CONFLICT (version_id, record_key, chunk_ordinal) DO NOTHING;
  RETURN NULL;
END
$index_short_chunk$;

CREATE TRIGGER civic_data_publication_search_short_from_chunk
AFTER INSERT ON civic_data_publication_search_chunks
FOR EACH ROW EXECUTE FUNCTION index_civic_publication_short_chunk();

-- Stage B: long isolated backfill after Stage A committed. Concurrent
-- promotions are covered by the trigger. Build a GIN array index after data
-- load. This stage has NOT been run or benchmarked on any Neon branch.
INSERT INTO civic_data_publication_search_short_vocabulary(gram_code, gram)
SELECT DISTINCT grams.gram_code, grams.gram
FROM civic_data_publication_search_chunks chunks
CROSS JOIN LATERAL publication_search_short_grams(chunks.search_chunk) grams
ON CONFLICT (gram_code) DO NOTHING;

INSERT INTO civic_data_publication_search_short_signatures
  (version_id, record_key, chunk_ordinal, gram_codes)
SELECT chunks.version_id, chunks.record_key, chunks.chunk_ordinal,
  array_agg(grams.gram_code ORDER BY grams.gram_code)
FROM civic_data_publication_search_chunks chunks
CROSS JOIN LATERAL publication_search_short_grams(chunks.search_chunk) grams
GROUP BY chunks.version_id, chunks.record_key, chunks.chunk_ordinal
ON CONFLICT (version_id, record_key, chunk_ordinal) DO NOTHING;

CREATE INDEX civic_data_publication_search_short_gin_idx
  ON civic_data_publication_search_short_signatures USING gin (gram_codes);

-- Stage C: one complete parity proof, then READY in that same transaction.
-- A count-only proof is insufficient: every saved chunk's sorted signature
-- must equal the signature rederived from that exact chunk. The vocabulary
-- code/spelling CHECK and UNIQUE constraints protect case-aware lookup.
BEGIN;
DO $verify_short_publication_search$
DECLARE
  expected_count bigint;
  stored_count bigint;
  mismatch_count bigint;
  missing_vocabulary_count bigint;
  vocabulary_count bigint;
BEGIN
  SELECT count(*) INTO expected_count FROM civic_data_publication_search_chunks;
  SELECT count(*) INTO stored_count FROM civic_data_publication_search_short_signatures;
  -- Derive one chunk at a time. Materializing every gram across the whole
  -- population would multiply the 755k source rows into a huge temporary
  -- relation and can exceed the isolated branch's memory.
  SELECT count(*) INTO mismatch_count
  FROM civic_data_publication_search_chunks chunks
  LEFT JOIN civic_data_publication_search_short_signatures saved
    USING (version_id, record_key, chunk_ordinal)
  WHERE saved.gram_codes IS DISTINCT FROM (
    SELECT array_agg(grams.gram_code ORDER BY grams.gram_code)
    FROM publication_search_short_grams(chunks.search_chunk) grams
  );
  -- Signature parity above proves each code is source-derived. The
  -- dictionary must contain a spelling for every code before ILIKE lookup.
  SELECT count(*) INTO missing_vocabulary_count
  FROM (SELECT DISTINCT unnest(gram_codes) AS gram_code
    FROM civic_data_publication_search_short_signatures) expected
  LEFT JOIN civic_data_publication_search_short_vocabulary saved
    USING (gram_code)
  WHERE saved.gram_code IS NULL;
  IF expected_count <> stored_count OR mismatch_count <> 0 OR missing_vocabulary_count <> 0 THEN
    RAISE EXCEPTION 'short publication index incomplete: chunks %, signatures %, mismatches %, missing vocabulary %',
      expected_count, stored_count, mismatch_count, missing_vocabulary_count USING ERRCODE = '23514';
  END IF;
  SELECT count(*) INTO vocabulary_count FROM civic_data_publication_search_short_vocabulary;
  INSERT INTO civic_data_publication_search_short_readiness
    (id, schema_version, status, verified_at, chunk_count, vocabulary_count)
    VALUES ('publication-history-short', 3, 'READY', now(), expected_count, vocabulary_count);
END
$verify_short_publication_search$;

CREATE TRIGGER civic_data_publication_search_short_vocab_immutable
BEFORE INSERT OR UPDATE OR DELETE ON civic_data_publication_search_short_vocabulary
FOR EACH ROW EXECUTE FUNCTION verify_civic_publication_search_row();
CREATE TRIGGER civic_data_publication_search_short_signatures_immutable
BEFORE INSERT OR UPDATE OR DELETE ON civic_data_publication_search_short_signatures
FOR EACH ROW EXECUTE FUNCTION verify_civic_publication_search_row();
CREATE TRIGGER civic_data_publication_search_short_readiness_immutable
BEFORE INSERT OR UPDATE OR DELETE ON civic_data_publication_search_short_readiness
FOR EACH ROW EXECUTE FUNCTION verify_civic_publication_search_row();
COMMIT;
