import { createHash } from "node:crypto";
import type { ChecklistCensus } from "../readiness/checklist-census.ts";
import { CHECKLIST_PROFILE } from "../readiness/checklist-score.ts";
import type { Sql } from "../repository/pg-store.ts";
import { boundedQuery } from "../repository/request-bounds.ts";
import { canonicalJson } from "../repository/types.ts";
import { CHECKLIST_SCOPE_HEAD_SQL } from "./checklist-instance-index-read.ts";

const BATCH_SIZE = 250;
const allDefinitionIds = CHECKLIST_PROFILE.definitions.map(definition => definition.id);
const knownDefinitions = new Set(allDefinitionIds);
const predicateByDefinition = new Map(CHECKLIST_PROFILE.definitions.map(definition => [definition.id, definition.canonicalPredicate]));

export const INSERT_CHECKLIST_INSTANCE_ROWS_SQL = `INSERT INTO cp_checklist_instance_projections
  (projection_id, definition_id, obligation_key, ordinal, instance)
  SELECT $1::text, input.definition_id, input.obligation_key, input.ordinal, input.instance
  FROM jsonb_to_recordset($2::jsonb) AS input
    (definition_id text, obligation_key text, ordinal bigint, instance jsonb)
  ON CONFLICT DO NOTHING`;
export const VERIFY_CHECKLIST_INSTANCE_ROWS_SQL = `WITH expected AS (
    SELECT * FROM jsonb_to_recordset($2::jsonb) AS input
      (definition_id text, obligation_key text, ordinal bigint, instance jsonb)
  ) SELECT count(*)::bigint AS expected_count,
    count(saved.instance)::bigint AS found_count,
    count(*) FILTER (WHERE saved.instance = expected.instance)::bigint AS equal_count
  FROM expected LEFT JOIN cp_checklist_instance_projections AS saved
    ON saved.projection_id = $1 AND saved.definition_id = expected.definition_id
    AND saved.obligation_key = expected.obligation_key AND saved.ordinal = expected.ordinal`;
export const COUNT_CHECKLIST_INSTANCE_ROWS_SQL = `SELECT count(*)::bigint AS row_count
  FROM cp_checklist_instance_projections WHERE projection_id = $1`;
export const PROMOTE_CHECKLIST_SCOPE_HEAD_SQL = `INSERT INTO cp_checklist_scope_heads
  (scope_id, instruction_receipt, projection_id, source_snapshot_revision,
   snapshot_published_at, scope_revision, observed_at, profile,
   inventory_complete, reads_complete, captured_counts)
  SELECT $1::text, $2::text, $3::text, $4::bigint, $5::timestamptz,
    $6::text, $7::timestamptz, $8::text, $9::boolean, $10::boolean, $11::jsonb
  FROM cp_owner_snapshots AS snapshot
  WHERE snapshot.id = 'current' AND snapshot.revision = $4::bigint
  ON CONFLICT (scope_id, instruction_receipt) DO UPDATE SET
    projection_id = EXCLUDED.projection_id,
    source_snapshot_revision = EXCLUDED.source_snapshot_revision,
    snapshot_published_at = EXCLUDED.snapshot_published_at,
    scope_revision = EXCLUDED.scope_revision,
    observed_at = EXCLUDED.observed_at,
    profile = EXCLUDED.profile,
    inventory_complete = EXCLUDED.inventory_complete,
    reads_complete = EXCLUDED.reads_complete,
    captured_counts = EXCLUDED.captured_counts
  WHERE cp_checklist_scope_heads.source_snapshot_revision < EXCLUDED.source_snapshot_revision
  RETURNING projection_id, source_snapshot_revision`;

export interface ChecklistIndexSourceSnapshot {
  readonly revision: number;
  readonly publishedAt: string;
  readonly checklists: readonly ChecklistCensus[];
}
type ProjectionRow = { readonly definition_id: string; readonly obligation_key: string;
  readonly ordinal: number; readonly instance: ChecklistCensus["instances"][number] };

function count(value: unknown): number | null {
  const n = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}
function validDate(value: string): boolean { return typeof value === "string" && Number.isFinite(Date.parse(value)); }

export class ChecklistIndexWriteError extends Error {
  readonly code: "INVALID_SOURCE" | "IMMUTABLE_ROW_CONFLICT" | "INCOMPLETE_PROJECTION" |
    "HEAD_IDENTITY_CONFLICT" | "SNAPSHOT_SUPERSEDED";
  constructor(code: ChecklistIndexWriteError["code"]) { super(code); this.code = code; }
}

