WITH people AS (
SELECT p.scope,p.source_id,p.current_version_id,p.promoted_at,person,
CASE WHEN p.source_id='plural-openstates' THEN substring(p.scope from '^US-([A-Z]{2})') ELSE person->>'state' END AS state,
CASE WHEN COALESCE(person#>>'{photo,url}','')<>'' THEN 1 ELSE 0 END AS has_photo,
EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p.payload#>'{roster,divisions}','[]'::jsonb)) link WHERE link->>'officeholderId'=person->>'id' AND link->>'ocdId' ~ '^ocd-division/country:us/(state|district|territory):[a-z]{2}$') AS state_root
FROM civic_data_promotions p CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p.payload#>'{roster,officeholders}','[]'::jsonb)) person
WHERE p.source_id IN ('plural-openstates','congress-directory-project')
)
SELECT state,source_id,
count(*) FILTER (WHERE person->>'level'='FEDERAL') AS federal_members,
sum(has_photo) FILTER (WHERE person->>'level'='FEDERAL') AS federal_photos,
count(*) FILTER (WHERE person->>'level'='STATE' AND COALESCE(person->>'chamber','') IN ('upper','lower')) AS legislators,
sum(has_photo) FILTER (WHERE person->>'level'='STATE' AND COALESCE(person->>'chamber','') IN ('upper','lower')) AS legislator_photos,
count(*) FILTER (WHERE person->>'level'='STATE' AND COALESCE(person->>'chamber','') NOT IN ('upper','lower') AND state_root) AS statewide_officers,
sum(has_photo) FILTER (WHERE person->>'level'='STATE' AND COALESCE(person->>'chamber','') NOT IN ('upper','lower') AND state_root) AS statewide_photos,
count(*) FILTER (WHERE lower(person->>'officeTitle')='governor') AS governors,
sum(has_photo) FILTER (WHERE lower(person->>'officeTitle')='governor') AS governor_photos,
count(*) FILTER (WHERE lower(person->>'officeTitle') IN ('attorney general','state attorney general')) AS attorneys_general,
sum(has_photo) FILTER (WHERE lower(person->>'officeTitle') IN ('attorney general','state attorney general')) AS attorney_general_photos
FROM people GROUP BY state,source_id ORDER BY state,source_id
