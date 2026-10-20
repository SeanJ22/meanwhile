/** Real gateway controls and authentic source handoffs, through the read-production/write-local PG adapter. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ArtifactRecord } from "../lib/control-plane/repository/types.ts";
import type { DispatchResult } from "../lib/control-plane/scheduler/dispatch.ts";
import type { WorkerResultRecord } from "../lib/control-plane/workers/types.ts";
import type { AutonomousWorkPlan } from "../lib/control-plane/workers/autonomous-plan.ts";
import type { ObjectMeta } from "../lib/control-plane/evidence/store.ts";
import { savedArtifactFirstObservation, savedSourceTaskFork } from "./rh01-source-fork.mts";

const option = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const phase = option("phase"); if (phase !== "before" && phase !== "after") throw Error("RH01 overlay phase is invalid");
const facts = process.env.WTP_RH01_FACTS_URL, connection = process.env.WTP_CONTROL_PLANE_DATABASE_URL;
if (!facts || new URL(facts).hostname !== "127.0.0.1" || process.env.WTP_RUNTIME_MODE !== "staging" ||
    !connection || new URL(connection).hostname !== "127.0.0.1" || decodeURIComponent(new URL(connection).username) !== "wtp_cp_release_readonly") throw Error("RH01 active setup requires a loopback control connection and local write overlay");
const prepared = resolve(option("prepared") ?? `.scratch/rh01/active-model-${phase}`);
const shared = process.env.WTP_RH01_SHARED_STATE_DIRECTORY;
if (!shared) throw Error("RH01 shared disposable state is absent");
const codeRoot = process.env.WTP_RH01_CODE_ROOT;
if (!codeRoot) throw Error("RH01 active setup requires the immutable native code root");
const code = (file: string) => import(pathToFileURL(join(codeRoot, file)).href);
const [{ createFileRepositories }, { createPgRepositories }, { submit }, { readIntents, RESEARCH_INTENT_LOG_KEY },
  { DurableEvidenceStore }, { enqueueWorkerTask }, { runLeaseWorkerProcesses }, { readCompletedWorkerResult }, { fingerprint, contentHash, routeTaskId }, { findReceipt }, { canonicalJson },
  { registerAutonomousPlan }, { openRuntimeMethod }, { standingFleetRuntime }, { disposeRoute }, { artifactId: deriveArtifactId }] = await Promise.all([
  code("lib/control-plane/repository/file-store.ts"), code("lib/control-plane/repository/pg-store.ts"),
  code("lib/control-plane/gateway/gateway.ts"), code("lib/control-plane/scheduler/research-policy.ts"),
  code("lib/control-plane/evidence/durable-store.ts"), code("lib/control-plane/workers/runtime.ts"),
  code("lib/control-plane/workers/process-pool.ts"), code("lib/control-plane/repository/worker-completion.ts"), code("lib/control-plane/ids.ts"),
  code("lib/control-plane/gateway/receipts.ts"), code("lib/control-plane/repository/types.ts"),
  code("lib/control-plane/workers/coordinator.ts"), code("lib/method/runtime-manual.ts"), code("lib/control-plane/workers/standing.ts"),
  code("lib/control-plane/route-task.ts"), code("lib/control-plane/evidence/artifact.ts"),
]);
interface PreparedHandoff {
  format: number; phase: string;
  nativeHandoff: { workItemId: string; acquirerTaskId: string; plan: AutonomousWorkPlan; sourceWorkItemIds: string[];
    sourceRouteTaskIds: string[]; sourceAttemptIds: string[]; sourceArtifacts: { record: ArtifactRecord; key: string }[];
    parserExpectedFields?: Readonly<Record<string, string | number | boolean>> };
}
const manifest = JSON.parse(await readFile(join(prepared, "rh01-model-replay.json"), "utf8")) as PreparedHandoff;
if (manifest.phase !== phase) throw Error("RH01 prepared source phase differs");
if (manifest.format !== 2 || manifest.nativeHandoff?.plan.contract.schemaVersion !== 2)
  throw Error("RH01 active setup requires genuine native v2 source instructions; legacy v1 audit is unsupported");
const at = new Date().toISOString(), repos = await createPgRepositories(connection, at, { skipBootstrap: true });
const held = await createFileRepositories(prepared), handoff = manifest.nativeHandoff, { workItemId } = handoff, contract = handoff.plan.contract;
const sourceTasks = await Promise.all(handoff.sourceRouteTaskIds.map(id => held.routeTasks.mustRead(id)));
const sourceAttempts = await Promise.all(handoff.sourceAttemptIds.map(id => held.attempts.mustRead(id)));
const firstObservations: { artifactId: string; savedReplayAttemptId: string; originalAttemptId: string; snapshot: string }[] = [];
// Verify the saved execution and bytes before restoring any local lifecycle projection.
const sourceObjects = await Promise.all(handoff.sourceArtifacts.map(async ({ record: source, key }) => {
  const task = sourceTasks.find(row => row.id === source.routeTaskId)?.value;
  const attempt = sourceAttempts.find(row => row.id === source.attemptId)?.value;
  if (!task || !attempt || deriveArtifactId(source.tier, source.contentHash) !== source.artifactId)
    throw Error("RH01 original source lineage is absent or has a different content address");
  const bytes = await readFile(join(prepared, "vault", key));
  const { meta } = JSON.parse(await readFile(join(prepared, "vault", key + ".meta.json"), "utf8")) as { meta: ObjectMeta };
  if (contentHash(bytes) !== source.contentHash || bytes.byteLength !== source.byteLength || meta.contentHash !== source.contentHash ||
      meta.byteLength !== source.byteLength || meta.custom?.canonicalUrl !== source.canonicalUrl || meta.custom?.retrievedAt !== source.recordedAt ||
      meta.custom?.workItemId !== source.workItemId || meta.custom?.attemptId !== source.attemptId || meta.custom?.tier !== source.tier)
    throw Error("RH01 held source sidecar does not identify the original acquisition");
  savedSourceTaskFork({ source: task, existing: { ...task, state: "PENDING", disposition: null, attemptIds: [], policyDenial: null, policyReauthorizations: [] },
    attempt, artifacts: [source], canonicalJson, routeTaskId, disposeRoute });
  const found = await repos.artifacts.readWhere(source.workItemId, ["artifactId"], source.artifactId) as readonly ArtifactRecord[];
  if (!found.length) return { source, key, bytes, meta, existingMetadata: false };
  if (found.length === 1 && canonicalJson(found[0]) === canonicalJson(source)) return { source, key, bytes, meta, existingMetadata: true };
  const snapshot = join(shared, `source-artifact-snapshot-${source.artifactId}.json`);
  await writeFile(snapshot, JSON.stringify({ at, source: prepared, savedAcquisition: source, existing: found, productionWrites: 0 }, null, 2) + "\n");
  if (found.length !== 1) throw Error(`RH01 source metadata is ambiguous; no immutable artifact is overwritten; snapshots: ${snapshot}`);
  const original = savedArtifactFirstObservation(source, found[0], canonicalJson);
  const [originalAttempt, originalTask] = await Promise.all([
    repos.attempts.mustRead(original.attemptId), repos.routeTasks.mustRead(original.routeTaskId!),
  ]);
  // The native first observation must itself have completed. The saved replay remains in its original File store.
  savedSourceTaskFork({ source: originalTask.value,
    existing: { ...task, state: "PENDING", disposition: null, attemptIds: [], policyDenial: null, policyReauthorizations: [] },
    attempt: originalAttempt.value, artifacts: [original], canonicalJson, routeTaskId, disposeRoute });
  sourceTasks[sourceTasks.findIndex(row => row.id === source.routeTaskId)] = originalTask;
  sourceAttempts[sourceAttempts.findIndex(row => row.id === source.attemptId)] = originalAttempt;
  firstObservations.push({ artifactId: source.artifactId, savedReplayAttemptId: source.attemptId, originalAttemptId: original.attemptId, snapshot });
  return { source: original, key, bytes, meta: { ...meta, custom: { ...meta.custom, attemptId: original.attemptId } }, existingMetadata: true };
}));
for (const id of handoff.sourceWorkItemIds) {
  const source = await held.workItems.mustRead(id), existing = await repos.workItems.read(id);
  if (existing) {
    if (existing.value.subject !== source.value.subject || existing.value.project !== source.value.project)
      throw Error("RH01 genuine source work item identity conflicts with its production row");
  } else {
    const { autonomousPlan: _plan, ...value } = source.value;
    await repos.workItems.put(id, value, source.updatedAt);
  }
}
for (const source of sourceAttempts) {
  const existing = await repos.attempts.read(source.id);
  if (!existing) await repos.attempts.put(source.id, source.value, source.updatedAt);
  else if (canonicalJson(existing.value) !== canonicalJson(source.value)) throw Error("RH01 source Attempt changed; no immutable lineage is overwritten");
}
await mkdir(join(shared, "vault"), { recursive: true });
const vault = new DurableEvidenceStore(join(shared, "vault"), { remote: null });
let restored = 0;
for (const { source, key, bytes, meta, existingMetadata } of sourceObjects) {
  if (!existingMetadata) await repos.artifacts.append(source.workItemId, source.artifactId, source, source.recordedAt);
  await vault.put(key, bytes, meta); restored++;
}
await writeFile(join(shared, "saved-source-first-observations.json"), JSON.stringify({ at, source: prepared, firstObservations, productionWrites: 0,
  note: "Existing immutable artifact metadata and its genuine original completed acquisition were retained. Matching saved bytes filled the disposable local vault; the separate local replay was not rewritten." }, null, 2) + "\n");
const sourceForks: ReturnType<typeof savedSourceTaskFork>[] = [];
for (const source of sourceTasks) {
  const existing = await repos.routeTasks.read(source.id);
  if (!existing) await repos.routeTasks.put(source.id, source.value, source.updatedAt);
  else if (canonicalJson(existing.value) !== canonicalJson(source.value)) {
    // A local completed replay and an unstarted production occurrence can share the native derived ID.
    // Keep both snapshots in the measurement receipt; never describe this local fork as production completion.
    const snapshot = join(shared, `source-task-snapshot-${source.id}.json`);
    await writeFile(snapshot, JSON.stringify({ at, source: prepared, existing, savedExecution: source, productionWrites: 0 }, null, 2) + "\n");
    const attempt = sourceAttempts.find(row => row.id === source.value.disposition?.attemptId)?.value;
    if (!attempt) throw Error(`RH01 source task differs without a saved completed Attempt; snapshots: ${snapshot}`);
    const fork = savedSourceTaskFork({ source: source.value, existing: existing.value, attempt,
      artifacts: sourceObjects.filter(row => row.source.routeTaskId === source.id).map(row => row.source), canonicalJson, routeTaskId, disposeRoute });
    await repos.routeTasks.compareAndSet(source.id, existing.revision, source.value, source.updatedAt);
    sourceForks.push(fork);
    await writeFile(join(shared, "saved-source-local-forks.json"), JSON.stringify({ at, source: prepared, sourceForks, productionWrites: 0,
      note: "Saved native completions replaced only untouched pending projections in the disposable local fork. Production lifecycle and controls were not changed." }, null, 2) + "\n");
  }
}
await registerAutonomousPlan(repos, workItemId, handoff.plan, at);
async function execute(taskId: string, role: "ACQUIRER" | "PARSER" | "VALIDATOR", verdict: string): Promise<WorkerResultRecord> {
  const reports: DispatchResult[] = [];
  await runLeaseWorkerProcesses({ entry: "lib/control-plane/workers/lease-worker.ts", config: { root: codeRoot, postgres: true,
    taskIds: [taskId], modelEnabled: false, searchEnabled: false, ceilingUsd: 0, fundedSubjects: [] }, capacity: () => 1,
    transportFor: () => async () => { throw Error("RH01 preparation cannot send a model request"); }, onDispatched: (row: DispatchResult) => { reports.push(row); } });
  const report = reports[0];
  if (reports.length !== 1 || report.outcome !== "WORKED" || !report.claimed || !report.attemptId) throw Error(`RH01 native ${role} preparation did not complete: ${JSON.stringify(reports)}`);
  const completed = await readCompletedWorkerResult(repos, `wr-${fingerprint([report.attemptId])}`);
  if (completed.record.routeTaskId !== taskId || completed.record.result.role !== role || completed.record.result.verdict !== verdict)
    throw Error(`RH01 native ${role} preparation did not complete its exact source handoff`);
  return completed.record;
}
const acquired = await execute(handoff.acquirerTaskId, "ACQUIRER", "ACQUIRED");
if (acquired.result.role !== "ACQUIRER") throw Error("RH01 actual source acquisition result is absent");
const primary = acquired.result.artifacts.filter(row => row.completeness === "COMPLETE" && contract.schemaVersion === 2 && contract.sourceScope.canonicalUrls.includes(row.canonicalUrl));
if (primary.length !== 1) throw Error("RH01 actual acquisition did not retain exactly its declared source representation");
const artifactId = primary[0].artifactId;
const parserTask = await enqueueWorkerTask(repos, { workItemId, role: "PARSER", artifactId, contract, now: at,
  purpose: "DIAGNOSTIC_REPLAY", replayLabel: `RH01:${phase}:${process.env.WTP_WORKER_MEMORY_RELEASE}` });
const parser = await execute(parserTask.id, "PARSER", "EXTRACTED");
if (parser.result.role !== "PARSER" || !parser.result.records.length) throw Error("RH01 genuine source has no extracted records");
if (!handoff.parserExpectedFields || parser.result.records.length !== 1 || parser.result.records.some(row =>
    Object.entries(handoff.parserExpectedFields!).some(([field, value]) => row.fields[field] !== value)))
  throw Error("RH01 extracted source differs from its actual held Pima observation");
const validatorTask = await enqueueWorkerTask(repos, { workItemId, role: "VALIDATOR", artifactId, contract, now: at,
  producerResultId: parser.id, purpose: "DIAGNOSTIC_REPLAY", replayLabel: `RH01:${phase}:${process.env.WTP_WORKER_MEMORY_RELEASE}` });
const validator = await execute(validatorTask.id, "VALIDATOR", "PASS");
// Verify canonical first-party context before any paid audit work is offered.
const method = await openRuntimeMethod(repos);
try {
  const runtime = standingFleetRuntime({ root: codeRoot, repos, vaultRoot: join(shared, "vault"), method, now: () => new Date().toISOString() });
  await runtime.independentContext({ artifactId, contract, auditScope: handoff.plan.auditScope, methodVersion: method.version, workItemId });
} finally { await method.close(); }
const audit = await enqueueWorkerTask(repos, { workItemId, role: "ADVERSARIAL_AUDITOR", artifactId,
  contract, now: at, producerResultId: parser.id, validatorResultId: validator.id, purpose: "DIAGNOSTIC_REPLAY", replayLabel: `RH01:${phase}:${process.env.WTP_WORKER_MEMORY_RELEASE}` });
const receipts = [];
for (const [type, input] of [
  ["research.resume", { note: "RH-01 user-authorized isolated memory diagnostic; production pause unchanged" }],
  ["fleet.deployHere", { note: "Send agents to Pima County Arizona", budgetUsd: 2.49 }],
] as const) {
  const result = await submit({ type, subject: "fleet", input, stateVersion: null, idempotencyKey: `rh01-active-pg-${phase}-${type}`,
    caller: "OPERATOR_CHAT", actorRef: "rh01-user-authorized-local-diagnostic" }, { repos, now: () => at, currentStateVersion: null, codeSha: null });
  if (!result.ok) throw Error(`RH01 native local command refused: ${result.receipt.says}`);
  if (canonicalJson(await findReceipt(repos, result.receipt.receiptId)) !== canonicalJson(result.receipt)) throw Error("RH01 native local gateway receipt did not persist exactly");
  receipts.push(result.receipt);
}
const controls = readIntents(await repos.researchIntents.read(RESEARCH_INTENT_LOG_KEY));
if (controls.paused || !controls.pendingDispatch.length) throw Error("RH01 local Resume/Send did not read back");
const result = { phase, at, source: prepared, restored, sourceForks, firstObservations, acquisitionResultId: acquired.id, parserResultId: parser.id, validatorResultId: validator.id, auditTaskId: audit.id, receipts, productionWrites: 0,
  note: "Exact saved source observations grounded a new native v2 ACQUIRER/parser/validator chain. Canonical independent context passed without a provider call. The audit is pending and no old v1 task or result was relabeled. All writes used the disposable local overlay." };
await writeFile(join(shared, "active-overlay-preparation.json"), JSON.stringify(result, null, 2) + "\n");
console.log(`RH01_ACTIVE_OVERLAY_PREPARED ${JSON.stringify(result)}`);
