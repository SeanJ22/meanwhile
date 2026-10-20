/** RH-01 replays use the real durable file repositories and coordinator, shared by child processes.
 * Production is queried by exact work-item identity; no production mutation is issued.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { neon } from "@neondatabase/serverless";
import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import { enqueueWorkerTask } from "../lib/control-plane/workers/runtime.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import type { RouteTask } from "../lib/control-plane/route-task.ts";
import type { WorkItem } from "../lib/control-plane/work-item.ts";
import type { DispatchResult } from "../lib/control-plane/scheduler/dispatch.ts";
import { fingerprint } from "../lib/control-plane/ids.ts";
import { readCompletedWorkerResult } from "../lib/control-plane/repository/worker-completion.ts";
import { enableProductionReadAccounting } from "./rh01-network.mjs";

enableProductionReadAccounting(process.env.WTP_RH01_PHASE ?? "typed-worker-preparation");

export interface ReplayManifest {
  readonly format: 1;
  readonly controlRoot: string;
  readonly tasks: readonly { readonly role: string; readonly productionTaskId: string; readonly replayTaskId: string;
    readonly workItemId: string; readonly subject: string; readonly artifactId: string }[];
  readonly capturedAt: string;
  readonly productionReadOnly: true;
  readonly remoteSourceBytesCopied: false;
}

/** This is the existing repository provider: its CAS, append arbitration and locks survive every child. */
export async function sharedReplayRepositories(root: string): Promise<ControlPlaneRepositories> {
  return createFileRepositories(resolve(root));
}

