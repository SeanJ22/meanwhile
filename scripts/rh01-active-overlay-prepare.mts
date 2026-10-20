/** Real gateway controls and authentic source handoffs, through the read-production/write-local PG adapter. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ArtifactRecord } from "../lib/control-plane/repository/types.ts";
import type { DispatchResult } from "../lib/control-plane/scheduler/dispatch.ts";
import type { WorkerResultRecord } from "../lib/control-plane/workers/types.ts";
import type { AutonomousWorkPlan } from "../lib/control-plane/workers/autonomous-plan.ts";

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
  { DurableEvidenceStore }, { enqueueWorkerTask }, { runLeaseWorkerProcesses }, { readCompletedWorkerResult }, { fingerprint, contentHash }, { findReceipt }, { canonicalJson },
  { registerAutonomousPlan }, { openRuntimeMethod }, { standingFleetRuntime }] = await Promise.all([
  code("lib/control-plane/repository/file-store.ts"), code("lib/control-plane/repository/pg-store.ts"),
  code("lib/control-plane/gateway/gateway.ts"), code("lib/control-plane/scheduler/research-policy.ts"),
  code("lib/control-plane/evidence/durable-store.ts"), code("lib/control-plane/workers/runtime.ts"),
  code("lib/control-plane/workers/process-pool.ts"), code("lib/control-plane/repository/worker-completion.ts"), code("lib/control-plane/ids.ts"),
  code("lib/control-plane/gateway/receipts.ts"), code("lib/control-plane/repository/types.ts"),
  code("lib/control-plane/workers/coordinator.ts"), code("lib/method/runtime-manual.ts"), code("lib/control-plane/workers/standing.ts"),
]);
interface PreparedHandoff {
  format: number; phase: string;
  nativeHandoff: { workItemId: string; acquirerTaskId: string; plan: AutonomousWorkPlan; sourceWorkItemIds: string[];
    sourceRouteTaskIds: string[]; sourceAttemptIds: string[]; sourceArtifacts: { record: ArtifactRecord; key: string }[] };
}
const manifest = JSON.parse(await readFile(join(prepared, "rh01-model-replay.json"), "utf8")) as PreparedHandoff;
if (manifest.phase !== phase) throw Error("RH01 prepared source phase differs");
if (manifest.format !== 2 || manifest.nativeHandoff?.plan.contract.schemaVersion !== 2)
  throw Error("RH01 active setup requires genuine native v2 source instructions; legacy v1 audit is unsupported");
const at = new Date().toISOString(), repos = await createPgRepositories(connection, at, { skipBootstrap: true });
const held = await createFileRepositories(prepared), handoff = manifest.nativeHandoff, { workItemId } = handoff, contract = handoff.plan.contract;
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
for (const id of handoff.sourceRouteTaskIds) {
  const source = await held.routeTasks.mustRead(id), existing = await repos.routeTasks.read(id);
  if (!existing) await repos.routeTasks.put(id, source.value, source.updatedAt);
  else if (canonicalJson(existing.value) !== canonicalJson(source.value)) throw Error("RH01 source task changed; no immutable lineage is overwritten");
}
for (const id of handoff.sourceAttemptIds) {
  const source = await held.attempts.mustRead(id), existing = await repos.attempts.read(id);
  if (!existing) await repos.attempts.put(id, source.value, source.updatedAt);
  else if (canonicalJson(existing.value) !== canonicalJson(source.value)) throw Error("RH01 source Attempt changed; no immutable lineage is overwritten");
}
await mkdir(join(shared, "vault"), { recursive: true });
const vault = new DurableEvidenceStore(join(shared, "vault"), { remote: null });
let restored = 0;
for (const { record: source, key } of handoff.sourceArtifacts) {
  const found = await repos.artifacts.readWhere(source.workItemId, ["artifactId"], source.artifactId) as readonly ArtifactRecord[];
  if (found.length > 1 || found.some(original => canonicalJson(original) !== canonicalJson(source))) throw Error("RH01 source metadata changed; no immutable artifact is overwritten");
  if (!found.length) await repos.artifacts.append(source.workItemId, source.artifactId, source, source.recordedAt);
  const acquisition = (await repos.attempts.mustRead(source.attemptId)).value;
  if (acquisition.workItemId !== source.workItemId || acquisition.routeTaskId !== source.routeTaskId || acquisition.outcome !== "COMPLETED" || !["ACQUIRER", "SCOUT"].includes(acquisition.worker.role))
    throw Error("RH01 original source lineage has no completed acquisition or SCOUT receipt");
  const bytes = await readFile(join(prepared, "vault", key));
  const sidecar = JSON.parse(await readFile(join(prepared, "vault", key + ".meta.json"), "utf8"));
  const meta = sidecar.meta;
  if (contentHash(bytes) !== source.contentHash || bytes.byteLength !== source.byteLength || meta.contentHash !== source.contentHash ||
      meta.byteLength !== source.byteLength || meta.custom?.canonicalUrl !== source.canonicalUrl || meta.custom?.retrievedAt !== source.recordedAt ||
      meta.custom?.workItemId !== source.workItemId || meta.custom?.attemptId !== source.attemptId)
    throw Error("RH01 held source sidecar does not identify the original acquisition");
  await vault.put(key, bytes, meta); restored++;
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
if (primary.length !== 1) throw Error("RH01 actual acquisition did not retain exactly its declared API representation");
const artifactId = primary[0].artifactId;
const parserTask = await enqueueWorkerTask(repos, { workItemId, role: "PARSER", artifactId, contract, now: at,
  purpose: "DIAGNOSTIC_REPLAY", replayLabel: `RH01:${phase}:${process.env.WTP_WORKER_MEMORY_RELEASE}` });
const parser = await execute(parserTask.id, "PARSER", "EXTRACTED");
if (parser.result.role !== "PARSER" || !parser.result.records.length || parser.result.records.some(row => row.fields.EventBodyId !== 138 || row.fields.EventBodyName !== "Board of Supervisors"))
  throw Error("RH01 new source does not bind only the genuine declared Pima body");
const validatorTask = await enqueueWorkerTask(repos, { workItemId, role: "VALIDATOR", artifactId, contract, now: at,
  producerResultId: parser.id, purpose: "DIAGNOSTIC_REPLAY", replayLabel: `RH01:${phase}:${process.env.WTP_WORKER_MEMORY_RELEASE}` });
const validator = await execute(validatorTask.id, "VALIDATOR", "PASS");
// Fail on canonical/first-party context before making the one allowed paid after-audit request.
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
const result = { phase, at, source: prepared, restored, acquisitionResultId: acquired.id, parserResultId: parser.id, validatorResultId: validator.id, auditTaskId: audit.id, receipts, productionWrites: 0,
  note: "Exact saved source observations grounded a new native v2 ACQUIRER/parser/validator chain. Canonical independent context passed without a provider call. The audit is pending and no old v1 task or result was relabeled. All writes used the disposable local overlay." };
await writeFile(join(shared, "active-overlay-preparation.json"), JSON.stringify(result, null, 2) + "\n");
console.log(`RH01_ACTIVE_OVERLAY_PREPARED ${JSON.stringify(result)}`);
