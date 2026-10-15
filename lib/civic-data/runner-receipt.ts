import { isScopedManualContractScope } from "./scoped-manual-contracts.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "./manual-contracts.ts";
import { CANDIDATE_STATES, type CandidateDecision, type CandidateState } from "./types.ts";
import { ZERO_RELEASE_EVENTS, type ZeroReleaseEvents } from "./release.ts";
import { canonicalCivicDataJson } from "./changes.ts";
import { readPromotedCivicData, type CivicDataReadStore } from "./read-model.ts";
import { parseValidationReceipt } from "./receipt.ts";
import type { RoutineRecordClass } from "./types.ts";
import type { RoutineDataStore } from "./store.ts";
import type { PromotionOutcome } from "./promotion.ts";
import type { RoutineSourceContract } from "./contracts.ts";
import { sanitizedErrorDiagnostic } from "../ops/error-diagnostic.ts";

export type DurableReceiptStore = CivicDataReadStore & Pick<RoutineDataStore, "readCandidateSummary" | "readPromotionIdentity">;

export interface RoutineRunnerReceipt {
  readonly source: string;
  readonly candidateId: string;
  readonly acquisitionSucceeded: boolean;
  readonly state: CandidateState;
  readonly decision: CandidateDecision | null;
  readonly promotedVersion: string | null;
  readonly lastKnownGoodVersion: string | null;
  readonly structuralReleaseContract: ZeroReleaseEvents;
    /** Set when the child confirmed the pointed version unchanged: `candidateId` then names the pointed version. */
  readonly confirmedAt?: string;
}

export function routineReceiptFields(
  candidate: { readonly id: string },
  outcome: PromotionOutcome,
): Omit<RoutineRunnerReceipt, "source" | "structuralReleaseContract"> {
  return {
    candidateId: outcome.confirmed ? outcome.candidate.candidate.id : candidate.id,
    acquisitionSucceeded: outcome.candidate.acquisitionSucceeded,
    state: outcome.candidate.state,
    decision: outcome.candidate.receipt?.decision ?? null,
    promotedVersion: outcome.promoted?.versionId ?? null,
    lastKnownGoodVersion: outcome.candidate.lastKnownGoodVersion,
    ...(outcome.confirmed ? { confirmedAt: outcome.confirmed.at } : {}),
  };
}

export function printSourceRunnerReceipt(source: string, candidate: { readonly id: string }, outcome: PromotionOutcome): void {
  console.log("RCD_RECEIPT=" + JSON.stringify({ source, ...routineReceiptFields(candidate, outcome), structuralReleaseContract: ZERO_RELEASE_EVENTS }));
}

export const ROUTINE_DURABLE_RECEIPT_MAX_REQUESTS = 4;

export type RoutineRunnerReceiptParseCode =
  | "RECEIPT_COUNT_INVALID"
  | "RECEIPT_JSON_INVALID"
  | "RECEIPT_SCHEMA_INVALID";

export type RoutineRunnerReceiptParse =
  | { readonly ok: true; readonly receipt: RoutineRunnerReceipt; readonly line: string }
  | { readonly ok: false; readonly code: RoutineRunnerReceiptParseCode; readonly detail: string };

export type RoutineRunnerReceiptBatchParse =
  | { readonly ok: true; readonly receipts: readonly RoutineRunnerReceipt[]; readonly lines: readonly string[] }
  | { readonly ok: false; readonly code: RoutineRunnerReceiptParseCode; readonly detail: string };

export type RoutineChildOutcome =
  | {
      readonly kind: "VERIFIED_SOURCE_SUCCESS";
      readonly state: CandidateState;
      readonly receipt: RoutineRunnerReceipt;
    }
  | {
      readonly kind: "VERIFIED_SOURCE_FAILURE";
      readonly state: CandidateState;
      readonly receipt: RoutineRunnerReceipt;
      readonly detail: string;
    }
  | {
      readonly kind: "SUPERVISOR_FAILURE";
      readonly state: "CANNOT_TELL";
      readonly code: "DURABLE_RECEIPT_INVALID" | RoutineRunnerReceiptParseCode;
      readonly detail: string;
    };

export interface RoutineSupervisorOuterEvidence {
  readonly attemptedTasks: number;
  readonly verifiedSourceSuccesses: number;
  readonly verifiedSourceFailures: number;
  readonly code: string;
  readonly detail: string;
}

