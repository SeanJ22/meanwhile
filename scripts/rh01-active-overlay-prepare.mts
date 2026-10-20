/** Real gateway controls and authentic source handoffs, through the read-production/write-local PG adapter. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ArtifactRecord } from "../lib/control-plane/repository/types.ts";
import type { DispatchResult } from "../lib/control-plane/scheduler/dispatch.ts";
import type { WorkerResultRecord } from "../lib/control-plane/workers/types.ts";

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
  { DurableEvidenceStore }, { extensionFor }, { enqueueWorkerTask }, { runLeaseWorkerProcesses }, { readCompletedWorkerResult }, { fingerprint }, { findReceipt }, { canonicalJson }] = await Promise.all([
  code("lib/control-plane/repository/file-store.ts"), code("lib/control-plane/repository/pg-store.ts"),
  code("lib/control-plane/gateway/gateway.ts"), code("lib/control-plane/scheduler/research-policy.ts"),
  code("lib/control-plane/evidence/durable-store.ts"), code("lib/control-plane/evidence/store.ts"), code("lib/control-plane/workers/runtime.ts"),
  code("lib/control-plane/workers/process-pool.ts"), code("lib/control-plane/repository/worker-completion.ts"), code("lib/control-plane/ids.ts"),
  code("lib/control-plane/gateway/receipts.ts"), code("lib/control-plane/repository/types.ts"),
]);
const manifest = JSON.parse(await readFile(join(prepared, "rh01-model-replay.json"), "utf8"));
if (manifest.phase !== phase) throw Error("RH01 prepared source phase differs");
const at = new Date().toISOString(), repos = await createPgRepositories(connection, at, { skipBootstrap: true });
const held = await createFileRepositories(prepared), workItemId = "wi-50b053705662f68e44998333";
await repos.workItems.mustRead(workItemId); // Preserve the actual production work item and its history.
const heldResults = await held.workerResults.read(workItemId) as readonly WorkerResultRecord[];
const selected = heldResults.find(row => row.result.role === "PARSER" && row.result.verdict === "EXTRACTED");
if (!selected) throw Error("RH01 prepared source has no actual parser handoff");
const originalTask = (await held.routeTasks.mustRead(selected.routeTaskId)).value, contract = originalTask.workerTask?.contract;
if (!contract) throw Error("RH01 actual parser contract is absent");
await mkdir(join(shared, "vault"), { recursive: true });
const vault = new DurableEvidenceStore(join(shared, "vault"), { remote: null });
let restored = 0;
for (const source of await held.artifacts.read(workItemId) as readonly ArtifactRecord[]) {
  const found = await repos.artifacts.readWhere(workItemId, ["artifactId"], source.artifactId) as readonly ArtifactRecord[];
  if (found.length !== 1) throw Error("RH01 immutable production source identity is missing or ambiguous");
  const original = found[0];
  if (original.contentHash !== source.contentHash || original.byteLength !== source.byteLength || original.canonicalUrl !== source.canonicalUrl || original.recordedAt !== source.recordedAt)
    throw Error("RH01 retained bytes do not match the original production source");
  const acquisition = (await repos.attempts.mustRead(original.attemptId)).value;
  const route = (await repos.routeTasks.mustRead(original.routeTaskId)).value;
  if (acquisition.workItemId !== workItemId || acquisition.routeTaskId !== route.id || acquisition.outcome !== "COMPLETED" || acquisition.worker.role !== "ACQUIRER")
    throw Error("RH01 original acquisition lineage is not a completed source receipt");
  const day = original.recordedAt.slice(0, 10).replaceAll("-", "/");
  const key = `project/freshness/source/legistar/${day}/${workItemId}/${original.contentHash}.${extensionFor(original.contentType)}`;
  const bytes = await readFile(join(prepared, "vault", key));
  const sidecar = JSON.parse(await readFile(join(prepared, "vault", key + ".meta.json"), "utf8"));
  const meta = sidecar.meta;
  if (meta.contentHash !== original.contentHash || meta.byteLength !== original.byteLength || meta.custom?.canonicalUrl !== original.canonicalUrl ||
      meta.custom?.retrievedAt !== original.recordedAt || meta.custom?.workItemId !== workItemId || meta.custom?.methodRouteId !== route.routeId)
    throw Error("RH01 held source sidecar does not identify the original acquisition");
  // Restore the original recorded acquisition identity; never alter an existing CP artifact or completed result.
  await vault.put(key, bytes, { ...meta, custom: { ...meta.custom, attemptId: original.attemptId } }); restored++;
}
async function execute(role: "PARSER" | "VALIDATOR", producer?: WorkerResultRecord): Promise<WorkerResultRecord> {
  const task = await enqueueWorkerTask(repos, { workItemId, role, artifactId: originalTask.workerTask.artifactId, contract, now: at,
    purpose: "DIAGNOSTIC_REPLAY", replayLabel: `RH01:${phase}:${process.env.WTP_WORKER_MEMORY_RELEASE}`,
    ...(producer ? { producerResultId: producer.id } : {}) });
  const reports: DispatchResult[] = [];
  await runLeaseWorkerProcesses({ entry: "lib/control-plane/workers/lease-worker.ts", config: { root: codeRoot, postgres: true,
    taskIds: [task.id], modelEnabled: false, searchEnabled: false, ceilingUsd: 0, fundedSubjects: [] }, capacity: () => 1,
    transportFor: () => async () => { throw Error("RH01 preparation cannot send a model request"); }, onDispatched: (row: DispatchResult) => { reports.push(row); } });
  const report = reports[0];
  if (reports.length !== 1 || report.outcome !== "WORKED" || !report.claimed || !report.attemptId) throw Error(`RH01 native ${role} preparation did not complete: ${JSON.stringify(reports)}`);
  const completed = await readCompletedWorkerResult(repos, `wr-${fingerprint([report.attemptId])}`);
  if (completed.record.result.role !== role || completed.record.result.verdict !== (role === "PARSER" ? "EXTRACTED" : "PASS")) throw Error(`RH01 native ${role} preparation did not validate the original source`);
  return completed.record;
}
const parser = await execute("PARSER"), validator = await execute("VALIDATOR", parser);
const audit = await enqueueWorkerTask(repos, { workItemId, role: "ADVERSARIAL_AUDITOR", artifactId: originalTask.workerTask.artifactId,
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
const result = { phase, at, source: prepared, restored, parserResultId: parser.id, validatorResultId: validator.id, auditTaskId: audit.id, receipts, productionWrites: 0,
  note: "Original production source identities and native PG reads are preserved. Free native parser/validator preparation created the pending independent audit. All writes used the disposable local overlay." };
await writeFile(join(shared, "active-overlay-preparation.json"), JSON.stringify(result, null, 2) + "\n");
console.log(`RH01_ACTIVE_OVERLAY_PREPARED ${JSON.stringify(result)}`);
