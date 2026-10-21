import { neon } from "@neondatabase/serverless";
import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import { installReaderDatabaseQuery } from "../reader/database.ts";
import { installDatabaseTransferCounter } from "../db/transfer.ts";
import { installConnectAttemptWindow } from "../ops/connect-attempt-window.ts";
import type { CivicDataReadResult } from "./read-model.ts";
import { parseValidationReceipt } from "./receipt.ts";
import type { RegistrationReadModel } from "../registration/candidate.ts";
import { registrationTarget } from "../registration/publication.ts";
import type { DerivedWiringProjection } from "./derived-meeting-wiring.ts";
import type { RoutineRecordClass } from "./types.ts";
import { withControlPlaneConnectRetry, isTransientControlPlaneConnectError } from "../control-plane/repository/connect-retry.ts";

/** Startup needs registration identities and their source vintage, never geometry.
 * Resolve only these members of the already state-keyed publication. */
export const PLANNER_REGISTRATION_PAYLOAD = `json_strip_nulls(json_build_object(
  'formatVersion',root->'formatVersion','state',root->'state','scope',root->'scope',
  'vintage',reader_payload_value(root->'vintage'),
  'bodyCount',(SELECT count(*) FROM reader_payload_members(root->'bodies')),
  'governmentCount',CASE WHEN root ? 'governments' THEN (SELECT count(*) FROM reader_payload_members(root->'governments')) END,
  'bodies',COALESCE((SELECT json_agg(json_build_array(b->'id',b->'jurisdictionId',b->'censusId',b->'ocdId') ORDER BY ordinal_index)
    FROM reader_payload_members(root->'bodies'),LATERAL (SELECT reader_payload_node(item) AS b) body
    WHERE ordinal_index>$3 AND ordinal_index<=$4),'[]'::json),
  'governments',CASE WHEN root ? 'governments' THEN COALESCE((SELECT json_agg(json_build_array(
    g->'id',g->'jurisdictionId',reader_payload_value(g->'name'),g->'governmentClass',
    reader_payload_node(g->'nativeIds')->'census_pid6',reader_payload_node(g->'nativeIds')->'tiger_geoid',
    reader_payload_value(g->'website'),g->'countyFips',
    (SELECT reader_payload_value(item) FROM reader_payload_members(g->'associations') LIMIT 1)) ORDER BY ordinal_index)
    FROM reader_payload_members(root->'governments'),LATERAL (SELECT reader_payload_node(item) AS g) government
    WHERE ordinal_index>$3 AND ordinal_index<=$4),'[]'::json) END,
  'counts',reader_payload_value(root->'counts'),
  'functionalStatus',reader_payload_value(root->'functionalStatus'),
  'divisions','[]'::jsonb,'reviewedRegistryVersionId',root->'reviewedRegistryVersionId'))`;

const PLANNER_WIRING_PAYLOAD = `jsonb_build_object('kind',root->'kind','formatVersion',root->'formatVersion',
  'records',COALESCE((SELECT jsonb_agg(reader_payload_value(item) ORDER BY ordinal_index)
    FROM reader_payload_members(root->'records')
    WHERE reader_payload_node(reader_payload_node(item)->'row')->>'state'=$2),'[]'::jsonb))`;

export function plannerProjectionSql(payload: string): string {
  return `WITH pointer AS MATERIALIZED (
    SELECT p.*,c.state AS candidate_state,c.acquisition_succeeded,c.promoted_version_id,
      c.last_known_good_version_id AS candidate_lkg,c.record_class AS candidate_class,
      c.scope AS candidate_scope,c.source_id AS candidate_source,c.retrieved_at,
      NULL::jsonb AS temporal
    FROM civic_data_promotions p LEFT JOIN civic_data_candidates c ON c.id=p.current_version_id WHERE p.key=$1 AND $2::text IS NOT NULL
  ) SELECT key,source_id,record_class,scope,current_version_id,last_known_good_version_id,promoted_at,
    candidate_state,acquisition_succeeded,promoted_version_id,candidate_lkg,candidate_class,candidate_scope,candidate_source,
    (validation_receipt-'excludedFacts')||jsonb_build_object('excludedFacts','[]'::jsonb) AS receipt,
    retrieved_at,temporal,${payload} AS payload
    FROM pointer,LATERAL (SELECT reader_payload_node(payload) AS root) header`;
}

