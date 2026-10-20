/**
 * Production read-only memory measurement for the runner's actual source executables.
 * node --env-file=/tmp/rh01-production.env --experimental-strip-types --import ./scripts/register-test-loader.mjs scripts/rh01-profile.mts --inventory
 * --only=fetch-congress-legislators.mts --phase=before --code-root=/tmp/rh01-before
 * The result names every incomplete job. Exit zero requires all selected jobs to finish.
 */
import { spawn, execFileSync } from "node:child_process";
import { appendFile, mkdir, open, readFile, writeFile } from "node:fs/promises";
import { createWriteStream, existsSync, readFileSync, readdirSync } from "node:fs";
import { once } from "node:events";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash, randomBytes } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { measuredCompletion } from "./rh01-completion.mts";
import { enableProductionReadAccounting } from "./rh01-network.mjs";
import { commandIdentity, workloadOffers } from "./rh01-workload.mts";
import { physicalRunReads, reserveProductionReadRun } from "./rh01-read-accounting.mts";
import { DatabaseSync } from "node:sqlite";
import type { RoutineSourceTask } from "../lib/civic-data/runner.ts";

const arg = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const harnessRoot = process.cwd(), codeRoot = resolve(arg("code-root") ?? harnessRoot);
const phase = arg("phase") ?? "after", directory = resolve(arg("out") ?? `.scratch/rh01/${phase}`);
const activePima = process.argv.includes("--active-pima-diagnostic");
let activePreparation: { status: "NOT_REQUESTED" | "SUCCEEDED" | "FAILED"; code?: number | null; detail?: string } = { status: "NOT_REQUESTED" };
const only = arg("only")?.split(",");
const hostBytes = Number(arg("host-bytes") ?? 8326938624);
const admissionCode = await import(pathToFileURL(join(codeRoot, "lib/control-plane/workers/worker-slots.ts")).href);
const leaseBytes = Number(arg("lease-bytes") ?? admissionCode.WORKER_ENTRY_PEAK_MIB.lease * 1024 * 1024);
const observationMs = Number(arg("observe-ms") ?? 0), watchdogBytes = Number(arg("watchdog-bytes") ?? hostBytes - 768 * 1024 * 1024);
const output = join(directory, "results.json");
await mkdir(directory, { recursive: true });
process.env.WTP_RH01_PRODUCTION_READ_LEDGER ??= join(harnessRoot, ".scratch/rh01/production-read-bytes.jsonl");
process.env.WTP_RH01_RUN_ID = await reserveProductionReadRun(process.env.WTP_RH01_PRODUCTION_READ_LEDGER,
  arg("run-id") ?? process.env.WTP_RH01_RUN_ID);
const phaseStartedAt = Date.now();
enableProductionReadAccounting(phase);
// --env-file preserves an inherited workspace DATABASE_URL; explicitly select the named read-only handle.
if (process.env.WTP_PRODUCTION_DATABASE_URL_READONLY) process.env.DATABASE_URL = process.env.WTP_PRODUCTION_DATABASE_URL_READONLY;

interface Job { readonly id: string; readonly script: string; readonly command: readonly string[]; readonly source: string; readonly scope?: string; readonly recordClass?: string;
  readonly authority?: { readonly capability: string; readonly contract: string | null } }
interface SourceReceipt { readonly acquisitionSucceeded?: boolean; readonly decision?: string }
interface NestedPeak { readonly pid: number; readonly names: readonly string[]; peakRssBytes: number; treePeakRssBytes?: number; readerBytes: number;
  exclusiveOwnerPeakRssBytes?: number; exclusiveOwnerHwmBoundBytes?: number }
interface OwnerMemoryPeak {
  readonly pid: number; readonly entries: string[]; samples: number;
  readonly firstSeenAt: string; lastSeenAt: string;
  exclusiveOwnerPeakRssBytes: number; exclusiveOwnerHwmBoundBytes: number;
  ownPeakRssBytes: number; inclusiveTreePeakRssBytes: number;
}
interface JobResult extends Job {
  readonly peakRssBytes: number | null; readonly elapsedMs?: number; readonly complete: boolean;
  readonly ownPeakRssBytes?: number;
  exclusiveOwnerPeakRssBytes?: number; exclusiveOwnerHwmBoundBytes?: number;
  readonly nestedProcesses?: readonly NestedPeak[];
  readonly readerBytes?: number; readonly controlPlaneBytes?: number; readonly sourceReceipt?: SourceReceipt | null;
  readonly code?: number | null; readonly signal?: NodeJS.Signals | null; readonly logDirectory: string; readonly error?: string;
  readonly completionReason?: string;
  readonly successful?: boolean;
  readonly execution?: "DIRECT" | "ACTUAL_PARENT_CHILD" | "IDENTICAL_COMMAND_ALIAS";
  readonly coveredByJobId?: string; readonly actualPid?: number; readonly offeredAt?: string;
  productionReaderResponseBytes?: number; productionControlResponseBytes?: number;
}
interface ObservedChild {
  readonly file: string; readonly id: string; readonly command: readonly string[]; readonly pid: number; readonly parentPid: number;
  readonly startedAt: string; readonly finishedAt?: string; readonly settled: boolean; readonly status?: number | null;
  readonly signal?: NodeJS.Signals | null; readonly termination?: string; readonly errorMessage?: string | null; readonly refusedOperation?: boolean;
  readonly authority?: { readonly capability: string | null; readonly contract: string | null };
}
interface MemorySample { peak: number; ownPeak: number; readonly nested: Map<number, NestedPeak> }
const savedInventory = arg("inventory-file") ? JSON.parse(await readFile(resolve(arg("inventory-file")!), "utf8")) as {
  jobs: Job[]; nativeDoorInventory?: { rows: number; partitions: number | null } | null } : null;
