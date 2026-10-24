import { createHash } from "node:crypto";
import type { RoutineDataStore } from "./store.ts";
import type { RoutineSourceContract } from "./contracts.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS, type ManualProductionSourceContract } from "./manual-contracts.ts";
import { MEETING_PARTITION_CONTRACTS, meetingPartitionOfId, observableRoutineContracts, type MeetingPartitionContract } from "./meeting-partitions.ts";
import {
  READER_PROJECTION_READBACK_PREFIX,
  parseReaderProjectionReadback,
  type ReaderProjectionReadbackReceipt,
} from "./reader-readback.ts";
import type { ReaderReadbackRepairOutcome } from "./reader-verification.ts";
import type { RoutineCivicDataReaderReadbackReference } from "../control-plane/owner-surface.ts";
import { statesForRegistryDivisions } from "./state-scopes.ts";
import { DOOR_OUTCOMES_SOURCE_ID, DOOR_MINUTES_OUTCOMES_SOURCE_ID, OUTCOME_PARTITION_CONTRACTS, installOutcomePartitions, outcomePartitionId,
  type OutcomePartitionContract } from "./outcome-partitions.ts";
import { outcomePartitionScope } from "../outcomes/door-outcome-pointers.ts";

export const ROUTINE_READER_REPAIR_PREFIX = "RCD_READER_REPAIR=";
export const ROUTINE_READER_CHILD_CONCURRENCY = 4;
export const ROUTINE_READER_SINGLE_TIMEOUT_MS = 2 * 60_000;
export const ROUTINE_READER_MEETING_TIMEOUT_MS = 5 * 60_000;
/** Bound a domain's query and output size; every domain gets its own killable child. */
export const ROUTINE_READER_MEETING_BATCH_SIZE = 256;
export const ROUTINE_READER_CONTRACT_BATCH_SIZE = 32;

export type ReaderRepairContract = RoutineSourceContract | ManualProductionSourceContract;

/** Dynamic outcome contracts must travel with the pass that selected them, just like calendar partitions. */
export function readerRepairContractHandoff(contracts: readonly ReaderRepairContract[]): readonly (string | OutcomePartitionContract)[] {
  const outcomes = new Map(OUTCOME_PARTITION_CONTRACTS.map(contract => [contract.id, contract]));
  return contracts.map(contract => outcomes.get(contract.id) ?? contract.id);
}

export function installOutcomeRepairSelection(contracts: readonly OutcomePartitionContract[]): void {
  const ids = new Set<string>(), scopes = new Set<string>();
  for (const contract of contracts) {
    const identity = contract && typeof contract.doorId === "string" ? meetingPartitionOfId(contract.doorId) : null;
    const source = contract?.kind === "legistar" ? DOOR_OUTCOMES_SOURCE_ID : contract?.kind === "legistar-insite" ? DOOR_MINUTES_OUTCOMES_SOURCE_ID : null;
    if (!identity || source === null || identity.source !== contract.kind || identity.bodyId !== contract.bodyId ||
        contract.id !== outcomePartitionId(contract.doorId) || contract.scope !== outcomePartitionScope(contract.doorId) ||
        contract.recordClass !== "MEETING_OUTCOME" || contract.sourceId !== source ||
        contract.wiring?.bodyId !== contract.bodyId || contract.tenant?.contractId !== contract.id ||
        contract.tenant.scope !== contract.scope || contract.tenant.sourceId !== source || contract.tenant.recordClass !== "MEETING_OUTCOME" ||
        !/^[a-z0-9-]+$/.test(contract.tenant.slug) || contract.readerProjection?.id !== `door-outcomes:${contract.doorId}` ||
        ids.has(contract.id) || scopes.has(contract.scope)) throw new Error("READER_REPAIR_OUTCOME_SELECTION_INVALID");
    ids.add(contract.id); scopes.add(contract.scope);
  }
  installOutcomePartitions(contracts);
}

/** The state roster and ballot publishers also update their own state's holder/candidacy join. */
function readerRepairSourcePointers(tasks: readonly Pick<ReaderRepairContract, "recordClass" | "scope">[]): ReadonlySet<string> {
  const pointers = new Set(tasks.map(task => `${task.recordClass}:${task.scope}`));
  for (const task of tasks) {
    if (task.recordClass !== "STATE_LEGISLATOR" && task.recordClass !== "BALLOT_CANDIDACY") continue;
    for (const state of statesForRegistryDivisions([task.scope])) pointers.add(`REGISTRY_RUNTIME_BINDING:US-${state}:reader-registry-runtime`);
  }
  return pointers;
}

