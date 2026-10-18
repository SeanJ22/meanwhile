import { FIELD_MANUAL_ROLES } from "../field-manual.ts";
import { FIPS_TO_STATE } from "../../ocd/fips.ts";
import { PLACE_STATE_SQL } from "../../method/fix-map.ts";
import { MANUAL_METHOD_SQL, MANUAL_OUTCOME_SQL } from "./field-manual-sql.ts";

export const MANUAL_OWNER_DDL=`CREATE OR REPLACE FUNCTION cp_manual_state(record jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path FROM CURRENT AS $$
  BEGIN RETURN cp_control_state(jsonb_build_object('subjectId',
    coalesce(record #>> '{ocdIds,0}',record #>> '{bodyIds,0}',record #>> '{reach,places,0}'),
    'state',coalesce(record #>> '{states,0}',record #>> '{reach,states,0}'))); END $$`;
export const MANUAL_METHOD_STATES=["*",...new Set(Object.values(FIPS_TO_STATE).map(state=>state.postal.toLowerCase()))];
export const MANUAL_METHOD_INDEX_DDL=[
  `CREATE TABLE IF NOT EXISTS cp_manual_method_meta (
    entry_id text PRIMARY KEY,role text NOT NULL,kind text NOT NULL,classes jsonb NOT NULL,
    states jsonb NOT NULL,platforms jsonb NOT NULL,legacy_here jsonb NOT NULL,
    legacy_states text[] NOT NULL,legacy_any boolean NOT NULL,working_states text[] NOT NULL,working_any boolean NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS cp_manual_method_here ON cp_manual_method_meta USING gin (legacy_here)`,
  `CREATE TABLE IF NOT EXISTS cp_manual_method_rank (
    entry_id text NOT NULL REFERENCES cp_manual_method_meta(entry_id) ON DELETE CASCADE,
    state text NOT NULL,role text NOT NULL,class_key text NOT NULL,empty_class boolean NOT NULL,
    tier integer NOT NULL,outcome integer NOT NULL,observed text NOT NULL,
    PRIMARY KEY(entry_id,state,class_key))`,
  `CREATE INDEX IF NOT EXISTS cp_manual_method_order ON cp_manual_method_rank
    (state,role,class_key,empty_class,tier,outcome,observed COLLATE "C" DESC,entry_id COLLATE "C")`,
  `CREATE OR REPLACE FUNCTION cp_manual_refresh_method(target text) RETURNS void LANGUAGE plpgsql AS $$
  DECLARE v jsonb; item jsonb; place text; region text; legacy jsonb; here jsonb:='{}';
    regions text[]:='{}'; worked text[]:='{}'; any_legacy boolean:=false; any_work boolean:=false;
  BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('manual-method:'||target,0));
    SELECT value INTO v FROM cp_field_manual_entries WHERE id=target;
    IF v IS NULL OR NOT coalesce((${MANUAL_METHOD_SQL.replaceAll('value','v')}),false) THEN
      DELETE FROM cp_manual_method_meta WHERE entry_id=target; RETURN;
    END IF;
    legacy:=v->'placeResults';
    IF legacy IS NULL THEN
      IF jsonb_array_length(coalesce(v->'ocdIds','[]'))+jsonb_array_length(coalesce(v->'bodyIds','[]'))>0 THEN
        SELECT jsonb_agg(jsonb_build_object('place',p,'outcome',v->>'outcome')) INTO legacy FROM (
          SELECT jsonb_array_elements_text(coalesce(v->'ocdIds','[]')) p UNION ALL
          SELECT 'body:'||jsonb_array_elements_text(coalesce(v->'bodyIds','[]'))) places;
      ELSIF jsonb_array_length(coalesce(v->'states','[]'))>0 THEN
        SELECT jsonb_agg(jsonb_build_object('place','state:'||p,'outcome',v->>'outcome')) INTO legacy
          FROM jsonb_array_elements_text(v->'states') places(p);
      ELSE legacy:='[]'; END IF;
    END IF;
    FOR item IN SELECT * FROM jsonb_array_elements(legacy) LOOP
      place:=item->>'place';
      IF place<>'any' AND left(place,6)<>'state:' THEN
        IF item->>'outcome' IN ('FAILED','BLOCKED') THEN here:=here||jsonb_build_object(place,'FAILS');
        ELSIF item->>'outcome'='YIELDED' AND here->>place IS DISTINCT FROM 'FAILS' THEN here:=here||jsonb_build_object(place,'WORKS'); END IF;
      END IF;
      IF item->>'outcome'='YIELDED' AND place<>'any' THEN
        any_legacy:=any_legacy OR left(place,6)<>'state:';
        region:=CASE WHEN left(place,6)='state:' THEN lower(btrim(substring(place FROM 7)))
          ELSE ${PLACE_STATE_SQL.replaceAll('place_id','place')} END;
        IF region IS NOT NULL AND region<>'' AND NOT region=ANY(regions) THEN regions:=array_append(regions,region); END IF;
      END IF;
    END LOOP;
    SELECT coalesce(array_agg(DISTINCT ${PLACE_STATE_SQL}) FILTER(WHERE ${PLACE_STATE_SQL} IS NOT NULL),'{}'),count(*)>0
      INTO worked,any_work FROM cp_fix_map WHERE method_id=target AND state='WORKS';
    INSERT INTO cp_manual_method_meta VALUES(target,v->>'role',v->>'kind',coalesce(v->'recordClasses','[]'),
      coalesce(v->'states','[]'),coalesce(v->'platforms','[]'),here,regions,any_legacy,worked,any_work)
      ON CONFLICT(entry_id) DO UPDATE SET role=EXCLUDED.role,kind=EXCLUDED.kind,classes=EXCLUDED.classes,
        states=EXCLUDED.states,platforms=EXCLUDED.platforms,legacy_here=EXCLUDED.legacy_here,
        legacy_states=EXCLUDED.legacy_states,legacy_any=EXCLUDED.legacy_any,
        working_states=EXCLUDED.working_states,working_any=EXCLUDED.working_any;
    DELETE FROM cp_manual_method_rank WHERE entry_id=target;
    INSERT INTO cp_manual_method_rank
      SELECT target,rank_state,v->>'role',class_key,jsonb_array_length(coalesce(v->'recordClasses','[]'))=0,
        CASE WHEN rank_state=ANY(regions||worked) THEN 2
          WHEN (SELECT count(DISTINCT x) FROM unnest(regions||worked) states(x))>=3 THEN 3
          WHEN cardinality(regions||worked)>0 OR any_legacy OR any_work THEN 4 ELSE 5 END,
        ${MANUAL_OUTCOME_SQL.replaceAll('value','v')},coalesce(v->>'observedAt','')
      FROM unnest(ARRAY[${MANUAL_METHOD_STATES.map(state=>`'${state}'`).join(',')}]) states(rank_state)
      CROSS JOIN (SELECT '@all' class_key UNION SELECT CASE WHEN jsonb_array_length(coalesce(v->'recordClasses','[]'))=0 THEN '@empty' END
        UNION SELECT jsonb_array_elements_text(coalesce(v->'recordClasses','[]'))) classes WHERE class_key IS NOT NULL;
  END $$`,
  `CREATE OR REPLACE FUNCTION cp_manual_method_note_changed() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN PERFORM cp_manual_refresh_method(CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END); RETURN NULL; END $$`,
  `CREATE OR REPLACE FUNCTION cp_manual_method_fix_changed() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN PERFORM cp_manual_refresh_method(CASE WHEN TG_OP='DELETE' THEN OLD.method_id ELSE NEW.method_id END); RETURN NULL; END $$`,
  `CREATE OR REPLACE TRIGGER cp_manual_method_note_changed AFTER INSERT OR UPDATE OR DELETE ON cp_field_manual_entries
    FOR EACH ROW EXECUTE FUNCTION cp_manual_method_note_changed()`,
  `CREATE OR REPLACE TRIGGER cp_manual_method_fix_changed AFTER INSERT OR UPDATE OR DELETE ON cp_fix_map
    FOR EACH ROW EXECUTE FUNCTION cp_manual_method_fix_changed()`,
] as const;

