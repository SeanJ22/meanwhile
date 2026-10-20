/** Measurement-only loader: exact source executables, production reads, disposable publication writes. */
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { isMainThread } from "node:worker_threads";
import { installMeasurementNetworkBoundary } from "./rh01-network.mjs";
import { observeNativeBody } from "./rh01-native-body.mjs";

const root = process.env.WTP_RH01_CODE_ROOT ?? process.cwd();
const runtime = pathToFileURL(join(process.env.WTP_RH01_HARNESS_ROOT ?? root, "scripts/rh01-readonly-runtime.mts")).href;
const neonBridge = pathToFileURL(join(process.env.WTP_RH01_HARNESS_ROOT ?? root, "scripts/rh01-loopback-neon.mjs")).href;
const routeReplay = pathToFileURL(join(process.env.WTP_RH01_HARNESS_ROOT ?? root, "scripts/rh01-route-replay.mts")).href;
const browserEvidence = pathToFileURL(join(process.env.WTP_RH01_HARNESS_ROOT ?? root, "scripts/rh01-browser-evidence.mts")).href;
const localArtifacts = pathToFileURL(join(process.env.WTP_RH01_HARNESS_ROOT ?? root, "scripts/rh01-local-artifacts.mts")).href;

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
    const restricted = "this.restricted = options.restricted ?? null;";
    if (!source.includes(restricted)) throw Error("RH01 native restricted evidence provider seam did not match");
    source = source.replace(restricted, "this.restricted = options.restricted ?? rhRestrictedProvider({keyToRelativePath,reconcileExistingObject}) ?? null;");
    add(`import {restrictedMeasurementProvider as rhRestrictedProvider} from ${JSON.stringify(localArtifacts)};`);
  } else if (url.endsWith("/lib/control-plane/evidence/store.ts")) {
    for (const name of ["putArtifact", "readArtifact"]) {
      const declaration = `export async function ${name}(`;
      if (!source.includes(declaration)) throw Error(`RH01 native artifact custody seam did not match: ${name}`);
      source = source.replace(declaration, `async function rhOriginal${name}(`);
    }
    add(`import {withRestrictedMeasurementCustody as rhRestrictedCustody} from ${JSON.stringify(localArtifacts)};
      export function putArtifact(...args) { return rhRestrictedCustody('ACQUIRER',()=>rhOriginalputArtifact(...args)); }
      export function readArtifact(...args) { return rhRestrictedCustody(args[3],()=>rhOriginalreadArtifact(...args)); }`);
  } else if (url.endsWith("/lib/photos/store.ts")) {
    const declaration = "export async function storeRunScreenshot(";
    if (!source.includes(declaration)) throw Error("RH01 native screenshot writer did not match");
    source = source.replace(declaration, "async function rhOriginalStoreRunScreenshot(");
    add(`import {storeMeasurementScreenshot as rhLocalScreenshot} from ${JSON.stringify(runtime)};
      export async function storeRunScreenshot(key,bytes,io) { return rhOriginalStoreRunScreenshot(key,bytes,io??{put:rhLocalScreenshot}); }`);
  } else if (url.endsWith("/lib/control-plane/live-audit-log.ts")) {
    for (const name of ["recordClaimPass", "readRecentClaimPasses", "recordLookPass", "recordTaskPass", "recordSpeedPass"]) {
      const declaration = `export async function ${name}(`;
      if (!source.includes(declaration)) throw Error(`RH01 native audit lifecycle did not match: ${name}`);
      source = source.replace(declaration, `async function rhOriginal${name}(`);
    }
    add(`import {auditDueRepositories as rhAuditDue,observeLookPass as rhObserveLook} from ${JSON.stringify(runtime)};
      export async function recordClaimPass(repos,pass) { return rhOriginalrecordClaimPass(rhAuditDue(repos,{kind:'CLAIMS',week:pass.week}),pass); }
      export async function readRecentClaimPasses(repos,weeks) { return rhOriginalreadRecentClaimPasses(weeks.length===1?rhAuditDue(repos,{kind:'CLAIMS',week:weeks[0]}):repos,weeks); }
      export async function recordLookPass(repos,pass) { const local=rhAuditDue(repos,{kind:'LOOK',sha:pass.sha}); await rhOriginalrecordLookPass(local,pass); await rhObserveLook(local,pass); }
      export async function recordTaskPass(repos,pass) { await rhOriginalrecordTaskPass(repos,pass); await rhObserveTasks(repos,pass); }
      export async function recordSpeedPass(repos,pass) { await rhOriginalrecordSpeedPass(repos,pass); await rhObserveSpeed(repos,pass); }`);
    add(`import {observeResidentPass as rhObserveTasks,observeSpeedPass as rhObserveSpeed} from ${JSON.stringify(browserEvidence)};`);
  } else if (url.endsWith("/lib/health/resident-task-run.ts")) {
    const declaration = "export async function runTaskPlaces(";
    if (!source.includes(declaration)) throw Error("RH01 native resident place iterator did not match");
    source = source.replace(declaration, "async function rhOriginalRunTaskPlaces(");
    add(`import {observeResidentPlaces as rhObserveTaskPlaces} from ${JSON.stringify(browserEvidence)};
      export async function runTaskPlaces(input) { return rhObserveTaskPlaces(input,rhOriginalRunTaskPlaces); }`);
  } else if (url.endsWith("/scripts/resident-tasks.mts")) {
    const screen = "if (deadEnd === null) missing = await unmet(page, script.scope, script.checks);";
    if (!source.includes(screen)) throw Error("RH01 native resident final-screen check did not match");
    source = source.replace(screen, "if (deadEnd === null) { missing = await unmet(page, script.scope, script.checks); await rhResidentScreen(page,script.scope,script.checks); }");
    add(`import {observeResidentScreen as rhResidentScreen} from ${JSON.stringify(browserEvidence)};`);
  } else if (url.endsWith("/scripts/worst-case-speed-pass.mts")) {
    const targets = 'const targets = speedTargets(tasks, zips).filter((t) => t.surface !== "ask" || askZips.has(t.zip));';
    const visit = 'runs.push(await visit(target.surface === "ask" ? asker! : reader, target));';
    if (!source.includes(targets) || !source.includes(visit)) throw Error("RH01 native speed target loop did not match");
    source = source.replace(targets, targets + "\nrhPrepareSpeed(targets,RUNS);");
    source = source.replace(visit, 'runs.push(await rhSpeedTarget(target,()=>visit(target.surface === "ask" ? asker! : reader, target)));');
    add(`import {prepareSpeedObservation as rhPrepareSpeed,observeSpeedTarget as rhSpeedTarget} from ${JSON.stringify(browserEvidence)};`);
  } else if (url.endsWith("/scripts/look-pass.mts")) {
    const current = "hasLookedCommit(repos, served.sha)", before = "readLookedCommits(repos)";
    if (source.includes(current)) source = source.replace(current, "hasLookedCommit(rhAuditDue(repos,{kind:'LOOK',sha:served.sha}), served.sha)");
    else if (source.includes(before)) source = source.replace(before, "readLookedCommits(rhAuditDue(repos,{kind:'LOOK',sha:served.sha}))");
    else throw Error("RH01 native look scheduling read did not match");
    add(`import {auditDueRepositories as rhAuditDue} from ${JSON.stringify(runtime)};`);
  } else if (url.endsWith("/scripts/platform-census-runner.mts") || url.endsWith("/scripts/split-federal-people.mts")) {
    source = observeNativeBody(url.split("/").at(-1), source);
  } else if (url.endsWith("/lib/reader/cache.ts")) {
    source = source.replace("export async function purgeReaderCacheTags(", "async function rhOriginalPurgeReaderCacheTags(");
    add('export async function purgeReaderCacheTags() { return { purged: true, detail: "RH01 local publication" }; }');
  } else if (url.endsWith("/scripts/browser.mts")) {
    source = source.replace("if (blockWrites) {", "if (true) {");
    source = source.replace("    return context;", `    await context.route("**/*", async route => {
      const request = route.request();
      const ask=await rhAskResponse({url:request.url(),method:request.method(),headers:request.headers(),body:request.postData()});
      if(ask)return route.fulfill({status:ask.status,headers:ask.headers,body:ask.body});
      if (!rhAllowedRequest(request.url(), request.method())) return route.abort("blockedbyclient");
      return route.fallback();
    });\n    return context;`);
    add(`import { allowedMeasurementRequest as rhAllowedRequest } from ${JSON.stringify(pathToFileURL(join(process.env.WTP_RH01_HARNESS_ROOT ?? root, "scripts/rh01-network.mjs")).href)};`);
    add(`import {measurementAskResponse as rhAskResponse} from ${JSON.stringify(runtime)};`);
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
