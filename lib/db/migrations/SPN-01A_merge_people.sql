-- One record per person where an identifier the sources themselves publish proves two records are the same person:
-- the same Open States id in any of its spellings (ocd-person/<uuid>, plural:<uuid>, plural:<st>:<uuid>), or one record
-- listing another's id as a key it is known by. A name is never used. The record carrying the most facts, children and
-- keys survives; every other id becomes an alias that points to it. Two records tied together that hold different
-- Open States ids are two people until a detective settles it, so they get a blank and stay as they are.
DROP TABLE IF EXISTS spn01a_key, spn01a_edge, spn01a_group, spn01a_clean, spn01a_move;
--> statement-breakpoint
CREATE TEMP TABLE spn01a_key (entity_id text NOT NULL, key text NOT NULL);
--> statement-breakpoint
INSERT INTO spn01a_key
SELECT p.id, 'ocd-person:' || lower(substring(p.id FROM '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'))
FROM entity p WHERE p.kind = 'person' AND p.id ~ '^(ocd-person/|plural:([a-z]{2}:)?)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
--> statement-breakpoint
INSERT INTO spn01a_key SELECT id, id FROM entity WHERE kind = 'person';
--> statement-breakpoint
INSERT INTO spn01a_key
SELECT x.entity_id, 'ocd-person:' || lower(substring(x.value FROM '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'))
FROM entity_external_id x JOIN entity p ON p.id = x.entity_id AND p.kind = 'person'
WHERE x.scheme NOT LIKE 'roster-name:%' AND x.scheme <> 'body-alias'
  AND x.value ~ '^((ocd-person/|plural:([a-z]{2}:)?)?)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
--> statement-breakpoint
INSERT INTO spn01a_key
SELECT x.entity_id, x.value FROM entity_external_id x JOIN entity p ON p.id = x.entity_id AND p.kind = 'person'
WHERE x.scheme NOT LIKE 'roster-name:%' AND x.scheme <> 'body-alias' AND EXISTS (SELECT 1 FROM entity other WHERE other.id = x.value AND other.kind = 'person');
--> statement-breakpoint
CREATE INDEX ON spn01a_key (key);
--> statement-breakpoint
CREATE INDEX ON spn01a_key (entity_id);
--> statement-breakpoint
CREATE TEMP TABLE spn01a_edge AS
SELECT DISTINCT a.entity_id AS a, b.entity_id AS b FROM spn01a_key a JOIN spn01a_key b ON b.key = a.key AND b.entity_id <> a.entity_id;
--> statement-breakpoint
CREATE INDEX ON spn01a_edge (a);
--> statement-breakpoint
-- Each connected set of records is a group named by its smallest id.
CREATE TEMP TABLE spn01a_group AS
WITH RECURSIVE reach(a, b) AS (
  SELECT a, b FROM spn01a_edge
  UNION SELECT r.a, e.b FROM reach r JOIN spn01a_edge e ON e.a = r.b
)
SELECT a AS entity_id, least(a, min(b)) AS grp FROM reach GROUP BY a;
--> statement-breakpoint
CREATE INDEX ON spn01a_group (entity_id);
--> statement-breakpoint
-- A group is clean when it names one state and at most one Open States id.
CREATE TEMP TABLE spn01a_clean AS
SELECT g.grp FROM spn01a_group g JOIN entity e ON e.id = g.entity_id
LEFT JOIN spn01a_key k ON k.entity_id = g.entity_id AND k.key LIKE 'ocd-person:%'
GROUP BY g.grp HAVING count(DISTINCT e.state) <= 1 AND count(DISTINCT k.key) <= 1;
--> statement-breakpoint
INSERT INTO blank (entity_id, field, stage, reason, detail, next_try_at, attempts)
SELECT min(g.entity_id), 'identity:key-conflict', 'CHECK', 'IDENTITY_TIE',
  jsonb_build_object('candidates', jsonb_agg(g.entity_id ORDER BY g.entity_id), 'why', 'KEY_CONFLICT')::text, now(), 1
