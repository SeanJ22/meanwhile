export const SPEND_LINE_TOTALS_DDL = [
  `CREATE OR REPLACE FUNCTION cp_adjust_spend_line(h cp_spend_holds, direction integer) RETURNS void LANGUAGE plpgsql AS $$
  DECLARE k text; held numeric := extract(epoch FROM h.held_at)*1000000 + 9223372036854775808::numeric;
    cost_at numeric := extract(epoch FROM h.cost_recorded_at)*1000000 + 9223372036854775808::numeric;
  BEGIN
    FOR k IN SELECT DISTINCT unnest(h.keys) ORDER BY 1 LOOP
      INSERT INTO cp_spend_line_totals (line_key,scope,held_level,cost_level,held_bucket,cost_bucket,usd)
        SELECT k,CASE WHEN cardinality(h.lifetime_keys)>0 THEN 1 ELSE 0 END,x.level,y.level,div(held,power(256::numeric,x.level)),
          CASE WHEN y.level=-1 THEN 0 ELSE div(cost_at,power(256::numeric,y.level)) END,
          direction * CASE WHEN h.cost_recorded_at IS NULL THEN h.usd ELSE coalesce(h.settled_usd,0) END
        FROM generate_series(0,7) x(level) CROSS JOIN LATERAL (
          SELECT -1 level WHERE h.cost_recorded_at IS NULL UNION ALL
          SELECT generate_series(0,7) WHERE h.cost_recorded_at IS NOT NULL) y
        ON CONFLICT (line_key,scope,held_level,cost_level,held_bucket,cost_bucket)
          DO UPDATE SET usd=cp_spend_line_totals.usd+excluded.usd;
    END LOOP;
  END $$`,
  `CREATE OR REPLACE FUNCTION cp_update_spend_lines() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF TG_OP <> 'INSERT' THEN PERFORM cp_adjust_spend_line(OLD,-1); END IF;
    IF TG_OP <> 'DELETE' THEN PERFORM cp_adjust_spend_line(NEW,1); END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END $$`,
  `DO $$ BEGIN
    LOCK TABLE cp_spend_holds IN SHARE ROW EXCLUSIVE MODE;
    IF to_regclass('cp_spend_line_totals') IS NULL THEN
      CREATE TABLE cp_spend_line_totals (line_key text NOT NULL,scope smallint NOT NULL,
        held_level smallint NOT NULL,cost_level smallint NOT NULL,held_bucket numeric(20,0) NOT NULL,cost_bucket numeric(20,0) NOT NULL,
        usd numeric NOT NULL,PRIMARY KEY (line_key,scope,held_level,cost_level,held_bucket,cost_bucket));
      INSERT INTO cp_spend_line_totals (line_key,scope,held_level,cost_level,held_bucket,cost_bucket,usd)
        SELECT k.line_key,CASE WHEN cardinality(h.lifetime_keys)>0 THEN 1 ELSE 0 END,x.level,y.level,
          div(extract(epoch FROM h.held_at)*1000000+9223372036854775808::numeric,power(256::numeric,x.level)),
          CASE WHEN y.level=-1 THEN 0 ELSE
            div(extract(epoch FROM h.cost_recorded_at)*1000000+9223372036854775808::numeric,power(256::numeric,y.level)) END,
          sum(CASE WHEN h.cost_recorded_at IS NULL THEN h.usd ELSE coalesce(h.settled_usd,0) END)
        FROM cp_spend_holds h CROSS JOIN LATERAL (SELECT DISTINCT unnest(h.keys) line_key) k
        CROSS JOIN generate_series(0,7) x(level) CROSS JOIN LATERAL (
          SELECT -1 level WHERE h.cost_recorded_at IS NULL UNION ALL
          SELECT generate_series(0,7) WHERE h.cost_recorded_at IS NOT NULL) y
        GROUP BY 1,2,3,4,5,6;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='cp_spend_holds_totals' AND tgrelid='cp_spend_holds'::regclass) THEN
      CREATE TRIGGER cp_spend_holds_totals AFTER INSERT OR UPDATE OR DELETE ON cp_spend_holds
        FOR EACH ROW EXECUTE FUNCTION cp_update_spend_lines();
    END IF;
  END $$`,
  `CREATE OR REPLACE FUNCTION cp_spend_suffix_ranges(at timestamptz)
    RETURNS TABLE(level smallint,lower numeric,upper numeric,sign integer) LANGUAGE sql IMMUTABLE ROWS 9 AS $$
    WITH point AS (SELECT extract(epoch FROM at)*1000000+9223372036854775808::numeric value)
    SELECT 7::smallint,0::numeric,256::numeric,1 UNION ALL
    SELECT n::smallint,div(value,power(256::numeric,n))-mod(div(value,power(256::numeric,n)),256),div(value,power(256::numeric,n)),-1
      FROM point CROSS JOIN generate_series(0,7) n WHERE mod(div(value,power(256::numeric,n)),256) <> 0 $$`,
  `CREATE OR REPLACE FUNCTION cp_spend_line_left(l jsonb,win timestamptz,stale timestamptz,kept timestamptz)
    RETURNS numeric LANGUAGE sql STABLE SET jit=off AS $$
    WITH scopes AS (SELECT scope,scope=1 AND coalesce((l->>'lifetime')::boolean,false) lifetime FROM generate_series(0,1) scope),
    open_amount AS (
      SELECT coalesce(sum(t.usd*h.sign),0) usd FROM scopes s
      CROSS JOIN LATERAL cp_spend_suffix_ranges(CASE WHEN s.lifetime THEN stale ELSE greatest(win,stale) END) h
      CROSS JOIN LATERAL (SELECT usd FROM cp_spend_line_totals WHERE line_key=l->>'key' AND scope=s.scope
        AND held_level=h.level AND cost_level=-1 AND held_bucket>=h.lower AND held_bucket<h.upper AND cost_bucket=0 OFFSET 0) t
    ), settled_amount AS (
      SELECT coalesce(sum(t.usd*h.sign*c.sign),0) usd FROM scopes s
      CROSS JOIN LATERAL cp_spend_suffix_ranges(CASE WHEN s.lifetime THEN NULL ELSE win END) h
      CROSS JOIN LATERAL cp_spend_suffix_ranges(greatest(kept,(l->>'historyReadAt')::timestamptz+interval '1 microsecond')) c
      CROSS JOIN LATERAL (SELECT usd FROM cp_spend_line_totals WHERE line_key=l->>'key' AND scope=s.scope
        AND held_level=h.level AND cost_level=c.level AND held_bucket>=h.lower AND held_bucket<h.upper
        AND cost_bucket>=c.lower AND cost_bucket<c.upper OFFSET 0) t
      WHERE l->>'historyReadAt' IS NOT NULL
    ) SELECT round(((l->>'budgetUsd')::numeric-(l->>'historicalUsd')::numeric-o.usd-s.usd)*1000000000)/1000000000
      FROM open_amount o CROSS JOIN settled_amount s $$`,
] as const;