const { ROUTINE_SOURCE_TASKS, routineTaskFromContract } = await import(pathToFileURL(join(codeRoot, "lib/civic-data/runner.ts")).href);
const { AUTOMATIC_REFRESH_TASKS } = await import(pathToFileURL(join(codeRoot, "lib/civic-data/automatic-refresh.ts")).href);
const { AUDIT_PASSES } = await import(pathToFileURL(join(codeRoot, "scripts/audit-pass-clock.mts")).href);
let nativeDoorInventory: { rows: number; partitions: number | null } | null = null;
if (process.env.WTP_CONTROL_PLANE_DATABASE_URL && !process.argv.includes("--static-inventory") && !savedInventory) {
  const connection = process.env.WTP_CONTROL_PLANE_DATABASE_URL;
  if (decodeURIComponent(new URL(connection).username) !== "wtp_cp_release_readonly") throw Error("RH01 native job inventory requires the production control read-only role");
  const [{ createPgRepositories }, { refreshDoorsForPass }] = await Promise.all([
    import(pathToFileURL(join(codeRoot, "lib/control-plane/repository/pg-store.ts")).href),
    import(pathToFileURL(join(codeRoot, "lib/doors/install.ts")).href),
  ]);
  const repository = await createPgRepositories(connection, new Date().toISOString(), { skipBootstrap: true });
  const doors = await refreshDoorsForPass(repository.doors);
  if (!doors.partitions?.refreshed) throw Error(`RH01 native job inventory could not read actual door schedules:${doors.reason}`);
  nativeDoorInventory = { rows: doors.rows, partitions: doors.partitions.partitions };
}
const { RUNTIME_ROUTINE_CONTRACTS } = await import(pathToFileURL(join(codeRoot, "lib/civic-data/runtime-routine-contracts.ts")).href);
const tasks = [...ROUTINE_SOURCE_TASKS, ...RUNTIME_ROUTINE_CONTRACTS.map(routineTaskFromContract), ...AUTOMATIC_REFRESH_TASKS];
const manualIds = new Set(AUTOMATIC_REFRESH_TASKS.map((task: RoutineSourceTask) => task.id));
const jobs: Job[] = tasks.map(task => ({ id: task.id, script: task.command[0], command: task.command, source: "standing source contract", scope: task.scope, recordClass: task.recordClass,
  authority: { capability: manualIds.has(task.id) ? "MANUAL_CONTRACT" : "ROUTINE_CONTRACT", contract: task.registeredContractId ?? task.id } }));
for (const pass of AUDIT_PASSES) jobs.push({ id: `audit:${pass.id}`, script: pass.args[0], command: pass.args, source: "audit clock" });
for (const script of ["pilot-runner", "freshness-shadow", "hunter-lane", "routine-civic-data-runner", "publish-now-runner", "publish-owner-snapshot", "intake-tripwire", "platform-census-runner", "publish-meeting-doors", "split-federal-people", "db-apply"]) {
  const name = `scripts/${script}.mts`;
  jobs.push({ id: `runtime:${script}`, script: name, command: [name,
    ...(["freshness-shadow", "hunter-lane"].includes(script) ? ["--provider=postgres"] : []),
    ...(script === "pilot-runner" ? ["--cycles=1", "--staging"] : []),
    ...(script === "publish-meeting-doors" ? ["--promote"] : []),
    ...(script === "freshness-shadow" ? ["--no-model"] : []),
    ...(script === "db-apply" ? ["--dry"] : [])], source: "standing runner", authority: {
      capability: ({ "freshness-shadow": "RESEARCH_CYCLE", "hunter-lane": "RESEARCH_CYCLE", "platform-census-runner": "ROUTINE_SUPERVISOR",
        "routine-civic-data-runner": "ROUTINE_SUPERVISOR", "publish-now-runner": "ROUTINE_SUPERVISOR",
        "publish-owner-snapshot": "CONSOLE_PUBLISHER", "intake-tripwire": "INTAKE_RUNTIME", "split-federal-people": "FEDERAL_PEOPLE_SPLIT",
        "publish-meeting-doors": "ROUTINE_CONTRACT" } as Record<string, string>)[script] ?? "STANDING_PARENT",
      contract: script === "publish-meeting-doors" ? "meeting-doors" : null,
    } });
}
if (arg("extra-jobs")) {
  const extra = JSON.parse(await readFile(resolve(arg("extra-jobs")!), "utf8")) as { jobs: Job[] };
  for (const job of extra.jobs) {
    if (typeof job.id !== "string" || !job.script.startsWith("scripts/") || job.command[0] !== job.script)
      throw Error("RH01 supplemental jobs must name their actual runner command");
    jobs.push(job);
  }
}
const inventory = [...new Map([...(savedInventory?.jobs ?? jobs), ...(savedInventory ? jobs.filter(job => job.source !== "standing source contract" && job.source !== "audit clock" && job.source !== "standing runner") : [])].map(job => [job.id, job])).values()]
  .map(job => ["runtime:hunter-lane", "runtime:platform-census-runner"].includes(job.id)
    ? { ...job, authority: { capability: job.id === "runtime:hunter-lane" ? "RESEARCH_CYCLE" : "ROUTINE_SUPERVISOR", contract: null } } : job)
  .map(job => activePima && job.id === "runtime:freshness-shadow"
    ? { ...job, command: job.command.filter(argument => argument !== "--no-model") } : job);
if (savedInventory) nativeDoorInventory = savedInventory.nativeDoorInventory ?? null;
let selection = inventory.filter(job => !only || only.includes(job.id) || only.includes(job.script.split("/").at(-1)!));
if (!selection.length) throw Error("RH01 selected no registered jobs");
await writeFile(join(directory, "inventory.json"), JSON.stringify({ codeRoot, phase, nativeDoorInventory, jobs: inventory }, null, 2));
if (process.argv.includes("--inventory")) {
  await writeFile(join(directory, "offers.json"), JSON.stringify({ allOfferedAt: null, offers: workloadOffers(selection) }, null, 2));
  process.stdout.write(`${JSON.stringify({ inventory: join(directory, "inventory.json"), jobs: inventory.length, scripts: [...new Set(inventory.map(job => job.script))].sort() })}\n`);
  process.exit(0);
}

process.env.WTP_RH01_DIRECTORY = directory;
const { verifyReadonly } = await import("./rh01-readonly-runtime.mts");
await verifyReadonly();
if (process.argv.includes("--representatives")) {
  const sql = neon(process.env.WTP_PRODUCTION_DATABASE_URL_READONLY!);
  const sizes = await sql.query(`SELECT t.id, coalesce(pg_column_size(c.candidate),0) AS size
    FROM jsonb_to_recordset($1::jsonb) t(id text,"recordClass" text,scope text)
    LEFT JOIN civic_data_promotions p ON p.record_class=t."recordClass" AND p.scope=t.scope
    LEFT JOIN civic_data_candidates c ON c.id=p.current_version_id`, [JSON.stringify(selection.map(({ id, recordClass, scope }) => ({ id, recordClass, scope })))]);
  const sizeById = new Map(sizes.map(row => [String(row.id), Number(row.size)]));
  const mode = (job: Job) => JSON.stringify(job.command.filter(argument => !/^--state=/i.test(argument)));
  const largest = new Map<string, Job>();
  for (const job of selection) {
    const key = mode(job), prior = largest.get(key);
    if (!prior || (sizeById.get(job.id) ?? 0) > (sizeById.get(prior.id) ?? 0)) largest.set(key, job);
  }
  selection = [...largest.values()];
  if (process.argv.includes("--include-largest-states")) {
    const retained = new Map(selection.map(job => [job.id, job]));
    for (const job of inventory) if (selection.some(chosen => chosen.script === job.script) &&
        job.command.some(argument => /^--state=(?:CA|TX)$/i.test(argument))) retained.set(job.id, job);
    selection = [...retained.values()];
  }
  await writeFile(join(directory, "selected.json"), JSON.stringify(selection.map(job => ({ ...job, priorCandidateBytes: sizeById.get(job.id) ?? 0 })), null, 2));
}
const offers = workloadOffers(selection);

