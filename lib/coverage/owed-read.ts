import type { AdminConfig } from "../control-plane/gateway/admin-config.ts";
import { US_STATES } from "../control-plane/readiness/catalog.ts";
import { factClocks } from "../facts/clocks.ts";
import type { Query } from "../facts/publish.ts";
import { owedTable, type OwedTable } from "./owed-table.ts";

export interface OwedCounts { readonly owed: number; readonly held: number; readonly missing: number; readonly stale: number; readonly stuck: number }
export interface StateOwedCounts extends OwedCounts { readonly state: string; readonly name: string }
export interface PlaceMissingItem {
  readonly entityId: string; readonly entityName: string; readonly kind: string; readonly field: string; readonly label: string;
  readonly blank: { readonly stage: string; readonly reason: string; readonly nextTryAt: string } | null;
}
export interface PlaceHeldItem extends PlaceMissingItem {
  readonly facts: readonly { readonly id: number; readonly value: unknown; readonly status: string; readonly sourceUrl: string | null;
    readonly checkedAt: string; readonly stale: boolean }[];
}
export interface PlaceNeeds {
  readonly placeId: string; readonly observedAt: string; readonly counts: OwedCounts;
  readonly missing: readonly PlaceMissingItem[]; readonly held: readonly PlaceHeldItem[];
}

/** One SQL relation defines a slot: entity + field. Facts and recorded blanks extend the editable baseline. */
function sources(scope: string): string {
  return `WITH RECURSIVE ${scope},
    rules AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS r(kind text,field text,label text,clock text,state text,place_kind text)),
    holdings AS MATERIALIZED (
      SELECT f.entity_id,f.field,bool_or(f.provenance_kind='OWNER') AS owner,
        max(f.checked_at) FILTER (WHERE f.checked_at<=$2::timestamptz) AS checked_at
      FROM fact f JOIN subjects e ON e.id=f.entity_id WHERE f.status IN ('live','held') GROUP BY f.entity_id,f.field
    ),
    active_fields AS MATERIALIZED (
      SELECT entity_id,field FROM holdings
      UNION SELECT b.entity_id,b.field FROM blank b JOIN subjects e ON e.id=b.entity_id
    )`;
}

function slots(scope: string): string {
  return `${sources(scope)},
    configured AS (
      SELECT e.id,coalesce(a.field,r.field) AS field,r.clock,length(r.field) AS specificity
      FROM subjects e JOIN rules r ON r.kind=e.kind AND (r.state IS NULL OR r.state=e.state)
        AND (r.place_kind IS NULL OR r.place_kind=split_part(regexp_replace(e.id,'^.*/',''),':',1))
      LEFT JOIN active_fields a ON a.entity_id=e.id AND (a.field=r.field OR starts_with(a.field,r.field||':'))
    ),
    wanted AS (
      SELECT DISTINCT ON (id,field) id,field,clock FROM configured ORDER BY id,field,specificity DESC
    ),
    extra AS (
      SELECT e.id,a.field,
        CASE WHEN a.field LIKE 'campaign-%' THEN 'money' WHEN a.field LIKE 'member:%' OR a.field LIKE 'term_%' THEN 'officeholder'
          WHEN a.field LIKE 'comment:%' THEN 'comment_rule' WHEN a.field IN ('agenda_url') THEN 'agenda'
          WHEN a.field IN ('minutes_url','video_url','outcome','outcomes') THEN 'outcome'
          WHEN a.field IN ('starts_at','location','meeting_cadence') THEN 'meeting' ELSE 'contact' END AS clock
      FROM active_fields a JOIN subjects e ON e.id=a.entity_id
      WHERE NOT EXISTS (SELECT 1 FROM wanted w WHERE w.id=e.id AND w.field=a.field)
    ),
    owed AS (SELECT * FROM wanted UNION ALL SELECT * FROM extra),
    measured AS (
      SELECT o.*,h.entity_id IS NOT NULL AS held,
        coalesce(h.owner OR h.checked_at + make_interval(secs => (($3::jsonb->>o.clock)::double precision)*3600) >= $2::timestamptz,false) AS fresh,
        b.entity_id IS NOT NULL AS stuck
      FROM owed o LEFT JOIN holdings h ON h.entity_id=o.id AND h.field=o.field
        LEFT JOIN blank b ON b.entity_id=o.id AND b.field=o.field
    )`;
}

