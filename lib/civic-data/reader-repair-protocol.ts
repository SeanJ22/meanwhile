import type { RoutineSourceContract } from "./contracts.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS, type ManualProductionSourceContract } from "./manual-contracts.ts";
import { MEETING_PARTITION_CONTRACTS, observableRoutineContracts } from "./meeting-partitions.ts";
import {
  READER_PROJECTION_READBACK_PREFIX,
  parseReaderProjectionReadback,
  type ReaderProjectionReadbackReceipt,
} from "./reader-readback.ts";
import type { ReaderReadbackRepairOutcome } from "./reader-verification.ts";
import type { RoutineCivicDataReaderReadbackReference } from "../control-plane/owner-surface.ts";

export const ROUTINE_READER_REPAIR_PREFIX = "RCD_READER_REPAIR=";
export const ROUTINE_READER_CHILD_CONCURRENCY = 4;
export const ROUTINE_READER_SINGLE_TIMEOUT_MS = 2 * 60_000;
export const ROUTINE_READER_MEETING_TIMEOUT_MS = 5 * 60_000;

export type ReaderRepairContract = RoutineSourceContract | ManualProductionSourceContract;

export function selectedReaderRepairContracts(
  contracts: readonly ReaderRepairContract[],
  tasks: readonly Pick<ReaderRepairContract, "recordClass" | "scope">[] | null,
): readonly ReaderRepairContract[] {
  if (tasks === null) return contracts;
  const pointers = new Set(tasks.map(task => `${task.recordClass}:${task.scope}`));
  return contracts.filter(contract => pointers.has(`${contract.recordClass}:${contract.scope}`));
}

export interface RoutineReaderRepairDomain {
  readonly id: string;
  readonly mode: "SINGLE" | "MEETING_AGGREGATE";
  readonly contracts: readonly ReaderRepairContract[];
  readonly timeoutMs: number;
}

export function routineReaderRepairDomains(
  contracts: readonly ReaderRepairContract[] = [
    ...observableRoutineContracts(),
    ...MANUAL_PRODUCTION_SOURCE_CONTRACTS,
  ],
): readonly RoutineReaderRepairDomain[] {
  const ids = contracts.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) throw new Error("ROUTINE_READER_CONTRACT_ID_DUPLICATE");
  const meetingIds = new Set(MEETING_PARTITION_CONTRACTS.map(({ id }) => id));
  const meetingContracts = contracts.filter((contract) => meetingIds.has(contract.id));
  const applicable = contracts.filter((contract) => contract.readerProjection !== null);
  const singles = applicable.filter((contract) => !meetingIds.has(contract.id));
  const domains: RoutineReaderRepairDomain[] = singles.map((contract) => ({
    id: `reader-readback:${contract.id}`,
    mode: "SINGLE",
    contracts: [contract],
    timeoutMs: ROUTINE_READER_SINGLE_TIMEOUT_MS,
  }));
  if (meetingContracts.length > 0) {
    domains.push({
      id: "reader-readback:meetings-aggregate",
      mode: "MEETING_AGGREGATE",
      contracts: meetingContracts,
      timeoutMs: ROUTINE_READER_MEETING_TIMEOUT_MS,
    });
  }
  const planned = domains.flatMap(({ contracts: rows }) => rows.map(({ id }) => id));
  if (new Set(planned).size !== planned.length || planned.some((id) => !ids.includes(id))) {
    throw new Error("ROUTINE_READER_DOMAIN_DENOMINATOR_INVALID");
  }
  return domains;
}

export interface RoutineReaderRepairRecord {
  readonly kind: "ROUTINE_READER_REPAIR";
  readonly contractId: string;
  readonly sourceId: string;
  readonly recordClass: ReaderRepairContract["recordClass"];
  readonly scope: string;
  readonly projectionId: string;
  readonly disposition: Exclude<ReaderReadbackRepairOutcome["kind"], "NOT_APPLICABLE"> | "REPAIR_FAILED";
  readonly receipt: ReaderProjectionReadbackReceipt | null;
  readonly error: string | null;
}

