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
function slots(scope: string): string {
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
    ),
    configured AS (
      SELECT e.id,e.name,e.kind,e.state,coalesce(a.field,r.field) AS field,r.label,r.clock
      FROM subjects e JOIN rules r ON r.kind=e.kind AND (r.state IS NULL OR r.state=e.state)
        AND (r.place_kind IS NULL OR r.place_kind=split_part(regexp_replace(e.id,'^.*/',''),':',1))
      LEFT JOIN active_fields a ON a.entity_id=e.id AND (a.field=r.field OR starts_with(a.field,r.field||':'))
    ),
    wanted AS (
      SELECT DISTINCT ON (id,field) * FROM configured ORDER BY id,field
    ),
    extra AS (
      SELECT e.id,e.name,e.kind,e.state,a.field,replace(split_part(a.field,':',1),'_',' ') AS label,
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
export async function readStateOwedCounts(query: Query, config: AdminConfig | null, now: string): Promise<readonly StateOwedCounts[]> {
  const rows = await query(`${slots("subjects AS MATERIALIZED (SELECT id,name,kind,coalesce(state,'US') AS state FROM entity)")}
    SELECT state,count(*) AS owed,count(*) FILTER (WHERE held) AS held,count(*) FILTER (WHERE NOT held) AS missing,
      count(*) FILTER (WHERE held AND NOT fresh) AS stale,count(*) FILTER (WHERE stuck) AS stuck FROM measured GROUP BY state`, parameters(config, now));
  const byState = new Map(rows.map(row => [String(row.state), counts(row)]));
  return [...US_STATES.map(state => ({ state: state.code.toUpperCase(), name: state.name, ...counts(byState.get(state.code.toUpperCase()) ?? {}) })),
    { state: "US", name: "National government", ...counts(byState.get("US") ?? {}) }];
}

/** Hunters call once before spending: exact place, map-linked subjects and descendants, their missing fields and every held value/source. */
export async function readPlaceNeeds(query: Query, config: AdminConfig | null, placeId: string, now: string): Promise<PlaceNeeds> {
  if (!placeId || placeId.length > 500) throw new Error("Choose a place");
  const rows = await query(`${slots(`root AS MATERIALIZED (SELECT * FROM entity WHERE id=$4 AND kind='place'),
    reach(id) AS (
      SELECT id FROM root UNION SELECT e.id FROM entity e JOIN reach r ON e.parent_id=r.id
        WHERE e.state IS NOT DISTINCT FROM (SELECT state FROM root)
    ),
    mapped AS (SELECT id FROM reach UNION SELECT ep.entity_id FROM entity_place ep JOIN reach r ON ep.place_id=r.id),
    family(id) AS (SELECT id FROM mapped UNION SELECT e.id FROM entity e JOIN family p ON e.parent_id=p.id
      WHERE e.state IS NOT DISTINCT FROM (SELECT state FROM root)),
    subjects AS MATERIALIZED (SELECT e.id,e.name,e.kind,coalesce(e.state,'US') AS state FROM entity e JOIN family f ON f.id=e.id
      WHERE e.state IS NOT DISTINCT FROM (SELECT state FROM root))`)}
    SELECT m.*,b.stage,b.reason,b.next_try_at,
      coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'value',f.value,'status',f.status,'sourceUrl',s.final_url,
        'checkedAt',f.checked_at,'stale',f.provenance_kind<>'OWNER' AND (f.checked_at>$2::timestamptz OR
          f.checked_at + make_interval(secs => (($3::jsonb->>m.clock)::double precision)*3600) < $2::timestamptz)) ORDER BY f.id)
        FROM fact f LEFT JOIN source_copy s ON s.id=f.source_copy_id
        WHERE f.entity_id=m.id AND f.field=m.field AND f.status IN ('live','held')),'[]'::jsonb) AS facts
    FROM measured m LEFT JOIN blank b ON b.entity_id=m.id AND b.field=m.field ORDER BY m.id,m.field`,
  [...parameters(config, now), placeId]);
  const missing: PlaceMissingItem[] = [], held: PlaceHeldItem[] = [];
  let stale = 0, stuck = 0;
  for (const row of rows) {
    const item: PlaceMissingItem = { entityId: String(row.id), entityName: String(row.name), kind: String(row.kind), field: String(row.field), label: String(row.label),
      blank: row.stage ? { stage: String(row.stage), reason: String(row.reason), nextTryAt: new Date(row.next_try_at as string).toISOString() } : null };
    if (row.stuck) stuck++;
    if (row.held) {
      if (!row.fresh) stale++;
      held.push({ ...item, facts: row.facts as PlaceHeldItem["facts"] });
    } else missing.push(item);
  }
  return { placeId, observedAt: now, counts: { owed: rows.length, held: held.length, missing: missing.length, stale, stuck }, missing, held };
}
