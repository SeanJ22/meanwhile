-- Duplicate records proven to be one thing become one, and every old id stays as an alias of the survivor.
-- People: the same Open States id in any of its spellings (ocd-person/<uuid>, plural:<uuid>, plural:<st>:<uuid>, person:<st>:<uuid>), or one
-- record listing another's id as a key it is known by. A name is never used. Two records tied together that hold different Open States ids are
-- two people until a detective settles it, so they get a blank and stay as they are.
-- Governing boards: a government's records of its own governing board when each is provably that board. The record carrying the most facts,
-- children and keys survives. A board with any other name stays, and the government gets a blank.
-- The whole file runs as one statement under the contract budget, so every step reaches the large tables by index from the few merged ids:
-- each work table is analyzed before it is joined, a list of ids is matched as = ANY (ARRAY(...)), and member fields are looked up as exact strings.
DROP TABLE IF EXISTS spn01a_key, spn01a_edge, spn01a_group, spn01a_clean, spn01a_move, spn01a_member;
--> statement-breakpoint
CREATE TEMP TABLE spn01a_key (entity_id text NOT NULL, key text NOT NULL);
--> statement-breakpoint
INSERT INTO spn01a_key
SELECT p.id, 'ocd-person:' || lower(substring(p.id FROM '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'))
FROM entity p WHERE p.kind = 'person' AND p.id ~ '^(ocd-person/|plural:([a-z]{2}:)?|person:[a-z]{2}:)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
--> statement-breakpoint
INSERT INTO spn01a_key SELECT id, id FROM entity WHERE kind = 'person';
--> statement-breakpoint
INSERT INTO spn01a_key
SELECT x.entity_id, 'ocd-person:' || lower(substring(x.value FROM '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'))
FROM entity_external_id x JOIN entity p ON p.id = x.entity_id AND p.kind = 'person'
WHERE x.scheme NOT LIKE 'roster-name:%' AND x.scheme <> 'body-alias'
  AND x.value ~ '^((ocd-person/|plural:([a-z]{2}:)?|person:[a-z]{2}:)?)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