export function planChecklistIndex(snapshot: ChecklistIndexSourceSnapshot, census: ChecklistCensus): {
  readonly projectionId: string; readonly counts: Readonly<Record<string, number>>;
  readonly rows: readonly ProjectionRow[];
} {
  if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0 || !validDate(snapshot.publishedAt) ||
    census.profile !== CHECKLIST_PROFILE.version || census.censusVersion !== "checklist-census/1" ||
    !census.scopeId || !census.instructionReceipt || !census.scopeRevision || !validDate(census.observedAt))
    throw new ChecklistIndexWriteError("INVALID_SOURCE");
  const counts = Object.fromEntries(allDefinitionIds.map(id => [id, 0])) as Record<string, number>;
  const rows: ProjectionRow[] = [];
  for (const [index, instance] of census.instances.entries()) {
    if (!instance.obligationKey || instance.scopeRevision !== census.scopeRevision ||
      !Array.isArray(instance.definitionIds) || !instance.definitionIds.length ||
      new Set(instance.definitionIds).size !== instance.definitionIds.length ||
      instance.definitionIds.some(id => !knownDefinitions.has(id) || predicateByDefinition.get(id) !== instance.predicateKey))
      throw new ChecklistIndexWriteError("INVALID_SOURCE");
    for (const definitionId of instance.definitionIds) {
      counts[definitionId] += 1;
      rows.push({ definition_id: definitionId, obligation_key: instance.obligationKey,
        ordinal: index + 1, instance });
    }
  }
  const digest = createHash("sha256").update(canonicalJson({ revision: snapshot.revision,
    publishedAt: snapshot.publishedAt, census })).digest("hex");
  return { projectionId: `cpidx-${digest}`, counts, rows };
}

/** Only caller-controlled post-CAS snapshots may reach this writer. The DB
 * independently refuses a head if the current snapshot revision has moved. */
export async function publishChecklistIndexForSnapshot(sql: Sql, snapshot: ChecklistIndexSourceSnapshot): Promise<void> {
  if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0 || !validDate(snapshot.publishedAt))
    throw new ChecklistIndexWriteError("INVALID_SOURCE");
  const uniqueScopes = new Set<string>();
  const plans = snapshot.checklists.map(census => {
    const scopeKey = JSON.stringify([census.scopeId, census.instructionReceipt]);
    if (uniqueScopes.has(scopeKey)) throw new ChecklistIndexWriteError("INVALID_SOURCE");
    uniqueScopes.add(scopeKey);
    return { census, plan: planChecklistIndex(snapshot, census) };
  });
  for (const { census, plan } of plans) {
    for (let start = 0; start < plan.rows.length; start += BATCH_SIZE) {
      const batch = plan.rows.slice(start, start + BATCH_SIZE);
      const payload = JSON.stringify(batch);
      await boundedQuery(sql, { operation: "cp_checklist_instance_projections.insert", callClass: "PAGE" },
        INSERT_CHECKLIST_INSTANCE_ROWS_SQL, [plan.projectionId, payload]);
      const verified = await boundedQuery(sql, { operation: "cp_checklist_instance_projections.verify", callClass: "PAGE" },
        VERIFY_CHECKLIST_INSTANCE_ROWS_SQL, [plan.projectionId, payload]) as readonly Record<string, unknown>[];
      const result = verified[0];
      if (!result || count(result.expected_count) !== batch.length || count(result.found_count) !== batch.length ||
        count(result.equal_count) !== batch.length) throw new ChecklistIndexWriteError("IMMUTABLE_ROW_CONFLICT");
    }
    const total = await boundedQuery(sql, { operation: "cp_checklist_instance_projections.count", callClass: "POINT" },
      COUNT_CHECKLIST_INSTANCE_ROWS_SQL, [plan.projectionId]) as readonly Record<string, unknown>[];
    if (count(total[0]?.row_count) !== plan.rows.length ||
      Object.values(plan.counts).reduce((sum, n) => sum + n, 0) !== plan.rows.length ||
      Object.keys(plan.counts).length !== CHECKLIST_PROFILE.definitionCount)
      throw new ChecklistIndexWriteError("INCOMPLETE_PROJECTION");
    await boundedQuery(sql, { operation: "cp_checklist_scope_heads.promote", callClass: "POINT" },
      PROMOTE_CHECKLIST_SCOPE_HEAD_SQL,
      [census.scopeId, census.instructionReceipt, plan.projectionId, snapshot.revision,
        snapshot.publishedAt, census.scopeRevision, census.observedAt, census.profile,
        census.inventory.complete, census.readsComplete, JSON.stringify(plan.counts)]);
    const heads = await boundedQuery(sql, { operation: "cp_checklist_scope_heads.verify", callClass: "POINT" },
      CHECKLIST_SCOPE_HEAD_SQL, [census.scopeId, census.instructionReceipt]) as readonly Record<string, unknown>[];
    const head = heads[0];
    if (!head || count(head.source_snapshot_revision) !== snapshot.revision ||
      count(head.current_snapshot_revision) !== snapshot.revision) {
      if (head && (count(head.source_snapshot_revision) ?? -1) > snapshot.revision)
        throw new ChecklistIndexWriteError("SNAPSHOT_SUPERSEDED");
      throw new ChecklistIndexWriteError("SNAPSHOT_SUPERSEDED");
    }
    if (head.projection_id !== plan.projectionId) throw new ChecklistIndexWriteError("HEAD_IDENTITY_CONFLICT");
  }
}
