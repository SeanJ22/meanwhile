-- River: read only, through the existing control-plane connection.
-- DB-39 decision uses the same count read as the current Admin learning panel.
SELECT coalesce((SELECT (value #>> '{entries,0,payload,count}')::bigint
                 FROM cp_field_manual WHERE id = 'write-errors'), 0) AS write_errors;

-- Exclusive lifecycle buckets: VALIDATED and ADMITTED are separate populations.
SELECT c->>'lifecycle' AS lifecycle, count(*) AS candidates
FROM cp_method_candidates m
CROSS JOIN LATERAL jsonb_array_elements(m.value->'candidates') c
WHERE m.id = 'live'
GROUP BY 1 ORDER BY 1;

-- Does a saved validated proposal already have a route in the current manual?
-- Presence does not replace revalidation or prove payload/provenance equivalence.
WITH routes AS (
 SELECT DISTINCT e->'payload'->>'id' AS route_id
 FROM cp_field_manual m CROSS JOIN LATERAL jsonb_array_elements(m.value->'entries') e
 WHERE m.id = 'live' AND e->>'kind' = 'ROUTE'
), validated AS (
 SELECT c->'proposal'->>'id' AS route_id
 FROM cp_method_candidates m CROSS JOIN LATERAL jsonb_array_elements(m.value->'candidates') c
 WHERE m.id = 'live' AND c->>'lifecycle' = 'VALIDATED'
)
SELECT r.route_id IS NOT NULL AS route_in_manual, count(*) AS validated_offers,
       count(DISTINCT v.route_id) AS distinct_routes
FROM validated v LEFT JOIN routes r ON r.route_id = v.route_id GROUP BY 1;
