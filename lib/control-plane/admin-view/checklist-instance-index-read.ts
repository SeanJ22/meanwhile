import { CHECKLIST_PROFILE, type ChecklistInstance } from "../readiness/checklist-score.ts";
import type { Sql } from "../repository/pg-store.ts";
import { boundedQuery } from "../repository/request-bounds.ts";

export const CHECKLIST_INSTANCE_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 50;
const definitions = new Set(CHECKLIST_PROFILE.definitions.map(row => row.id));

/** Both predicates lead with primary-key columns; no owner-snapshot JSON expansion. */
export const CHECKLIST_SCOPE_HEAD_SQL = `SELECT head.projection_id, head.source_snapshot_revision,
  snapshot.revision AS current_snapshot_revision, head.snapshot_published_at,
  head.scope_revision, head.observed_at, head.profile, head.inventory_complete,
  head.reads_complete, head.captured_counts
  FROM cp_checklist_scope_heads AS head
  LEFT JOIN cp_owner_snapshots AS snapshot ON snapshot.id = 'current'
  WHERE head.scope_id = $1 AND head.instruction_receipt = $2`;
export const CHECKLIST_INSTANCE_PAGE_SQL = `SELECT obligation_key, ordinal, instance
  FROM cp_checklist_instance_projections
  WHERE projection_id = $1 AND definition_id = $2
    AND ($3::text IS NULL OR (obligation_key, ordinal) > ($3::text, $4::bigint))
  ORDER BY obligation_key, ordinal LIMIT $5`;

export interface ChecklistInstanceIndexQuery {
  readonly scopeId: string;
  readonly instructionReceipt: string;
  readonly definitionId: string;
  readonly limit: number;
  readonly cursor: string | null;
}

export type ChecklistInstanceIndexRead =
  | { readonly state: "INDEX_NOT_POPULATED" | "INDEX_STALE"; readonly rows: null;
      readonly matchedCapturedCount: null; readonly says: string }
  | { readonly state: "CURRENT_SNAPSHOT_CAPTURED_INSTANCES";
      readonly scopeId: string; readonly instructionReceipt: string; readonly definitionId: string;
      readonly projectionId: string; readonly snapshotPublishedAt: string;
      readonly scopeRevision: string; readonly observedAt: string;
      readonly rows: readonly ChecklistInstance[]; readonly ordinals: readonly number[];
      readonly matchedCapturedCount: number;
      readonly pageLimit: number; readonly nextCursor: string | null;
      readonly completeness: { readonly inventoryComplete: boolean; readonly readsComplete: boolean;
        readonly expectedObjects: null; readonly nationalTotal: null; readonly historicalTotal: null } };

export class ChecklistInstanceIndexError extends Error {
  readonly code: "INVALID_QUERY" | "INVALID_CURSOR" | "STALE_CURSOR" | "CORRUPT_INDEX";
  constructor(code: ChecklistInstanceIndexError["code"]) { super(code); this.code = code; }
}

type Cursor = { readonly format: 1; readonly scopeId: string; readonly instructionReceipt: string;
  readonly definitionId: string; readonly projectionId: string; readonly afterKey: string;
  readonly afterOrdinal: number };

