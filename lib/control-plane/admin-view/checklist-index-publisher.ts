/** Optional post-snapshot materialization. An index failure never reverses the authoritative snapshot. */
import type { OwnerSnapshot } from "../owner-surface.ts";
import type { Persisted } from "../repository/types.ts";
import type { Sql } from "../repository/pg-store.ts";
import { boundedQuery } from "../repository/request-bounds.ts";
import { BOOTSTRAP_VERSION } from "../repository/pg-schema.ts";
import { ChecklistIndexWriteError, publishChecklistIndexForSnapshot } from "./checklist-instance-index-write.ts";

export const CHECKLIST_INDEX_ENABLED_VAR = "WTP_ADMIN_CHECKLIST_INDEX_ENABLED";
export type ChecklistIndexPublishOutcome =
  | { readonly state: "DISABLED" | "NO_CENSUS" | "SCHEMA_NOT_READY" }
  | { readonly state: "PROMOTED"; readonly sourceSnapshotRevision: number }
  | { readonly state: "FAILED"; readonly code: string };

/** Caller passes only the persisted result of a successful put/CAS, never an intended value. */
export async function publishChecklistIndexAfterSnapshot(input: {
  readonly enabled: boolean;
  readonly persisted: Persisted<OwnerSnapshot>;
  readonly sql: Sql | null;
}): Promise<ChecklistIndexPublishOutcome> {
  if (!input.enabled) return { state: "DISABLED" };
  const census = input.persisted.value.checklists;
  if (!Array.isArray(census) || census.length === 0) return { state: "NO_CENSUS" };
  if (!input.sql) return { state: "SCHEMA_NOT_READY" };
  try {
    const rows = await boundedQuery(input.sql,
      { operation: "cp_checklist_index.schema_ready", callClass: "POINT" },
      "SELECT version FROM cp_schema_version WHERE singleton = true", []) as readonly { version?: unknown }[];
    const version = Number(rows[0]?.version);
    if (!Number.isSafeInteger(version) || version < BOOTSTRAP_VERSION) return { state: "SCHEMA_NOT_READY" };
    await publishChecklistIndexForSnapshot(input.sql, { revision: input.persisted.revision,
      publishedAt: input.persisted.value.publishedAt, checklists: census });
    return { state: "PROMOTED", sourceSnapshotRevision: input.persisted.revision };
  } catch (error) {
    const code = error instanceof ChecklistIndexWriteError ? error.code : "INDEX_WRITE_UNAVAILABLE";
    return { state: "FAILED", code };
  }
}
