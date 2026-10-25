-- Read-only export for an isolated local replay; replace __STATE__ with one validated postal code.
-- No reader interactions, posts, reactions, credentials or control-plane payloads are selected.
WITH RECURSIVE picked AS MATERIALIZED (
  SELECT f.* FROM fact f JOIN entity e ON e.id=f.entity_id
  WHERE f.status='live' AND e.state='__STATE__'
  ORDER BY f.id LIMIT 1000
), seeds AS (
  SELECT entity_id AS id FROM picked
  UNION SELECT substr(field,8) FROM picked WHERE field LIKE 'member:%'
  UNION SELECT ep.place_id FROM entity_place ep JOIN picked f ON f.entity_id=ep.entity_id
), ancestors(id) AS (
  SELECT e.id FROM entity e JOIN seeds s ON s.id=e.id
  UNION SELECT e.parent_id FROM entity e JOIN ancestors a ON a.id=e.id WHERE e.parent_id IS NOT NULL
), entities AS (
  SELECT e.* FROM entity e JOIN ancestors a ON a.id=e.id
), copies AS (
  SELECT s.id,s.url,s.final_url,s.fetched_at,s.sha256,s.is_archive,
    'local-replay-source:' || s.id AS blob_key
  FROM source_copy s
  WHERE s.id IN (SELECT source_copy_id FROM picked UNION SELECT second_copy_id FROM picked)
)
SELECT jsonb_build_object(
  'state','__STATE__','capturedAt',now(),
  'facts',(SELECT jsonb_agg(p) FROM picked p),
  'entities',(SELECT jsonb_agg(e) FROM entities e),
  'sourceCopies',(SELECT jsonb_agg(c) FROM copies c),
  'hosts',(SELECT jsonb_agg(h) FROM entity_host h WHERE h.entity_id IN (SELECT id FROM entities)),
  'externalIds',(SELECT jsonb_agg(x) FROM entity_external_id x WHERE x.entity_id IN (SELECT id FROM entities)),
  'places',(SELECT jsonb_agg(ep) FROM entity_place ep
    WHERE ep.entity_id IN (SELECT id FROM entities) AND ep.place_id IN (SELECT id FROM entities))
) AS snapshot;