export function routineReaderRepairRecord(
  contract: ReaderRepairContract,
  result:
    | { readonly ok: true; readonly value: ReaderReadbackRepairOutcome }
    | { readonly ok: false; readonly error: string },
): RoutineReaderRepairRecord {
  if (contract.readerProjection === null) throw new Error(`ROUTINE_READER_REPAIR_NOT_APPLICABLE:${contract.id}`);
  if (!result.ok) {
    return {
      kind: "ROUTINE_READER_REPAIR",
      contractId: contract.id,
      sourceId: contract.sourceId,
      recordClass: contract.recordClass,
      scope: contract.scope,
      projectionId: contract.readerProjection.id,
      disposition: "REPAIR_FAILED",
      receipt: null,
      error: result.error || "Reader repair failed without a diagnostic.",
    };
  }
  if (result.value.kind === "NOT_APPLICABLE") {
    throw new Error(`ROUTINE_READER_REPAIR_RESULT_CONTRADICTS_CONTRACT:${contract.id}`);
  }
  return {
    kind: "ROUTINE_READER_REPAIR",
    contractId: contract.id,
    sourceId: contract.sourceId,
    recordClass: contract.recordClass,
    scope: contract.scope,
    projectionId: contract.readerProjection.id,
    disposition: result.value.kind,
    receipt: result.value.receipt,
    error: null,
  };
}

export function serializeRoutineReaderRepairRecord(record: RoutineReaderRepairRecord): string {
  return ROUTINE_READER_REPAIR_PREFIX + JSON.stringify(record);
}

export interface RoutineReaderRepairParseIssue {
  readonly code: "READER_REPAIR_JSON_INVALID" | "READER_REPAIR_SCHEMA_INVALID" | "READER_REPAIR_DUPLICATE";
  readonly detail: string;
}

export interface RoutineReaderRepairParse {
  readonly records: readonly RoutineReaderRepairRecord[];
  readonly issues: readonly RoutineReaderRepairParseIssue[];
  readonly missingContractIds: readonly string[];
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function validReceipt(
  value: unknown,
  expected: ReaderRepairContract,
): ReaderProjectionReadbackReceipt | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  let parsed: ReaderProjectionReadbackReceipt | null;
  try {
    parsed = parseReaderProjectionReadback(READER_PROJECTION_READBACK_PREFIX + JSON.stringify(value));
  } catch {
    return null;
  }
  return parsed &&
      parsed.contractId === expected.id &&
      parsed.sourceId === expected.sourceId &&
      parsed.recordClass === expected.recordClass &&
      parsed.scope === expected.scope &&
      parsed.projectionId === expected.readerProjection?.id
    ? parsed
    : null;
}

