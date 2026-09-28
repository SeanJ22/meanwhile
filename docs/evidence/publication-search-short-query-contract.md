# Draft short-literal publication search contract

This is an isolated search-index follow-up. The SQL in
`publication-search-short-postings-draft.sql` is **not in the migration
journal, has not been applied to Neon, and has no performance acceptance**.
The original immutable GOOD/PROMOTED candidate and event remain authority.

The v2 16 KiB chunks retain every byte of the searchable version ID, record
key and record JSON. A full user literal is at most 100 UTF-16 units, hence at
most 400 UTF-8 bytes; adjacent chunks overlap by at least 512 bytes. A
complete match therefore lies in at least one chunk. The short index stores
the distinct one- and two-Unicode-codepoint spellings in each chunk as
collision-free 64-bit codes. Its dictionary retains the original spellings.
The producer is a trigger on each canonical chunk insert, so future
promotion and its short signature commit together.

For a short or punctuation-heavy query, derive the first and last two
codepoints using `publicationHistoryShortGrams`. A one-codepoint query uses
one gram. Escape each gram with `publicationHistoryExactGramPattern` and
escape the full literal with the existing `publicationHistoryPattern`.
Look up equivalent gram codes with **PostgreSQL `ILIKE` on the dictionary
spellings under the database's own collation**, rather than JavaScript
lowercasing. For each candidate chunk, require overlap with the first and
last code sets, then recheck the **full chunk** with the exact escaped
`ILIKE` pattern. Only after that recheck may the query distinct parent
`(version_id, record_key)`, join the immutable search parent, apply the
`promoted_at <= asOf` cutoff, count the *entire* match set and page 25
metadata rows. No count or candidate cap is allowed.

The candidate portion is:

```sql
WITH readiness AS MATERIALIZED (
  SELECT
    EXISTS (SELECT 1 FROM civic_data_publication_search_readiness
      WHERE id = 'publication-history' AND schema_version = 2 AND status = 'READY')
    AND EXISTS (SELECT 1 FROM civic_data_publication_search_short_readiness
      WHERE id = 'publication-history-short' AND schema_version = 3 AND status = 'READY')
    AS ready
), first_codes AS MATERIALIZED (
  SELECT coalesce(array_agg(gram_code), '{}'::bigint[]) AS codes
  FROM civic_data_publication_search_short_vocabulary
  WHERE gram ILIKE $1  -- exact escaped first gram, no surrounding %
), last_codes AS MATERIALIZED (
  SELECT coalesce(array_agg(gram_code), '{}'::bigint[]) AS codes
  FROM civic_data_publication_search_short_vocabulary
  WHERE gram ILIKE $2  -- exact escaped last gram, or repeat first
), matching_keys AS MATERIALIZED (
  SELECT DISTINCT chunk.version_id, chunk.record_key
  FROM civic_data_publication_search_short_signatures signature
  JOIN civic_data_publication_search_chunks chunk
    USING (version_id, record_key, chunk_ordinal)
  WHERE (SELECT ready FROM readiness)
    AND signature.gram_codes && (SELECT codes FROM first_codes)
    AND signature.gram_codes && (SELECT codes FROM last_codes)
    AND chunk.search_chunk ILIKE $3  -- complete escaped literal with surrounding %
)
-- Join matching_keys to civic_data_publication_search, apply promoted_at/asOf,
-- count all matches, and only then page, as the current reader does.
```

The SQL reader must return `UNAVAILABLE`, with an unknown total, if the
short readiness marker is absent. It must never report zero from an incomplete
backfill. Exact version/key navigation may continue to use the existing v2
READY gate. A current Reader confirmation or hunt membership is never
inferred from a historical search match.

The branch's database uses `C.UTF-8`; read-only examples show
`'İ' ILIKE 'i'` and `'K' ILIKE 'k'` true, while
`'ß' ILIKE 'ss'` false. The vocabulary's database-side `ILIKE`
preserves that case behavior without an unsafe ASCII-only fold. Before
activation, a collation/Unicode query equivalence test must confirm that a
full literal match implies matches for its first and last one/two-codepoint
grams. If not, that query class must use a complete exact scan or remain
`UNAVAILABLE`; it must never take a lossy shortcut.
Small read-only SQL cases for Greek sigma, dotted I, Kelvin sign, combining
mark, emoji and literal percent/underscore showed that implication under
`C.UTF-8`; they are not an exhaustive collation proof.

The prior isolated-clone measurements showed candidate GIN lookups were fast
but TOAST rechecks of full text and large list payloads were not. This
signature removes no exact recheck, and 16 KiB chunks may still be toasted.
The blocked 0.25-CU clone benchmark must measure cold common, short
punctuation, literal percent/underscore/backslash, late-match, no-match and
exact-count cases before any sub-three-second or production readiness claim.