function decodeCursor(raw: string, query: ChecklistInstanceIndexQuery): Cursor {
  if (raw.length > 2000 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new ChecklistInstanceIndexError("INVALID_CURSOR");
  let parsed: unknown;
  try {
    const bytes = Buffer.from(raw, "base64url");
    if (bytes.toString("base64url") !== raw) throw Error("NONCANONICAL_CURSOR");
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch { throw new ChecklistInstanceIndexError("INVALID_CURSOR"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new ChecklistInstanceIndexError("INVALID_CURSOR");
  const cursor = parsed as Record<string, unknown>;
  if (Object.keys(cursor).sort().join("|") !== "afterKey|afterOrdinal|definitionId|format|instructionReceipt|projectionId|scopeId" ||
    cursor.format !== 1 || cursor.scopeId !== query.scopeId || cursor.instructionReceipt !== query.instructionReceipt ||
    cursor.definitionId !== query.definitionId || typeof cursor.projectionId !== "string" ||
    typeof cursor.afterKey !== "string" || !Number.isSafeInteger(cursor.afterOrdinal) || Number(cursor.afterOrdinal) < 1)
    throw new ChecklistInstanceIndexError("INVALID_CURSOR");
  return cursor as Cursor;
}

export function validateChecklistInstanceIndexQuery(query: ChecklistInstanceIndexQuery): void {
  if (!query.scopeId || query.scopeId.length > 300 || /[\u0000-\u001f]/.test(query.scopeId) ||
    !query.instructionReceipt || query.instructionReceipt.length > 400 || /[\u0000-\u001f]/.test(query.instructionReceipt) ||
    !definitions.has(query.definitionId) || !Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > MAX_PAGE_SIZE)
    throw new ChecklistInstanceIndexError("INVALID_QUERY");
  if (query.cursor !== null) decodeCursor(query.cursor, query);
}

type HeadRow = { readonly projection_id?: unknown; readonly source_snapshot_revision?: unknown;
  readonly current_snapshot_revision?: unknown; readonly snapshot_published_at?: unknown;
  readonly scope_revision?: unknown; readonly observed_at?: unknown; readonly profile?: unknown;
  readonly inventory_complete?: unknown; readonly reads_complete?: unknown;
  readonly captured_counts?: unknown };
type InstanceRow = { readonly obligation_key?: unknown; readonly ordinal?: unknown; readonly instance?: unknown };
const revision = (value: unknown): number | null => {
  const n = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
};
const isoDate = (value: unknown): string | null => {
  const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

/** A missing/stale materialization is an explicit unavailable state, never zero. */
export async function readIndexedChecklistInstances(sql: Sql, query: ChecklistInstanceIndexQuery): Promise<ChecklistInstanceIndexRead> {
  validateChecklistInstanceIndexQuery(query);
  const cursor = query.cursor === null ? null : decodeCursor(query.cursor, query);
  const heads = await boundedQuery(sql, { operation: "cp_checklist_scope_heads.exact", callClass: "POINT" },
    CHECKLIST_SCOPE_HEAD_SQL, [query.scopeId, query.instructionReceipt]) as readonly HeadRow[];
  if (heads.length > 1) throw new ChecklistInstanceIndexError("CORRUPT_INDEX");
  const head = heads[0];
  if (!head) return { state: "INDEX_NOT_POPULATED", rows: null, matchedCapturedCount: null,
    says: "No complete indexed projection has been promoted for this exact instruction scope." };
  if (revision(head.source_snapshot_revision) === null || revision(head.current_snapshot_revision) === null ||
    revision(head.source_snapshot_revision) !== revision(head.current_snapshot_revision))
    return { state: "INDEX_STALE", rows: null, matchedCapturedCount: null,
      says: "The indexed projection does not match the current owner snapshot; its instances were not served." };
  if (head.profile !== CHECKLIST_PROFILE.version || typeof head.projection_id !== "string" ||
    !/^cpidx-[a-f0-9]{64}$/.test(head.projection_id) || typeof head.scope_revision !== "string" ||
    !isoDate(head.snapshot_published_at) || !isoDate(head.observed_at) ||
    typeof head.inventory_complete !== "boolean" || typeof head.reads_complete !== "boolean" ||
    !head.captured_counts || typeof head.captured_counts !== "object" || Array.isArray(head.captured_counts))
    throw new ChecklistInstanceIndexError("CORRUPT_INDEX");
  const counts = head.captured_counts as Record<string, unknown>;
  const count = counts[query.definitionId];
  if (!Number.isSafeInteger(count) || Number(count) < 0) throw new ChecklistInstanceIndexError("CORRUPT_INDEX");
  if (cursor && cursor.projectionId !== head.projection_id) throw new ChecklistInstanceIndexError("STALE_CURSOR");
  const rows = await boundedQuery(sql, { operation: "cp_checklist_instance_projections.page", callClass: "POINT" },
    CHECKLIST_INSTANCE_PAGE_SQL, [head.projection_id, query.definitionId,
      cursor?.afterKey ?? null, cursor?.afterOrdinal ?? null, query.limit + 1]) as readonly InstanceRow[];
  if (rows.length > query.limit + 1 || count === 0 && rows.length > 0 ||
    count !== 0 && cursor === null && rows.length === 0)
    throw new ChecklistInstanceIndexError("CORRUPT_INDEX");
  for (const row of rows) {
    const instance = row.instance as Partial<ChecklistInstance> | null;
    if (!instance || typeof instance !== "object" || !Array.isArray(instance.definitionIds) ||
      !instance.definitionIds.includes(query.definitionId) || instance.scopeRevision !== head.scope_revision ||
      instance.obligationKey !== row.obligation_key || typeof row.obligation_key !== "string" ||
      revision(row.ordinal) === null || Number(row.ordinal) < 1)
      throw new ChecklistInstanceIndexError("CORRUPT_INDEX");
  }
  const shown = rows.slice(0, query.limit);
  const last = shown.at(-1);
  const nextCursor = rows.length > query.limit && last ? Buffer.from(JSON.stringify({ format: 1,
    scopeId: query.scopeId, instructionReceipt: query.instructionReceipt, definitionId: query.definitionId,
    projectionId: head.projection_id, afterKey: last.obligation_key, afterOrdinal: Number(last.ordinal) }), "utf8").toString("base64url") : null;
  return { state: "CURRENT_SNAPSHOT_CAPTURED_INSTANCES", scopeId: query.scopeId,
    instructionReceipt: query.instructionReceipt, definitionId: query.definitionId,
    projectionId: head.projection_id, snapshotPublishedAt: isoDate(head.snapshot_published_at)!, scopeRevision: head.scope_revision,
    observedAt: isoDate(head.observed_at)!,
    rows: shown.map(row => row.instance as ChecklistInstance), ordinals: shown.map(row => Number(row.ordinal)),
    matchedCapturedCount: Number(count),
    pageLimit: query.limit, nextCursor, completeness: { inventoryComplete: head.inventory_complete,
      readsComplete: head.reads_complete, expectedObjects: null, nationalTotal: null, historicalTotal: null } };
}