function parameters(config: AdminConfig | null, now: string, table: OwedTable = owedTable(config)): unknown[] {
  if (!Number.isFinite(Date.parse(now))) throw new Error("Invalid owed-list time");
  const rules = [...table.base.map(row => ({ ...row, state: null, place_kind: row.placeKind ?? null })),
    ...Object.entries(table.states).flatMap(([state, rows]) => rows.map(row => ({ ...row, state, place_kind: row.placeKind ?? null })))];
  const clocks = factClocks(config);
  const hours = Object.fromEntries([...new Set(rules.map(r => r.clock)), "contact", "money", "officeholder", "comment_rule", "agenda", "outcome", "meeting"]
    .map(kind => [kind, clocks.windowHours(kind as Parameters<typeof clocks.windowHours>[0])]));
  return [JSON.stringify(rules), now, JSON.stringify(hours)];
}
const counts = (row: Partial<Record<keyof OwedCounts, unknown>>): OwedCounts => ({ owed: Number(row.owed ?? 0), held: Number(row.held ?? 0),
  missing: Number(row.missing ?? 0), stale: Number(row.stale ?? 0), stuck: Number(row.stuck ?? 0) });

/** Aggregation stays in Postgres; no country-sized record list enters a worker or Admin. */
export async function readStateOwedCounts(query: Query, config: AdminConfig | null, now: string, state?: string): Promise<readonly StateOwedCounts[]> {
  if (state !== undefined && state !== "US" && !US_STATES.some(row => row.code.toUpperCase() === state)) throw new Error("Choose a state");
  const rows = await query(`${sources(`subjects AS MATERIALIZED (SELECT id,kind,coalesce(state,'US') AS state FROM entity${state ? state === "US" ? " WHERE coalesce(state,'US')=$4" : " WHERE state=$4::char(2)" : ""})`)},
    types AS (SELECT state,kind,CASE WHEN kind='place' THEN split_part(regexp_replace(id,'^.*/',''),':',1) END AS place_kind,count(*) AS n
      FROM subjects GROUP BY 1,2,3),
    baseline AS (SELECT t.state,sum(t.n) AS n FROM types t JOIN rules r ON r.kind=t.kind
      AND (r.state IS NULL OR r.state=t.state) AND (r.place_kind IS NULL OR r.place_kind=t.place_kind) GROUP BY t.state),
    matched AS MATERIALIZED (
      SELECT a.entity_id,a.field,r.field AS rule_field,r.clock FROM active_fields a JOIN subjects e ON e.id=a.entity_id
      JOIN rules r ON r.kind=e.kind AND (r.state IS NULL OR r.state=e.state)
        AND (r.place_kind IS NULL OR r.place_kind=split_part(regexp_replace(e.id,'^.*/',''),':',1))
        AND split_part(a.field,':',1)=split_part(r.field,':',1)
        AND (a.field=r.field OR starts_with(a.field,r.field||':'))
    ),
    covered AS (SELECT e.state,count(*) AS n FROM (SELECT DISTINCT entity_id,rule_field FROM matched) m
      JOIN subjects e ON e.id=m.entity_id GROUP BY e.state),
    clocks AS (SELECT DISTINCT ON (entity_id,field) entity_id,field,clock FROM matched ORDER BY entity_id,field,length(rule_field) DESC),
    known AS (SELECT e.state,count(*) AS n,count(h.entity_id) AS held,
      count(*) FILTER (WHERE h.entity_id IS NOT NULL AND NOT coalesce(h.owner OR
        h.checked_at + make_interval(secs => (($3::jsonb->>coalesce(c.clock,
          CASE WHEN a.field LIKE 'campaign-%' THEN 'money' WHEN a.field LIKE 'member:%' OR a.field LIKE 'term_%' THEN 'officeholder'
            WHEN a.field LIKE 'comment:%' THEN 'comment_rule' WHEN a.field='agenda_url' THEN 'agenda'
            WHEN a.field IN ('minutes_url','video_url','outcome','outcomes') THEN 'outcome'
            WHEN a.field IN ('starts_at','location','meeting_cadence') THEN 'meeting' ELSE 'contact' END))::double precision)*3600) >= $2::timestamptz,false)) AS stale
      FROM active_fields a JOIN subjects e ON e.id=a.entity_id LEFT JOIN holdings h ON h.entity_id=a.entity_id AND h.field=a.field
        LEFT JOIN clocks c ON c.entity_id=a.entity_id AND c.field=a.field GROUP BY e.state),
    stuck AS (SELECT e.state,count(*) AS n FROM blank b JOIN subjects e ON e.id=b.entity_id GROUP BY e.state),
    states AS (SELECT state FROM baseline UNION SELECT state FROM known)
    SELECT s.state,coalesce(b.n,0)-coalesce(c.n,0)+coalesce(k.n,0) AS owed,coalesce(k.held,0) AS held,
      coalesce(b.n,0)-coalesce(c.n,0)+coalesce(k.n,0)-coalesce(k.held,0) AS missing,coalesce(k.stale,0) AS stale,coalesce(t.n,0) AS stuck
    FROM states s LEFT JOIN baseline b ON b.state=s.state LEFT JOIN covered c ON c.state=s.state
      LEFT JOIN known k ON k.state=s.state LEFT JOIN stuck t ON t.state=s.state`, [...parameters(config, now), ...(state ? [state] : [])]);
  const byState = new Map(rows.map(row => [String(row.state), counts(row)]));
  return [...US_STATES.map(state => ({ state: state.code.toUpperCase(), name: state.name, ...counts(byState.get(state.code.toUpperCase()) ?? {}) })),
    { state: "US", name: "National government", ...counts(byState.get("US") ?? {}) }].filter(row => state === undefined || row.state === state);
}

