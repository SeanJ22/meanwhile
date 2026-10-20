/** Replay the existing permanent-source intake and real deterministic worker handoffs.
 * All source bytes and meeting-door metadata are read from production; writes are local. */
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { neon } from "@neondatabase/serverless";
import { fingerprint } from "../lib/control-plane/ids.ts";
import type { DispatchResult } from "../lib/control-plane/scheduler/dispatch.ts";
import { enableProductionReadAccounting } from "./rh01-network.mjs";

enableProductionReadAccounting(process.env.WTP_RH01_PHASE ?? "held-worker-preparation");

const option = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = resolve(option("store") ?? ".scratch/rh01/held-legistar-control");
const codeRoot = process.env.WTP_RH01_CODE_ROOT ?? process.cwd();
const code = (path: string) => import(pathToFileURL(join(codeRoot, path)).href);
const [{ createFileRepositories }, { readCompletedWorkerResult }, { enqueueWorkerTask }] = await Promise.all([
  code("lib/control-plane/repository/file-store.ts"), code("lib/control-plane/repository/worker-completion.ts"), code("lib/control-plane/workers/runtime.ts"),
]);
const seedRoot = option("prepare-from") ? resolve(option("prepare-from")!) : null;
if (seedRoot) {
  if (seedRoot === root) throw Error("RH01 held replay requires a separate fresh local store");
  await cp(seedRoot, root, { recursive: true, errorOnExist: true, force: false });
}
const repos = await createFileRepositories(root), now = () => new Date().toISOString();
const manifestPath = join(root, "rh01-held-replay.json");
if (seedRoot) {
  const prior = JSON.parse(await readFile(manifestPath, "utf8"));
  const original = (await repos.routeTasks.mustRead(prior.parserTaskId)).value;
  const spec = original.workerTask;
  if (spec?.role !== "PARSER") throw Error("RH01 held replay seed does not name its authentic parser task");
  const task = await enqueueWorkerTask(repos, { workItemId: original.workItemId, role: "PARSER", artifactId: spec.artifactId,
    contract: spec.contract, now: now(), purpose: "DIAGNOSTIC_REPLAY", replayLabel: `RH-01:${now()}` });
  const manifest = { ...prior, root, parserTaskId: task.id, preparedFrom: seedRoot, preparedAt: now() };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`RH01_HELD_PREPARED ${JSON.stringify({ root, parserTaskId: task.id, source: prior.source, productionReads: 0 })}`);
} else if (process.argv.includes("--prepare")) {
  const control = process.env.WTP_CONTROL_PLANE_DATABASE_URL, reader = process.env.WTP_PRODUCTION_DATABASE_URL_READONLY;
  if (!control || !reader || decodeURIComponent(new URL(control).username) !== "wtp_cp_release_readonly" || decodeURIComponent(new URL(reader).username) !== "readonly") throw Error("RH01 held replay requires actual read-only roles");
  const cp = neon(control), db = neon(reader);
  const [{ PIMA_LEGISTAR_CONTRACT }, { meetingPartitionScope }, { installDoorRecords }, { retainRecentRoutineMeetingEvidence }, { DurableEvidenceStore }, { readMethodKnowledge }] = await Promise.all([
    code("lib/control-plane/workers/held-meeting-contract.ts"), code("lib/civic-data/meeting-partitions.ts"), code("lib/doors/meeting-doors.ts"),
    code("lib/control-plane/workers/routine-meeting-intake.ts"), code("lib/control-plane/evidence/durable-store.ts"), code("lib/method/manual-bridge.ts"),
  ]);
  const subject = PIMA_LEGISTAR_CONTRACT.subjectId;
  const doors = await cp.query("SELECT value FROM cp_doors WHERE value->'bodyIds' ? $1", [subject]);
  if (!doors.length) throw Error("RH01 actual held meeting door is not registered in production");
  const installed = installDoorRecords(doors.map(row => row.value), "actual production door replay");
  if (!installed.partitions.refreshed) throw Error(installed.partitions.reason);
  const scope = meetingPartitionScope("legistar", subject);
  const candidates = await db.query(`SELECT id,scope,record_class AS "recordClass",candidate->'retainedSourceResponses' AS "retainedSourceResponses"
    FROM civic_data_candidates WHERE scope=$1 AND record_class='MEETING' AND candidate ? 'retainedSourceResponses'
    ORDER BY retrieved_at DESC LIMIT 2`, [scope]);
  if (!candidates.length) throw Error("RH01 actual production routine has no retained source bytes");
  const manuals = await cp.query("SELECT id,value FROM cp_field_manual_entries WHERE value->>'kind'=ANY($1::text[]) ORDER BY id", [["METHOD_VERSION", "ROUTE", "PLAYBOOK"]]);
  for (const row of manuals) await repos.fieldManual.put(String(row.id), row.value, now());
  const method = await readMethodKnowledge(repos);
  const retained = await retainRecentRoutineMeetingEvidence({ repos, store: new DurableEvidenceStore(join(root, "vault"), { remote: null }),
    methodVersion: method.version, candidates, now });
  if (!retained.length) throw Error("RH01 actual source intake did not enqueue a fresh parser");
  const selected = retained.at(-1);
  const manifest = { format: 1, root, source: "actual production retainedSourceResponses", productionCandidateIds: candidates.map(row => row.id),
    productionDoorIds: doors.map(row => row.value.doorId), methodVersion: method.version, ...selected };
  await mkdir(root, { recursive: true }); await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`RH01_HELD_PREPARED ${JSON.stringify(manifest)}`);
} else {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const role = option("role") ?? "PARSER";
  let taskId = manifest.parserTaskId;
  if (role === "VALIDATOR") {
    const until = Date.now() + Number(option("predecessor-ms") ?? 120_000);
    let producer;
    while (!producer && Date.now() < until) {
      const results = await repos.workerResults.read(manifest.workItemId);
      producer = results.find((row: { routeTaskId: string; result: { role: string; verdict: string } }) => row.routeTaskId === manifest.parserTaskId && row.result.role === "PARSER" && row.result.verdict === "EXTRACTED");
      if (!producer) {
        const parser = (await repos.routeTasks.mustRead(manifest.parserTaskId)).value;
        if (!["PENDING", "RECLAIMABLE", "CLAIMED"].includes(parser.state)) throw Error(`RH01 actual parser predecessor ended without extraction:${parser.state}`);
        await new Promise(done => setTimeout(done, 100));
      }
    }
    if (!producer) throw Error("RH01 validator requires the actual preceding parser completion");
    const task = (await repos.routeTasks.mustRead(manifest.parserTaskId)).value;
    taskId = (await enqueueWorkerTask(repos, { workItemId: manifest.workItemId, artifactId: manifest.artifactId, contract: task.workerTask.contract,
      role, producerResultId: producer.id, now: now() })).id;
  } else if (role !== "PARSER") throw Error("RH01 held deterministic replay supports only PARSER and VALIDATOR");
  process.env.WTP_RH01_HELD_VAULT_DIRECTORY = join(root, "vault");
  const { runLeaseWorkerProcesses } = await code("lib/control-plane/workers/process-pool.ts");
  const reports: DispatchResult[] = [];
  await runLeaseWorkerProcesses({ entry: "lib/control-plane/workers/lease-worker.ts", config: { root: codeRoot, fileStoreRoot: root, postgres: false,
    taskIds: [taskId], modelEnabled: false, searchEnabled: false, ceilingUsd: 0, fundedSubjects: [] }, capacity: () => 1,
    transportFor: () => async () => { throw Error("RH01 paid model call is forbidden"); }, onDispatched: (report: DispatchResult) => { reports.push(report); } });
  const report = reports[0], committed = report?.attemptId && report.outcome === "WORKED"
    ? await readCompletedWorkerResult(repos, `wr-${fingerprint([report.attemptId])}`) : null;
  const result = committed?.record;
  const complete = reports.length === 1 && report.claimed && report.outcome === "WORKED" && result?.routeTaskId === taskId &&
    result.completion.closedAttempt.outcome === "COMPLETED" && result.result.role === role &&
    (role === "PARSER" ? result.result.verdict === "EXTRACTED" : result.result.verdict === "PASS");
  console.log(`RH01_REPLAY ${JSON.stringify({ complete, role, taskId, source: manifest.source, committedResultId: result?.id ?? null,
    result: result ? { role: result.result.role, verdict: result.result.verdict } : null, reports })}`);
  if (!complete) process.exitCode = 1;
}
