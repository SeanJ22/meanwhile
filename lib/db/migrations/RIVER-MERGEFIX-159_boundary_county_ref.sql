-- Deleting an entity checks every boundary row that names it as its host county. The only index on that reference is partial, so the
-- check read the whole boundary table once per deleted record; this one serves it.
CREATE INDEX place_boundary_host_county_ref ON place_boundary (host_county_id) WHERE host_county_id IS NOT NULL;