FROM spn01a_group g WHERE g.grp NOT IN (SELECT grp FROM spn01a_clean) GROUP BY g.grp
ON CONFLICT (entity_id, field) DO NOTHING;
--> statement-breakpoint
-- The survivor is the record with the most facts, children and keys, so the fewest rows move; ties go to the smaller id.
CREATE TEMP TABLE spn01a_move AS
SELECT loser, survivor FROM (
  SELECT g.entity_id AS loser, first_value(g.entity_id) OVER (PARTITION BY g.grp ORDER BY w.weight DESC, g.entity_id) AS survivor
  FROM spn01a_group g JOIN spn01a_clean c ON c.grp = g.grp
  CROSS JOIN LATERAL (SELECT (SELECT count(*) FROM fact f WHERE f.entity_id = g.entity_id)
    + (SELECT count(*) FROM entity child WHERE child.parent_id = g.entity_id)
    + (SELECT count(*) FROM entity_external_id x WHERE x.entity_id = g.entity_id) AS weight) w
) ranked WHERE loser <> survivor;
--> statement-breakpoint
CREATE INDEX ON spn01a_move (loser);
--> statement-breakpoint
-- Two live facts for one field keep the one the Slide's rule picks: the more official provenance, then the newer source copy.
-- Everything else about a loser's facts, history included, moves to the survivor unchanged.
WITH members AS (
  SELECT loser AS entity_id, survivor FROM spn01a_move UNION SELECT survivor, survivor FROM spn01a_move
), live AS (
  SELECT f.id, row_number() OVER (PARTITION BY m.survivor, f.field ORDER BY
    CASE f.provenance_kind WHEN 'OWNER' THEN 0 WHEN 'OFFICIAL' THEN 1 WHEN 'FILING' THEN 1 WHEN 'REFERENCE' THEN 2 WHEN 'NEWS' THEN 3 WHEN 'CAMPAIGN' THEN 4 ELSE 5 END,
    coalesce(s.fetched_at, f.checked_at) DESC, (f.entity_id = m.survivor) DESC, f.id DESC) AS place
  FROM fact f JOIN members m ON m.entity_id = f.entity_id LEFT JOIN source_copy s ON s.id = f.source_copy_id WHERE f.status = 'live'
)
UPDATE fact SET status = 'superseded' WHERE id IN (SELECT id FROM live WHERE place > 1);
--> statement-breakpoint
UPDATE fact SET entity_id = m.survivor FROM spn01a_move m WHERE fact.entity_id = m.loser;
--> statement-breakpoint
-- A body lists its members by person id in the field name; the same rule decides a seat that both ids held.
WITH renamed AS (
  SELECT f.id, f.entity_id, 'member:' || m.survivor AS field FROM fact f JOIN spn01a_move m ON f.field = 'member:' || m.loser
  UNION ALL SELECT f.id, f.entity_id, f.field FROM fact f WHERE f.status = 'live' AND f.field IN (SELECT 'member:' || survivor FROM spn01a_move)
), live AS (
  SELECT f.id, row_number() OVER (PARTITION BY r.entity_id, r.field ORDER BY
    CASE f.provenance_kind WHEN 'OWNER' THEN 0 WHEN 'OFFICIAL' THEN 1 WHEN 'FILING' THEN 1 WHEN 'REFERENCE' THEN 2 WHEN 'NEWS' THEN 3 WHEN 'CAMPAIGN' THEN 4 ELSE 5 END,
    coalesce(s.fetched_at, f.checked_at) DESC, f.id DESC) AS place
  FROM fact f JOIN renamed r ON r.id = f.id LEFT JOIN source_copy s ON s.id = f.source_copy_id WHERE f.status = 'live'
)
UPDATE fact SET status = 'superseded' WHERE id IN (SELECT id FROM live WHERE place > 1);
--> statement-breakpoint
UPDATE fact SET field = 'member:' || m.survivor FROM spn01a_move m WHERE fact.field = 'member:' || m.loser;
--> statement-breakpoint
INSERT INTO entity_place (entity_id, place_id, boundary_year, placement_basis)
SELECT m.survivor, p.place_id, p.boundary_year, p.placement_basis FROM entity_place p JOIN spn01a_move m ON m.loser = p.entity_id
ON CONFLICT (entity_id, place_id, boundary_year) DO NOTHING;
--> statement-breakpoint
DELETE FROM entity_place WHERE entity_id IN (SELECT loser FROM spn01a_move);
--> statement-breakpoint
INSERT INTO entity_host (entity_id, host, proved_by) SELECT m.survivor, h.host, h.proved_by FROM entity_host h JOIN spn01a_move m ON m.loser = h.entity_id
ON CONFLICT DO NOTHING;
--> statement-breakpoint
DELETE FROM entity_host WHERE entity_id IN (SELECT loser FROM spn01a_move);
--> statement-breakpoint
UPDATE entity_external_id SET entity_id = m.survivor FROM spn01a_move m WHERE entity_external_id.entity_id = m.loser;
--> statement-breakpoint
UPDATE entity SET parent_id = m.survivor FROM spn01a_move m WHERE entity.parent_id = m.loser;
--> statement-breakpoint
UPDATE blank SET entity_id = pick.survivor FROM (
  SELECT DISTINCT ON (m.survivor, b.field) b.entity_id AS loser, b.field, m.survivor
  FROM blank b JOIN spn01a_move m ON m.loser = b.entity_id
  WHERE NOT EXISTS (SELECT 1 FROM blank held WHERE held.entity_id = m.survivor AND held.field = b.field)
  ORDER BY m.survivor, b.field, b.opened_at
) pick WHERE blank.entity_id = pick.loser AND blank.field = pick.field;
--> statement-breakpoint
DELETE FROM blank WHERE entity_id IN (SELECT loser FROM spn01a_move);
--> statement-breakpoint
INSERT INTO place_page_dependency (page_id, entity_id) SELECT d.page_id, m.survivor FROM place_page_dependency d JOIN spn01a_move m ON m.loser = d.entity_id
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO entity_external_id (entity_id, scheme, value) SELECT survivor, 'body-alias', loser FROM spn01a_move
ON CONFLICT (scheme, value) DO UPDATE SET entity_id = EXCLUDED.entity_id;
--> statement-breakpoint
DELETE FROM entity WHERE id IN (SELECT loser FROM spn01a_move);
--> statement-breakpoint
-- People who share a name and a state but no identifier stay separate; a detective is asked, with every candidate named. Two people
-- who hold different Open States ids are known to be different and are not asked about.
INSERT INTO blank (entity_id, field, stage, reason, detail, next_try_at, attempts)
SELECT min(named.id), 'identity:name-only', 'CHECK', 'IDENTITY_NAME_ONLY',
  jsonb_build_object('candidates', jsonb_agg(named.id ORDER BY named.id), 'why', 'NAME_ONLY')::text, now(), 1