const readStatus = (pid: number) => {
  try {
    const status = readFileSync(`/proc/${pid}/status`, "utf8");
    return { rss: Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1] ?? 0) * 1024, peak: Number(/^VmHWM:\s+(\d+)/m.exec(status)?.[1] ?? 0) * 1024,
      parent: Number(/^PPid:\s+(\d+)/m.exec(status)?.[1] ?? 0) };
  } catch { return null; }
};
function sample() {
  const rows = new Map<number, NonNullable<ReturnType<typeof readStatus>>>();
  for (const name of readdirSync("/proc")) if (/^\d+$/.test(name)) { const row = readStatus(Number(name)); if (row) rows.set(Number(name), row); }
  return rows;
}
function family(root: number, rows: ReturnType<typeof sample>) {
  const included = new Set([root]);
  for (;;) { let changed = false; for (const [pid, row] of rows) if (included.has(row.parent) && !included.has(pid)) { included.add(pid); changed = true; } if (!changed) break; }
  return included;
}
const tree = (root: number, rows: ReturnType<typeof sample>) => [...family(root, rows)].reduce((sum, pid) => sum + (rows.get(pid)?.rss ?? 0), 0);
function terminateTree(root: number | undefined): void {
  if (root === undefined) return;
  const rows = sample(), included = new Set([root]);
  for (;;) { let changed = false; for (const [pid, row] of rows) if (included.has(row.parent) && !included.has(pid)) { included.add(pid); changed = true; } if (!changed) break; }
  for (const pid of [...included].reverse()) {
    try { process.kill(pid, "SIGTERM"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
  }
}

const environment: NodeJS.ProcessEnv = { ...process.env, WTP_RH01_DIRECTORY: directory, WTP_RH01_SHARED_STATE_DIRECTORY: directory, WTP_RH01_CODE_ROOT: codeRoot, WTP_RH01_HARNESS_ROOT: harnessRoot, NODE_USE_ENV_PROXY: "1", WTP_VITAL_SIGNS_REPORT: "1" };
// An archive has no .git: its caller supplies the exact archived commit instead of inheriting this checkout's identity.
const codeRevision = arg("release-sha") ?? execFileSync("git", ["rev-parse", "HEAD"], { cwd: codeRoot, encoding: "utf8" }).trim();
if (!/^[a-f0-9]{40}$/.test(codeRevision)) throw Error("RH01 --release-sha must name the full immutable code snapshot SHA");
environment.WTP_WORKER_MEMORY_RELEASE = codeRevision;
process.env.WTP_WORKER_MEMORY_RELEASE = codeRevision;
environment.NODE_OPTIONS = `${environment.NODE_OPTIONS ?? ""} --import=${join(harnessRoot, "scripts/rh01-loader.mjs")}`;
// Publication credentials are never available to a measurement child.
for (const key of Object.keys(environment)) if (key !== "SOCRATA_APP_TOKEN" && /TOKEN|WRITE|SECRET|BLOBS|ANTHROPIC|OPENAI|EXA|BRAVE/.test(key)) delete environment[key];
// Staging is an existing authority mode. The real production connections keep their verified read-only roles;
// the loader routes publication mutations to disposable local stores.
if (process.argv.includes("--runtime-controlled")) {
  environment.WTP_RUNTIME_MODE = "staging"; environment.WTP_DB_ROLE = "local";
  environment.WTP_RUNTIME_AUTHORITY_SHA = codeRevision;
}
if (activePima) {
  if (!process.argv.includes("--runtime-controlled") || !savedInventory) throw Error("RH01 active diagnostic requires controlled authority and the saved exact inventory");
  const descriptor = arg("model-broker") ?? environment.WTP_RH01_MODEL_BROKER;
  if (!descriptor || JSON.parse(await readFile(descriptor, "utf8")).authorized !== true) throw Error("RH01 active diagnostic requires the explicitly authorized shared broker");
  environment.WTP_RH01_MODEL_BROKER = resolve(descriptor);
  environment.WTP_RH01_MODEL_PHASE = phase;
  environment.WTP_CONTINUOUS_HUNTERS = "1";
  environment.WTP_HUNTER_LANE_ARMING = join(directory, "hunter-arming.sqlite");
  delete environment.WTP_RH01_MODEL_CAPTURE; // The full run executes native production-scoped reads.
  environment.NODE_OPTIONS += ` --import=${join(harnessRoot, "scripts/rh01-model-preload.mjs")}`;
}
environment.WTP_WORKER_HOST_MEMORY_MIB = String(hostBytes / (1024 * 1024));
process.env.WTP_WORKER_HOST_MEMORY_MIB = environment.WTP_WORKER_HOST_MEMORY_MIB;
const facts = spawn(process.execPath, ["--experimental-strip-types", join(harnessRoot, "scripts/rh01-facts-server.mts")], { cwd: codeRoot, env: environment, stdio: ["ignore", "pipe", "pipe"] });
let factsPeak = 0, factsBytes = 0, controlHydrationBytes = 0;
let controlReadTiming: Record<string, number> | null = null;
const factsUrl = await new Promise<string>((accept, reject) => {
  let held = "";
  facts.once("error", reject);
  facts.once("exit", code => reject(Error(`RH01 local fact database ended ${code} before ready`)));
  facts.stderr.on("data", chunk => process.stderr.write(chunk));
  facts.stdout.on("data", chunk => {
    held += chunk;
    const lines = held.split("\n"); held = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("RH01_FACTS_READY ")) accept(JSON.parse(line.slice(17)).url);
      if (line.startsWith("RH01_FACTS_END ")) { const row = JSON.parse(line.slice(15)); factsPeak = row.peakRssBytes; factsBytes = row.remoteBytes; controlHydrationBytes = row.remoteControlBytes ?? 0; controlReadTiming = row.controlReadTiming ?? null; }
    }
  });
});
environment.WTP_RH01_FACTS_URL = factsUrl;
// Only the read adapter has the production CP credential. Failed interception can reach only loopback.
const productionControlHost = new URL(environment.WTP_CONTROL_PLANE_DATABASE_URL!).hostname;
for (const name of Object.keys(environment)) if (environment[name]?.includes(productionControlHost)) delete environment[name];
environment.WTP_CONTROL_PLANE_DATABASE_URL = "postgresql://wtp_cp_release_readonly:local-only@127.0.0.1:1/rh01";
if (activePima) {
  const preparation = spawn(process.execPath, ["--experimental-strip-types", "--import", join(harnessRoot, "scripts/register-test-loader.mjs"),
    join(harnessRoot, "scripts/rh01-active-overlay-prepare.mts"), `--phase=${phase}`,
    `--prepared=${resolve(arg("model-prepared") ?? `.scratch/rh01/active-model-${phase}`)}`], {
    cwd: harnessRoot, env: environment, stdio: ["ignore", "pipe", "pipe"],
  });
  let detail = "";
  const preparationStdout = createWriteStream(join(directory, "active-preparation.stdout.log"));
  const preparationStderr = createWriteStream(join(directory, "active-preparation.stderr.log"));
  preparation.stdout.on("data", chunk => { detail = (detail + chunk).slice(-4096); preparationStdout.write(chunk); process.stdout.write(chunk); });
  preparation.stderr.on("data", chunk => { detail = (detail + chunk).slice(-4096); preparationStderr.write(chunk); process.stderr.write(chunk); });
  const [status] = await once(preparation, "close");
  preparationStdout.end(); preparationStderr.end();
  activePreparation = status === 0 ? { status: "SUCCEEDED", code: 0 } : { status: "FAILED", code: typeof status === "number" ? status : null,
    detail: detail.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[redacted database connection]") };
  await writeFile(join(directory, "active-preparation-result.json"), JSON.stringify(activePreparation, null, 2));
  if (status !== 0) process.stderr.write("RH01_ACTIVE_PREPARATION_FAILED: native preparation remains incomplete; all exact inventory offers still proceed under native controls\n");
}
const active = new Map<number, { readonly job: Job; peak: number; ownPeak: number; readonly startedAt: number; readonly nested: Map<number, NestedPeak> }>();
const observed = new Map<string, ObservedChild>(), observedMemory = new Map<number, MemorySample>();
const observedByCommand = new Map<string, ObservedChild[]>();
let wakeOwnership: () => void = () => {};
let ownershipChanged = new Promise<void>(accept => { wakeOwnership = accept; });
function notifyOwnership(): void {
  const wake = wakeOwnership; ownershipChanged = new Promise<void>(accept => { wakeOwnership = accept; }); wake();
}
const allParts = new Map<string, { pid: number; hour: string; startedMs?: number; processes?: readonly string[]; bytes: Record<string, number>; peakRssBytes?: number }>();
function refreshObserved(): void {
  const root = join(directory, "observed-children");
  let changed = false;
  if (existsSync(root)) for (const name of readdirSync(root)) if (name.endsWith(".json")) {
    const file = join(root, name), prior = observed.get(file);
    if (prior?.settled) continue;
    try {
      const next = { ...JSON.parse(readFileSync(file, "utf8")), file: file.slice(0, -5) } as ObservedChild;
      changed ||= !prior || prior.settled !== next.settled; observed.set(file, next);
      const key = commandIdentity(next.command), rows = observedByCommand.get(key) ?? [];
      observedByCommand.set(key, [...rows.filter(row => row.file !== next.file), next]);
    }
    catch { /* The real parent is atomically observed again after its synchronous write finishes. */ }
  }
  if (changed) notifyOwnership();
  const parts = join(directory, "observed-byte-parts");
  if (existsSync(parts)) for (const name of readdirSync(parts)) if (name.endsWith(".json")) {
    try { const row = JSON.parse(readFileSync(join(parts, name), "utf8")); allParts.set(`${row.pid}/${row.startedMs}/${row.hour}`, row); }
    catch { /* A part can be replaced while sampled. */ }
  }
}
async function logTail(file: string): Promise<string> {
  const handle = await open(file, "r");
  try {
    const size = (await handle.stat()).size, buffer = Buffer.alloc(Math.min(size, 262144));
    await handle.read(buffer, 0, buffer.length, Math.max(0, size - buffer.length)); return buffer.toString("utf8");
  } finally { await handle.close(); }
}
let aggregatePeak = 0;
let watchdogExceeded = false;
const workerRoles = new Map<number, { role: string; status: string; taskId: string }>();
let leaseWorkersAtPeak: { pid: number; role: string; status: string }[] = [], maxSimultaneousLeaseWorkers = 0, maxSimultaneousWorkingLeaseWorkers = 0;
const startedAt = Date.now(), results: JobResult[] = [];
await writeFile(join(directory, "offers.json"), JSON.stringify({ allOfferedAt: new Date(startedAt).toISOString(), offers }, null, 2));
const { routineProcessSlots, workerMemoryHost, memoryReading } = admissionCode;
const memoryHost = workerMemoryHost({ shared: true, processes: () => {
  const rows = sample(), included = new Set([process.pid]);
  for (const pid of active.keys()) included.add(pid);
  for (;;) { let changed = false; for (const [pid, row] of rows) if (included.has(row.parent) && pid !== facts.pid && !included.has(pid)) { included.add(pid); changed = true; } if (!changed) break; }
  return [...rows].filter(([pid]) => included.has(pid)).map(([pid, row]) => ({ pid, parentPid: row.parent, rss: row.rss, peakRss: row.peak }));
} });
const slots = routineProcessSlots({ availableBytes: () => {
  const rows = sample();
  return Math.max(0, hostBytes - (rows.get(process.pid)?.rss ?? 0) - [...active.keys()].reduce((sum, pid) => sum + tree(pid, rows), 0));
}, host: memoryHost });
let admissionAtPeak: { readonly fitLeaseWorkers: number; readonly reservedGrowthBytes: number; readonly runnerTreeRssBytes: number } | null = null;
let minAdmissibleLeaseWorkers: number | null = null;
const ownerMemoryPeaks = new Map<number, OwnerMemoryPeak>();
let ownerPeaksWrittenAt = 0;
const interval = setInterval(() => {
  const rows = sample();
  refreshObserved();
  for (const child of observed.values()) {
    const memory = observedMemory.get(child.pid) ?? { peak: 0, ownPeak: 0, nested: new Map<number, NestedPeak>() };
    memory.ownPeak = Math.max(memory.ownPeak, rows.get(child.pid)?.peak ?? 0);
    memory.peak = Math.max(memory.peak, tree(child.pid, rows), memory.ownPeak);
    for (const pid of family(child.pid, rows)) if (pid !== child.pid) {
      const row = rows.get(pid); if (!row) continue;
      const prior = memory.nested.get(pid);
      memory.nested.set(pid, { pid, names: prior?.names ?? [], readerBytes: prior?.readerBytes ?? 0,
        peakRssBytes: Math.max(prior?.peakRssBytes ?? 0, row.rss, row.peak), treePeakRssBytes: Math.max(prior?.treePeakRssBytes ?? 0, tree(pid, rows)) });
    }
    observedMemory.set(child.pid, memory);
  }
  let sum = rows.get(process.pid)?.rss ?? 0;
  for (const [pid, row] of active) {
    const rss = tree(pid, rows);
    row.ownPeak = Math.max(row.ownPeak, rows.get(pid)?.peak ?? 0);
    row.peak = Math.max(row.peak, rss, row.ownPeak); sum += rss;
    for (const childPid of family(pid, rows)) if (childPid !== pid) {
      const child = rows.get(childPid); if (!child) continue;
      let nested = row.nested.get(childPid);
      if (!nested) {
        let script = "child";
        try { const command = readFileSync(`/proc/${childPid}/cmdline`, "utf8").split("\0"); script = (command.findLast(value => !value.startsWith("--") && /[.](?:ts|mts|mjs|js)$/.test(value)) ?? command[0] ?? script).split("/").at(-1)!; } catch { /* Exiting process. */ }
        nested = { pid: childPid, names: [`${script}#${childPid}`], peakRssBytes: 0, readerBytes: 0 }; row.nested.set(childPid, nested);
      }
      nested.peakRssBytes = Math.max(nested.peakRssBytes, child.peak, child.rss);
      nested.treePeakRssBytes = Math.max(nested.treePeakRssBytes ?? 0, tree(childPid, rows));
    }
  }
  const isPeak = sum >= aggregatePeak;
  aggregatePeak = Math.max(aggregatePeak, sum);
  const descendants = new Set(active.keys());
  for (;;) { let changed = false; for (const [pid, row] of rows) if (descendants.has(row.parent) && !descendants.has(pid)) { descendants.add(pid); changed = true; } if (!changed) break; }
  const leases: { pid: number; role: string; status: string }[] = [];
  for (const pid of descendants) {
    try {
      if (readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").some(value => /(?:^|\/)lease-worker[.]ts$/.test(value)))
        leases.push({ pid, role: workerRoles.get(pid)?.role ?? "UNASSIGNED", status: workerRoles.get(pid)?.status ?? "STARTING" });
    } catch { /* An observed worker can exit between samples. */ }
  }
  maxSimultaneousLeaseWorkers = Math.max(maxSimultaneousLeaseWorkers, leases.length);
  maxSimultaneousWorkingLeaseWorkers = Math.max(maxSimultaneousWorkingLeaseWorkers, leases.filter(row => row.status === "RUNNING").length);
  if (isPeak) leaseWorkersAtPeak = leases;
  const sampledProcesses = [...new Set([process.pid, ...descendants])].flatMap(pid => {
    const row = rows.get(pid); return row ? [{ pid, parentPid: row.parent, rss: row.rss, peakRss: row.peak }] : [];
  });
  if (isPeak) admissionAtPeak = null;
  void Promise.resolve(memoryHost.transact((state: { reservations: readonly { pid: number | null; entry: string }[] }) => {
    const processes = sampledProcesses;
    const at = new Date().toISOString();
    const reading = memoryReading({ at, totalBytes: hostBytes, availableBytes: Math.max(0, hostBytes - sum),
      rootPid: process.pid, rows: processes, state, leaseWorkerPeakBytes: leaseBytes });
    // Use the native ownership split for both readings: unmanaged browser/OCR
    // descendants belong to their owner, separately admitted children do not.
    const highWater = memoryReading({ at, totalBytes: hostBytes, availableBytes: Math.max(0, hostBytes - sum),
      rootPid: process.pid, rows: processes.map(row => ({ ...row, rss: Math.max(row.rss, row.peakRss ?? 0) })), state,
      leaseWorkerPeakBytes: leaseBytes });
    const keep = (pid: number | null, entry: string, rss: number, hwm: number) => {
      if (pid === null) return;
      const prior = ownerMemoryPeaks.get(pid) ?? { pid, entries: [], samples: 0, firstSeenAt: at, lastSeenAt: at,
        exclusiveOwnerPeakRssBytes: 0, exclusiveOwnerHwmBoundBytes: 0, ownPeakRssBytes: 0, inclusiveTreePeakRssBytes: 0 };
      if (!prior.entries.includes(entry)) prior.entries.push(entry);
      prior.samples++; prior.lastSeenAt = at;
      prior.exclusiveOwnerPeakRssBytes = Math.max(prior.exclusiveOwnerPeakRssBytes, rss);
      prior.exclusiveOwnerHwmBoundBytes = Math.max(prior.exclusiveOwnerHwmBoundBytes, hwm);
      prior.ownPeakRssBytes = Math.max(prior.ownPeakRssBytes, rows.get(pid)?.peak ?? 0);
      prior.inclusiveTreePeakRssBytes = Math.max(prior.inclusiveTreePeakRssBytes, tree(pid, rows));
      ownerMemoryPeaks.set(pid, prior);
    };
    reading.parents.forEach((parent: { pid: number; rssBytes: number }, index: number) =>
      keep(parent.pid, "managed-parent", parent.rssBytes, highWater.parents[index]?.rssBytes ?? parent.rssBytes));
    reading.reservations.forEach((reservation: { rssBytes: number }, index: number) => {
      const identity = state.reservations[index];
      if (identity) keep(identity.pid, identity.entry, reservation.rssBytes, highWater.reservations[index]?.rssBytes ?? reservation.rssBytes);
    });
    if (Date.now() - ownerPeaksWrittenAt >= 5000) {
      ownerPeaksWrittenAt = Date.now();
      void writeFile(join(directory, "owner-memory-peaks.json"), JSON.stringify([...ownerMemoryPeaks.values()])).catch(() => {});
    }
    minAdmissibleLeaseWorkers = Math.min(minAdmissibleLeaseWorkers ?? Infinity, reading.fitLeaseWorkers);
    if (isPeak) admissionAtPeak = reading;
  }, false)).catch(() => { if (isPeak) admissionAtPeak = null; });
  // Capture roles, ownership and admission from the same pre-termination sample.
  if (sum > watchdogBytes && !watchdogExceeded) {
    watchdogExceeded = true;
    process.stderr.write(`RH01_MEASUREMENT_WATCHDOG ${JSON.stringify({ runnerBytes: sum, ceilingBytes: watchdogBytes, productionProcessesStopped: 0 })}\n`);
    for (const pid of active.keys()) terminateTree(pid);
  }
}, 100);
const loaderArgs = ["--experimental-strip-types", "--import", join(codeRoot, "scripts/register-test-loader.mjs"), "--import", join(harnessRoot, "scripts/rh01-loader.mjs")];
async function recordResult(result: JobResult): Promise<JobResult> {
  results.push(result);
  await appendFile(join(directory, "progress.jsonl"), JSON.stringify(result) + "\n");
  await writeFile(join(directory, "results.partial.json"), JSON.stringify({ aggregatePeakRssBytes: aggregatePeak,
    activeJobs: [...active.values()].map(row => row.job.id), settled: results }, null, 2));
  process.stdout.write(`RH01_JOB ${JSON.stringify(result)}\n`);
  return result;
}
async function runDirect(job: Job): Promise<JobResult> {
    const local = join(directory, createHash("sha256").update(job.id).digest("hex").slice(0, 16));
    await mkdir(local, { recursive: true });
    const env = { ...environment, WTP_RH01_DIRECTORY: local, WTP_RH01_JOB_ID: job.id };
    if (process.argv.includes("--runtime-controlled") && job.authority) Object.assign(env, {
      WTP_RUNTIME_AUTHORITY_REPO: codeRoot, WTP_RUNTIME_AUTHORITY_SHA: environment.WTP_RUNTIME_AUTHORITY_SHA,
      WTP_RUNTIME_AUTHORITY_CAPABILITY: job.authority.capability, WTP_RUNTIME_AUTHORITY_CONTRACT: job.authority.contract ?? "",
      WTP_RUNTIME_AUTHORITY_PARENT_PID: String(process.pid), WTP_RUNTIME_AUTHORITY_NONCE: randomBytes(32).toString("hex"),
    });
    let release: (() => void) & { observe?: (pid: number) => void };
    try {
      if (watchdogExceeded) throw Error("RH01 measurement watchdog ended the controlled replay; production jobs remain unchanged");
      release = await slots.acquire(`${job.id}/${job.script}`, Date.now() + Number(arg("admission-ms") ?? 600000));
      if (watchdogExceeded) { release(); throw Error("RH01 measurement watchdog ended the controlled replay; production jobs remain unchanged"); }
    }
    catch (error) {
      const result = { ...job, complete: false, peakRssBytes: null, error: error instanceof Error ? error.message : String(error), logDirectory: local };
      return recordResult(result);
    }
    const command = job.command[0].startsWith("scripts/rh01-") ? [join(harnessRoot, job.command[0]), ...job.command.slice(1)] : job.command;
    const child = spawn(process.execPath, [...loaderArgs, ...command], { cwd: codeRoot, env, stdio: ["ignore", "pipe", "pipe"] });
    const start = Date.now(), reading = { job, peak: 0, ownPeak: 0, startedAt: start, nested: new Map<number, NestedPeak>() };
    if (child.pid) active.set(child.pid, reading);
    if (child.pid) release.observe?.(child.pid);
    let stdout = "", stderr = "", refusedOperation = false;
    const stdoutFile = createWriteStream(join(local, "stdout.log")), stderrFile = createWriteStream(join(local, "stderr.log"));
    child.stdout.pipe(stdoutFile); child.stderr.pipe(stderrFile);
    const parts = new Map<string, { pid: number; processes?: readonly string[]; bytes: Record<string, number>; peakRssBytes?: number }>();
    let sourceReceipt: SourceReceipt | null = null;
    let exceededBudget = false;
    const budget = setTimeout(() => { exceededBudget = true; terminateTree(child.pid); }, Number(arg("job-budget-ms") ?? 180000));
    let workerProtocol = "";
    child.stdout.on("data", chunk => {
      stdout = (stdout + chunk).slice(-262144); workerProtocol += chunk;
      refusedOperation ||= /RH01_(?:UNSUPPORTED|REMOTE_.*_BLOCKED)|WRITE_HANDLE_REFUSED|RuntimeAuthorityRefused/.test(String(chunk));
      const lines = workerProtocol.split("\n"); workerProtocol = lines.pop() ?? "";
      if (workerProtocol.length > 1048576) workerProtocol = workerProtocol.slice(-1048576);
      for (const line of lines) {
        if (line.startsWith("RH01_WORKER_ROLE ")) { const row = JSON.parse(line.slice(17)); workerRoles.set(row.pid, row); }
        if (line.startsWith("vital-signs-bytes ")) {
          const part = JSON.parse(line.slice(18)); parts.set(`${part.pid}/${part.hour}`, part);
          allParts.set(`${part.pid}/${part.startedMs}/${part.hour}`, part);
          reading.peak = Math.max(reading.peak, part.peakRssBytes ?? 0);
          if (part.pid === child.pid) reading.ownPeak = Math.max(reading.ownPeak, part.peakRssBytes ?? 0);
        }
        if (line.startsWith("RCD_RECEIPT=")) sourceReceipt = JSON.parse(line.slice(12));
      }
    }); child.stderr.on("data", chunk => {
      stderr = (stderr + chunk).slice(-262144);
      refusedOperation ||= /RH01_(?:UNSUPPORTED|REMOTE_.*_BLOCKED)|WRITE_HANDLE_REFUSED|RuntimeAuthorityRefused/.test(String(chunk));
    });
    const status = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(accept => {
      child.once("error", error => { stderr += error.message; });
      child.once("close", (code, signal) => accept({ code, signal }));
    });
    active.delete(child.pid!);
    clearTimeout(budget);
    release();
    await Promise.all([stdoutFile.writableFinished ? undefined : once(stdoutFile, "finish"), stderrFile.writableFinished ? undefined : once(stderrFile, "finish")]);
    const readerBytes = [...parts.values()].reduce((sum, part) => sum + (part.bytes.reader ?? 0), 0);
    const controlPlaneBytes = [...parts.values()].reduce((sum, part) => sum + (part.bytes["control-plane"] ?? 0), 0);
    const nested = reading.nested;
    for (const part of parts.values()) if (part.pid !== child.pid) {
      const prior = nested.get(part.pid);
      nested.set(part.pid, { ...prior, pid: part.pid, names: part.processes ?? prior?.names ?? [], peakRssBytes: Math.max(prior?.peakRssBytes ?? 0, part.peakRssBytes ?? 0),
        readerBytes: (prior?.readerBytes ?? 0) + (part.bytes.reader ?? 0) });
    }
    const completion = measuredCompletion({ script: job.script, stdout, stderr: stderr + (refusedOperation ? "\nRH01_UNSUPPORTED_RECORDED_OPERATION" : ""), code: status.code, timedOut: exceededBudget, receipt: sourceReceipt });
    try { reading.ownPeak = Math.max(reading.ownPeak, JSON.parse(readFileSync(join(directory, "process-exits", `${child.pid}.json`), "utf8")).peakRssBytes); }
    catch { /* A killed process cannot report its own exit high-water value. */ }
    const result: JobResult = { ...job, peakRssBytes: Math.max(reading.peak, reading.ownPeak), ownPeakRssBytes: reading.ownPeak, nestedProcesses: [...nested.values()], readerBytes, controlPlaneBytes, elapsedMs: Date.now() - start,
      complete: completion.complete, successful: completion.successful, completionReason: completion.reason, sourceReceipt, ...status,
      execution: "DIRECT", actualPid: child.pid, offeredAt: new Date(startedAt).toISOString(),
      ...(exceededBudget ? { error: "RH01 measurement budget ended; full job peak remains unmeasured" } : {}), logDirectory: local };
    return recordResult(result);
}
async function resultFromChild(job: Job, child: ObservedChild, ownerId: string): Promise<JobResult> {
  refreshObserved();
  const reading = observedMemory.get(child.pid) ?? { peak: 0, ownPeak: 0, nested: new Map<number, NestedPeak>() };
  try { reading.ownPeak = Math.max(reading.ownPeak, JSON.parse(readFileSync(join(directory, "process-exits", `${child.pid}.json`), "utf8")).peakRssBytes); }
  catch { /* A missing exit report is retained as a sampled lower bound. */ }
  const [stdout, stderr] = child.settled ? await Promise.all([logTail(`${child.file}.stdout.log`), logTail(`${child.file}.stderr.log`)]) : ["", ""];
  const receiptLine = stdout.split(/\r?\n/).findLast(line => line.startsWith("RCD_RECEIPT="));
  const receipt = receiptLine ? JSON.parse(receiptLine.slice(12)) as SourceReceipt : null;
  const completion = measuredCompletion({ script: job.script, stdout, stderr: stderr + (child.refusedOperation ? "\nRH01_UNSUPPORTED_RECORDED_OPERATION" : ""),
    code: child.status ?? null, timedOut: !child.settled || child.termination === "TIMED_OUT", receipt });
  const pids = new Set([child.pid, ...reading.nested.keys()]);
  const parts = [...allParts.values()].filter(part => pids.has(part.pid));
  return recordResult({ ...job, complete: completion.complete, successful: completion.successful, completionReason: completion.reason,
    peakRssBytes: Math.max(reading.peak, reading.ownPeak), ownPeakRssBytes: reading.ownPeak, nestedProcesses: [...reading.nested.values()],
    readerBytes: parts.reduce((sum, part) => sum + (part.bytes.reader ?? 0), 0),
    controlPlaneBytes: parts.reduce((sum, part) => sum + (part.bytes["control-plane"] ?? 0), 0),
    elapsedMs: Date.parse(child.finishedAt ?? new Date().toISOString()) - Date.parse(child.startedAt),
    code: child.status ?? null, signal: child.signal ?? null, logDirectory: child.file,
    execution: "ACTUAL_PARENT_CHILD", coveredByJobId: ownerId, actualPid: child.pid, offeredAt: new Date(startedAt).toISOString(), sourceReceipt: receipt });
}
const offerById = new Map(offers.map(offer => [offer.id, offer])), jobById = new Map(selection.map(job => [job.id, job]));
const pendingOffers = new Map<string, Promise<JobResult>>();
function runOffer(job: Job): Promise<JobResult> {
  const existing = pendingOffers.get(job.id); if (existing) return existing;
  const work = Promise.resolve().then(async () => {
    const offer = offerById.get(job.id)!;
    if (offer.aliasOf) {
      const actual = await runOffer(jobById.get(offer.aliasOf)!);
      return recordResult({ ...actual, ...job, execution: "IDENTICAL_COMMAND_ALIAS", coveredByJobId: actual.id,
        completionReason: `The identical actual command and authority ran as ${actual.id}: ${actual.completionReason}` });
    }
    if (offer.ownerId) {
      let ended = false;
      const owner = runOffer(jobById.get(offer.ownerId)!);
      void owner.finally(() => { ended = true; notifyOwnership(); });
      const identity = commandIdentity(job.command);
      for (;;) {
        const child = observedByCommand.get(identity)?.find(row => !job.authority ||
          row.authority?.capability === job.authority.capability && row.authority.contract === job.authority.contract);
        if (child?.settled || child && ended) return resultFromChild(job, child, offer.ownerId);
        if (ended && !child) break;
        await ownershipChanged;
      }
    }
    return runDirect(job);
  });
  pendingOffers.set(job.id, work); return work;
}

try {
  await Promise.all(selection.map(runOffer));
  while (!watchdogExceeded && Date.now() - startedAt < observationMs)
    await new Promise(resolve => setTimeout(resolve, Math.min(30000, observationMs - (Date.now() - startedAt))));
} finally {
  clearInterval(interval);
  const closed = new Promise<void>(accept => facts.once("close", () => accept()));
  facts.kill("SIGTERM"); await closed;
}
const elapsedMs = Date.now() - startedAt;
refreshObserved();
const logicalReaderBytes = factsBytes + [...allParts.values()].reduce((sum, part) => sum + (part.bytes.reader ?? 0), 0);
const physical = await physicalRunReads(environment.WTP_RH01_PRODUCTION_READ_LEDGER!, environment.WTP_RH01_RUN_ID!, startedAt);
const phasePhysical = await physicalRunReads(environment.WTP_RH01_PRODUCTION_READ_LEDGER!, environment.WTP_RH01_RUN_ID!, 0);
interface WorkerCompletion { pid: number; role: string; taskId: string; attemptId: string; complete: boolean; endedAt?: string; usd?: number | null; modelRequests?: number }
const workerCompletions: WorkerCompletion[] = [], completionDirectory = join(directory, "observed-worker-completions");
if (existsSync(completionDirectory)) for (const file of readdirSync(completionDirectory)) if (file.endsWith(".json")) {
  const row = JSON.parse(await readFile(join(completionDirectory, file), "utf8")) as WorkerCompletion;
  if (row.endedAt && Date.parse(row.endedAt) >= startedAt) workerCompletions.push(row);
}
let modelDiagnosticCalls: { role: string; usd: number | null; usage: unknown; requestHash: string; sentAt: string }[] = [];
if (activePima) {
  const descriptor = JSON.parse(await readFile(environment.WTP_RH01_MODEL_BROKER!, "utf8"));
  const ledger = new DatabaseSync(descriptor.budgetPath, { readOnly: true });
  try { modelDiagnosticCalls = ledger.prepare("SELECT role,actual_usd,usage_json,request_hash,sent_at FROM calls WHERE phase=? AND sent_at>=? ORDER BY id")
    .all(phase, new Date(startedAt).toISOString()).map(row => ({ role: String(row.role), usd: typeof row.actual_usd === "number" ? row.actual_usd : null,
      usage: typeof row.usage_json === "string" ? JSON.parse(row.usage_json) : null, requestHash: String(row.request_hash), sentAt: String(row.sent_at) })); }
  finally { ledger.close(); }
}
const requiredWorkerRoles = ["SCOUT", "PARSER", "VALIDATOR", "ADVERSARIAL_AUDITOR", "ACQUIRER"];
const roleCoverage = requiredWorkerRoles.map(role => {
  const completed = workerCompletions.filter(row => row.role === role && row.complete);
  const paid = role === "SCOUT" || role === "ADVERSARIAL_AUDITOR";
  const calls = modelDiagnosticCalls.filter(row => row.role === role && row.usd !== null && row.usage !== null);
  const providerUsd = calls.reduce((sum, row) => sum + row.usd!, 0), completedUsd = completed.reduce((sum, row) => sum + (row.usd ?? 0), 0);
  return { role, complete: completed.length > 0 && (!paid || calls.length > 0 && providerUsd + 0.000001 >= completedUsd), completed,
    providerCalls: calls.length, providerUsd, completedUsd };
});
const allRoleCoverageRequired = Boolean(savedInventory && !only && !process.argv.includes("--representatives"));
const attributed = new Set<number>();
for (const result of results) {
  const ownerMemory = result.actualPid ? ownerMemoryPeaks.get(result.actualPid) : undefined;
  if (ownerMemory) {
    result.exclusiveOwnerPeakRssBytes = ownerMemory.exclusiveOwnerPeakRssBytes;
    result.exclusiveOwnerHwmBoundBytes = ownerMemory.exclusiveOwnerHwmBoundBytes;
  }
  for (const nested of result.nestedProcesses ?? []) {
    const owner = ownerMemoryPeaks.get(nested.pid);
    if (owner) {
      nested.exclusiveOwnerPeakRssBytes = owner.exclusiveOwnerPeakRssBytes;
      nested.exclusiveOwnerHwmBoundBytes = owner.exclusiveOwnerHwmBoundBytes;
    }
  }
  const pids = new Set([...(result.actualPid ? [result.actualPid] : []), ...(result.nestedProcesses ?? []).map(row => row.pid)]);
  result.productionReaderResponseBytes = 0; result.productionControlResponseBytes = 0;
  for (const pid of pids) {
    const counts = physical.owners.get(pid); attributed.add(pid);
    result.productionReaderResponseBytes += counts?.reader ?? 0; result.productionControlResponseBytes += counts?.control ?? 0;
  }
}
const headroomBytes = 768 * 1024 * 1024;
const report = { phase, codeRoot, codeRevision, startedAt: new Date(startedAt).toISOString(), elapsedMs, headroomBytes, comparisonLeaseWorkerBytes: leaseBytes,
  activePreparation,
  requiredWorkerRoleCoverage: { required: allRoleCoverageRequired, roles: roleCoverage, missing: roleCoverage.filter(row => !row.complete).map(row => row.role),
    definition: "Actual native committed results produced during the workload. Preparation is excluded. SCOUT must finish its model loop; Auditor must commit a model review; ACQUIRER must complete a genuine generalized acquisition. Paid-role native usage is checked against the authorized phase broker's recorded provider usage." },
  modelDiagnosticSpend: { calls: modelDiagnosticCalls, measuredUsd: modelDiagnosticCalls.reduce((sum, row) => sum + (row.usd ?? 0), 0) },
  temporaryDirectory: process.env.TMPDIR ?? process.env.TEMP ?? process.env.TMP ?? null,
  observationRequestedMs: observationMs, observedFullHour: elapsedMs >= 3600000 && !watchdogExceeded,
  workload: "Every selected command offered simultaneously. Actual parent descendants cover identical child commands; never-spawned offers enter admission after their owner ends. No cadence replay or synthetic clock advance",
  watchdogExceeded, watchdogBytes,
  aggregatePeakRssBytes: aggregatePeak, localDatabasePeakRssBytes: factsPeak, controlHydrationBytes, controlReadTiming, readerBytes: physical.reader,
  readerBytesPerHour: physical.reader * 3600000 / elapsedMs, logicalReaderBytes,
  productionReadAccounting: { runId: environment.WTP_RH01_RUN_ID, path: environment.WTP_RH01_PRODUCTION_READ_LEDGER,
    phaseStartedAt: new Date(phaseStartedAt).toISOString(), workloadStartedAt: new Date(startedAt).toISOString(), finishedAt: new Date().toISOString(),
    setup: { readerResponseBytes: phasePhysical.reader - physical.reader, controlResponseBytes: phasePhysical.control - physical.control },
    workload: { readerResponseBytes: physical.reader, controlResponseBytes: physical.control },
    phaseTotal: { readerResponseBytes: phasePhysical.reader, controlResponseBytes: phasePhysical.control },
    readerResponseBytes: physical.reader, controlResponseBytes: physical.control,
    unattributedReaderResponseBytes: [...physical.owners].filter(([pid]) => !attributed.has(pid)).reduce((sum, [, row]) => sum + row.reader, 0),
    definition: "Actual production HTTP bodies and WebSocket payloads are counted once during this run. RPC owner PID attributes delegated reads to the calling job. Per-job native readerBytes are partial logical counters; productionReaderResponseBytes includes delegated reads. Parent owned-tree rows include descendants; aggregate bytes are never the sum of overlapping job rows." },
  observedSpareLeaseWorkers: Math.max(0, Math.floor((hostBytes - aggregatePeak - headroomBytes) / leaseBytes)),
  fitLeaseWorkers: (admissionAtPeak as { fitLeaseWorkers: number } | null)?.fitLeaseWorkers ?? null,
  additionalAdmissibleLeaseWorkers: (admissionAtPeak as { fitLeaseWorkers: number } | null)?.fitLeaseWorkers ?? null,
  leaseWorkersAtPeak, workingLeaseWorkersAtPeak: leaseWorkersAtPeak.filter(row => row.status === "RUNNING").length,
  maxSimultaneousLeaseWorkers, maxSimultaneousWorkingLeaseWorkers,
  minAdmissibleLeaseWorkers, admissionAtPeak,
  ownerMemoryPeaks: [...ownerMemoryPeaks.values()],
  ownerMemoryDefinition: "Phase-native memoryReading ownership per PID: parents by reading PID, reservations by the same index in shared state. The after implementation includes unmanaged descendants and excludes separately managed children. HWM bound repeats that identical ownership split with each live process RSS replaced by max(RSS, VmHWM); it is a conservative sum, not an observed simultaneous peak. Inclusive job trees and own-PID HWM remain separate. Baseline native ownership semantics are retained.",
  jobs: results, complete: !watchdogExceeded && activePreparation.status !== "FAILED" && (!allRoleCoverageRequired || roleCoverage.every(row => row.complete)) && results.length === selection.length && results.every(result => result.complete) && admissionAtPeak !== null,
  limits: ["The temporary fact database is separate from runner RSS, as production PostgreSQL is remote.", "Only a completed executable is a full-job measurement; every incomplete executable remains required work.",
    elapsedMs >= 3600000 && !watchdogExceeded ? "Reader bytes were observed for at least one real hour of this simultaneous-offer replay; this does not reproduce production cadence." : "Reader bytes per hour extrapolates this controlled interval, rather than observing a full hour of production cadence.",
    activePima ? "Only the explicitly authorized Pima model requests may spend; other production model work retains its existing controls and the broker scope." : "The no-model research parent cannot prove the paid hunter workload; that requires authentic replay or the explicitly approved isolated diagnostic."] };
await writeFile(output, JSON.stringify(report, null, 2));
process.stdout.write(`RH01_RESULT ${JSON.stringify({ output, complete: report.complete, peak: aggregatePeak, fitLeaseWorkers: report.fitLeaseWorkers })}\n`);
if (!report.complete) process.exitCode = 1;