export function parseRoutineReaderRepairRecords(
  output: string,
  expectedContracts: readonly ReaderRepairContract[],
): RoutineReaderRepairParse {
  const expected = new Map(expectedContracts.map((contract) => [contract.id, contract]));
  if (expected.size !== expectedContracts.length || expectedContracts.some(({ readerProjection }) => readerProjection === null)) {
    throw new Error("ROUTINE_READER_REPAIR_EXPECTATION_INVALID");
  }
  const accepted = new Map<string, RoutineReaderRepairRecord>();
  const duplicated = new Set<string>();
  const issues: RoutineReaderRepairParseIssue[] = [];
  const lines = output.split(/\r?\n/).filter((line) => line.startsWith(ROUTINE_READER_REPAIR_PREFIX));
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(lines[lineIndex]!.slice(ROUTINE_READER_REPAIR_PREFIX.length));
    } catch {
      issues.push({
        code: "READER_REPAIR_JSON_INVALID",
        detail: `Reader repair line ${lineIndex} is not JSON.`,
      });
      continue;
    }
    const row = object(parsed);
    if (row === null) {
      issues.push({
        code: "READER_REPAIR_SCHEMA_INVALID",
        detail: `Reader repair line ${lineIndex} is not an object.`,
      });
      continue;
    }
    const contract = typeof row.contractId === "string" ? expected.get(row.contractId) : undefined;
    if (!contract || contract.readerProjection === null) {
      issues.push({
        code: "READER_REPAIR_SCHEMA_INVALID",
        detail: `Reader repair line ${lineIndex} does not name an expected contract.`,
      });
      continue;
    }
    const allowed = ["NO_PROMOTION", "CURRENT", "BACKOFF", "FAILED_BACKOFF", "RECORDED", "REPAIR_FAILED"];
    const receiptRequired = row.disposition === "CURRENT" || row.disposition === "FAILED_BACKOFF" || row.disposition === "RECORDED";
    const receipt = receiptRequired ? validReceipt(row.receipt, contract) : null;
    const valid = row.kind === "ROUTINE_READER_REPAIR" &&
      row.sourceId === contract.sourceId &&
      row.recordClass === contract.recordClass &&
      row.scope === contract.scope &&
      row.projectionId === contract.readerProjection.id &&
      typeof row.disposition === "string" && allowed.includes(row.disposition) &&
      (receiptRequired ? receipt !== null : row.receipt === null) &&
      (row.disposition === "CURRENT" ? receipt?.status === "PASS" : true) &&
      (row.disposition === "FAILED_BACKOFF" ? receipt?.status === "FAIL" : true) &&
      (row.disposition === "REPAIR_FAILED"
        ? typeof row.error === "string" && row.error.trim().length > 0
        : row.error === null);
    if (!valid) {
      issues.push({
        code: "READER_REPAIR_SCHEMA_INVALID",
        detail: `Reader repair line ${lineIndex} contradicts contract ${contract.id}.`,
      });
      continue;
    }
    if (accepted.has(contract.id) || duplicated.has(contract.id)) {
      accepted.delete(contract.id);
      duplicated.add(contract.id);
      issues.push({
        code: "READER_REPAIR_DUPLICATE",
        detail: `Reader repair contract ${contract.id} was emitted more than once.`,
      });
      continue;
    }
    accepted.set(contract.id, {
      kind: "ROUTINE_READER_REPAIR",
      contractId: contract.id,
      sourceId: contract.sourceId,
      recordClass: contract.recordClass,
      scope: contract.scope,
      projectionId: contract.readerProjection.id,
      disposition: row.disposition as RoutineReaderRepairRecord["disposition"],
      receipt,
      error: row.disposition === "REPAIR_FAILED" ? String(row.error) : null,
    });
  }
  return {
    records: [...accepted.values()],
    issues,
    missingContractIds: expectedContracts
      .map(({ id }) => id)
      .filter((id) => !accepted.has(id)),
  };
}

export interface RoutineReaderRepairSupervisorFailure {
  readonly taskId: string;
  readonly code: string;
  readonly detail: string;
}

export function reconcileRoutineReaderRepairDomain(
  domain: RoutineReaderRepairDomain,
  output: string,
  executionFailure: RoutineReaderRepairSupervisorFailure | null,
): {
  readonly references: readonly RoutineCivicDataReaderReadbackReference[];
  readonly failures: readonly RoutineReaderRepairSupervisorFailure[];
} {
  const parsed = parseRoutineReaderRepairRecords(output, domain.contracts);
  const records = new Map(parsed.records.map((record) => [record.contractId, record]));
  const failures: RoutineReaderRepairSupervisorFailure[] = [];
  if (executionFailure !== null) failures.push(executionFailure);
  failures.push(...parsed.issues.map((issue) => ({
    taskId: domain.id,
    code: issue.code,
    detail: issue.detail,
  })));
  const references = domain.contracts.map((contract): RoutineCivicDataReaderReadbackReference => {
    const record = records.get(contract.id);
    if (!record) {
      const detail = executionFailure?.detail ??
        `The ${domain.id} child did not emit one exact result for ${contract.id}.`;
      failures.push({
        taskId: `reader-readback:${contract.id}`,
        code: "READER_READBACK_REPAIR_FAILED",
        detail,
      });
      return {
        contractId: contract.id,
        sourceId: contract.sourceId,
        recordClass: contract.recordClass,
        scope: contract.scope,
        projectionId: contract.readerProjection?.id ?? null,
        disposition: "REPAIR_FAILED",
        receipt: null,
      };
    }
    if (record.disposition === "REPAIR_FAILED") {
      failures.push({
        taskId: `reader-readback:${contract.id}`,
        code: "READER_READBACK_REPAIR_FAILED",
        detail: record.error ?? "Reader repair failed without a diagnostic.",
      });
    }
    return {
      contractId: record.contractId,
      sourceId: record.sourceId,
      recordClass: record.recordClass,
      scope: record.scope,
      projectionId: record.projectionId,
      disposition: record.disposition,
      receipt: record.receipt,
    };
  });
  return { references, failures };
}
