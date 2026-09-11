import { ROUTINE_RECORD_CLASSES, type RoutineRecordClass } from "./types.ts";

export const READER_PROJECTION_READBACK_PREFIX = "READER_PROJECTION_READBACK_V2 ";

const LEGACY_READER_PROJECTION_READBACK_PREFIXES = ["READER_PROJECTION_READBACK_V1 "] as const;
const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/;

export const READER_READBACK_EVIDENCE_KIND = "TYPED_READER_READ_MODEL" as const;

/** Stable evidence identity for a registered operational projection with no public Reader surface. */
export function sourceScopedReaderReadbackProjectionId(contractId: string): string {
  return `source-scoped:${contractId}`;
}

/**
 * Durable result from executing the contract-specific typed read model used
 * by Reader against the exact promoted version. A pointer read or a declared
 * consumer list is not this proof. Failed observations are retained too, so
 * Admin cannot turn a delivery defect into either silence or source failure.
 */
export interface ReaderProjectionReadbackReceipt {
  readonly contractVersion: 2;
  readonly kind: "READER_PROJECTION_READBACK";
  readonly contractId: string;
  readonly sourceId: string;
  readonly recordClass: RoutineRecordClass;
  readonly scope: string;
  readonly projectionId: string;
  readonly versionId: string;
  readonly pointerKey: string;
  readonly observedAt: string;
  readonly evidenceKind: typeof READER_READBACK_EVIDENCE_KIND;
  readonly verifierId: string;
  /** Commit whose typed Reader implementation produced this observation. */
  readonly verifierCodeSha: string | null;
  readonly status: "PASS" | "FAIL";
  readonly detail: string;
}

/** Normalize an exact Git commit identity; an absent/unreadable value stays unknown. */
export function normalizeReaderCodeSha(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  return GIT_SHA_PATTERN.test(normalized) ? normalized : null;
}

/**
 * Readback events are operational evidence, not source promotion events.
 * Recognize retired receipt versions here so a V1 row cannot reappear as a
 * second PROMOTED source event after the V2 migration.
 */
export function isReaderProjectionReadbackDetail(detail: string): boolean {
  return detail.startsWith(READER_PROJECTION_READBACK_PREFIX) ||
    LEGACY_READER_PROJECTION_READBACK_PREFIXES.some((prefix) => detail.startsWith(prefix));
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function serializeReaderProjectionReadback(receipt: ReaderProjectionReadbackReceipt): string {
  return READER_PROJECTION_READBACK_PREFIX + JSON.stringify(receipt);
}

export function parseReaderProjectionReadback(detail: string): ReaderProjectionReadbackReceipt | null {
  if (!detail.startsWith(READER_PROJECTION_READBACK_PREFIX)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(detail.slice(READER_PROJECTION_READBACK_PREFIX.length));
  } catch {
    return null;
  }
  const row = object(parsed);
  if (
    row === null ||
    row.contractVersion !== 2 ||
    row.kind !== "READER_PROJECTION_READBACK" ||
    typeof row.contractId !== "string" || row.contractId.length === 0 ||
    typeof row.sourceId !== "string" || row.sourceId.length === 0 ||
    typeof row.recordClass !== "string" || !(ROUTINE_RECORD_CLASSES as readonly string[]).includes(row.recordClass) ||
    typeof row.scope !== "string" || row.scope.length === 0 ||
    typeof row.projectionId !== "string" || row.projectionId.length === 0 ||
    typeof row.versionId !== "string" || row.versionId.length === 0 ||
    row.pointerKey !== `${row.recordClass}:${row.scope}` ||
    typeof row.observedAt !== "string" || !Number.isFinite(Date.parse(row.observedAt)) ||
    row.evidenceKind !== READER_READBACK_EVIDENCE_KIND ||
    typeof row.verifierId !== "string" || row.verifierId.length === 0 ||
    (row.verifierCodeSha !== null && normalizeReaderCodeSha(
      typeof row.verifierCodeSha === "string" ? row.verifierCodeSha : undefined,
    ) !== row.verifierCodeSha) ||
    (row.status !== "PASS" && row.status !== "FAIL") ||
    typeof row.detail !== "string" || row.detail.length === 0
  ) return null;
  return row as unknown as ReaderProjectionReadbackReceipt;
}
