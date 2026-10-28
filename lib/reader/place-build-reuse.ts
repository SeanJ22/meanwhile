import type { Query } from "../facts/publish.ts";
import type { BodyTerritorySelection } from "../registry/body-territory.ts";

export interface ReusedPlacePage { readonly placeId: string }
export interface PlaceBuildRead {
  readonly fingerprint: string;
  readonly reused?: ReusedPlacePage;
  readonly row?: Record<string, unknown>;
}

/** Hash the selected inputs in the build's snapshot. Only a new input body crosses the connection. */
export async function readPlaceBuild(query: Query, statement: string, params: readonly unknown[],
  territory: BodyTerritorySelection | null | undefined, revision = "fixture", placeId?: string): Promise<PlaceBuildRead> {
  const [read] = await query(`WITH input AS MATERIALIZED (${statement}), fingerprint AS MATERIALIZED (
    SELECT encode(sha256(convert_to(jsonb_build_array(to_jsonb(input),$${params.length + 1}::jsonb,$${params.length + 2}::text)::text,'UTF8')),'hex') AS value FROM input
  ), held AS MATERIALIZED (
    SELECT p.place_id FROM place_page p,fingerprint f WHERE p.build_fingerprint=f.value
      AND p.place_id LIKE 'zip:%' ORDER BY (p.place_id=$${params.length + 3}::text) DESC NULLS LAST,p.place_id LIMIT 1
  ) SELECT f.value AS fingerprint,(SELECT place_id FROM held) AS reused_page_id,
    CASE WHEN NOT EXISTS(SELECT 1 FROM held) THEN to_jsonb(input) END AS row FROM input,fingerprint f`,
  [...params, JSON.stringify(territory ?? null),revision,placeId ?? null]);
  if (!read || typeof read.fingerprint !== "string") throw new Error("PLACE_BUILD_FINGERPRINT_MISSING");
  return { fingerprint: read.fingerprint,
    ...(typeof read.reused_page_id === "string" ? { reused: { placeId: read.reused_page_id } }
      : { row: read.row as Record<string, unknown> }) };
}

/** Confirm the same saved answer or copy an equal answer inside the database, without downloading its body. */
export async function reusePlaceBuild(query: Query, id: string, held: ReusedPlacePage, fingerprint: string): Promise<void> {
  if(id===held.placeId){
    const confirmed=await query("UPDATE place_page SET built_at=clock_timestamp() WHERE place_id=$1 AND build_fingerprint=$2 RETURNING place_id",[id,fingerprint]);
    if(!confirmed.length)throw new Error("PLACE_BUILD_REUSE_REPLACED");
    return;
  }
  const copied = await query(`WITH copied AS (
    INSERT INTO place_page(place_id,version,built_at,body,history_body,context,build_fingerprint)
    SELECT $1,1,clock_timestamp(),body,history_body,context,build_fingerprint FROM place_page
    WHERE place_id=$2 AND build_fingerprint=$3
    ON CONFLICT(place_id) DO UPDATE SET version=place_page.version+1,built_at=excluded.built_at,
      body=excluded.body,history_body=excluded.history_body,context=excluded.context,build_fingerprint=excluded.build_fingerprint
    RETURNING place_id
  ), cleared AS (
    DELETE FROM place_page_dependency WHERE page_id=$1 AND $1<>$2 AND EXISTS(SELECT 1 FROM copied) RETURNING entity_id
  ), dependencies AS (
    INSERT INTO place_page_dependency(page_id,entity_id)
      SELECT $1,entity_id FROM place_page_dependency CROSS JOIN (SELECT count(*) FROM cleared) removed
        WHERE page_id=$2 AND entity_id<>$2 AND $1<>$2 AND EXISTS(SELECT 1 FROM copied)
      UNION SELECT $1,$1 WHERE $1<>$2 AND EXISTS(SELECT 1 FROM copied)
      ON CONFLICT DO NOTHING RETURNING page_id
  ) SELECT place_id FROM copied`, [id,held.placeId,fingerprint]);
  if (!copied.length) throw new Error("PLACE_BUILD_REUSE_REPLACED");
}
