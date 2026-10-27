import type { Query } from "../facts/publish.ts";
import type { Division, Registry } from "../registry/types.ts";
import { requireRegistryState, stateRegistryRuntimeScope } from "./state-scopes.ts";

/** A lookup is a selection of a published registry, never a successor's complete base. */
export interface RegistryLookup {
  readonly versionId: string;
  readonly payload: { readonly registry: Pick<Registry, "bodies" | "divisions"> };
}

const registryPointer = `SELECT p.key,p.current_version_id,
  (p.source_id='registry-reviewed-bindings' AND p.current_version_id=p.last_known_good_version_id
    AND c.state='PROMOTED' AND c.source_id=p.source_id AND c.record_class=p.record_class AND c.scope=p.scope
    AND (p.current_version_id=c.id AND p.payload_fingerprint IS NOT DISTINCT FROM c.read_model_fingerprint) AND p.validation_receipt=c.validation_receipt
    AND p.validation_receipt->>'decision'='GOOD') AS valid
  FROM civic_data_promotions p LEFT JOIN civic_data_candidates c ON c.id=p.current_version_id
  WHERE p.record_class='REGISTRY_RUNTIME_BINDING' AND p.scope=$1`;

function requireRegistryPointer(row: Record<string, unknown>, scope: string): void {
  if (row.valid !== true) throw new Error(`REGISTRY_RUNTIME_BASE_UNAVAILABLE:INVALID_PUBLISHED_POINTER:${scope}`);
}

export function selectRegistryLookup(versionId: string, registry: Registry, bodyIds: readonly string[], divisionIds: readonly string[]): RegistryLookup {
  const wantedBodies = new Set(bodyIds), bodies = registry.bodies.filter(body => wantedBodies.has(body.id));
  const wantedDivisions = new Set([...divisionIds, ...bodies.flatMap(body => [body.ocdId, ...body.alsoServesOcdIds ?? []].filter((id): id is string => id !== null))]);
  return { versionId, payload: { registry: { bodies: structuredClone(bodies),
    divisions: structuredClone(registry.divisions.filter(division => wantedDivisions.has(division.ocdId))) } } };
}

/** The pointer and its selected rows share one statement and one database snapshot. */
export async function readKeyedRegistry(query: Query, state: string, bodyIds: readonly string[], divisionIds: readonly string[]): Promise<RegistryLookup | null> {
  const scope = stateRegistryRuntimeScope(requireRegistryState(state));
  const [row] = await query(`WITH pointer AS MATERIALIZED (${registryPointer}), bodies AS MATERIALIZED (
    SELECT r.ordinal,r.value FROM pointer p JOIN civic_data_rows r ON r.promotion_key=p.key AND r.version_id=p.current_version_id
    WHERE p.valid AND r.collection='registry.bodies' AND r.row_id=ANY($2::text[])
  ), divisions AS (
    SELECT r.ordinal,r.value FROM pointer p JOIN civic_data_rows r ON r.promotion_key=p.key AND r.version_id=p.current_version_id
    WHERE p.valid AND r.collection='registry.divisions' AND r.row_id=ANY(
      $3::text[] || ARRAY(SELECT value->>'ocdId' FROM bodies WHERE value->>'ocdId' IS NOT NULL)
      || ARRAY(SELECT jsonb_array_elements_text(coalesce(value->'alsoServesOcdIds','[]'::jsonb)) FROM bodies))
  ) SELECT p.current_version_id,p.valid,
    coalesce((SELECT jsonb_agg(reader_payload_value(value) ORDER BY ordinal) FROM bodies),'[]'::jsonb) AS bodies,
    coalesce((SELECT jsonb_agg(reader_payload_value(value) ORDER BY ordinal) FROM divisions),'[]'::jsonb) AS divisions FROM pointer p`,
  [scope, [...new Set(bodyIds)], [...new Set(divisionIds)]]);
  if (!row) return null;
  requireRegistryPointer(row, scope);
  return { versionId: String(row.current_version_id), payload: { registry: {
    bodies: row.bodies as Registry["bodies"], divisions: row.divisions as Registry["divisions"],
  } } };
}

export async function readKeyedRegistryDivisions(query: Query, state: string, labels: readonly string[]):
  Promise<readonly Pick<Division, "ocdId" | "label" | "state" | "sourceDataset">[]> {
  if (!labels.length) return [];
  const jurisdiction = requireRegistryState(state), scope = stateRegistryRuntimeScope(jurisdiction);
  const [row] = await query(`WITH pointer AS MATERIALIZED (${registryPointer}), divisions AS (
    SELECT r.ordinal,jsonb_build_object('ocdId',r.value->'ocdId','label',reader_payload_value(r.value->'label'),
      'state',r.value->'state','sourceDataset',r.value->'sourceDataset') AS value
    FROM pointer p JOIN civic_data_rows r ON r.promotion_key=p.key AND r.version_id=p.current_version_id
    WHERE p.valid AND r.collection='registry.divisions' AND upper(r.value->>'state')=$2 AND r.label_key=ANY($3::text[])
  ) SELECT p.valid,coalesce((SELECT jsonb_agg(value ORDER BY ordinal) FROM divisions),'[]'::jsonb) AS divisions FROM pointer p`,
  [scope,jurisdiction,labels]);
  if (!row) return [];
  requireRegistryPointer(row,scope);
  return row.divisions as Pick<Division, "ocdId" | "label" | "state" | "sourceDataset">[];
}