/** The planner uses the same direct, read-only HTTP transport for its state
 * packages and fact queries. It has no reader route, selection or page timer. */
export function plannerStateReads(state: string, query?: ReadOnlyQuery, observe?: (read: {
  readonly name: string; readonly elapsedMs: number; readonly bytes: number; readonly ok: boolean;
}) => void) {
  const postal = state.toUpperCase();
  if (!/^[A-Z]{2}$/.test(postal) && state !== "system") throw new Error(`PLANNER_STATE_INVALID:${state}`);
  if (!query) {
    if (!process.env.DATABASE_URL) throw new Error("PLANNER_STORE_UNCONFIGURED");
    installConnectAttemptWindow();
    installDatabaseTransferCounter();
    const sql = neon(process.env.DATABASE_URL);
    query = statements => sql.transaction(statements.map(statement => sql.query(statement.text, [...statement.params])), { readOnly: true });
  }
  const direct: ReadOnlyQuery = async statements => {
    const started = performance.now();
    const name = statements.map(statement => statement.params.find(value => typeof value === "string" && value.includes(":"))
      ?? statement.text.match(/(?:FROM|JOIN)\s+([a-z_]+)/i)?.[1] ?? "state-query").join("|");
    try {
      const rows = await withControlPlaneConnectRetry(() => query!(statements), {
        // Neon also reports a failed upstream connection as this precise 503.
        // It is safe to retry this read-only transaction; SQL errors and other
        // HTTP refusals retain the ordinary connect-retry behavior.
        isRetryable: error => isTransientControlPlaneConnectError(error) ||
          (error instanceof Error && error.name === "NeonDbError" &&
            /HTTP status 503/.test(error.message) && /upstream connect error or disconnect\/reset before headers/.test(error.message) &&
            /reset reason: connection termination/.test(error.message) && !/PROVIDER_CIRCUIT_BROKEN/.test(error.message)),
        onRetry: ({ attempt, delayMs }) => console.error(`planner state read retry: state=${postal} read=${name} attempt=${attempt} delayMs=${delayMs}`),
      });
      observe?.({ name, elapsedMs: performance.now() - started, bytes: Buffer.byteLength(JSON.stringify(rows)), ok: true });
      return rows;
    } catch (error) {
      observe?.({ name, elapsedMs: performance.now() - started, bytes: 0, ok: false });
      throw error;
    }
  };
  async function projection<T>(recordClass: RoutineRecordClass, scope: string, payload: string, page?: readonly [number, number]): Promise<CivicDataReadResult<T>> {
    const key = `${recordClass}:${scope}`;
    const [rows] = await direct([{ text: plannerProjectionSql(payload), params: [key, `US-${postal}`, ...page ?? []] }]);
    const row = rows[0];
    const metadata = { recordClass, scope, sourceId: null, version: null, versionId: null,
      lastKnownGoodVersionId: null, sourceThrough: null, retrievedAt: null, promotedAt: null, stale: "UNKNOWN" as const, staleAt: null };
    if (!row) return { kind: "NOT_RECORDED", value: null, metadata, detail: `No published ${key}.` };
    const version = row.current_version_id;
    const receipt = parseValidationReceipt(row.receipt);
    if (row.key !== key || row.record_class !== recordClass || row.scope !== scope || typeof version !== "string" ||
      row.last_known_good_version_id !== version || row.candidate_state !== "PROMOTED" || row.acquisition_succeeded !== true ||
      row.promoted_version_id !== version || row.candidate_lkg !== version || row.candidate_class !== recordClass ||
      row.candidate_scope !== scope || row.candidate_source !== row.source_id || !receipt || receipt.decision !== "GOOD" ||
      receipt.candidateId !== version || receipt.sourceId !== row.source_id || receipt.recordClass !== recordClass || receipt.scope !== scope) {
      throw new Error(`PLANNER_PUBLICATION_INVALID:${key}`);
    }
    const temporal = row.temporal as { version?: string; sourceThrough?: string } | null;
    const promotedAt = new Date(row.promoted_at as string).toISOString();
    return { kind: "PROMOTED", value: row.payload as T,
      metadata: { ...metadata, sourceId: row.source_id as string, version: temporal?.version ?? null, versionId: version,
        lastKnownGoodVersionId: version, sourceThrough: temporal?.sourceThrough ?? null,
        retrievedAt: new Date(row.retrieved_at as string).toISOString(), promotedAt },
      projection: { key, recordClass, scope, sourceId: row.source_id as string, versionId: version,
        lastKnownGoodVersionId: version, promotedAt, receipt, payload: row.payload as T } };
  }
  // One small identity read is shared by registration and partition ownership;
  // refresh at the next pass rather than retaining duplicate payloads in a round.
  let registration: Promise<CivicDataReadResult<RegistrationReadModel>> | undefined;
  return {
    query: direct,
    install: () => installReaderDatabaseQuery(direct),
    registration: (wanted: string) => {
      if (wanted.toUpperCase() !== postal) throw new Error(`PLANNER_STATE_BOUNDARY:${postal}:${wanted}`);
      return registration ??= projection<RegistrationReadModel>("REGISTRATION", registrationTarget(wanted).scope, PLANNER_REGISTRATION_PAYLOAD, [0, 0])
        .then(async read => {
          if (read.kind === "PROMOTED" && (read.value.state.toUpperCase() !== postal || read.value.formatVersion !== 1))
            throw new Error(`PLANNER_REGISTRATION_INVALID:${postal}`);
          if (read.kind === "PROMOTED") {
            const bodyCount = (read.value as RegistrationReadModel & { bodyCount: number }).bodyCount;
            const count = Math.max(read.value.governmentCount ?? 0, bodyCount);
            if (!Number.isSafeInteger(count) || count < 0) throw new Error(`PLANNER_REGISTRATION_COUNT_INVALID:${postal}`);
            const pageSize = 512;
            for (let offset = 0; offset < count; offset += pageSize * 4) {
              const pages = await Promise.all(Array.from({ length: Math.min(4, Math.ceil((count - offset) / pageSize)) }, (_, page) =>
                projection<RegistrationReadModel>("REGISTRATION", registrationTarget(wanted).scope, PLANNER_REGISTRATION_PAYLOAD,
                  [offset + page * pageSize, offset + (page + 1) * pageSize])));
              for (const page of pages) {
                if (page.kind !== "PROMOTED" || page.metadata.versionId !== read.metadata.versionId) throw new Error(`PLANNER_REGISTRATION_CHANGED:${postal}`);
                (read.value.bodies as unknown[]).push(...page.value.bodies);
                if (read.value.governments && page.value.governments) (read.value.governments as unknown[]).push(...page.value.governments);
              }
            }
            if (read.value.bodies.length !== bodyCount || read.value.governments && read.value.governments.length !== read.value.governmentCount)
              throw new Error(`PLANNER_REGISTRATION_INCOMPLETE:${postal}`);
            // Compact tuples avoid transferring the same property names thousands
            // of times. Only these identities are used by registration/ownership.
            const value = read.value;
            Object.assign(value, {
              bodies: (value.bodies as unknown as [string, string | null, string, string][]).map(([id, jurisdictionId, censusId, ocdId]) => ({ id, jurisdictionId, censusId, ocdId })),
              ...(value.governments ? { governments: (value.governments as unknown as [string, string | null, string, string, string | null, string | null, string | null, string | null, unknown][])
                .map(([id, jurisdictionId, name, governmentClass, censusPid, tigerGeoid, website, countyFips, association]) => ({
                  id, jurisdictionId, name, governmentClass, nativeIds: { ...(censusPid ? { census_pid6: censusPid } : {}), ...(tigerGeoid ? { tiger_geoid: tigerGeoid } : {}) },
                  website, countyFips, associations: association ? [association] : [],
                })) } : {}),
            });
          }
          return read;
        }).catch(error => { registration = undefined; throw error; });
    },
    wiring: () => projection<DerivedWiringProjection>("CURATED_READER_RECORD", "US:meeting-source-wiring", PLANNER_WIRING_PAYLOAD),
    bodyIds: () => projection<{ readonly ids: readonly string[] }>("REGISTRY_RUNTIME_BINDING", `US-${postal}:reader-registry-runtime`,
      `jsonb_build_object('ids',COALESCE((SELECT jsonb_agg(reader_payload_node(item)->'id' ORDER BY ordinal_index)
        FROM reader_payload_members(reader_payload_node(root->'registry')->'bodies')),'[]'::jsonb))`),
  };
}