FROM (SELECT e.id, e.state, lower(e.name) AS name, o.openstates
  FROM entity e LEFT JOIN (SELECT entity_id, min(key) AS openstates FROM spn01a_key WHERE key LIKE 'ocd-person:%' GROUP BY entity_id) o ON o.entity_id = e.id
  WHERE e.kind = 'person' AND e.state IS NOT NULL) named
GROUP BY named.state, named.name
HAVING count(*) > 1 AND (count(named.openstates) < count(*) OR count(DISTINCT named.openstates) < count(named.openstates))
ON CONFLICT (entity_id, field) DO NOTHING;
--> statement-breakpoint
-- Every page that shows or depends on a surviving person is rebuilt, so the duplicate is gone from the page, not only from the store.
INSERT INTO rebuild_queue (place_id, queued_at, priority, next_queued_at)
SELECT e.id, clock_timestamp(), e.page_priority, clock_timestamp() FROM entity e WHERE e.id IN (
  SELECT p.place_id FROM entity_place p WHERE p.entity_id IN (SELECT survivor FROM spn01a_move)
    AND p.place_id !~ '^ocd-division/country:us(/(state|territory|district):[a-z]{2})?$'
  UNION SELECT d.page_id FROM place_page_dependency d WHERE d.entity_id IN (SELECT survivor FROM spn01a_move)
) ORDER BY e.id
ON CONFLICT (place_id) DO UPDATE SET generation = rebuild_queue.generation
    + CASE WHEN rebuild_queue.lease_token IS NOT NULL OR rebuild_queue.built_generation = rebuild_queue.generation THEN 1 ELSE 0 END,
  next_queued_at = CASE WHEN rebuild_queue.lease_token IS NOT NULL THEN coalesce(rebuild_queue.next_queued_at, clock_timestamp()) ELSE clock_timestamp() END
WHERE rebuild_queue.next_queued_at IS NULL OR rebuild_queue.built_generation = rebuild_queue.generation;
--> statement-breakpoint
DROP TABLE spn01a_key, spn01a_edge, spn01a_group, spn01a_clean, spn01a_move;