/** Isolated calendar and repair children use the parent's exact selection even when the published registry changes. */
export function installMeetingPartitionSelection(contracts: readonly MeetingPartitionContract[]): void {
  if (contracts.length === 0) throw new Error("READER_REPAIR_MEETING_SELECTION_INVALID");
  const ids = new Set<string>(), scopes = new Set<string>();
  for (const contract of contracts) {
    const identity = contract && typeof contract.id === "string" ? meetingPartitionOfId(contract.id) : null;
    if (!identity || contract.recordClass !== "MEETING" || contract.sourceId !== (identity.source === "derived" ? "meetings-derived-routes" : "meetings-public-bodies") ||
        identity.source !== contract.meetingSource || identity.bodyId !== contract.bodyId || identity.scope !== contract.scope ||
        !contract.readerProjection?.id || ids.has(contract.id) || scopes.has(contract.scope) ||
        (contract.wiring !== null && (contract.wiring?.bodyId !== contract.bodyId || contract.wiring?.ocdId !== contract.ocdId))) {
      throw new Error("READER_REPAIR_MEETING_SELECTION_INVALID");
    }
    ids.add(contract.id); scopes.add(contract.scope);
  }
  MEETING_PARTITION_CONTRACTS.splice(0, MEETING_PARTITION_CONTRACTS.length, ...contracts);
}

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

/** Unchanged pointers can be repaired immediately. A source and its dependent registry join settle first. */
export function readerRepairDomainPhases(domains: readonly RoutineReaderRepairDomain[],
  sources: readonly Pick<ReaderRepairContract, "recordClass" | "scope">[]) {
  const pointers = readerRepairSourcePointers(sources);
  const early: RoutineReaderRepairDomain[] = [], late: RoutineReaderRepairDomain[] = [];
  for (const domain of domains) {
    const after = domain.contracts.filter(contract => pointers.has(`${contract.recordClass}:${contract.scope}`));
    const before = domain.contracts.filter(contract => !pointers.has(`${contract.recordClass}:${contract.scope}`));
    if (before.length) early.push({ ...domain, contracts: before, id: after.length ? `${domain.id}:before-sources` : domain.id });
    if (after.length) late.push({ ...domain, contracts: after, id: before.length ? `${domain.id}:after-sources` : domain.id });
  }
  return { early, late };
}

export function routineReaderRepairDomains(
  contracts: readonly ReaderRepairContract[] = [
    ...observableRoutineContracts(),
    ...MANUAL_PRODUCTION_SOURCE_CONTRACTS,
  ],
): readonly RoutineReaderRepairDomain[] {
  return batchReaderRepairContracts(contracts, new Map(MEETING_PARTITION_CONTRACTS.map(contract => [contract.id, contract])));
}

/** The selected calendar objects remain authoritative even when the registry changes during a source phase. */
function batchReaderRepairContracts(contracts: readonly ReaderRepairContract[],
  partitions: ReadonlyMap<string, MeetingPartitionContract>): readonly RoutineReaderRepairDomain[] {
  const ids = contracts.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) throw new Error("ROUTINE_READER_CONTRACT_ID_DUPLICATE");
  const meetingIds = new Set(partitions.keys());
  const meetingContracts = contracts.filter((contract) => meetingIds.has(contract.id));
  const applicable = contracts.filter((contract) => contract.readerProjection !== null);
  const singles = applicable.filter((contract) => !meetingIds.has(contract.id));
  const domains: RoutineReaderRepairDomain[] = [];
  const outcomes = new Map(OUTCOME_PARTITION_CONTRACTS.map(contract => [contract.id, contract]));
  const singlesByState = new Map<string, ReaderRepairContract[]>();
  for (const contract of singles) {
    const outcome = outcomes.get(contract.id);
    const states = outcome?.recordClass === contract.recordClass && outcome.scope === contract.scope
      ? statesForRegistryDivisions([outcome.tenant.jurisdiction, outcome.wiring.ocdId ?? "", outcome.bodyId])
      : statesForRegistryDivisions([contract.scope]);
    const national = states.length === 0 &&
      (/^US(?::|$)/.test(contract.scope) || /^[a-z0-9-]+:national$/.test(contract.scope)) &&
      !/(?:^|:)\d{5}(?::|$)/.test(contract.scope) && !/^national-place:\d{5}/.test(contract.id);
    // Explicit national programs share startup too. ZIPs and ambiguous state scopes stay isolated.
    const key = states.length === 1 ? states[0]! : national ? "US" : `unscoped:${contract.id}`;
    const selected = singlesByState.get(key) ?? [];
    selected.push(contract); singlesByState.set(key, selected);
  }
  for (const [state, selected] of singlesByState) {
    for (let at = 0; at < selected.length; at += ROUTINE_READER_CONTRACT_BATCH_SIZE) {
      const batch = selected.slice(at, at + ROUTINE_READER_CONTRACT_BATCH_SIZE);
      domains.push({ id: batch.length === 1 ? `reader-readback:${batch[0]!.id}` : `reader-readback:contracts:${state}:${at / ROUTINE_READER_CONTRACT_BATCH_SIZE}`,
        mode: "SINGLE", contracts: batch, timeoutMs: ROUTINE_READER_SINGLE_TIMEOUT_MS });
    }
  }
  const meetingsByState = new Map<string, ReaderRepairContract[]>();
  for (const contract of meetingContracts) {
    const partition = partitions.get(contract.id)!;
    const states = statesForRegistryDivisions([partition.derivedFamily ?? "", partition.ocdId ?? "", partition.bodyId]);
    // An ambiguous board keeps its own child; it never brings another state's payload into that child.
    const state = states.length === 1 ? states[0]! : `unscoped:${contract.id}`;
    const selected = meetingsByState.get(state) ?? [];
    selected.push(contract); meetingsByState.set(state, selected);
  }
  for (const [state, selected] of meetingsByState) {
    for (let at = 0; at < selected.length; at += ROUTINE_READER_MEETING_BATCH_SIZE) {
      domains.push({
        id: `reader-readback:meetings-aggregate:${state}:${at / ROUTINE_READER_MEETING_BATCH_SIZE}`,
        mode: "MEETING_AGGREGATE",
        contracts: selected.slice(at, at + ROUTINE_READER_MEETING_BATCH_SIZE),
        timeoutMs: ROUTINE_READER_MEETING_TIMEOUT_MS,
      });
    }
  }
  const planned = domains.flatMap(({ contracts: rows }) => rows.map(({ id }) => id));
  if (new Set(planned).size !== planned.length || planned.some((id) => !ids.includes(id))) {
    throw new Error("ROUTINE_READER_DOMAIN_DENOMINATOR_INVALID");
  }
  return domains;
}

