/** Fresh native tasks over authentic held inputs; paid sends require the separate approved local broker. */
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { DispatchResult } from "../lib/control-plane/scheduler/dispatch.ts";
import { fingerprint } from "../lib/control-plane/ids.ts";
import { diagnosticModelClient } from "./rh01-model-client.mts";
import { enableProductionReadAccounting } from "./rh01-network.mjs";

process.env.WTP_VITAL_SIGNS_REPORT = "1";
if (process.env.WTP_PRODUCTION_DATABASE_URL_READONLY) process.env.DATABASE_URL = process.env.WTP_PRODUCTION_DATABASE_URL_READONLY;
enableProductionReadAccounting("model-role-replay");

const option = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const phase = option("phase"); if (phase !== "before" && phase !== "after") throw Error("RH01 model replay requires --phase=before|after");
const root = resolve(option("store") ?? `.scratch/rh01/model-${phase}`), codeRoot = resolve(process.env.WTP_RH01_CODE_ROOT ?? process.cwd());
const harnessRoot = resolve(process.env.WTP_RH01_HARNESS_ROOT ?? process.cwd());
const code = (file: string) => import(pathToFileURL(join(codeRoot, file)).href);
const [{ createFileRepositories }, methodReader, { refreshDoorsForPass }, { seedMeetingDoors }, { standingFleetRuntime, advanceHeldWorkerFleet }] = await Promise.all([
  code("lib/control-plane/repository/file-store.ts"), code(phase === "before" ? "lib/method/manual-bridge.ts" : "lib/method/runtime-manual.ts"), code("lib/doors/install.ts"),
  code("lib/doors/seed-meetings.ts"), code("lib/control-plane/workers/standing.ts"),
]);
const manifestPath = join(root, "rh01-model-replay.json"), now = () => new Date().toISOString();
if (process.argv.includes("--prepare")) {
  await mkdir(resolve(process.env.TMPDIR ?? "/tmp"), { recursive: true });
  await cp(resolve(".scratch/rh01/held-legistar-control"), root, { recursive: true, force: false, errorOnExist: true });
  const repos = await createFileRepositories(root), held = JSON.parse(await readFile("/tmp/rh01-before/data/doors/hand-wired-meeting-doors.json", "utf8"));
  await seedMeetingDoors({ repo: repos.doors, wiring: held.rows.filter((row: unknown) => JSON.stringify(row).includes("county:pima")),
    derived: [], deriveInputAt: held.generatedAt, at: held.generatedAt });
  await refreshDoorsForPass(repos.doors, { state: "AZ" });
  const method = phase === "before" ? await methodReader.readMethodKnowledge(repos) : await methodReader.openRuntimeMethod(repos);
  const runtime = standingFleetRuntime({ root: codeRoot, vaultRoot: join(root, "vault"), repos, method, now });
  try { await advanceHeldWorkerFleet(codeRoot, runtime); } finally { if (phase === "after") await method.close(); }
  const tasks = await repos.routeTasks.listWhere(["workItemId"], "wi-50b053705662f68e44998333");
  const audit = tasks.map((row: { value: { id: string; state: string; workerTask?: { role: string } } }) => row.value)
    .find((row: { state: string; workerTask?: { role: string } }) => row.workerTask?.role === "ADVERSARIAL_AUDITOR" && row.state === "PENDING");
  if (!audit) throw Error("RH01 native held handoff did not create the prepared audit");
  const [{ huntPacketObligation }, { standing, openOccurrence }] = await Promise.all([code("lib/hunt/packet-plan.ts"), code("lib/control-plane/scheduler/durable.ts")]);
  const obligation = standing(huntPacketObligation("ocd-division/country:us/state:az/county:pima"), now());
  await repos.obligations.put(obligation.id, obligation, now());
  const opened = await openOccurrence(repos, { obligation, dueAt: now(), now: now() });
  if (!opened) throw Error("RH01 native packet occurrence did not open");
  const capture = resolve(".scratch/rh01/native-scout-prepared/actual-held-place-capture.json");
  const manifest = { phase, root, codeRoot, preparedAt: now(), productionQueries: 0,
    inputs: { sourceCandidateIds: ["cv-2ca58b2e616b3811b54cc0033fda8d99", "cv-75146d1fea394be98dcb4cfc7834ecd2"],
      heldCapture: capture, heldCaptureNote: "Actual current one-place reader result; baseline country assembly is outside this replay component." },
    tasks: { SCOUT: opened.routeTask.id, ADVERSARIAL_AUDITOR: audit.id }, methodVersion: method.version };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`RH01_MODEL_PREPARED ${JSON.stringify(manifest)}`);
} else {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const role = option("role"); if (role !== "SCOUT" && role !== "ADVERSARIAL_AUDITOR") throw Error("RH01 model replay role is invalid");
  if (!process.env.WTP_RH01_MODEL_BROKER) throw Error("RH01 model replay requires the separately authorized or dry-blocked local broker");
  process.env.WTP_RH01_MODEL_PHASE = phase;
  process.env.WTP_RH01_HELD_VAULT_DIRECTORY = join(root, "vault");
  process.env.WTP_RH01_MODEL_CAPTURE = manifest.inputs.heldCapture;
  process.env.WTP_RH01_DIRECTORY ??= root;
  process.env.WTP_RH01_SHARED_STATE_DIRECTORY ??= root;
  const preloads = [join(harnessRoot, "scripts/rh01-loader.mjs"), join(harnessRoot, "scripts/rh01-model-preload.mjs")];
  for (const name of Object.keys(process.env)) if (/ANTHROPIC|OPENAI|EXA|BRAVE|BLOBS|NETLIFY.*TOKEN/.test(name)) delete process.env[name];
  process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ""} ${preloads.map(file => `--import=${file}`).join(" ")}`;
  const { runLeaseWorkerProcesses } = await code("lib/control-plane/workers/process-pool.ts");
  const reports: DispatchResult[] = [];
  await runLeaseWorkerProcesses({ entry: "lib/control-plane/workers/lease-worker.ts", config: { root: codeRoot, fileStoreRoot: root, postgres: false,
    taskIds: [manifest.tasks[role]], modelEnabled: true, searchEnabled: false, ceilingUsd: role === "SCOUT" ? 2.49 : 0.01, fundedSubjects: [] },
    capacity: () => 1, transportFor: () => diagnosticModelClient(),
    onDispatched: (report: DispatchResult) => { reports.push(report); } });
  const repos = await createFileRepositories(root), report = reports[0];
  let complete = false;
  if (report?.claimed && report.outcome === "WORKED" && report.attemptId) {
    const attempt = await repos.attempts.read(report.attemptId);
    if (role === "ADVERSARIAL_AUDITOR") {
      const { readCompletedWorkerResult } = await code("lib/control-plane/repository/worker-completion.ts");
      const record = await readCompletedWorkerResult(repos, `wr-${fingerprint([report.attemptId])}`);
      complete = record?.record.routeTaskId === manifest.tasks[role] && record.record.modelReview !== undefined && attempt?.value.outcome === "COMPLETED";
    } else complete = attempt?.value.outcome === "COMPLETED" && (await repos.scoutResults.read((await code("lib/hunt/packet.ts")).huntPacketObligationId("ocd-division/country:us/state:az/county:pima")))
      .some((row: { attemptId: string; steps: readonly unknown[]; stoppedBy: string }) => row.attemptId === report.attemptId && row.steps.length > 0 && row.stoppedBy === "MODEL");
  }
  console.log(`RH01_REPLAY ${JSON.stringify({ complete, role, taskId: manifest.tasks[role], phase, reports })}`);
  if (!complete) process.exitCode = 1;
}