export const MANUAL_METHOD_POOL_SQL=`SELECT picked.id FROM
  unnest(coalesce($1::text[],ARRAY[${FIELD_MANUAL_ROLES.map(role=>`'${role}'`).join(",")}])) roles(role)
  CROSS JOIN (VALUES(false),(true)) empties(empty_class)
  CROSS JOIN unnest(ARRAY(SELECT DISTINCT key FROM unnest(
    CASE WHEN $3::text IS NULL THEN ARRAY['@all'] ELSE ARRAY['@empty',$3::text] END||coalesce($11::text[],'{}')) keys(key))) classes(class_key)
  CROSS JOIN LATERAL (
    SELECT r.entry_id AS id FROM cp_manual_method_rank r JOIN cp_manual_method_meta m ON m.entry_id=r.entry_id
    LEFT JOIN LATERAL (SELECT state FROM cp_fix_map WHERE method_id=r.entry_id AND place_id=ANY($10::text[]) ORDER BY place_id LIMIT 1) fixed ON true
    WHERE r.state=coalesce($7::text,'*') AND r.role=roles.role AND r.class_key=classes.class_key AND r.empty_class=empties.empty_class
      AND ($2::text[] IS NULL OR m.kind=ANY($2)) AND NOT(m.kind=ANY($13::text[]))
      AND ($3::text IS NULL OR jsonb_array_length(m.classes)=0 OR m.classes ? $3)
      AND ($14::text IS NULL OR m.states ? $14)
      AND ($6::text IS NULL OR jsonb_array_length(m.platforms)=0 OR m.platforms ? $6)
      AND CASE WHEN fixed.state IS NOT NULL AND fixed.state<>'UNTRIED' THEN fixed.state<>'FAILS'
        ELSE NOT EXISTS(SELECT 1 FROM jsonb_each_text(m.legacy_here) legacy(place,status) WHERE place=ANY($5::text[]) AND status='FAILS') END
    ORDER BY r.tier,r.outcome,r.observed COLLATE "C" DESC,r.entry_id COLLATE "C" LIMIT $8::int
  ) picked`;
