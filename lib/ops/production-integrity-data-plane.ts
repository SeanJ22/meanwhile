/** Post-deploy integrity outcomes as an adapter over the existing software-release log, under one fixed key. */
import type { AppendOnlyRepository } from "../control-plane/repository/types.ts";
import {
  PRODUCTION_INTEGRITY_LOG_KEY,
  SOFTWARE_RELEASE_REVIEW_FORMAT_VERSION,
  isProductionIntegrityLogRecord,
  type ProductionIntegrityLogRecord,
  type SoftwareReleaseReviewRecord,
} from "../control-plane/software-release-review.ts";
import {
  FAILURE_CLASSES,
  NEVER_CHECKED,
  type IntegrityRecord,
} from "./production-integrity.ts";

export const CONTROL_PLANE_INTEGRITY_WRITE_URL_VAR =
  "WTP_CONTROL_PLANE_POST_DEPLOY_DATABASE_URL" as const;
export const CONTROL_PLANE_INTEGRITY_READ_URL_VAR =
  "WTP_CONTROL_PLANE_DATABASE_URL_READONLY" as const;

export type ProductionIntegrityRead =
  | { readonly kind: "HELD"; readonly record: IntegrityRecord; readonly receipt: ProductionIntegrityLogRecord }
  | { readonly kind: "NOT_RECORDED"; readonly record: IntegrityRecord; readonly detail: string }
  | { readonly kind: "STORE_UNREACHABLE"; readonly record: IntegrityRecord; readonly detail: string };

function fullSha(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{40}$/i.test(value);
}

/** A persisted value must prove its whole format before it can govern release. */
export function validIntegrityRecord(value: unknown): value is IntegrityRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<IntegrityRecord>;
  if (row.formatVersion !== 1) return false;
  if (row.deployedSha !== null && !fullSha(row.deployedSha)) return false;
  if (row.mainSha !== null && !fullSha(row.mainSha)) return false;
  if (!(["HELD", "REFUSED", "COULD_NOT_TELL"] as const).includes(row.observed as never)) return false;
  if (row.failureClass !== null && !(FAILURE_CLASSES as readonly string[]).includes(String(row.failureClass))) return false;
  if (typeof row.detail !== "string" || row.detail.trim() === "") return false;
  if (row.observedAt !== null && (typeof row.observedAt !== "string" || !Number.isFinite(Date.parse(row.observedAt)))) return false;
  if (row.moment !== null && row.moment !== "pre-deploy" && row.moment !== "post-deploy") return false;
  if (row.gateExit !== null && row.gateExit !== 0 && row.gateExit !== 1 && row.gateExit !== 2) return false;
  return true;
}

function unavailable(detail: string, kind: "NOT_RECORDED" | "STORE_UNREACHABLE"): ProductionIntegrityRead {
  return { kind, record: { ...NEVER_CHECKED, detail }, detail };
}

export function productionIntegrityReceipt(
  record: IntegrityRecord,
  input: { readonly runId?: string | null; readonly actor?: string } = {},
): ProductionIntegrityLogRecord {
  if (!validIntegrityRecord(record)) throw new Error("POST_DEPLOY_INTEGRITY_INVALID_RECORD");
  const observedAt = record.observedAt;
  if (observedAt === null) throw new Error("POST_DEPLOY_INTEGRITY_MISSING_OBSERVED_AT");
  const sha = record.deployedSha ?? "unknown";
  const runId = input.runId?.trim() || null;
  return {
    formatVersion: SOFTWARE_RELEASE_REVIEW_FORMAT_VERSION,
    id: `${PRODUCTION_INTEGRITY_LOG_KEY}:${sha}:${observedAt}${runId ? `:${runId}` : ""}`,
    stagingSha: sha,
    deployId: null,
    section: null,
    decision: "POST_DEPLOY_INTEGRITY",
    raisedStateChoice: null,
    feedback: null,
    actor: input.actor ?? "post-deploy-observer",
    composedFrom: null,
    createdAt: observedAt,
    manifest: {
      prompt3Status: null,
      reviewState: null,
      stagingBoundary: null,
      reportedAt: null,
    },
    productionIntegrity: record,
    sourceRunId: runId,
  };
}

export async function appendProductionIntegrity(
  log: AppendOnlyRepository<SoftwareReleaseReviewRecord>,
  record: IntegrityRecord,
  input: { readonly runId?: string | null; readonly actor?: string } = {},
): Promise<ProductionIntegrityLogRecord> {
  const receipt = productionIntegrityReceipt(record, input);
  await log.append(PRODUCTION_INTEGRITY_LOG_KEY, receipt.id, receipt, receipt.createdAt);
  return receipt;
}

export async function readLatestProductionIntegrity(
  log: Pick<AppendOnlyRepository<SoftwareReleaseReviewRecord>, "read">,
): Promise<ProductionIntegrityRead> {
  let rows: readonly SoftwareReleaseReviewRecord[];
  try {
    rows = await log.read(PRODUCTION_INTEGRITY_LOG_KEY);
  } catch (error) {
    return unavailable(
      `The canonical software-release outcome log could not be read (${error instanceof Error ? error.name : "error"}).`,
      "STORE_UNREACHABLE",
    );
  }
  if (rows.length === 0) {
    return unavailable(
      "The canonical software-release outcome log answered and holds no post-deploy integrity reading.",
      "NOT_RECORDED",
    );
  }
  const malformed = rows.find((row) => !isProductionIntegrityLogRecord(row) || !validIntegrityRecord(row.productionIntegrity));
  if (malformed !== undefined) {
    return unavailable(
      `The canonical software-release outcome log contains an unreadable post-deploy receipt (${malformed.id ?? "unnamed"}).`,
      "STORE_UNREACHABLE",
    );
  }
  const receipt = rows[rows.length - 1] as ProductionIntegrityLogRecord;
  return { kind: "HELD", record: receipt.productionIntegrity, receipt };
}

export function productionIntegrityHistory(
  rows: readonly SoftwareReleaseReviewRecord[],
): readonly ProductionIntegrityLogRecord[] {
  return rows.filter(isProductionIntegrityLogRecord).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
