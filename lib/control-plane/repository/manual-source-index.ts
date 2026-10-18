import { MANUAL_METHOD_SQL, MANUAL_SOURCE_ORIGIN_SQL } from "./field-manual-sql.ts";

export const MANUAL_SOURCE_INDEX_DDL = [
  `CREATE TABLE IF NOT EXISTS cp_manual_source_facts (
    entry_id text NOT NULL,scope text NOT NULL,origin text NOT NULL,url text NOT NULL,
    outcome text NOT NULL,observed text NOT NULL,PRIMARY KEY(entry_id,scope))`,
  `CREATE INDEX IF NOT EXISTS cp_manual_source_latest ON cp_manual_source_facts
    (scope,origin,url COLLATE "C",observed COLLATE "C" DESC,entry_id COLLATE "C") INCLUDE(outcome)`,
  `CREATE INDEX IF NOT EXISTS cp_manual_source_worked ON cp_manual_source_facts
    (scope,origin,url COLLATE "C",entry_id COLLATE "C") WHERE outcome='YIELDED'`,
  `CREATE TABLE IF NOT EXISTS cp_manual_source_classes (
    entry_id text NOT NULL,scope text NOT NULL,origin text NOT NULL,url text NOT NULL,class text NOT NULL,
    PRIMARY KEY(entry_id,scope,class))`,
  `CREATE INDEX IF NOT EXISTS cp_manual_source_class ON cp_manual_source_classes
    (scope,origin,url COLLATE "C",class COLLATE "C")`,
  `CREATE OR REPLACE FUNCTION cp_manual_refresh_source(target text) RETURNS void LANGUAGE plpgsql AS $$
    BEGIN
      DELETE FROM cp_manual_source_facts WHERE entry_id=target;
      DELETE FROM cp_manual_source_classes WHERE entry_id=target;
      INSERT INTO cp_manual_source_facts
        SELECT target,scope,${MANUAL_SOURCE_ORIGIN_SQL},value->>'url',value->>'outcome',coalesce(value->>'observedAt','')
        FROM cp_field_manual_entries CROSS JOIN LATERAL (
          SELECT 'p:'||jsonb_array_elements_text(coalesce(value #> '{reach,places}','[]'::jsonb)) AS scope
          UNION SELECT 's:'||jsonb_array_elements_text(coalesce(value #> '{reach,states}','[]'::jsonb))
          UNION SELECT '*' WHERE coalesce((value #>> '{reach,everywhere}')::boolean,false)
            OR jsonb_array_length(coalesce(value #> '{reach,platforms}','[]'::jsonb))>0 OR ${MANUAL_METHOD_SQL}
        ) scopes WHERE id=target AND value->>'url' IS NOT NULL;
      INSERT INTO cp_manual_source_classes
        SELECT DISTINCT f.entry_id,f.scope,f.origin,f.url,class
        FROM cp_manual_source_facts f JOIN cp_field_manual_entries e ON e.id=f.entry_id
        CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(e.value->'recordClasses','[]'::jsonb)) classes(class)
        WHERE f.entry_id=target AND f.outcome='YIELDED';
    END $$`,
  `CREATE OR REPLACE FUNCTION cp_manual_source_changed() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN PERFORM cp_manual_refresh_source(CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END); RETURN NULL; END $$`,
  `CREATE OR REPLACE TRIGGER cp_manual_source_changed AFTER INSERT OR UPDATE OR DELETE ON cp_field_manual_entries
    FOR EACH ROW EXECUTE FUNCTION cp_manual_source_changed()`,
] as const;

export const MANUAL_SOURCE_HINTS_SQL = `WITH RECURSIVE scopes AS MATERIALIZED (
  SELECT scope,origin FROM unnest(ARRAY['*']||ARRAY(SELECT 'p:'||unnest($1::text[]))||
    CASE WHEN $2::text IS NULL THEN '{}'::text[] ELSE ARRAY['s:'||$2::text] END) scopes(scope)
  CROSS JOIN unnest($3::text[]) origins(origin)
), urls(scope,origin,url) AS (
  SELECT s.scope,s.origin,first.url FROM scopes s CROSS JOIN LATERAL (
    SELECT url FROM cp_manual_source_facts WHERE scope=s.scope AND origin=s.origin ORDER BY url COLLATE "C" LIMIT 1) first
  UNION ALL
  SELECT u.scope,u.origin,next.url FROM urls u CROSS JOIN LATERAL (
    SELECT url FROM cp_manual_source_facts WHERE scope=u.scope AND origin=u.origin AND url COLLATE "C">u.url COLLATE "C"
    ORDER BY url COLLATE "C" LIMIT 1) next
), latest AS (
  SELECT DISTINCT ON(u.url COLLATE "C") u.url,l.outcome,l.observed FROM urls u CROSS JOIN LATERAL (
    SELECT outcome,observed,entry_id FROM cp_manual_source_facts WHERE scope=u.scope AND origin=u.origin AND url COLLATE "C"=u.url COLLATE "C"
    ORDER BY observed COLLATE "C" DESC,entry_id COLLATE "C" LIMIT 1) l
  ORDER BY u.url COLLATE "C",l.observed COLLATE "C" DESC,l.entry_id COLLATE "C"
), worked AS (
  SELECT u.url,min(w.entry_id COLLATE "C") AS first_worked FROM urls u CROSS JOIN LATERAL (
    SELECT entry_id FROM cp_manual_source_facts WHERE scope=u.scope AND origin=u.origin AND url COLLATE "C"=u.url COLLATE "C" AND outcome='YIELDED'
    ORDER BY entry_id COLLATE "C" LIMIT 1) w GROUP BY u.url
), class_walk(scope,origin,url,class) AS (
  SELECT u.scope,u.origin,u.url,c.class FROM urls u CROSS JOIN LATERAL (
    SELECT class FROM cp_manual_source_classes WHERE scope=u.scope AND origin=u.origin AND url COLLATE "C"=u.url COLLATE "C"
    ORDER BY class COLLATE "C" LIMIT 1) c
  UNION ALL
  SELECT w.scope,w.origin,w.url,c.class FROM class_walk w CROSS JOIN LATERAL (
    SELECT class FROM cp_manual_source_classes WHERE scope=w.scope AND origin=w.origin AND url COLLATE "C"=w.url COLLATE "C" AND class COLLATE "C">w.class COLLATE "C"
    ORDER BY class COLLATE "C" LIMIT 1) c
), classes AS (
  SELECT url,array_agg(DISTINCT class COLLATE "C" ORDER BY class COLLATE "C") AS classes FROM class_walk GROUP BY url
)
SELECT jsonb_build_object('url',l.url,'outcome',l.outcome,'observedAt',nullif(l.observed,''),
  'worked',w.url IS NOT NULL,'workedFor',coalesce(c.classes,'{}'::text[])) AS hint
FROM latest l LEFT JOIN worked w ON w.url=l.url LEFT JOIN classes c ON c.url=l.url
ORDER BY w.first_worked COLLATE "C" NULLS LAST,l.url COLLATE "C"`;