export function routineSupervisorOuterEvidence(input: {
  readonly output: string;
  readonly termination: string;
  readonly exitStatus: number | null;
}): RoutineSupervisorOuterEvidence {
  const lines = input.output.split(/\r?\n/);
  const launchCounts = lines.flatMap((line) => {
    const match = /^RCD_PASS launching (\d+) isolated command\(s\) through a bounded pool;/.exec(line);
    if (!match) return [];
    const count = Number(match[1]);
    return Number.isSafeInteger(count) && count >= 0 ? [count] : [];
  });
  const successes = new Set(lines.flatMap((line) => {
    const match = /^RCD_TASK (.+): GOOD \(/.exec(line);
    return match ? [match[1]!] : [];
  }));
  const failures = new Set(lines.flatMap((line) => {
    const match = /^RCD_TASK (.+): SOURCE_HELD_LKG \(/.exec(line);
    return match ? [match[1]!] : [];
  }));
  const contradictory = [...successes].filter((id) => failures.has(id));
  for (const id of contradictory) {
    successes.delete(id);
    failures.delete(id);
  }
  const catchUpLaunched = lines.reduce((sum, line) => {
    const match = /^RCD_PASS catch-up at \S+: launching (\d+) due meeting read\(s\)/.exec(line);
    const count = match ? Number(match[1]) : 0;
    return sum + (Number.isSafeInteger(count) && count >= 0 ? count : 0);
  }, 0);
  const distinctLaunchCounts = [...new Set(launchCounts)];
  const attemptedTasks = distinctLaunchCounts.length === 1
    ? distinctLaunchCounts[0]! + catchUpLaunched
    : successes.size + failures.size;
  const exit = input.exitStatus === null ? "unavailable" : String(input.exitStatus);
  return {
    attemptedTasks,
    verifiedSourceSuccesses: successes.size,
    verifiedSourceFailures: failures.size,
    code: `ROUTINE_CHILD_${input.termination.replace(/[^A-Za-z0-9_]+/g, "_").toUpperCase()}`,
    detail:
      `The bounded routine child terminated=${input.termination}; exit=${exit}; ` +
      `launch plan=${distinctLaunchCounts.length === 1 ? attemptedTasks : "not exactly recorded"}; ` +
      `parent-observed durable source summaries=${successes.size} GOOD/${failures.size} HELD` +
      `${contradictory.length > 0 ? `; ${contradictory.length} contradictory task summary line(s) were not attributed` : ""}. ` +
      "No source candidate, pointer, or LKG disposition was inferred by the parent.",
  };
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nullableText(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length > 0);
}

function exactSevenZero(value: unknown): value is ZeroReleaseEvents {
  const row = object(value);
  const expected = Object.entries(ZERO_RELEASE_EVENTS);
  return row !== null &&
    Object.keys(row).length === expected.length &&
    expected.every(([key, zero]) => row[key] === zero);
}

/** Exactly one line may represent a child outcome; its JSON is untrusted. */
export function parseRoutineRunnerReceipt(output: string): RoutineRunnerReceiptParse {
  const lines = output.split(/\r?\n/).filter((line) => line.startsWith("RCD_RECEIPT="));
  if (lines.length !== 1) {
    return {
      ok: false,
      code: "RECEIPT_COUNT_INVALID",
      detail: `Expected exactly one RCD_RECEIPT line; observed ${lines.length}.`,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(lines[0].slice("RCD_RECEIPT=".length));
  } catch {
    return { ok: false, code: "RECEIPT_JSON_INVALID", detail: "The RCD_RECEIPT payload is not JSON." };
  }
  const row = object(parsed);
  if (
    row === null ||
    typeof row.source !== "string" || row.source.length === 0 ||
    typeof row.candidateId !== "string" || row.candidateId.length === 0 ||
    typeof row.acquisitionSucceeded !== "boolean" ||
    typeof row.state !== "string" || !(CANDIDATE_STATES as readonly string[]).includes(row.state) ||
    !(row.decision === null || ["GOOD", "FAIL", "CANNOT_TELL"].includes(String(row.decision))) ||
    !nullableText(row.promotedVersion) ||
    !nullableText(row.lastKnownGoodVersion) ||
    !exactSevenZero(row.structuralReleaseContract) ||
    !(row.confirmedAt === undefined || (typeof row.confirmedAt === "string" && Number.isFinite(Date.parse(row.confirmedAt))))
  ) {
    return { ok: false, code: "RECEIPT_SCHEMA_INVALID", detail: "The RCD_RECEIPT payload does not satisfy the durable runner receipt contract." };
  }
  return { ok: true, receipt: row as unknown as RoutineRunnerReceipt, line: lines[0] };
}

export function parseMeetingPartitionRunnerReceipts(output: string): RoutineRunnerReceiptBatchParse {
  const lines = output.split(/\r?\n/).filter((line) => line.startsWith("RCD_MEETING_PARTITION_RECEIPT="));
  if (lines.length === 0) {
    return { ok: false, code: "RECEIPT_COUNT_INVALID", detail: "Expected at least one RCD_MEETING_PARTITION_RECEIPT line; observed 0." };
  }
  const receipts: RoutineRunnerReceipt[] = [];
  for (const line of lines) {
    const parsed = parseRoutineRunnerReceipt(`RCD_RECEIPT=${line.slice("RCD_MEETING_PARTITION_RECEIPT=".length)}`);
    if (!parsed.ok) return parsed;
    receipts.push(parsed.receipt);
  }
  if (new Set(receipts.map((receipt) => receipt.source)).size !== receipts.length) {
    return { ok: false, code: "RECEIPT_SCHEMA_INVALID", detail: "Meeting partition receipts contain a duplicate source/partition id." };
  }
  return { ok: true, receipts, lines };
}

export function classifyRoutineChildOutcome(input: {
  readonly parsed: RoutineRunnerReceiptParse;
  readonly durableIssue: string | null;
  readonly exitStatus: number | null;
  readonly childDiagnostic: string | null;
}): RoutineChildOutcome {
  if (input.parsed.ok && input.durableIssue === null) {
    if (successfulRoutineRunnerReceiptIssue(input.parsed.receipt) === null) {
      return {
        kind: "VERIFIED_SOURCE_SUCCESS",
        state: input.parsed.receipt.state,
        receipt: input.parsed.receipt,
      };
    }
    return {
      kind: "VERIFIED_SOURCE_FAILURE",
      state: input.parsed.receipt.state,
      receipt: input.parsed.receipt,
      detail: input.childDiagnostic ??
        `The source-aware child durably recorded a held outcome (process exit ${input.exitStatus ?? "unavailable"}).`,
    };
  }

  const receiptCode = input.parsed.ok ? "DURABLE_RECEIPT_INVALID" : input.parsed.code;
  const receiptDetail = input.parsed.ok
    ? `The emitted receipt did not match durable source state (${input.durableIssue ?? "unspecified mismatch"}).`
    : `${input.parsed.code}: ${input.parsed.detail}`;
  const processDetail = input.childDiagnostic === null ? "" : ` Child process: ${input.childDiagnostic}`;
  return {
    kind: "SUPERVISOR_FAILURE",
    state: "CANNOT_TELL",
    code: receiptCode,
    detail: `${receiptDetail}${processDetail}`,
  };
}

export function successfulRoutineRunnerReceiptIssue(receipt: RoutineRunnerReceipt): string | null {
  if (!receipt.acquisitionSucceeded) return "the child did not prove successful acquisition";
  if (receipt.state !== "PROMOTED") return `the child reported terminal state ${receipt.state}, not PROMOTED`;
  if (receipt.decision !== "GOOD") return `the child reported decision ${receipt.decision ?? "null"}, not GOOD`;
  if (receipt.promotedVersion !== receipt.candidateId) return "the promoted version does not equal the reported candidate";
  if (receipt.lastKnownGoodVersion !== receipt.candidateId) return "the last-known-good version does not equal the reported candidate";
  return null;
}

export interface ExpectedRoutineRunnerReceipt {
  readonly id: string;
  readonly registeredContractId?: string;
  readonly sourceId: string;
  readonly recordClass: RoutineRecordClass;
  readonly scope: string;
  readonly contract?: Pick<RoutineSourceContract, "readerProjection">;
}

function readerRepairReprovesVersion(expected: ExpectedRoutineRunnerReceipt): boolean {
  return expected.contract !== undefined && expected.contract.readerProjection !== null;
}

/**
 * The pointer is proved by identity: the database refuses any pointer write whose payload or receipt is not that
 * candidate's, so a pointer naming the proved candidate carries exactly its payload and receipt. A contract without a
 * Reader projection is still re-read through the full proven read, its only whole proof.
 */
export async function durableRoutineRunnerReceiptIssue(
  receipt: RoutineRunnerReceipt,
  expected: ExpectedRoutineRunnerReceipt,
  store: DurableReceiptStore,
  expectedOutcome: "SUCCESS" | "HELD",
): Promise<string | null> {
  try {
    if (receipt.source !== expected.id && receipt.source !== expected.registeredContractId) {
      return `receipt source ${receipt.source} does not match registered task ${expected.id}`;
    }
    if (expectedOutcome === "HELD" && (receipt.state === "PROMOTED" || receipt.decision === "GOOD" || receipt.promotedVersion !== null)) {
      return "a nonzero child claimed a successful promotion instead of a held outcome";
    }
    const candidate = await store.readCandidateSummary(receipt.candidateId);
    if (candidate === null) return `candidate ${receipt.candidateId} is not durable`;
    const contract = MANUAL_PRODUCTION_SOURCE_CONTRACTS.find(contract => contract.id === expected.registeredContractId);
    const scope = contract?.scope === expected.scope && isScopedManualContractScope(contract.id, candidate.candidate.scope)
      ? candidate.candidate.scope : expected.scope;
    if (
      candidate.candidate.id !== receipt.candidateId ||
      candidate.candidate.sourceId !== expected.sourceId ||
      candidate.candidate.recordClass !== expected.recordClass ||
      candidate.candidate.scope !== scope
    ) return "the durable candidate does not match the registered task identity";
    if (
      candidate.state !== receipt.state ||
      candidate.acquisitionSucceeded !== receipt.acquisitionSucceeded ||
      candidate.promotedVersion !== receipt.promotedVersion ||
      candidate.lastKnownGoodVersion !== receipt.lastKnownGoodVersion
    ) return "the emitted state/version summary differs from the durable candidate";
    const durableReceipt = parseValidationReceipt(candidate.receipt);
    if (
      !durableReceipt ||
      durableReceipt.candidateId !== receipt.candidateId ||
      durableReceipt.sourceId !== expected.sourceId ||
      durableReceipt.recordClass !== expected.recordClass ||
      durableReceipt.scope !== scope ||
      durableReceipt.decision !== receipt.decision
    ) return "the emitted decision is not backed by the candidate's durable eight-check receipt";

    if (expectedOutcome === "SUCCESS") {
      const summaryIssue = successfulRoutineRunnerReceiptIssue(receipt);
      if (summaryIssue) return summaryIssue;
      if (receipt.confirmedAt !== undefined) {
                // The database admits a confirmation only for the pointed version and its read-model hash, so no re-read.
        const pointer = await store.readPromotionIdentity(expected.recordClass, scope);
        if (
          pointer === null ||
          pointer.versionId !== receipt.candidateId ||
          pointer.lastKnownGoodVersionId !== receipt.candidateId ||
          pointer.sourceId !== expected.sourceId ||
          pointer.latestConfirmation?.versionId !== receipt.candidateId ||
          pointer.latestConfirmation.observedAt !== receipt.confirmedAt
        ) return `canonical ${expected.recordClass}:${scope} does not carry the reported confirmation of ${receipt.candidateId}`;
        return null;
      }
      if (!readerRepairReprovesVersion(expected)) {
        const readback = await readPromotedCivicData(expected.recordClass, scope, { store, bypassCache: true });
        if (
          readback.kind !== "PROMOTED" ||
          readback.metadata.versionId !== receipt.candidateId ||
          readback.metadata.sourceId !== expected.sourceId ||
          canonicalCivicDataJson(readback.projection.receipt) !== canonicalCivicDataJson(durableReceipt)
        ) return `canonical ${expected.recordClass}:${scope} does not prove the reported GOOD candidate`;
        return null;
      }
            // Keeps its durable outcome even when another child publishes a newer version before settlement.
      const pointer = await store.readPromotionIdentity(expected.recordClass, scope);
      if (
        pointer === null ||
        pointer.recordClass !== expected.recordClass ||
        pointer.scope !== scope ||
        pointer.lastKnownGoodVersionId !== pointer.versionId ||
        pointer.sourceId !== expected.sourceId
      ) return `canonical ${expected.recordClass}:${scope} does not carry a valid current LKG identity`;
      return null;
    }

    const pointer = await store.readPromotionIdentity(expected.recordClass, scope);
    if (receipt.lastKnownGoodVersion === null) {
      return pointer === null ? null : "the held receipt omitted the canonical last-known-good pointer";
    }
    if (
      pointer === null ||
      pointer.recordClass !== expected.recordClass ||
      pointer.scope !== scope ||
      pointer.versionId !== receipt.lastKnownGoodVersion ||
      pointer.lastKnownGoodVersionId !== pointer.versionId ||
      pointer.sourceId !== expected.sourceId ||
      pointer.versionId === receipt.candidateId
    ) return "the held receipt does not match an unchanged, proof-valid canonical LKG pointer";
    return null;
  } catch (error) {
    return `durable receipt readback failed: ${sanitizedErrorDiagnostic(error)}`;
  }
}