--> statement-breakpoint
INSERT INTO spn01a_key
SELECT x.entity_id, x.value FROM entity_external_id x JOIN entity p ON p.id = x.entity_id AND p.kind = 'person'
WHERE x.scheme NOT LIKE 'roster-name:%' AND x.scheme <> 'body-alias' AND EXISTS (SELECT 1 FROM entity other WHERE other.id = x.value AND other.kind = 'person');
--> statement-breakpoint
CREATE INDEX ON spn01a_key (key);
--> statement-breakpoint
CREATE INDEX ON spn01a_key (entity_id);
--> statement-breakpoint
ANALYZE spn01a_key;
--> statement-breakpoint
CREATE TEMP TABLE spn01a_edge AS
SELECT DISTINCT a.entity_id AS a, b.entity_id AS b FROM spn01a_key a JOIN spn01a_key b ON b.key = a.key AND b.entity_id <> a.entity_id;
--> statement-breakpoint
CREATE INDEX ON spn01a_edge (a);
--> statement-breakpoint
ANALYZE spn01a_edge;
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
ANALYZE spn01a_group;
--> statement-breakpoint
-- A group is clean when it names one state and at most one Open States id.
CREATE TEMP TABLE spn01a_clean AS
SELECT g.grp FROM spn01a_group g JOIN entity e ON e.id = g.entity_id
LEFT JOIN spn01a_key k ON k.entity_id = g.entity_id AND k.key LIKE 'ocd-person:%'
GROUP BY g.grp HAVING count(DISTINCT e.state) <= 1 AND count(DISTINCT k.key) <= 1;
--> statement-breakpoint
ANALYZE spn01a_clean;
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
-- A government's governing board is held twice when two records hang on it in the governing slot (#governing, or #board for a school) and both
-- are provably that board: each is named for the government itself, or is its bare "City Council" / "Board of Education". A record with any other
-- name (a joint meeting, another authority's board) is not provably the same and stays, with a detective asked. Only a government holding two
-- such records is weighed.
INSERT INTO spn01a_move
SELECT loser, survivor FROM (
  SELECT k.id AS loser, first_value(k.id) OVER (PARTITION BY k.parent_id ORDER BY w.weight DESC, k.id) AS survivor
  FROM (
    SELECT b.id, b.parent_id, count(*) OVER (PARTITION BY b.parent_id) AS held
    FROM entity b JOIN entity g ON g.id = b.parent_id AND g.kind = 'government'
    WHERE b.kind = 'body' AND (b.id LIKE '%#governing' OR b.id LIKE '%#board') AND CASE
        WHEN lower(btrim(regexp_replace(regexp_replace(btrim(b.name), '\s+(governing|school) board$', '', 'i'), '[^a-zA-Z0-9]+', ' ', 'g')))
          = lower(btrim(regexp_replace(g.name, '[^a-zA-Z0-9]+', ' ', 'g'))) THEN true
        WHEN lower(btrim(b.name)) ~ '^(city|town|village|borough|township) council$' AND g.id ~ '^[a-z]{2}:city:' THEN true
        WHEN lower(btrim(b.name)) = 'board of education' AND g.id ~ '^[a-z]{2}:(school|depschool):' THEN true
        ELSE false END
  ) k
  CROSS JOIN LATERAL (SELECT (SELECT count(*) FROM fact f WHERE f.entity_id = k.id)
    + (SELECT count(*) FROM entity child WHERE child.parent_id = k.id)
    + (SELECT count(*) FROM entity_external_id x WHERE x.entity_id = k.id) AS weight) w
  WHERE k.held > 1
) ranked WHERE loser <> survivor;
--> statement-breakpoint
CREATE INDEX ON spn01a_move (loser);
--> statement-breakpoint
ANALYZE spn01a_move;
--> statement-breakpoint
-- A body lists its members by person id in the field name, so each merged id's field is spelled out once to be found by index.
CREATE TEMP TABLE spn01a_member AS SELECT 'member:' || loser AS old_field, 'member:' || survivor AS field FROM spn01a_move;
--> statement-breakpoint
ANALYZE spn01a_member;
--> statement-breakpoint
-- Two live facts for one field keep the one the Slide's rule picks: the more official provenance, then the newer source copy.
-- Everything else about a loser's facts, history included, moves to the survivor unchanged.
WITH members AS (
  SELECT loser AS entity_id, survivor FROM spn01a_move UNION SELECT survivor, survivor FROM spn01a_move
), live AS (
  SELECT f.id, row_number() OVER (PARTITION BY m.survivor, f.field ORDER BY
    CASE f.provenance_kind WHEN 'OWNER' THEN 0 WHEN 'OFFICIAL' THEN 1 WHEN 'FILING' THEN 1 WHEN 'REFERENCE' THEN 2 WHEN 'NEWS' THEN 3 WHEN 'CAMPAIGN' THEN 4 ELSE 5 END,
    coalesce(s.fetched_at, f.checked_at) DESC, (f.entity_id = m.survivor) DESC, f.id DESC) AS place
  FROM fact f JOIN members m ON m.entity_id = f.entity_id LEFT JOIN source_copy s ON s.id = f.source_copy_id
  WHERE f.status = 'live' AND f.entity_id = ANY (ARRAY(SELECT entity_id FROM members))
)
UPDATE fact SET status = 'superseded' WHERE id = ANY (ARRAY(SELECT id FROM live WHERE place > 1));
--> statement-breakpoint
UPDATE fact SET entity_id = m.survivor FROM spn01a_move m WHERE fact.entity_id = m.loser AND fact.entity_id = ANY (ARRAY(SELECT loser FROM spn01a_move));
--> statement-breakpoint
-- The same rule decides a seat that both ids held.
WITH renamed AS (
  SELECT f.id, f.entity_id, t.field FROM spn01a_member t JOIN fact f ON f.field = t.old_field AND f.field LIKE 'member:%'
  UNION ALL SELECT f.id, f.entity_id, f.field FROM fact f
  WHERE f.status = 'live' AND f.field LIKE 'member:%' AND f.field IN (SELECT field FROM spn01a_member)
), live AS (
  SELECT f.id, row_number() OVER (PARTITION BY r.entity_id, r.field ORDER BY
    CASE f.provenance_kind WHEN 'OWNER' THEN 0 WHEN 'OFFICIAL' THEN 1 WHEN 'FILING' THEN 1 WHEN 'REFERENCE' THEN 2 WHEN 'NEWS' THEN 3 WHEN 'CAMPAIGN' THEN 4 ELSE 5 END,
    coalesce(s.fetched_at, f.checked_at) DESC, f.id DESC) AS place
  FROM fact f JOIN renamed r ON r.id = f.id LEFT JOIN source_copy s ON s.id = f.source_copy_id WHERE f.status = 'live'
)
UPDATE fact SET status = 'superseded' WHERE id = ANY (ARRAY(SELECT id FROM live WHERE place > 1));
--> statement-breakpoint
UPDATE fact SET field = t.field FROM spn01a_member t WHERE fact.field = t.old_field AND fact.field LIKE 'member:%';
--> statement-breakpoint
INSERT INTO entity_place (entity_id, place_id, boundary_year, placement_basis)
SELECT m.survivor, p.place_id, p.boundary_year, p.placement_basis FROM entity_place p JOIN spn01a_move m ON m.loser = p.entity_id
WHERE p.entity_id = ANY (ARRAY(SELECT loser FROM spn01a_move))
ON CONFLICT (entity_id, place_id, boundary_year) DO NOTHING;
--> statement-breakpoint
DELETE FROM entity_place WHERE entity_id = ANY (ARRAY(SELECT loser FROM spn01a_move));
--> statement-breakpoint
INSERT INTO entity_host (entity_id, host, proved_by) SELECT m.survivor, h.host, h.proved_by FROM entity_host h JOIN spn01a_move m ON m.loser = h.entity_id
ON CONFLICT DO NOTHING;
--> statement-breakpoint
DELETE FROM entity_host WHERE entity_id IN (SELECT loser FROM spn01a_move);
--> statement-breakpoint
UPDATE entity_external_id SET entity_id = m.survivor FROM spn01a_move m WHERE entity_external_id.entity_id = m.loser
  AND entity_external_id.entity_id = ANY (ARRAY(SELECT loser FROM spn01a_move));
--> statement-breakpoint
UPDATE entity SET parent_id = m.survivor FROM spn01a_move m WHERE entity.parent_id = m.loser AND entity.parent_id = ANY (ARRAY(SELECT loser FROM spn01a_move));
--> statement-breakpoint
UPDATE blank SET entity_id = pick.survivor FROM (
  SELECT DISTINCT ON (m.survivor, b.field) b.entity_id AS loser, b.field, m.survivor
  FROM blank b JOIN spn01a_move m ON m.loser = b.entity_id
  WHERE b.entity_id = ANY (ARRAY(SELECT loser FROM spn01a_move))
    AND NOT EXISTS (SELECT 1 FROM blank held WHERE held.entity_id = m.survivor AND held.field = b.field)
  ORDER BY m.survivor, b.field, b.opened_at
) pick WHERE blank.entity_id = pick.loser AND blank.field = pick.field;
--> statement-breakpoint
DELETE FROM blank WHERE entity_id = ANY (ARRAY(SELECT loser FROM spn01a_move));
--> statement-breakpoint
INSERT INTO place_page_dependency (page_id, entity_id) SELECT d.page_id, m.survivor FROM place_page_dependency d JOIN spn01a_move m ON m.loser = d.entity_id
WHERE d.entity_id = ANY (ARRAY(SELECT loser FROM spn01a_move))
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO entity_external_id (entity_id, scheme, value) SELECT survivor, 'body-alias', loser FROM spn01a_move
ON CONFLICT (scheme, value) DO UPDATE SET entity_id = EXCLUDED.entity_id;
--> statement-breakpoint
DELETE FROM place_page WHERE place_id = ANY (ARRAY(SELECT loser FROM spn01a_move));
--> statement-breakpoint
DELETE FROM rebuild_queue WHERE place_id = ANY (ARRAY(SELECT loser FROM spn01a_move));
--> statement-breakpoint
-- Each deleted record is checked against every row that may still name it, by index (RIVER-MERGEFIX-159_boundary_county_ref).
DELETE FROM entity WHERE id = ANY (ARRAY(SELECT loser FROM spn01a_move));
--> statement-breakpoint
-- A government still holding two records of its governing board is a question for a detective; writes go on to the first by id.
INSERT INTO blank (entity_id, field, stage, reason, detail, next_try_at, attempts)
SELECT g.id, 'identity:governing-body', 'CHECK', 'IDENTITY_TIE', jsonb_build_object('candidates', jsonb_agg(b.id ORDER BY b.id), 'why', 'GOVERNING_BOARD_HELD_TWICE')::text, now(), 1
FROM entity g JOIN entity b ON b.parent_id = g.id AND b.kind = 'body' AND (b.id LIKE '%#governing' OR b.id LIKE '%#board')
WHERE g.kind = 'government' GROUP BY g.id HAVING count(*) > 1
ON CONFLICT (entity_id, field) DO NOTHING;
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
-- Every page that shows or depends on a survivor is rebuilt, so a duplicate is gone from the page and not only from the store. These join the
-- ordinary backlog in order of when they were queued, as a state-wide change does: none jumps the line, and a page already waiting is not queued again.
INSERT INTO rebuild_queue (place_id, queued_at, priority)
SELECT e.id, clock_timestamp(), e.page_priority FROM entity e WHERE e.id IN (
  SELECT p.place_id FROM entity_place p JOIN entity s ON s.id = p.entity_id WHERE p.entity_id = ANY (ARRAY(SELECT survivor FROM spn01a_move))
    AND (s.kind <> 'person' OR p.place_id !~ '^ocd-division/country:us(/(state|territory|district):[a-z]{2})?$')
  UNION SELECT d.page_id FROM place_page_dependency d WHERE d.entity_id = ANY (ARRAY(SELECT survivor FROM spn01a_move))
  UNION SELECT survivor FROM spn01a_move m JOIN entity s ON s.id = m.survivor AND s.kind = 'body'
) ORDER BY e.id
ON CONFLICT (place_id) DO UPDATE SET generation = rebuild_queue.generation + 1
WHERE rebuild_queue.built_generation = rebuild_queue.generation;
--> statement-breakpoint
DROP TABLE spn01a_key, spn01a_edge, spn01a_group, spn01a_clean, spn01a_move, spn01a_member;
