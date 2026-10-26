-- LA Metro's Legistar boards that were filed on Oregon's state root move to the Los Angeles County Metropolitan
-- Transportation Authority (Census of Governments 142274) and its places. Ids, names and facts stay; Oregon Metro's own boards stay.
WITH metro AS (
  SELECT g.id, g.state FROM entity_external_id x JOIN entity g ON g.id = x.entity_id AND g.kind = 'government' AND g.state = 'CA'
  WHERE x.scheme = 'census-pid6' AND x.value = '142274'
), moved AS (
  UPDATE entity b SET state = metro.state, parent_id = metro.id FROM metro
  WHERE b.kind = 'body' AND b.state = 'OR' AND b.parent_id = 'ocd-division/country:us/state:or'
    AND EXISTS (SELECT 1 FROM entity_host h WHERE h.entity_id = b.id AND h.host = 'webapi.legistar.com/v1/metro')
    AND NOT EXISTS (SELECT 1 FROM entity_host h WHERE h.entity_id = b.id AND h.host = 'webapi.legistar.com/v1/oregonmetro')
  RETURNING b.id, metro.id AS government
)
INSERT INTO entity_place (entity_id, place_id, boundary_year, placement_basis)
SELECT moved.id, p.place_id, p.boundary_year, p.placement_basis FROM moved JOIN entity_place p ON p.entity_id = moved.government
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- The ids LA Metro's own doors and board findings give these boards resolve to them, so a later read cannot add a second copy.
INSERT INTO entity_external_id (entity_id, scheme, value)
SELECT b.id, 'body-alias', named.id FROM entity b
JOIN entity g ON g.id = b.parent_id AND g.kind = 'government'
JOIN entity_external_id x ON x.entity_id = g.id AND x.scheme = 'census-pid6' AND x.value = '142274'
CROSS JOIN LATERAL (VALUES (g.id || substr(b.id, strpos(b.id, '#'))), (g.parent_id || substr(b.id, strpos(b.id, '#')))) AS named(id)
WHERE b.kind = 'body' AND b.id LIKE 'ocd-division/country:us/state:or#body:%' AND named.id IS NOT NULL
  AND EXISTS (SELECT 1 FROM entity_host h WHERE h.entity_id = b.id AND h.host = 'webapi.legistar.com/v1/metro')
  AND NOT EXISTS (SELECT 1 FROM entity e WHERE e.id = named.id)
ON CONFLICT (scheme, value) DO NOTHING;
