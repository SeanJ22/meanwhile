import { CANDIDATE_STATES, type CandidateDecision, type CandidateState } from "./types.ts";
import { ZERO_RELEASE_EVENTS, type ZeroReleaseEvents } from "./release.ts";
import { canonicalCivicDataJson } from "./changes.ts";
import { readPromotedCivicData, type CivicDataReadStore } from "./read-model.ts";
import { parseValidationReceipt } from "./receipt.ts";
import type { RoutineRecordClass } from "./types.ts";

export interface RoutineRunnerReceipt {
  readonly source: string;
  readonly candidateId: string;
  readonly acquisitionSucceeded: boolean;
  readonly state: CandidateState;
  readonly decision: CandidateDecision | null;
  readonly promotedVersion: string | null;
  readonly lastKnownGoodVersion: string | null;
  readonly structuralReleaseContract: ZeroReleaseEvents;
}

/** Candidate plus canonical pointer/LKG proof needs at most four Neon requests. */
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

/**
 * Build a credential-free operational account from protocol lines already
 * classified by the routine child. This is used only when that child exits
 * nonzero: it never attributes a source disposition and never consumes raw
 * stderr, URLs, environment values, or publisher payloads.
 */
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
  const distinctLaunchCounts = [...new Set(launchCounts)];
  const attemptedTasks = distinctLaunchCounts.length === 1
    ? distinctLaunchCounts[0]!
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
    !exactSevenZero(row.structuralReleaseContract)
  ) {
    return { ok: false, code: "RECEIPT_SCHEMA_INVALID", detail: "The RCD_RECEIPT payload does not satisfy the durable runner receipt contract." };
  }
  return { ok: true, receipt: row as unknown as RoutineRunnerReceipt, line: lines[0] };
}

/** Parse the independently durable receipts emitted by the meetings fan-out. */
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

/**
 * Attribute an outcome only after the child's receipt agrees with durable
 * source state. Missing, malformed, or contradictory evidence is a supervisor
 * failure; it is never permission for the parent process to invent a source
 * attempt or candidate disposition. Process termination is orthogonal once
 * that proof exists: callers record a timeout/exit contradiction separately,
 * without erasing the already-durable source disposition.
 */
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
  readonly sourceId: string;
  readonly recordClass: RoutineRecordClass;
  readonly scope: string;
}

/** Prove a child summary against its durable candidate and canonical LKG. */
export async function durableRoutineRunnerReceiptIssue(
  receipt: RoutineRunnerReceipt,
  expected: ExpectedRoutineRunnerReceipt,
  store: CivicDataReadStore,
  expectedOutcome: "SUCCESS" | "HELD",
): Promise<string | null> {
  try {
    if (receipt.source !== expected.id) {
      return `receipt source ${receipt.source} does not match registered task ${expected.id}`;
    }
    if (expectedOutcome === "HELD" && (receipt.state === "PROMOTED" || receipt.decision === "GOOD" || receipt.promotedVersion !== null)) {
      return "a nonzero child claimed a successful promotion instead of a held outcome";
    }
    const candidate = await store.readCandidate(receipt.candidateId);
    if (candidate === null) return `candidate ${receipt.candidateId} is not durable`;
    if (
      candidate.candidate.id !== receipt.candidateId ||
      candidate.candidate.sourceId !== expected.sourceId ||
      candidate.candidate.recordClass !== expected.recordClass ||
      candidate.candidate.scope !== expected.scope
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
      durableReceipt.scope !== expected.scope ||
      durableReceipt.decision !== receipt.decision
    ) return "the emitted decision is not backed by the candidate's durable eight-check receipt";

    if (expectedOutcome === "SUCCESS") {
      const summaryIssue = successfulRoutineRunnerReceiptIssue(receipt);
      if (summaryIssue) return summaryIssue;
      const readback = await readPromotedCivicData(expected.recordClass, expected.scope, { store, bypassCache: true });
      if (
        readback.kind !== "PROMOTED" ||
        readback.metadata.versionId !== receipt.candidateId ||
        readback.metadata.sourceId !== expected.sourceId ||
        canonicalCivicDataJson(readback.projection.receipt) !== canonicalCivicDataJson(durableReceipt)
      ) return `canonical ${expected.recordClass}:${expected.scope} does not prove the reported GOOD candidate`;
      return null;
    }

    const pointer = await store.readPromotion(expected.recordClass, expected.scope);
    if (receipt.lastKnownGoodVersion === null) {
      return pointer === null ? null : "the held receipt omitted the canonical last-known-good pointer";
    }
    const lkg = await readPromotedCivicData(expected.recordClass, expected.scope, { store, bypassCache: true });
    if (
      lkg.kind !== "PROMOTED" ||
      lkg.metadata.versionId !== receipt.lastKnownGoodVersion ||
      lkg.metadata.sourceId !== expected.sourceId ||
      lkg.metadata.versionId === receipt.candidateId
    ) return "the held receipt does not match an unchanged, proof-valid canonical LKG pointer";
    return null;
  } catch (error) {
    return `durable receipt readback failed (${error instanceof Error ? error.name : "unknown error"})`;
  }
}
