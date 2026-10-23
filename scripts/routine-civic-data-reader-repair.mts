/**
 * Killable Reader-delivery evidence boundary for the standing data plane.
 * This process never acquires a publisher, creates a source candidate, moves a
 * pointer, or changes LKG. It only reads canonical promotions and appends
 * typed Reader observations to the already-promoted candidate event stream.
 */
import { MEETING_PARTITION_CONTRACTS, observableRoutineContracts, type MeetingPartitionContract } from "../lib/civic-data/meeting-partitions.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "../lib/civic-data/manual-contracts.ts";
import {
  installMeetingPartitionSelection,
  routineReaderRepairRecord,
  serializeRoutineReaderRepairRecord,
} from "../lib/civic-data/reader-repair-protocol.ts";
import { readContractHandoff } from "../lib/civic-data/contract-handoff.ts";
import {
  repairMeetingReaderProjectionReadbacks,
  repairRoutineReaderProjectionReadbacks,
} from "../lib/civic-data/reader-verification.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { installFatalLine } from "../lib/ops/fatal-line.ts";
import { stageLine, traceMethodCalls } from "../lib/ops/stage-trace.ts";
import { assignment, present, requiredAssignment } from "./cli-args.mts";
import { readerVerifierClosureAttestor } from "./lib/verifier-attestation.ts";
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

// An uncaught error ends this child through one sanitized RCD_FATAL line naming its step (lib/ops/fatal-line.ts).
let step = "reading the Reader repair arguments";
installFatalLine("routine-civic-data-reader-repair", () => step);

const argv = process.argv.slice(2);
const meetingAggregate = present(argv, "meeting-aggregate");
const contractBatch = present(argv, "contract-batch");
const contractId = assignment(argv, "contract")?.trim() ?? null;
if (assignment(argv, "contracts") !== null) throw new Error("READER_REPAIR_INLINE_SELECTION_RETIRED");
const selectedMeetingContracts = meetingAggregate ? readContractHandoff<MeetingPartitionContract>(argv) : [];
const selectedContractIds = contractBatch ? readContractHandoff<string>(argv) : contractId ? [contractId] : [];
if (selectedMeetingContracts.some(contract => typeof contract !== "object" || contract.recordClass !== "MEETING" ||
    !contract.id.startsWith("meetings:") || !contract.scope || !contract.sourceId || !contract.readerProjection?.id)) {
  throw new Error("READER_REPAIR_MEETING_SELECTION_INVALID");
}
const observedAt = requiredAssignment(argv, "observed-at", "READER_REPAIR_ARGUMENT_MISSING");
const observedMs = Date.parse(observedAt);
if (!Number.isFinite(observedMs) || new Date(observedMs).toISOString() !== observedAt) {
  throw new Error(`READER_REPAIR_OBSERVED_AT_INVALID:${observedAt}`);
}
if (Number(meetingAggregate) + Number(contractBatch) + Number(Boolean(contractId)) !== 1) {
  throw new Error("READER_REPAIR_DOMAIN_ARGUMENT_INVALID");
}

// Stage lines go to stderr so a killed child leaves its last step as the failure detail; protocol records stay on stdout.
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
prepareProductionCivicDataWrite();
step = meetingAggregate ? "repairing the meeting aggregate" : `repairing ${contractId}`;
const store = stage
  ? traceMethodCalls(new PostgresRoutineDataStore(), "store", stage)
  : new PostgresRoutineDataStore();

let failed = false;
// A receipt from an earlier commit carries to this one when no typed Reader code changed between them.
const attestor = readerVerifierClosureAttestor();
if (meetingAggregate) {
  installMeetingPartitionSelection(selectedMeetingContracts);
  const results = await repairMeetingReaderProjectionReadbacks(store, selectedMeetingContracts, observedAt, undefined, { attestor });
  const byId = new Map(results.map(result => [result.contractId, result]));
  if (byId.size !== results.length || results.some(result => !selectedMeetingContracts.some(contract => contract.id === result.contractId))) {
    throw new Error("READER_REPAIR_MEETING_RESULT_SELECTION_MISMATCH");
  }
  for (const contract of selectedMeetingContracts) {
    const result = byId.get(contract.id) ?? { ok: false as const, error: `READER_REPAIR_MEETING_RESULT_MISSING:${contract.id}` };
    failed ||= !result.ok;
    console.log(serializeRoutineReaderRepairRecord(routineReaderRepairRecord(
      contract,
      result.ok
        ? { ok: true, value: result.value }
        : { ok: false, error: safeFailure(result.error) },
    )));
    console.log("RCD_PROGRESS=" + JSON.stringify({ key: contract.id, records: 1 }));
  }


} else {
  const contracts = [
    ...observableRoutineContracts(),
    ...MANUAL_PRODUCTION_SOURCE_CONTRACTS,
  ];
  if (new Set(selectedContractIds).size !== selectedContractIds.length || selectedContractIds.length === 0) throw new Error("READER_REPAIR_CONTRACT_SELECTION_INVALID");
  const selected = selectedContractIds.map(contractId => {
    const contract = contracts.find(({ id }) => id === contractId);
    if (!contract || contract.readerProjection === null) throw new Error(`READER_REPAIR_CONTRACT_UNKNOWN_OR_NOT_APPLICABLE:${contractId}`);
    if (MEETING_PARTITION_CONTRACTS.some(({ id }) => id === contract.id)) throw new Error(`READER_REPAIR_MEETING_REQUIRES_AGGREGATE:${contract.id}`);
    return contract;
  });
  const byId = new Map(selected.map(contract => [contract.id, contract]));
  await repairRoutineReaderProjectionReadbacks(store, selected, observedAt, undefined, { attestor, onResult: result => {
    const contract = byId.get(result.contractId)!;
    failed ||= !result.ok;
    stage?.(`readback ${contract.id}: ${result.ok ? result.value.kind : "failed"}`);
    console.log(serializeRoutineReaderRepairRecord(routineReaderRepairRecord(contract,
      result.ok ? { ok: true, value: result.value } : { ok: false, error: safeFailure(result.error) })));
    console.log("RCD_PROGRESS=" + JSON.stringify({ key: contract.id, records: 1 }));
    // A batch retains receipts only. Release the previous contract's decoded payload before reading the next one.
    globalThis.gc?.();
  } });
}

if (failed) process.exitCode = 2;
