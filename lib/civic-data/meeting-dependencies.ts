import { factReader } from "../facts/db.ts";
import type { Query } from "../facts/publish.ts";
import type { Registry, Body, Division } from "../registry/types.ts";
import { installMeetingRegistryProjection } from "../registry/runtime-read-model.ts";
import { REGISTRY_RUNTIME_SCOPE } from "../registry/runtime-data-plane.ts";
import { installMeetingVenueProjection } from "./curated-reader-read-model.ts";
import type { CuratedReaderProjection } from "./manual-projections.ts";
import { routineScopeState } from "./state-scope.ts";

export interface MeetingDependencyScope {
  readonly bodyId: string;
  readonly ocdId: string | null;
  readonly tenant?: string;
}

export const MEETING_BODY_DEPENDENCY_SQL = `SELECT member_id, version_id, value FROM civic_meeting_dependencies
  WHERE kind IN ('body','registered-body') AND member_id = $1 ORDER BY kind LIMIT 1`;
export const MEETING_DIVISION_DEPENDENCY_SQL = `WITH RECURSIVE divisions AS (
  (SELECT DISTINCT ON (member_id) member_id,value FROM civic_meeting_dependencies
    WHERE kind IN ('division','registered-division') AND member_id = ANY($1::text[]) ORDER BY member_id,kind)
  UNION
  SELECT parent.member_id,parent.value FROM divisions child CROSS JOIN LATERAL (
    SELECT member_id,value FROM civic_meeting_dependencies WHERE kind IN ('division','registered-division')
      AND member_id = child.value->>'parentOcdId' ORDER BY kind LIMIT 1) parent
    WHERE parent.member_id LIKE $2 OR parent.member_id = 'ocd-division/country:us'
) SELECT value FROM divisions`;
export const MEETING_VENUE_DEPENDENCY_SQL = `SELECT version_id,value FROM civic_meeting_dependencies
  WHERE kind = 'venue' AND scope = ANY($1::text[])`;

function requiredQuery(query?: Query | null): Query {
  const read = query ?? factReader();
  if (!read) throw new Error("MEETING_DEPENDENCY_STORE_UNAVAILABLE");
  return read;
}

export async function readMeetingBodiesForPublication(bodyIds: readonly string[], query?: Query | null): Promise<Body[]> {
  const ids = [...new Set(bodyIds)];
  const rows = await requiredQuery(query)(`SELECT DISTINCT ON (d.member_id) d.member_id,d.value
    FROM civic_meeting_dependencies d JOIN civic_data_promotions p ON p.scope=d.pointer_scope AND p.current_version_id=d.version_id
      AND p.record_class=CASE d.kind WHEN 'body' THEN 'REGISTRY_RUNTIME_BINDING' ELSE 'REGISTRATION' END
    WHERE d.kind IN ('body','registered-body') AND d.member_id=ANY($1::text[]) ORDER BY d.member_id,d.kind`, [ids]);
  if (rows.length !== ids.length) throw new Error("MEETING_DEPENDENCY_VERSION_MISMATCH");
  return rows.map(row => row.value as Body);
}

export async function readMeetingBodyIdsForDivisions(state: string, ocdIds: readonly string[], query?: Query | null): Promise<ReadonlySet<string>> {
  if (!/^(?:US(?:-[A-Z]{2})?|[A-Z]{2})$/i.test(state)) throw new Error("MEETING_REGISTRY_STATE_INVALID");
  const scope = routineScopeState(state);
  const divisions = [...new Set(ocdIds.map(id => id.split("#")[0]!))];
  if (divisions.some(id => routineScopeState(id) !== scope)) throw new Error("MEETING_DEPENDENCY_CROSSES_STATE");
  if (!divisions.length) return new Set();
  const rows = await requiredQuery(query)(`WITH bodies AS MATERIALIZED (
    SELECT DISTINCT ON (d.member_id) d.member_id,d.value
    FROM civic_meeting_dependencies d JOIN civic_data_promotions p ON p.scope=d.pointer_scope AND p.current_version_id=d.version_id
      AND p.record_class=CASE d.kind WHEN 'body' THEN 'REGISTRY_RUNTIME_BINDING' ELSE 'REGISTRATION' END
    WHERE d.kind IN ('body','registered-body') AND d.scope=$1 ORDER BY d.member_id,d.kind
  ) SELECT member_id FROM bodies WHERE value->>'ocdId'=ANY($2::text[])
    OR coalesce(value->'alsoServesOcdIds','[]'::jsonb) ?| $2::text[]`, [scope, divisions]);
  return new Set(rows.map(row => String(row.member_id)));
}

export async function readMeetingVenues(scopes: readonly string[], query?: Query | null): Promise<void> {
  const rows = await requiredQuery(query)(MEETING_VENUE_DEPENDENCY_SQL, [[...new Set(scopes)]]);
  installMeetingVenueProjection(rows.map(row => row.value) as CuratedReaderProjection["records"],
    rows.map(row => String(row.version_id)).sort().join("|") || "no-venue-recorded");
}

export async function preloadMeetingDependencies(scope: MeetingDependencyScope, query?: Query | null): Promise<void> {
  const read = requiredQuery(query);
  const [bodyRows, markers] = await Promise.all([
    read(MEETING_BODY_DEPENDENCY_SQL, [scope.bodyId]),
    read("SELECT version_id,value FROM civic_meeting_dependencies WHERE kind = 'registry' AND member_id = $1", [REGISTRY_RUNTIME_SCOPE]),
  ]);
  if (!markers[0]) throw new Error("MEETING_REGISTRY_PROJECTION_NOT_RECORDED");
  const bodies = bodyRows.map(row => row.value as Body);
  const divisions = [...new Set([scope.ocdId, ...bodies.flatMap(body => [body.ocdId, ...(body.alsoServesOcdIds ?? [])])].filter((id): id is string => Boolean(id)))];
  const state = /^(.*\/(?:state|district|territory):[a-z]{2})(?:\/|$)/.exec(scope.ocdId ?? scope.bodyId)?.[1];
  if (state && divisions.some(id => id !== "ocd-division/country:us" && !id.startsWith(state))) throw new Error("MEETING_DEPENDENCY_CROSSES_STATE");
  const divisionRows = await read(MEETING_DIVISION_DEPENDENCY_SQL, [divisions, state ? `${state}%` : "ocd-division/country:us"]);
  const registry: Registry = { generatedAt: String((markers[0].value as { generatedAt: string }).generatedAt),
    bodies, divisions: divisionRows.map(row => row.value as Division) };
  await installMeetingRegistryProjection(registry, String(markers[0].version_id), read);
  await readMeetingVenues([...divisions, ...(scope.tenant ? [`tenant:${scope.tenant}`] : [])], read);
}

export async function readMeetingRegistryBodyIdsForState(state: string, query?: Query | null): Promise<ReadonlySet<string>> {
  const scope = `US-${state.replace(/^US-/i, "").toUpperCase()}`;
  if (!/^US-[A-Z]{2}$/.test(scope)) throw new Error("MEETING_REGISTRY_STATE_INVALID");
  const rows = await requiredQuery(query)("SELECT member_id FROM civic_meeting_dependencies WHERE kind = 'body' AND scope = $1", [scope]);
  return new Set(rows.map(row => String(row.member_id)));
}
