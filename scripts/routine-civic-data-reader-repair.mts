/**
 * Killable Reader-delivery evidence boundary for the standing data plane.
 * This process never acquires a publisher, creates a source candidate, moves a
 * pointer, or changes LKG. It only reads canonical promotions and appends
 * typed Reader observations to the already-promoted candidate event stream.
 */
import { MEETING_PARTITION_CONTRACTS, observableRoutineContracts } from "../lib/civic-data/meeting-partitions.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "../lib/civic-data/manual-contracts.ts";
import {
  routineReaderRepairRecord,
  serializeRoutineReaderRepairRecord,
} from "../lib/civic-data/reader-repair-protocol.ts";
import {
  repairMeetingReaderProjectionReadbacks,
  repairRoutineReaderProjectionReadback,
} from "../lib/civic-data/reader-verification.ts";
import { readMeetingsProjection, type MeetingsProjectionReadResult } from "../lib/meetings/snapshot.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { assertWriteAllowed } from "../lib/db/write-guard.ts";
import { resolveProductionWriteHandle } from "../lib/db/write-handle.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { sanitizedErrorDiagnostic } from "../lib/ops/error-diagnostic.ts";
import { installFatalLine } from "../lib/ops/fatal-line.ts";
import { stageLine, traceMethodCalls } from "../lib/ops/stage-trace.ts";
import { assignment, present, requiredAssignment } from "./cli-args.mts";
import { readerVerifierClosureAttestor } from "./lib/reader-verifier-attestation.ts";
function safeFailure(value: string): string {
  return value
    .replace(/(postgres(?:ql)?:\/\/)[^@\s]+@/gi, "$1[credentials-redacted]@")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-8)
    .join(" | ")
    .slice(0, 4_000) || "Reader repair failed without a diagnostic.";
}

// An error nothing caught ends this child through one sanitized RCD_FATAL line
// naming its step (lib/ops/fatal-line.ts). Without it the supervisor quoted the
// last eight stderr lines, which for an uncaught throw are stack frames: the
// 2026-09-25T23:01Z runtime-authority refusals recorded no reason at all.
let step = "reading the Reader repair arguments";
installFatalLine("routine-civic-data-reader-repair", () => step);

const argv = process.argv.slice(2);
const meetingAggregate = present(argv, "meeting-aggregate");
const contractId = assignment(argv, "contract")?.trim() ?? null;
const observedAt = requiredAssignment(argv, "observed-at", "READER_REPAIR_ARGUMENT_MISSING");
const observedMs = Date.parse(observedAt);
if (!Number.isFinite(observedMs) || new Date(observedMs).toISOString() !== observedAt) {
  throw new Error(`READER_REPAIR_OBSERVED_AT_INVALID:${observedAt}`);
}
if (meetingAggregate === (contractId !== null && contractId !== "")) {
  throw new Error("READER_REPAIR_DOMAIN_ARGUMENT_INVALID");
}

// A one-contract child writes stage lines to stderr, so a child the runner
// kills leaves the step it stopped in as its failure detail
// (lib/ops/stage-trace.ts). Protocol records stay on stdout.
const stage = meetingAggregate
  ? null
  : (what: string): void => {
    step = what;
    process.stderr.write(`${stageLine("READER_REPAIR_STAGE", what)}\n`);
  };
step = `modules loaded for ${contractId ?? "the meeting aggregate"}`;
stage?.(`modules loaded for ${contractId}`);

installNeonRequestDeadline();
step = "admitting the production write";
const handle = resolveProductionWriteHandle();
process.env.DATABASE_URL = handle.connection;
process.env.WTP_DB_ROLE = "production";
process.env.WTP_SANCTIONED_WRITE = "routine-civic-data-promotion";
assertWriteAllowed("a routine civic data candidate/version promotion");
step = meetingAggregate ? "repairing the meeting aggregate" : `repairing ${contractId}`;
const store = stage
  ? traceMethodCalls(new PostgresRoutineDataStore(), "store", stage)
  : new PostgresRoutineDataStore();

let failed = false;
// A receipt from an earlier commit carries to this one when no typed Reader
// code changed between them; otherwise the Reader re-reads (R31, 2026-09-25).
// Every runner handoff once re-read every Reader (195.3 MB on an isolated copy).
const attestor = readerVerifierClosureAttestor();
if (meetingAggregate) {
  // One composition of every partition per pass, made only when something
  // needs it: the Reader readbacks of newly promoted versions and the prepared
  // snapshot's republication ask for exactly the same read, and a pass that
  // promoted a partition needs both. Each once composed on its own (about
  // 24 MB from the reader database apiece). A failed composition is not kept,
  // so the second consumer tries again as it did before.
  let composing: Promise<MeetingsProjectionReadResult> | null = null;
  const aggregate = (): Promise<MeetingsProjectionReadResult> => {
    composing ??= readMeetingsProjection({ store, now: observedAt, bypassCache: true, allowUnconfiguredBootstrap: false })
      .catch((error: unknown) => {
        composing = null;
        throw error;
      });
    return composing;
  };
  const selectedIds = assignment(argv, "contracts")?.split(",") ?? null;
  const selectedContracts = selectedIds === null ? MEETING_PARTITION_CONTRACTS : MEETING_PARTITION_CONTRACTS.filter(contract => selectedIds.includes(contract.id));
  if (selectedIds && (selectedIds.length !== selectedContracts.length || selectedContracts.length === 0)) throw new Error("READER_REPAIR_MEETING_SELECTION_INVALID");
  const results = await repairMeetingReaderProjectionReadbacks(
    store,
    selectedContracts,
    observedAt,
    undefined,
    { aggregate, attestor },
  );
  for (const result of results) {
    const contract = MEETING_PARTITION_CONTRACTS.find(({ id }) => id === result.contractId);
    if (!contract) throw new Error(`READER_REPAIR_MEETING_RESULT_UNKNOWN:${result.contractId}`);
    failed ||= !result.ok;
    console.log(serializeRoutineReaderRepairRecord(routineReaderRepairRecord(
      contract,
      result.ok
        ? { ok: true, value: result.value }
        : { ok: false, error: safeFailure(result.error) },
    )));
  }


} else {
  const contracts = [
    ...observableRoutineContracts(),
    ...MANUAL_PRODUCTION_SOURCE_CONTRACTS,
  ];
  const contract = contracts.find(({ id }) => id === contractId);
  if (!contract || contract.readerProjection === null) {
    throw new Error(`READER_REPAIR_CONTRACT_UNKNOWN_OR_NOT_APPLICABLE:${contractId ?? "missing"}`);
  }
  if (MEETING_PARTITION_CONTRACTS.some(({ id }) => id === contract.id)) {
    throw new Error(`READER_REPAIR_MEETING_REQUIRES_AGGREGATE:${contract.id}`);
  }
  try {
    stage?.("readback repair started");
    const result = await repairRoutineReaderProjectionReadback(store, contract, observedAt, undefined, { attestor });
    stage?.(`readback repair ${result.kind}`);
    console.log(serializeRoutineReaderRepairRecord(routineReaderRepairRecord(
      contract,
      { ok: true, value: result },
    )));
  } catch (error) {
    stage?.("readback repair failed");
    failed = true;
    console.log(serializeRoutineReaderRepairRecord(routineReaderRepairRecord(
      contract,
      { ok: false, error: safeFailure(sanitizedErrorDiagnostic(error)) },
    )));
  }
}

if (failed) process.exitCode = 2;