export async function prepareControlReplay(root: string): Promise<ReplayManifest> {
  const connection = process.env.WTP_CONTROL_PLANE_DATABASE_URL;
  if (!connection || decodeURIComponent(new URL(connection).username) !== "wtp_cp_release_readonly") {
    throw Error("RH01 replay requires the production control-plane read-only role");
  }
  const sql = neon(connection), capturedAt = new Date().toISOString();
  const controlRoot = resolve(root), repos = await sharedReplayRepositories(controlRoot);
  const selected = await sql.query(`SELECT DISTINCT ON (value->'workerTask'->>'role') value
    FROM cp_route_tasks WHERE value->>'state'='RESULT_RECORDED'
      AND value->'workerTask'->>'role' IN ('PARSER','VALIDATOR','ADVERSARIAL_AUDITOR','ACQUIRER','DETECTIVE')
    ORDER BY value->'workerTask'->>'role', updated_at DESC`);
  const manuals = await sql.query(`SELECT id,value FROM cp_field_manual_entries
    WHERE value->>'kind'=ANY($1::text[]) ORDER BY id`, [["METHOD_VERSION", "ROUTE", "PLAYBOOK"]]);
  for (const row of manuals) await repos.fieldManual.put(String(row.id), row.value, capturedAt);
  const tasks: ReplayManifest["tasks"][number][] = [];
  for (const selectedRow of selected) {
    const original = selectedRow.value as RouteTask, spec = original.workerTask!;
    const [work] = await sql.query("SELECT value FROM cp_work_items WHERE id=$1", [original.workItemId]);
    if (!work) throw Error(`RH01 production work item missing: ${original.workItemId}`);
    const item = work.value as WorkItem;
    if (!(await repos.workItems.read(item.id))) await repos.workItems.put(item.id, item, capturedAt);
    // A completed producer's identity, Attempt and committed result remain intact. Diagnostic replays
    // get their own ordinary derived task id; no old completion is erased or claimed as fresh work.
    for (const [table, repository] of [["route_tasks", repos.routeTasks], ["attempts", repos.attempts]] as const) {
      const rows = await sql.query(`SELECT value FROM cp_${table} WHERE value->>'workItemId'=$1 ORDER BY id`, [item.id]);
      for (const row of rows) {
        const value = row.value as { id: string };
        await (repository as unknown as { put(id: string, value: unknown, now: string): Promise<unknown> }).put(value.id, value, capturedAt);
      }
    }
    for (const [table, repository] of [["worker_results", repos.workerResults], ["artifacts", repos.artifacts], ["scout_results", repos.scoutResults]] as const) {
      let position = -1, key = "";
      for (;;) {
        const rows = await sql.query(`SELECT log_key,record_id,position,record,recorded_at FROM cp_log_${table}
          WHERE record->>'workItemId'=$1 AND (log_key,position)>($2,$3) ORDER BY log_key,position LIMIT 32`, [item.id, key, position]);
        for (const row of rows) await (repository as unknown as { append(key: string, id: string, record: unknown, now: string): Promise<unknown> })
          .append(String(row.log_key), String(row.record_id), row.record, String(row.recorded_at));
        if (rows.length < 32) break;
        key = String(rows.at(-1)!.log_key); position = Number(rows.at(-1)!.position);
      }
    }
    const replay = await enqueueWorkerTask(repos, { workItemId: item.id, role: spec.role,
      artifactId: spec.artifactId, contract: spec.contract, now: capturedAt,
      ...(spec.producerResultId ? { producerResultId: spec.producerResultId } : {}),
      ...(spec.validatorResultId ? { validatorResultId: spec.validatorResultId } : {}),
      ...(spec.acquisition ? { acquisition: spec.acquisition } : {}),
      auditScope: spec.auditScope, purpose: "DIAGNOSTIC_REPLAY", replayLabel: `RH-01:${capturedAt}` });
    tasks.push({ role: spec.role, productionTaskId: original.id, replayTaskId: replay.id, workItemId: item.id,
      subject: spec.contract.subjectId, artifactId: spec.artifactId });
  }
  const manifest: ReplayManifest = { format: 1, controlRoot, capturedAt, productionReadOnly: true,
    remoteSourceBytesCopied: false, tasks };
  await mkdir(controlRoot, { recursive: true });
  await writeFile(join(controlRoot, "rh01-replay.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}

async function main(): Promise<void> {
  if (process.env.WTP_PRODUCTION_DATABASE_URL_READONLY) process.env.DATABASE_URL = process.env.WTP_PRODUCTION_DATABASE_URL_READONLY;
  const arg = (key: string) => process.argv.find(value => value.startsWith(`--${key}=`))?.slice(key.length + 3);
  const root = arg("store");
  if (!root) throw Error("RH01 replay requires --store=<temporary directory>");
  if (process.argv.includes("--prepare")) {
    const result = await prepareControlReplay(root);
    console.log(JSON.stringify({ manifest: join(result.controlRoot, "rh01-replay.json"), tasks: result.tasks }));
    return;
  }
  const manifest = JSON.parse(await readFile(join(root, "rh01-replay.json"), "utf8")) as ReplayManifest;
  const role = arg("role"), task = manifest.tasks.find(row => row.role === role);
  if (!task) throw Error(`RH01 role is not in the production replay: ${role}`);
  const codeRoot = process.env.WTP_RH01_CODE_ROOT ?? process.cwd();
  const harnessRoot = process.env.WTP_RH01_HARNESS_ROOT ?? process.cwd();
  // process-pool supplies its own execArgv; NODE_OPTIONS carries the write boundary into every child.
  const loader = join(harnessRoot, "scripts/rh01-loader.mjs");
  if (!process.env.NODE_OPTIONS?.includes(loader)) process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ""} --import=${loader}`;
  const { runLeaseWorkerProcesses } = await import(pathToFileURL(join(codeRoot, "lib/control-plane/workers/process-pool.ts")).href);
  const reports: import("../lib/control-plane/scheduler/dispatch.ts").DispatchResult[] = [];
  await runLeaseWorkerProcesses({ entry: "lib/control-plane/workers/lease-worker.ts",
    config: { root: codeRoot, fileStoreRoot: manifest.controlRoot, postgres: false, taskIds: [task.replayTaskId],
      modelEnabled: false, searchEnabled: false, ceilingUsd: 0, fundedSubjects: [] }, capacity: () => 1,
    transportFor: () => async () => { throw Error("RH01 paid model call is forbidden"); }, onDispatched: (report: DispatchResult) => { reports.push(report); } });
  const repos = await sharedReplayRepositories(manifest.controlRoot);
  const report = reports[0];
  const committed = report?.attemptId && report.outcome === "WORKED" ? await readCompletedWorkerResult(repos,
    `wr-${fingerprint([report.attemptId])}`) : null;
  const committedResult = committed?.record;
  const complete = reports.length === 1 && report.claimed && report.outcome === "WORKED" &&
    committedResult?.routeTaskId === task.replayTaskId && committedResult.completion.closedAttempt.outcome === "COMPLETED";
  console.log(`RH01_REPLAY ${JSON.stringify({ complete, productionTaskId: task.productionTaskId,
    replayTaskId: task.replayTaskId, role, committedResultId: committedResult?.id ?? null, reports })}`);
  if (!complete) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
