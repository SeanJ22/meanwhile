/** Measurement-only loader: exact source executables, production reads, disposable publication writes. */
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { isMainThread } from "node:worker_threads";
import { installMeasurementNetworkBoundary } from "./rh01-network.mjs";

const root = process.env.WTP_RH01_CODE_ROOT ?? process.cwd();
const runtime = pathToFileURL(join(process.env.WTP_RH01_HARNESS_ROOT ?? root, "scripts/rh01-readonly-runtime.mts")).href;
const neonBridge = pathToFileURL(join(process.env.WTP_RH01_HARNESS_ROOT ?? root, "scripts/rh01-loopback-neon.mjs")).href;
const routeReplay = pathToFileURL(join(process.env.WTP_RH01_HARNESS_ROOT ?? root, "scripts/rh01-route-replay.mts")).href;

export async function resolve(specifier, context, nextResolve) {
  const parent = context.parentURL ?? "";
  const native = parent.startsWith(pathToFileURL(root + "/").href) && !parent.includes("/node_modules/") && !/\/scripts\/rh01-[^/]+$/.test(parent);
  if (specifier === "@neondatabase/serverless" && (native || parent === routeReplay) && parent !== neonBridge)
    return { url: neonBridge, shortCircuit: true };
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (!url.startsWith(pathToFileURL(root + "/").href) || url.includes("/node_modules/")) return result;
  let source = result.source === undefined || result.source === null ? null
    : typeof result.source === "string" ? result.source : Buffer.from(result.source).toString("utf8");
  if (result.format === "json" || url.endsWith(".json")) return source === null ? result : { ...result, source };
  if (source === null) return result;
  if (source.includes("RH01_LOADER_TRANSFORMED")) return result;
  const add = value => { source += `\n${value}\n`; };
  if (url.endsWith("/lib/civic-data/bounded-child-pass.ts")) {
    source = source.replace("export async function runBoundedChildPass(", "async function rhOriginalRunBoundedChildPass(");
    add(`import {observeChildStart as rhObserveStart,observeChildEnd as rhObserveEnd} from ${JSON.stringify(runtime)};
      export async function runBoundedChildPass(commands,options,...rest) {
        const files=new Map(),callbacks=new Map();
        return rhOriginalRunBoundedChildPass(commands,{...options,onStarting:async(command,index)=>{
          await options.onStarting?.(command,index);
          const started=command.onStarted;
          const observed=pid=>{command.onStarted=started;started?.(pid);files.set(command.id,rhObserveStart(command.id,command.args,pid,command.env??options.env));};
          callbacks.set(command.id,{command,started,observed});command.onStarted=observed;
        },onSettled:async(result,index)=>{const row=callbacks.get(result.id);if(row?.command.onStarted===row?.observed)row.command.onStarted=row.started;
          rhObserveEnd(files.get(result.id),result);await options.onSettled?.(result,index);}},...rest);
      }`);
  } else if (url.endsWith("/scripts/pilot-runtime-child.mts")) {
    source = source.replace("export async function runRuntimeChildren(", "async function rhOriginalRunRuntimeChildren(");
    source = source.replace("export function receiveChildVitalSigns(", "function rhOriginalReceiveChildVitalSigns(");
    add(`import {observeChildStart as rhObserveStart,observeChildEnd as rhObserveEnd,observeVitalPart as rhObserveVital} from ${JSON.stringify(runtime)};
      export function receiveChildVitalSigns(sink) { return rhOriginalReceiveChildVitalSigns(sink ? part=>{rhObserveVital(part);sink(part);} : sink); }
      export async function runRuntimeChildren(commands,options) {
        const files=new Map();
        const results=await rhOriginalRunRuntimeChildren(commands,{...options,onStarted:(id,child)=>{
          options.onStarted?.(id,child);
          const command=commands.find(value=>value.id===id);
          if(child.pid&&command)files.set(id,rhObserveStart(id,command.args,child.pid,command.env??options.env));
        }});
        for(const result of results)rhObserveEnd(files.get(result.id),result);
        return results;
      }`);
  } else if (url.endsWith("/lib/control-plane/workers/worker-slots.ts")) {
    const declaration = "async function hostProcesses(";
    if (!source.includes(declaration)) throw Error("RH01 native admission process probe did not match");
    source = source.replace(declaration, "async function rhNativeHostProcesses(");
    add(`import {runnerProcessRows as rhRunnerProcessRows} from ${JSON.stringify(pathToFileURL(join(process.env.WTP_RH01_HARNESS_ROOT ?? root, "scripts/rh01-remote-process.mts")).href)};
      async function hostProcesses() { return rhRunnerProcessRows(await rhNativeHostProcesses()); }`);
  } else if (url.endsWith("/lib/civic-data/production-write.ts")) {
    source = source.replace("export function prepareProductionCivicDataWrite(", "function rhOriginalPrepareProductionCivicDataWrite(");
    add(`import { assertReadonlyTargets as rhReadonlyTargets } from ${JSON.stringify(runtime)};
      export const prepareProductionCivicDataWrite = rhReadonlyTargets;`);
  } else if (url.endsWith("/lib/civic-data/store.ts")) {
    const constructor = "constructor(cacheOptions: { readonly purge?: ReaderCachePurger } = {}) { this.cacheOptions = cacheOptions; }";
    if (!source.includes(constructor)) throw Error("RH01 production store constructor did not match its measurement adapter");
    source = source.replace(constructor, "constructor(cacheOptions: { readonly purge?: ReaderCachePurger } = {}) { this.cacheOptions = cacheOptions; return rhRoutineOverlay(this, new MemoryRoutineDataStore()); }");
    source = source.replace("takeStatePublicationPrior(this, recordClass, scope)", "takeStatePublicationPrior(rhRoutineIdentity(this), recordClass, scope)");
    add(`import { routineOverlay as rhRoutineOverlay, routineStoreIdentity as rhRoutineIdentity } from ${JSON.stringify(runtime)};`);
  } else if (url.endsWith("/lib/control-plane/repository/pg-store.ts")) {
    source = source.replace("const sql = Object.assign(neon(connectionString), {", "const sql = Object.assign(rhControlSql(neon(connectionString)), {");
    source = source.replace("const locks = pgLockManager(connectionString);", "const locks = process.env.WTP_RH01_FACTS_URL ? rhControlLocks() : pgLockManager(connectionString);");
    source = source.replace("async withPinnedConnection<T>(operation: (pinned: Sql) => Promise<T>): Promise<T> {", "async withPinnedConnection<T>(operation: (pinned: Sql) => Promise<T>): Promise<T> { if (process.env.WTP_RH01_FACTS_URL) return operation({ query: rhControlSql(neon(connectionString)).query });");
    source = source.replace("export async function createPgRepositories(", "async function rhOriginalCreatePgRepositories(");
    add(`import { controlOverlay as rhControlOverlay, controlSql as rhControlSql, controlLocks as rhControlLocks } from ${JSON.stringify(runtime)};
      export async function createPgRepositories(connection, at, options = {}) {
        const original = await rhOriginalCreatePgRepositories(connection, at, { ...options, skipBootstrap: true });
        const overlay = rhControlOverlay(original);
        placeReadConnections.set(overlay, placeReadConnections.get(original));
        return overlay;
      }`);
  } else if (url.endsWith("/lib/facts/db.ts")) {
    source = source.replace("export function readerFactDb(", "function rhOriginalReaderFactDb(");
    add(`import { readonlyFactDb as rhReadonlyFactDb } from ${JSON.stringify(runtime)};
      export const readerFactDb = rhReadonlyFactDb;`);
  } else if (url.endsWith("/lib/reader/database.ts")) {
    source = source.replace("export function readerDatabaseQuery(", "function rhOriginalReaderDatabaseQuery(");
    add(`import { readonlyReaderQuery as rhReadonlyReaderQuery } from ${JSON.stringify(runtime)};
      export function readerDatabaseQuery(deadlineMs) { if (installed !== undefined) return installed; return rhReadonlyReaderQuery() ?? rhOriginalReaderDatabaseQuery(deadlineMs); }`);
  } else if (url.endsWith("/lib/civic-data/raw-capture-remote.ts")) {
    source = source.replace("export function rawCaptureVault(", "function rhOriginalRawCaptureVault(");
    add(`import { DurableEvidenceStore as RhLocalEvidenceStore } from "../control-plane/evidence/durable-store.ts";
      export function rawCaptureVault() { return new RhLocalEvidenceStore((process.env.WTP_RH01_SHARED_STATE_DIRECTORY ?? process.env.WTP_RH01_DIRECTORY) + "/vault", { remote: null }); }`);
  } else if (url.endsWith("/lib/control-plane/evidence/netlify-store.ts")) {
    source = source.replace("export function netlifyEvidenceStoreFromEnv(", "function rhOriginalNetlifyEvidenceStoreFromEnv(");
    add(`import { DurableEvidenceStore as RhLocalVault } from "./durable-store.ts";
      export function netlifyEvidenceStoreFromEnv() { return new RhLocalVault((process.env.WTP_RH01_SHARED_STATE_DIRECTORY ?? process.env.WTP_RH01_DIRECTORY) + "/vault", { remote: null }); }`);
  } else if (url.endsWith("/lib/sources/prl/archive-store.ts")) {
    source = source.replace("export function resolveS3ArchiveStore(", "function rhOriginalResolveS3ArchiveStore(");
    add(`import { LocalFileArchiveStore as RhLocalPrlArchive } from "./archive-store-local.ts";
      export function resolveS3ArchiveStore() { return new RhLocalPrlArchive(process.env.WTP_RH01_DIRECTORY + "/prl-archive"); }`);
  } else if (url.endsWith("/lib/control-plane/evidence/durable-store.ts")) {
    source = source.replace("this.remote = options.remote === undefined ? netlifyEvidenceStoreFromEnv() : options.remote;", "this.remote = null;");
    source = source.replace("constructor(root: string, options: DurableEvidenceStoreOptions = {}) {", "constructor(root: string, options: DurableEvidenceStoreOptions = {}) { root = process.env.WTP_RH01_HELD_VAULT_DIRECTORY ?? (process.env.WTP_RH01_SHARED_STATE_DIRECTORY ?? process.env.WTP_RH01_DIRECTORY) + '/vault';");
  } else if (url.endsWith("/lib/reader/cache.ts")) {
    source = source.replace("export async function purgeReaderCacheTags(", "async function rhOriginalPurgeReaderCacheTags(");
    add('export async function purgeReaderCacheTags() { return { purged: true, detail: "RH01 local publication" }; }');
  } else if (url.endsWith("/scripts/browser.mts")) {
    source = source.replace("if (blockWrites) {", "if (true) {");
    source = source.replace("    return context;", `    await context.route("**/*", async route => {
      const request = route.request();
      if (!rhAllowedRequest(request.url(), request.method())) return route.abort("blockedbyclient");
      return route.fallback();
    });\n    return context;`);
    add(`import { allowedMeasurementRequest as rhAllowedRequest } from ${JSON.stringify(pathToFileURL(join(process.env.WTP_RH01_HARNESS_ROOT ?? root, "scripts/rh01-network.mjs")).href)};`);
  } else if (url.endsWith("/lib/control-plane/workers/lease-worker.ts")) {
    const dispatch = "const result = await dispatchAutonomousTask(runtime, task);";
    if (!source.includes(dispatch)) throw Error("RH01 native lease dispatch observation did not match");
    source = source.replace(dispatch, dispatch + " await rhObserveWorkerCompletion(repos,task,result);");
    add(`import { observeWorkerCompletion as rhObserveWorkerCompletion } from ${JSON.stringify(runtime)};`);
    source = source.replace('broker.send("task-start", "", id);', 'broker.send("task-start", "", id); process.env.WTP_RH01_WORKER_TASK_ID=id; console.log("RH01_WORKER_ROLE " + JSON.stringify({pid:process.pid,role:task.workerTask?.role ?? "SCOUT",status:"RUNNING",taskId:id}));');
    source = source.replace('broker.send("result", "", { ...result,', 'console.log("RH01_WORKER_ROLE " + JSON.stringify({pid:process.pid,role:task.workerTask?.role ?? "SCOUT",status:"IDLE",taskId:id})); broker.send("result", "", { ...result,');
  } else if (url.endsWith("/scripts/promote-registry-runtime.mts")) {
    source = source.replace('onResult: place => {', 'onResult: place => { console.log("RH01_NATIONAL_RESULT " + JSON.stringify({zip:place.zip,completed:!("deferred" in place),deferred:"deferred" in place ? place.deferred : null}));');
  } else if (url.endsWith("/scripts/freshness-shadow.mts")) {
    const afterPublication = "exitAfterDrainGrace({";
    if (!source.includes(afterPublication)) throw Error("RH01 freshness lifecycle did not match its completion observer");
    source = source.replace(afterPublication, `console.log("RH01_FRESHNESS_RESULT " + JSON.stringify({
      state:canonicalOutcome.state,durable:canonicalOutcome.durable,simulated:dry,filtered:filteredCycle,
      registeredUnits:runRecord.registry.registeredUnits,workedUnits:runRecord.registry.workedUnits,
      obligations:runRecord.obligations,dispatched:runRecord.dispatched,noModel,cycleId:canonicalOutcome.cycleId}));\n${afterPublication}`);
  } else if (url.endsWith("/scripts/pilot-runner.mts")) {
    source = source.replace("const PARENT_CODE_SHA = headSha(ROOT);", "const PARENT_CODE_SHA = process.env.WTP_RUNTIME_AUTHORITY_SHA ?? headSha(ROOT);");
    // Use the existing typed staging child handoff; retaining the parent's
    // STANDING_PARENT envelope would make every correctly guarded child refuse.
    const stagingHandoff = "if (STAGING) return billingCollector ? { ...parentEnv } : withoutBillingSecrets(parentEnv);";
    if (!source.includes(stagingHandoff)) throw Error("RH01 pilot staging handoff did not match the actual typed authority adapter");
    source = source.replace(stagingHandoff,
      "if (STAGING) return admittedRuntimeChildEnvironment({parentEnv,capability,parentPid:process.pid,billingCollector});");
    const afterCycle = "const stagedRows = record.staged ?? [];";
    if (!source.includes(afterCycle)) throw Error("RH01 pilot lifecycle did not match its completion observer");
    source = source.replace(afterCycle, `console.log("RH01_PILOT_CYCLE " + JSON.stringify({ok:result.ok,recorded:result.recordPath!==null,
      registeredUnits:record.registry?.registeredUnits,workedUnits:record.registry?.workedUnits}));\n${afterCycle}`);
  }
  return { ...result, source: source + "\n/* RH01_LOADER_TRANSFORMED */\n" };
}

// --import executes this module once; the registered instance supplies load().
if (isMainThread) {
  installMeasurementNetworkBoundary();
  if (process.env.WTP_RH01_DIRECTORY) process.once("exit", () => {
    const directory = join(process.env.WTP_RH01_SHARED_STATE_DIRECTORY ?? process.env.WTP_RH01_DIRECTORY, "process-exits");
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, `${process.pid}.json`), JSON.stringify({ pid: process.pid,
      peakRssBytes: process.resourceUsage().maxRSS * 1024, at: new Date().toISOString() }));
  });
  register(import.meta.url);
}