/** Hunters call once before spending: exact place, map-linked subjects and descendants, their missing fields and every held value/source. */
export async function readPlaceNeeds(query: Query, config: AdminConfig | null, placeId: string, now: string,
  placeIds: readonly string[] = [placeId]): Promise<PlaceNeeds> {
  if (!placeId || placeId.length > 500) throw new Error("Choose a place");
  const rows = await query(`${slots(`root AS MATERIALIZED (SELECT * FROM entity WHERE id=ANY($4::text[]) AND kind='place'),
    mapped AS (SELECT id FROM root UNION SELECT ep.entity_id FROM entity_place ep JOIN root r ON ep.place_id=r.id),
    family(id) AS (SELECT id FROM mapped UNION SELECT e.id FROM entity e JOIN family p ON e.parent_id=p.id
      WHERE e.kind<>'place' AND EXISTS(SELECT 1 FROM root r WHERE e.state IS NOT DISTINCT FROM r.state)),
    subjects AS MATERIALIZED (SELECT e.id,e.name,e.kind,coalesce(e.state,'US') AS state FROM entity e JOIN family f ON f.id=e.id
      WHERE EXISTS(SELECT 1 FROM root r WHERE e.state IS NOT DISTINCT FROM r.state))`)}
    SELECT roots.n AS root_count,m.*,e.name,e.kind,
      coalesce(label.label,replace(split_part(m.field,':',1),'_',' ')) AS label,b.stage,b.reason,b.next_try_at,
      coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'value',f.value,'status',f.status,'sourceUrl',s.final_url,
        'checkedAt',f.checked_at,'stale',f.provenance_kind<>'OWNER' AND (f.checked_at>$2::timestamptz OR
          f.checked_at + make_interval(secs => (($3::jsonb->>m.clock)::double precision)*3600) < $2::timestamptz)) ORDER BY f.id)
        FROM fact f LEFT JOIN source_copy s ON s.id=f.source_copy_id
        WHERE f.entity_id=m.id AND f.field=m.field AND f.status IN ('live','held')),'[]'::jsonb) AS facts
    FROM (SELECT count(*) AS n FROM root) roots LEFT JOIN measured m ON true
      LEFT JOIN subjects e ON e.id=m.id
      LEFT JOIN LATERAL (SELECT r.label FROM rules r WHERE r.kind=e.kind AND (r.state IS NULL OR r.state=e.state)
        AND (r.place_kind IS NULL OR r.place_kind=split_part(regexp_replace(e.id,'^.*/',''),':',1))
        AND (m.field=r.field OR starts_with(m.field,r.field||':')) ORDER BY length(r.field) DESC LIMIT 1) label ON true
      LEFT JOIN blank b ON b.entity_id=m.id AND b.field=m.field ORDER BY m.id,m.field`,
  [...parameters(config, now), [...new Set(placeIds)]]);
  if (!Number(rows[0]?.root_count)) throw new Error("The place map has no coverage for this place yet");
  const missing: PlaceMissingItem[] = [], held: PlaceHeldItem[] = [];
  let stale = 0, stuck = 0;
  for (const row of rows) {
    if (row.id == null) continue;
    const item: PlaceMissingItem = { entityId: String(row.id), entityName: String(row.name), kind: String(row.kind), field: String(row.field), label: String(row.label),
      blank: row.stage ? { stage: String(row.stage), reason: String(row.reason), nextTryAt: new Date(row.next_try_at as string).toISOString() } : null };
    if (row.stuck) stuck++;
    if (row.held) {
      if (!row.fresh) stale++;
      held.push({ ...item, facts: row.facts as PlaceHeldItem["facts"] });
    } else missing.push(item);
  }
  return { placeId, observedAt: now, counts: { owed: held.length + missing.length, held: held.length, missing: missing.length, stale, stuck }, missing, held };
}
