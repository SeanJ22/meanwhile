CREATE FUNCTION civic_scope_state(source_scope text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  WITH decoded AS (
    SELECT replace(replace(replace(replace(replace(lower(source_scope),'%25','%'),'%2f','/'),'%3a',':'),'%23','#'),'%2b','+') AS scope
  ), matched AS (
    SELECT scope,substring(scope from '(?:\mus-|/(?:state|district|territory):|^(?:curated:)?)([a-z]{2})(?:[:/#]|$)') AS state FROM decoded
  )
  SELECT CASE WHEN scope ~ '\mus-[a-z]{2}(?:\+us-[a-z]{2})+' OR state IS NULL OR state='us' THEN 'US'
    ELSE 'US-' || upper(state) END FROM matched
$$;
--> statement-breakpoint
CREATE INDEX civic_data_promotions_state_idx ON civic_data_promotions (civic_scope_state(scope),key);