/** No source publication means there is no payload to decode in a child. Inspect those identities in bulk
 * after the phase's sources settle; a failed or malformed read leaves the full selection for the child. */
export async function planRoutineReaderRepair(
  store: Pick<RoutineDataStore, "readPromotionIdentities">,
  domains: readonly RoutineReaderRepairDomain[],
): Promise<{ readonly domains: readonly RoutineReaderRepairDomain[]; readonly noPromotion: readonly RoutineCivicDataReaderReadbackReference[] }> {
  const contracts = domains.flatMap(domain => domain.contracts);
  if (new Set(contracts.map(contract => contract.id)).size !== contracts.length) throw new Error("ROUTINE_READER_CONTRACT_ID_DUPLICATE");
  const groups = new Map<ReaderRepairContract["recordClass"], Set<string>>();
  for (const contract of contracts) {
    const scopes = groups.get(contract.recordClass) ?? new Set<string>();
    scopes.add(contract.scope); groups.set(contract.recordClass, scopes);
  }
  const absent = new Set<string>();
  for (const [recordClass, scopes] of groups) {
    try {
      const rows = await store.readPromotionIdentities(recordClass, [...scopes]);
      if (rows.some(row => row.recordClass !== recordClass || !scopes.has(row.scope) || row.key !== `${recordClass}:${row.scope}`) ||
        new Set(rows.map(row => row.key)).size !== rows.length) continue;
      const held = new Set(rows.map(row => row.scope));
      for (const scope of scopes) if (!held.has(scope)) absent.add(`${recordClass}:${scope}`);
    } catch { /* The child retains the exact contract and produces its own diagnostic; an outage is never absence. */ }
  }
  const noPromotion = contracts.filter(contract => absent.has(`${contract.recordClass}:${contract.scope}`)).map(contract => ({
    contractId: contract.id, sourceId: contract.sourceId, recordClass: contract.recordClass, scope: contract.scope,
    projectionId: contract.readerProjection!.id, disposition: "NO_PROMOTION" as const, receipt: null,
  }));
  if (noPromotion.length === 0) return { noPromotion, domains };
  const selected = contracts.filter(contract => !absent.has(`${contract.recordClass}:${contract.scope}`));
  const original = new Map(domains.flatMap(domain => domain.contracts.map(contract => [contract.id, domain] as const)));
  const partitions = new Map(domains.filter(domain => domain.mode === "MEETING_AGGREGATE")
    .flatMap(domain => domain.contracts.map(contract => [contract.id, contract as MeetingPartitionContract] as const)));
  // Removing missing pointers leaves sparse children. Repack the remaining exact selection within the same
  // state, mode and batch bounds; source phases remain separate because each invocation has its own selection.
  return { noPromotion, domains: batchReaderRepairContracts(selected, partitions).map(domain => ({
    ...domain,
    id: `reader-readback:inventory:${domain.mode}:${createHash("sha256").update(JSON.stringify(domain.contracts.map(contract => contract.id))).digest("hex")}`,
    timeoutMs: Math.min(...domain.contracts.map(contract => original.get(contract.id)!.timeoutMs)),
  })) };
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
