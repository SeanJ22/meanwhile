import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { execFileSync } from "node:child_process";
import { Client } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import type { StandingObligation } from "../lib/control-plane/scheduler/durable.ts";
import type { NeonBytesHour } from "../lib/db/transfer-by-caller.ts";
import type { FixMapRow } from "../lib/method/fix-map.ts";

interface RunReport {
  sourceSha:string; run: number; ms: number; responseBytes: number; requestBytes: number; databaseWalBytes:number; peakRssBytes: number;
  output: unknown; digest: string; hours: NeonBytesHour[];
}

const arg = (name: string, fallback = "") => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const root = resolve(arg("root", process.cwd()));
const sourceRoot = resolve(arg("source", process.cwd()));
const legacy = arg("legacy") === "true";
const now = "2026-10-15T12:00:00.000Z";
const importAt = (path: string) => import(pathToFileURL(join(root, path)).href);
const scenario = arg("scenario", "manual");
const repetitions = Number(arg("repetitions", "3"));
const history = Number(arg("history", "4"));
const runsPerDay = Number(arg("runs-per-day", "1440"));
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const mode = arg("mode", "parent");
const sourceSha=execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim();

if (mode === "worker") await worker();
else await parent();

async function worker() {
  const { neonConfig } = await import("@neondatabase/serverless");
  const inflight = new Map<number, { resolve: (value: string) => void; reject: (error: Error) => void }>();
  let sequence = 0;
  process.on("message", (message: { id: number; body?: string; error?: string }) => {
    const pending = inflight.get(message.id);
    if (!pending) return;
    inflight.delete(message.id);
    if (message.error) pending.reject(new Error(message.error));
    else pending.resolve(message.body!);
  });
  const proxy=(type:string,body?:unknown):Promise<string>=>{
    const id=++sequence;
    return new Promise((resolve,reject)=>{inflight.set(id,{resolve,reject});process.send!({type,id,body});});
  };
  neonConfig.fetchFunction = async (_url: unknown, options?: RequestInit) =>
    new Response(await proxy("query",options?.body), { headers: { "content-type": "application/json" } });
  const pg = await importAt("lib/control-plane/repository/pg-store.ts");
  const copies = await importAt("lib/control-plane/repository/incremental-reads.ts");
  const transfer = await importAt("lib/db/transfer-by-caller.ts");
  transfer.keepNeonBytesInProcess();
  pg.installHeldCopies(() => copies.openHeldCopies(arg("copies"), { slackMs: 0 }));
  const repos = await pg.createPgRepositories("postgresql://fixture:fixture@ep-cp-scale.us-east-2.aws.neon.tech/fixture", now, { skipBootstrap: true,...(arg("planning-state")?{planningState:arg("planning-state")}: {}) });
  const places = JSON.parse(await readFile(arg("selected"), "utf8")) as string[];
  const results: RunReport[] = [];
  for (let run = 0; run < repetitions; run++) {
    const before = transfer.processNeonBytes().reduce((sum: number, hour: { bytes: Record<string, number> }) => sum + hour.bytes["control-plane"], 0);
    const sentBefore = transfer.processNeonBytes().reduce((sum: number, hour: { sent: Record<string, { bytes: number }> }) => sum + hour.sent["control-plane"].bytes, 0);
    const walBefore=BigInt(await proxy("wal"));
    const began = performance.now();
    const output = await workload(repos, places, run);
    const duration=performance.now()-began;
    const walAfter=BigInt(await proxy("wal"));
    const parts = transfer.takeNeonBytesHours();
    const read = parts.reduce((sum: number, hour: { bytes: Record<string, number> }) => sum + hour.bytes["control-plane"], 0);
    const sent = parts.reduce((sum: number, hour: { sent: Record<string, { bytes: number }> }) => sum + hour.sent["control-plane"].bytes, 0);
    for (const part of parts) {
      const summary = transfer.summarizeNeonBytes(part, 1000);
      assert.equal(summary.byCaller.reduce((sum: number, row: { bytes: number }) => sum + row.bytes, 0), summary.controlPlaneBytes + summary.readerBytes);
    }

    const highWater = /VmHWM:\s+(\d+) kB/.exec(readFileSync("/proc/self/status", "utf8"));
    assert.ok(highWater, "Linux process memory high-water reading is required");
    const report = { sourceSha,run, ms: duration, responseBytes: read - before, requestBytes: sent - sentBefore, databaseWalBytes:Number(walAfter-walBefore),
      peakRssBytes: Number(highWater[1]) * 1024, output, digest: digest(output), hours: parts };
    results.push(report);
    process.send!({ type: "progress", scenario, run, responseBytes: report.responseBytes, requestBytes: report.requestBytes, ms: report.ms });
  }
  process.send!({ type: "done", results }, () => process.disconnect!());
}

async function workload(repos: ControlPlaneRepositories, places: string[], run: number): Promise<unknown> {
  if (scenario === "planner") {
    const state=arg("planning-state");
    const policy=await repos.adminConfig.mustRead("current",{expansionScopes:{where:{path:["geography","stateAbbr"],value:state.toUpperCase()}}});
    const scopes=(await importAt("lib/control-plane/expansion/scopes.ts")).expansionScopesOf(policy.value).scopes;
    const pg=await importAt("lib/control-plane/repository/pg-store.ts");
    const provider=await importAt("lib/control-plane/scheduler/providers/hunt-packets.ts");
    const registryModule=await importAt("lib/control-plane/scheduler/registry.ts");
    const durable=await importAt("lib/control-plane/scheduler/durable.ts");
    const schedule=await importAt("lib/control-plane/scheduler/obligation.ts");
    const memberships=await importAt("lib/control-plane/expansion/membership.ts");
    const lineages=await importAt("lib/control-plane/workers/standing-lineage.ts");
    const ids=await pg.readMaterializedPlanningIds(repos,scopes.map((scope:{receiptId:string})=>scope.receiptId));
    const expected=Number(arg("expected-subjects"));
    if(Number.isFinite(expected))assert.equal(ids.size,expected,"all Census governments and divisions in this state keep their hunt");
    const registry=registryModule.buildRegistry([provider.huntPacketsProvider({materialized:()=>({ids})})],{root,nowIso:now,state});
    const sync=await durable.syncObligations(repos,registry.units.map((unit:{obligation:unknown})=>unit.obligation),now);
    const snapshot=await repos.dispatchState.readOpen({obligationIds:sync.all.map((row:StandingObligation)=>row.id)});
    const scanned=await durable.scanOccurrences(repos,{obligations:sync.all,settledRouteTaskIds:durable.settledRouteTaskIds([...snapshot.routeTasks.values()]),neverClaimedRouteTaskIds:new Set(),snapshot});
    const resumed=[];
    for(const row of sync.all.filter((row:StandingObligation)=>row.openOccurrenceId))resumed.push(await durable.resumeOpenOccurrence(repos,row,snapshot));
    const held=await lineages.readStandingLineages(repos,sync.all,now);
    const zip="00000";
    const reference=state==="system"?null:(await importAt("lib/control-plane/expansion/state-references.ts")).readStateReference(sourceRoot,state,{units:"state"});
    const referenceUnits=new Map<string,{zips:readonly string[]}>(reference?.units.map((unit:{pid6:string;zips:readonly string[]})=>[`government:US-${state.toUpperCase()}:${unit.pid6}`,unit])??[]);
    const territory={bySubject:new Map(sync.all.map((row:StandingObligation)=>[row.subjectId,{subjectId:row.subjectId,name:row.subjectId,govClass:"CITY",stateCode:state.toUpperCase(),zctas:new Set([zip,...(referenceUnits.get(row.subjectId)?.zips??[])]),shares:new Map()}])),
      unplaced:new Map(),statewide:new Set(),unregisteredUnitsByState:new Map()};
    const plan=memberships.planExpansion({scopes:scopes.map((decision:unknown)=>({kind:"RESOLVED",decision,zctas:new Set([zip]),whole:new Set([zip]),fractions:new Map(),states:[state.toUpperCase()]})),
      now,territory,obligations:sync.all,lookup:{source:"published",versionId:"generated-national"},territoryDetail:null,malformedScopes:0});
    const owed=sync.all.flatMap((row:StandingObligation)=>{const derived=schedule.scheduleObligation(row,Date.parse(now));return schedule.isScheduled(derived)&&Date.parse(derived.nextDueAt)<=Date.parse(now)?[row.id]:[];}).sort();
    const selected=await pg.readCoordinatorWorkItems(repos);
    const scopeMembers=plan.scopes.reduce((n:number,scope:{members?:ReadonlySet<string>})=>n+(scope.members?.size??0),0);
    assert.equal(sync.all.length,ids.size);assert.equal(scopeMembers,ids.size);assert.equal(registry.units.length,ids.size);
    return {state,registered:ids.size,owed:owed.length,owedDigest:digest(owed),members:scopeMembers,open:snapshot.occurrences.size,
      resumed:resumed.length,lineages:held.length,coordinator:selected.length,scanned:scanned.settled.length+scanned.abandoned.length};
  }
  if (scenario === "admin") {
    const values = [];
    for (let call = 0; call < 79; call++) values.push((await repos.adminConfig.read("current"))?.value.apiFallback);
    return { calls: values.length, settings: values[0] };
  }
  if (scenario === "spend") {
    const spend = await importAt("lib/control-plane/spend-window.ts");
    const safety = await importAt("lib/control-plane/fleet-safety.ts");
    const entry = costEntry(`added-${run}`, places[0]);
    await spend.countCharge(repos, entry, now);
    const totals = [];
    for (let point = 0; point < 7; point++) {
      const held = await spend.readSpendWindow(repos, now);
      totals.push(legacy ? safety.aggregatePricedSpend(held, "2026-10-14T12:00:00.000Z", now).usd : held.usd);
    }
    return { admissions: totals.length, usd: totals[0] };
  }
  if (scenario === "method") {
    let works = await repos.fixMap.worksFor(["scale-method"]);
    for (let packet = 1; packet < places.length; packet++) works = await repos.fixMap.worksFor(["scale-method"]);
    if (legacy) {
      const prior = repos.fixMap as unknown as { forMethod(id: string, limit: number): Promise<readonly FixMapRow[]> };
      const proof = await prior.forMethod("scale-method", 1000);
      return { packets: places.length, works: [...works], proofCount: proof.length, triedCount: proof.filter(row => places.includes(row.placeId)).length };
    }
    const proof = await repos.fixMap.statistics("scale-method");
    const tried = await repos.fixMap.forPlaces("scale-method", places);
    return { packets: places.length, works: [...works], proofCount: proof.total, triedCount: tried.length };
  }
  if (scenario === "manual") {
    const manual = await importAt("lib/control-plane/field-manual.ts");
    const changed = await repos.fieldManual.mustRead("note-0-1");
    await repos.fieldManual.compareAndSet(changed.id, changed.revision, { ...changed.value, summary: `Calendar lesson ${run}` }, now);
    const notes = [];
    for (const place of places) {
      const query = { role: "SCOUT", state: /\/state:([a-z]{2})(?:\/|$)/.exec(place)?.[1], ocdIds: [place], limit: 12 };
      const result = await manual.readFieldManualRows(repos, query);
      if (result.error) throw new Error(result.error);
      notes.push({ place, ids: result.store.entries.map((entry: { id: string }) => entry.id).sort() });
    }
    return notes;
  }
  if (scenario === "coordinator") {
    const pg = await importAt("lib/control-plane/repository/pg-store.ts");
    const rows = await pg.readCoordinatorWorkItems(repos);
    assert.equal(rows.length, places.length + 1);
    assert.ok(rows.some((row: { id: string }) => row.id === "wi-0-1"), "Archived non-hunt continuation must remain visible");
    return rows.map((row: { id: string }) => row.id).sort();
  }
  if (scenario === "dispatch") {
    const durable = await importAt("lib/control-plane/scheduler/durable.ts");
    const obligations = places.map((subjectId, index) => ({ id: `o-${index}`, subjectId, openOccurrenceId: `open-${index}`, occurrenceCount: history + 1, updatedAt: now } as StandingObligation));
    if (legacy) {
      await repos.workItems.list();
      const tasks = await repos.routeTasks.list();
      await durable.scanOccurrences(repos, { obligations, settledRouteTaskIds: new Set(), neverClaimedRouteTaskIds: new Set(tasks.filter(row => row.value.state === "PENDING").map(row => row.id)) });
      return Promise.all(obligations.map(obligation => durable.resumeOpenOccurrence(repos, obligation)));
    }
    const snapshot = await repos.dispatchState.readOpen({ since: run === 0 ? null : now });
    await durable.scanOccurrences(repos, { obligations, settledRouteTaskIds: new Set(), neverClaimedRouteTaskIds: new Set(snapshot.routeTasks.keys()), snapshot });
    return Promise.all(obligations.map(obligation => durable.resumeOpenOccurrence(repos, obligation, snapshot)));
  }
  throw new Error(`Unknown scenario ${scenario}`);
}

function costEntry(id: string, place: string) {
  return { attemptId: id, workItemId: `wi-${id}`, routeTaskId: `rt-${id}`, routeId: null, source: "api.anthropic.com", jurisdiction: place,
    project: "freshness", role: "SCOUT", model: "claude-haiku-4-5-20251001", recordedAt: now,
    cost: { usd: 0.01, requestCount: 1, inputTokens: 1000, outputTokens: 100, elapsedMs: 250,
      uncachedInputTokens: 1000, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, cacheCreation5mInputTokens: 0, cacheCreation1hInputTokens: 0 } };
}

async function nationalPlaces(): Promise<string[]> {
  const directory = join(sourceRoot, "data/derived/zip-divisions");
  const places = new Set<string>();
  for (const file of (await readdir(directory)).filter(name => /^\d\d\.json$/.test(name))) {
    const shard = JSON.parse(await readFile(join(directory, file), "utf8"));
    for (const place of shard.divisions) places.add(place);
  }
  const {readStateReference}=await import(pathToFileURL(join(sourceRoot,"lib/control-plane/expansion/state-references.ts")).href);
  const {HUNT_STATES}=await import(pathToFileURL(join(sourceRoot,"lib/control-plane/hunt-orders.ts")).href);
  for(const state of HUNT_STATES) {
    const reference=readStateReference(sourceRoot,state,{units:"state"});
    for(const unit of reference.units)places.add(`government:US-${state.toUpperCase()}:${unit.pid6}`);
  }
  return [...places].sort();
}

async function parent() {
  assert.ok(Number.isInteger(repetitions) && repetitions > 0);
  assert.ok(Number.isInteger(history) && history > 0);
  const setupStarted = performance.now();
  const pg = await fixtureDatabase();
  try {
  const schema = await importAt("lib/control-plane/repository/pg-schema.ts");
  for (const ddl of schema.BOOTSTRAP_DDL) {
    await pg.exec(ddl.replaceAll(" CONCURRENTLY ", " "));
  }
  const all = await nationalPlaces();
  const maximum = Number(arg("places", String(all.length)));
  const byState = new Map<string, string>();
  for (const place of all) {
    const state = /\/(?:state|territory|district):([^/]+)/.exec(place)?.[1];
    if (state && !byState.has(state)) byState.set(state, place);
  }
  const selected = [...byState.values()];
  const places = [...new Set([...selected, ...all])].slice(0, maximum);
  await pg.exec("CREATE TABLE scale_places (ordinal integer PRIMARY KEY, id text NOT NULL,state text NOT NULL)");
  for (let at = 0; at < places.length; at += 1000) await pg.query("INSERT INTO scale_places SELECT (e->>'ordinal')::integer, e->>'id',e->>'state' FROM jsonb_array_elements($1::jsonb) e", [JSON.stringify(places.slice(at, at + 1000).map((id, index) => ({ ordinal: at + index, id,state:/\/(?:state|district|territory):([a-z]{2})(?:\/|$)/.exec(id)?.[1]??/^government:US-([A-Z]{2}):/.exec(id)?.[1]?.toLowerCase()??"system" })))]);
  await seed(pg, places, selected.filter(place => places.includes(place)));
  await pg.exec("ANALYZE");
  if (scenario === "manual" && arg("explain")) {
    const previous = JSON.parse(await readFile(arg("explain"), "utf8")) as { query: string; params: unknown[] };
    const store = await importAt("lib/control-plane/repository/pg-store.ts");
    const current = { query: store.FIELD_MANUAL_SLICE_SQL, params: [...store.fieldManualSliceParams({ role: "SCOUT", state: "az", ocdIds: ["ocd-division/country:us/state:az"], limit: 12 }), null] };
    for (const [version, query] of [["previous", previous], ["current", current]] as const) {
      const plan = (await pg.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.query}`, query.params)).rows;
      process.stderr.write(`${JSON.stringify({ type: "plan", version, plan })}\n`);
    }
  }
  const fixtureSetupMs = performance.now() - setupStarted;
  process.stderr.write(`${JSON.stringify({ type: "fixture", scenario, divisions: places.length, fixtureSetupMs })}\n`);
  const directory = await mkdtemp(join(tmpdir(), "cp-01-scale-"));
  const { writeFile } = await import("node:fs/promises");
  const selectedFile = join(directory, "selected.json");
  await writeFile(selectedFile, JSON.stringify(selected.filter(place => places.includes(place))));
  let planningRoundWallMs:number|null=null;
  const launch=async(state?:string):Promise<RunReport[]>=>{
  const child = fork(import.meta.filename, [...process.argv.slice(2), "--mode=worker", `--copies=${join(directory, "copies",state??"all")}`, `--selected=${selectedFile}`,...(state?[`--planning-state=${state}`,`--expected-subjects=${places.filter(subject=>((/\/(?:state|territory|district):([^/]+)/.exec(subject)?.[1]??/^government:US-([A-Z]{2}):/.exec(subject)?.[1]?.toLowerCase())??"system")===state).length}`]:[])], {
    cwd: root, execArgv: ["--max-old-space-size=1536","--experimental-strip-types", "--import", join(root, "scripts/register-test-loader.mjs")],
    env: { ...process.env, DATABASE_URL: "", WTP_CONTROL_PLANE_DATABASE_URL: "postgresql://fixture:fixture@ep-cp-scale.us-east-2.aws.neon.tech/fixture", WTP_VITAL_SIGNS_REPORT: "1" },
    stdio: ["ignore", "pipe", "pipe", "ipc"], serialization: "advanced",
  });
  child.stderr!.on("data", data => process.stderr.write(data));
  child.stdout!.on("data", data => process.stderr.write(data));
  const reports = await new Promise<RunReport[]>((resolve, reject) => {
    let completed:RunReport[]|null=null;
    child.on("error", reject);
    child.on("exit", code => {
      if(code===0 && completed!==null)resolve(completed);
      else reject(new Error(`Scale worker exited ${code} without completing its run`));
    });
    child.on("message", async (message: { type: string; id: number; body: string; results: RunReport[] }) => {
      if (message.type === "done") { completed=message.results; return; }
      if (message.type === "progress") { process.stderr.write(`${JSON.stringify(message)}\n`); return; }
      if(message.type==="wal") {
        const [{lsn}]=(await pg.query<{lsn:string}>("SELECT pg_current_wal_insert_lsn()::text AS lsn")).rows;
        const [high,low]=lsn.split("/");
        child.send({id:message.id,body:String((BigInt(`0x${high}`)<<BigInt(32))+BigInt(`0x${low}`))});return;
      }
      if (message.type !== "query") return;
      try {
        const request = JSON.parse(message.body);
        const execute = async (query: { query: string; params?: unknown[] }) => {
          return wire(await pg.query<Record<string, unknown>>(query.query, query.params ?? [], { serializers: { 16: (value:unknown) => String(value) } }));
        };
        const response = request.queries ? { results: await Promise.all(request.queries.map(execute)) } : await execute(request);
        child.send({ id: message.id, body: JSON.stringify(response) });
      } catch (error) { child.send({ id: message.id, error: error instanceof Error ? error.message : String(error) }); }
    });
  });
    return reports;
  };
  const results:RunReport[]=[];
  if(scenario==="planner") {
    const statePlanning=await importAt("lib/control-plane/scheduler/state-planning.ts");
    const started=performance.now();
    const round=await statePlanning.runStatePlanningRound(async(state:string)=>{
      const reports=await launch(state);results.push(...reports);return true;
    },arg("planning-states")?arg("planning-states").split(","):statePlanning.PLANNING_STATES);
    assert.equal(round.failed.length,0);
    planningRoundWallMs=performance.now()-started;
    process.stderr.write(`${JSON.stringify({type:"planning-round",states:round.completed,wallMs:planningRoundWallMs})}\n`);
  }else results.push(...await launch());
  const peak = Math.max(...results.map(result => result.peakRssBytes));
  const runnerAvailable = Number(arg("runner-available-bytes", "NaN"));
  const documentedHost = 8 * 1024 ** 3;
  const parentReserve = 2928 * 1024 ** 2;
  const margin = 0.75 * 1024 ** 3;
  const warmRows=scenario==="planner"?results.filter(result=>result.run===repetitions-1):[results.at(-1)!];
  const warm={responseBytes:warmRows.reduce((n,row)=>n+row.responseBytes,0),requestBytes:warmRows.reduce((n,row)=>n+row.requestBytes,0),databaseWalBytes:warmRows.reduce((n,row)=>n+row.databaseWalBytes,0),ms:warmRows.reduce((n,row)=>n+row.ms,0)};
  console.log(JSON.stringify({ scenario, root, legacy,sourceSha,planningRoundWallMs, input: { subjects: places.length,nationalSubjectsAvailable:all.length,ocdDivisions: all.filter(place=>place.startsWith("ocd-division/")).length,censusGovernments:all.filter(place=>place.startsWith("government:")).length,
    scopes: [...byState.keys()].sort(), selectedPlaces: selected.filter(place => places.includes(place)).length, historiesPerPlace: history },
    measurement: "Postgres 17 in an isolated local container; exact serialized fixture-adapter request/response bodies through the production Neon counter and physical WAL written per workload. Excludes real Neon framing and network latency. Database memory is separate from the measured worker.",
    assumptions: { runsPerDay, runnerAvailableBytes: Number.isFinite(runnerAvailable) ? runnerAvailable : null, reserveBytes: margin,
      documentedHostBytes: documentedHost, documentedHostSource: "deploy/runner/README.md", existingParentReserveBytes: parentReserve,
      parentReserveSource: "lib/control-plane/workers/worker-slots.ts", productionHeartbeatAvailable: false },
    fixtureSetupMs, peakRssBytes: peak, workerPeakSource: "/proc/self/status VmHWM", copiesAtMargin: Number.isFinite(runnerAvailable) ? Math.max(0, Math.floor((runnerAvailable - margin) / peak)) : null,
    runnerCopiesAfterParentReserve: Number.isFinite(runnerAvailable) ? Math.max(0,Math.floor((runnerAvailable-margin-parentReserve)/peak)) : null,
    documentedHostWorkerOnlyCopies: Math.floor((documentedHost - margin) / peak),
    documentedHostCopiesAfterParentReserve: Math.floor((documentedHost - margin - parentReserve) / peak),
    warmResponseBytesPerHour: warm.responseBytes * runsPerDay / 24, warmResponseBytesPerDay: warm.responseBytes * runsPerDay,
    warmRequestBytesPerHour: warm.requestBytes * runsPerDay / 24, warmRequestBytesPerDay: warm.requestBytes * runsPerDay,
    warmRuntimeMsPerDay: warm.ms * runsPerDay,warmDatabaseWalBytesPerDay:warm.databaseWalBytes*runsPerDay, results }, null, 2));
  await rm(directory, { recursive: true, force: true });
  } finally { await pg.close(); }
}

function wire(result: { rows: Record<string, unknown>[]; fields: { name: string; dataTypeID: number }[]; affectedRows?: number }) {
  const encode = (value: unknown, type: number): string | null => {
    if (value === null || value === undefined) return null;
    if (type === 114 || type === 3802) return JSON.stringify(value);
    if (Array.isArray(value)) return `{${value.map(entry => entry === null ? "NULL" : JSON.stringify(String(entry))).join(",")}}`;
    if (value instanceof Date) return value.toISOString();
    return String(value);
  };
  return { command: "SELECT", rowCount: result.affectedRows ?? result.rows.length, rowAsArray: true, fields: result.fields,
    rows: result.rows.map(row => result.fields.map(field => encode(row[field.name], field.dataTypeID))) };
}

async function seed(pg: FixtureDatabase, places: string[], selected: string[]) {
  const template = (kind: string) => `INSERT INTO cp_${kind} (id, revision, updated_at, changed_at, value)`;
  if (scenario === "manual") {
    const manual = await importAt("lib/control-plane/field-manual.ts");
    const entry = manual.normalizeEntry(manual.newFieldManualEntry("scale", "template", { role: "SCOUT", kind: "SCOUT_DISCOVERY", title: "Official meeting calendar",
      summary: "The official calendar publishes meetings and links the agenda and minutes for this government.", outcome: "YIELDED", ocdIds: [places[0]], observedAt: now, payload: { route: "official-calendar", result: "agenda and minutes" } }));
    await pg.query(`${template("field_manual_entries")} SELECT 'note-' || p.ordinal || '-' || h.n, 1, $1::timestamptz, $1::timestamptz,
      $2::jsonb || jsonb_build_object('id', 'note-' || p.ordinal || '-' || h.n, 'ocdIds', jsonb_build_array(p.id),
        'reach', jsonb_build_object('places', jsonb_build_array(lower(p.id)), 'states', '[]'::jsonb, 'platforms', '[]'::jsonb, 'everywhere', false))
      FROM scale_places p CROSS JOIN generate_series(1,$3::integer) h(n)`, [now, JSON.stringify(entry), history]);
  } else if (scenario === "method") {
    await pg.query(`INSERT INTO cp_fix_map (method_id,place_id,state,tried_at,attempt_id,cause,updated_at)
      SELECT 'scale-method',id,'WORKS',$1::timestamptz,'attempt-' || ordinal,NULL,$1::timestamptz FROM scale_places`, [now]);
    if (!legacy) {
      const map = await importAt("lib/method/fix-map.ts");
      for (const ddl of map.FIX_MAP_DDL) await pg.exec(ddl);
    }
  } else if (scenario === "admin") {
    const admin = await importAt("lib/control-plane/gateway/admin-config.ts");
    const config = admin.defaultAdminConfig(now);
    await pg.query(`${template("admin_config")} SELECT 'current',1,$1::timestamptz,$1::timestamptz,$2::jsonb${legacy ? ` ||
      jsonb_build_object('settingHistory',(SELECT jsonb_agg(jsonb_build_object('id','setting-' || ordinal,'key','workers','before',1,'after',2,'at',$1::text,'actor','factory')) FROM scale_places),
      'placeTargets',(SELECT jsonb_agg(jsonb_build_object('key','geo:'||state||'.place.'||ordinal,'goalPercent',100,'setAt',$1::text,'decidedBy','factory','receiptId','receipt-' || ordinal)) FROM scale_places))` : ""}`, [now, JSON.stringify(config)]);
    if (!legacy) {
      await pg.query(`INSERT INTO cp_admin_setting_history(config_id,id,updated_at,value)
        SELECT 'current','setting-'||ordinal,$1::timestamptz,jsonb_build_object('id','setting-'||ordinal,'key','workers','before',1,'after',2,'at',$1::text,'actor','factory') FROM scale_places`,[now]);
      await pg.exec("ALTER TABLE cp_admin_place_targets DISABLE TRIGGER cp_admin_place_targets_planning_changed");
      await pg.query(`INSERT INTO cp_admin_place_targets(config_id,id,updated_at,value)
        SELECT 'current','geo:'||state||'.place.'||ordinal,$1::timestamptz,jsonb_build_object('key','geo:'||state||'.place.'||ordinal,'goalPercent',100,'setAt',$1::text,'decidedBy','factory','receiptId','receipt-'||ordinal) FROM scale_places`,[now]);
      await pg.exec("ALTER TABLE cp_admin_place_targets ENABLE TRIGGER cp_admin_place_targets_planning_changed");
    }
  } else if (scenario === "spend") {
    const safety = await importAt("lib/control-plane/fleet-safety.ts");
    const spend = await importAt("lib/control-plane/spend-window.ts");
    const charge = safety.pricedModelCharge(costEntry("template", places[0]), "template");
    if (legacy) {
      await pg.query(`${template("spend_window")} SELECT 'model-charges',1,$1::timestamptz,$1::timestamptz,
        jsonb_build_object('charges', jsonb_agg($2::jsonb || jsonb_build_object('id','charge-' || ordinal,'jurisdiction',id))) FROM scale_places`, [now, JSON.stringify(charge)]);
    } else {
      const model = await importAt("lib/control-plane/repository/model-charges.ts");
      for (const ddl of model.MODEL_CHARGES_DDL) await pg.exec(ddl);
      await pg.query(`INSERT INTO cp_model_charges (id,charged_at,job_id,route_task_id,obligation_id,jurisdiction,attempt_id,usd,known_usd,measured,bounded,assignment_refs,is_scout,scout_usd,cache)
        SELECT 'charge-' || ordinal,$1::timestamptz,'job-' || ordinal,'task-' || ordinal,NULL,id,'attempt-' || ordinal,0.01,0.01,true,false,NULL,
          true,0.01,NULL FROM scale_places`, [now]);
    }
    assert.ok(spend.costRecordId);
  } else if (scenario === "dispatch" || scenario === "coordinator" || scenario === "planner") {
    let continuation: Record<string, unknown> | null = null;
    if (scenario === "coordinator") {
      const fixture = await import(pathToFileURL(join(sourceRoot, "tests/helpers/autonomous-fleet.ts")).href);
      const coordinator = await importAt("lib/control-plane/workers/coordinator.ts");
      const held = await fixture.autonomousHarness();
      const blocked = { ...held.item, autonomousPlan: { ...held.item.autonomousPlan, sources: [], acquisition: [] } };
      assert.equal((await coordinator.nextAutonomousOperation(held.runtime, held.item.id, [blocked])).action, "BLOCKED");
      assert.equal((await coordinator.nextAutonomousOperation(held.runtime, held.item.id)).action, "WORKER");
      continuation = { ...held.item, id: "wi-0-1" };
    }
    for (const kind of ["work_items", "route_tasks", "occurrences"]) {
      let value = kind === "work_items" ? "jsonb_build_object('id','wi-' || p.ordinal || '-' || h.n,'subject',p.id,'state','VERIFIED_COMPLETE')"
        : kind === "route_tasks" ? "jsonb_build_object('id','rt-' || p.ordinal || '-' || h.n,'workItemId','wi-' || p.ordinal || '-' || h.n,'state','DISPOSED','disposition',jsonb_build_object('disposition','YIELDED'))"
          : "jsonb_build_object('id','occ-' || p.ordinal || '-' || h.n,'obligationId','past-' || p.ordinal,'sequence',h.n,'workItemId','wi-' || p.ordinal || '-' || h.n,'routeTaskId','rt-' || p.ordinal || '-' || h.n,'closedAt',$1::text)";
      if (continuation && kind === "work_items") value = `CASE WHEN p.ordinal=0 AND h.n=1 THEN $5::jsonb ELSE ${value}
        || '{"autonomousPlan":{"capability":"officials/offices","acquisition":[],"sources":[],"contract":{"schemaVersion":2,"recordClass":"OFFICIAL_ROSTER"}}}'::jsonb END`;
      const prefix = kind === "work_items" ? "wi-" : kind === "route_tasks" ? "rt-" : "occ-";
      const batch = Math.max(1, Math.floor(1000 / history));
      for (let at = 0; at < places.length; at += batch) await pg.query(`${template(scenario==="planner"?`${kind}_archive`:kind)}
        SELECT '${prefix}' || p.ordinal || '-' || h.n,1,$1::timestamptz,$1::timestamptz,${value}
        FROM scale_places p CROSS JOIN generate_series(1,$2::integer) h(n) WHERE p.ordinal >= $3 AND p.ordinal < $4`,
      [now, history, at, at + batch, ...(continuation && kind === "work_items" ? [JSON.stringify(continuation)] : [])]);
    }
    if(scenario==="planner") {
      const durable=await importAt("lib/control-plane/scheduler/durable.ts");
      const providers=await importAt("lib/control-plane/scheduler/providers/hunt-packets.ts");
      const registryModule=await importAt("lib/control-plane/scheduler/registry.ts");
      const statePlanning=await importAt("lib/control-plane/scheduler/state-planning.ts");
      const admin=await importAt("lib/control-plane/gateway/admin-config.ts");
      const fipsModule=await importAt("lib/ocd/fips.ts");
      const fipsByState=Object.fromEntries(Object.entries(fipsModule.FIPS_TO_STATE).map(([fips,value])=>[String((value as {postal:string}).postal).toLowerCase(),fips]));
      const oneId=`hunt:packet:${places[0]}`;
      const prototype=durable.standing(registryModule.buildRegistry([providers.huntPacketsProvider({materialized:()=>({ids:new Set([oneId])})})],{root,nowIso:now}).units[0].obligation,now);
      await pg.query(`${template("admin_config")} VALUES('current',1,$1::timestamptz,$1::timestamptz,$2::jsonb)`,[now,JSON.stringify(admin.defaultAdminConfig(now))]);
      for(const state of statePlanning.PLANNING_STATES.filter((state:string)=>state!=="system")) {
        const scope={key:`state:2020/${fipsByState[state]}`,geography:{type:"state",geoid:fipsByState[state],version:"state:2020",label:state.toUpperCase(),stateAbbr:state.toUpperCase()},
          priority:1,budgetUsd:10000,budgetStartedAt:now,decidedAt:now,decidedBy:"fixture",receiptId:`send-${state}`,previous:null,note:null};
        await pg.query("INSERT INTO cp_admin_expansion_scopes(config_id,id,updated_at,value) VALUES('current',$1,$2,$3::jsonb)",[scope.key,now,JSON.stringify(scope)]);
      }
      for(let at=0;at<places.length;at+=1000)await pg.query(`${template("obligations")}
        SELECT 'hunt:packet:'||p.id,1,$1::timestamptz,$1::timestamptz,$2::jsonb || jsonb_build_object('id','hunt:packet:'||p.id,'subjectId',p.id,'scopeDivisions',jsonb_build_array(p.id),
          'materializedBy','OWNER_DISPATCH','active',true,'updatedAt',$1::text,'nextDueAt',$1::text,'occurrenceCount',$5::integer,
          'autonomousPlan',jsonb_set(jsonb_set(replace(($2::jsonb->'autonomousPlan')::text,$6,p.id)::jsonb,'{jurisdiction}',to_jsonb(upper(cp_control_state(jsonb_build_object('subjectId',p.id))))),'{contract,jurisdiction,state}',to_jsonb(upper(cp_control_state(jsonb_build_object('subjectId',p.id))))),
          'assignments',jsonb_build_array(jsonb_build_object('assignmentKey','state:2020/'||($7::jsonb->>cp_control_state(jsonb_build_object('subjectId',p.id))),
            'ref','send-'||cp_control_state(jsonb_build_object('subjectId',p.id)),'relation','CREATED','at',$1::text)))
        FROM scale_places p WHERE p.ordinal >= $3 AND p.ordinal < $4`,[now,JSON.stringify(prototype),at,at+1000,history,places[0],JSON.stringify(fipsByState)]);
      await pg.query(`INSERT INTO cp_lineage_cache(id,stamp,value,dirty,generation)
        SELECT id,jsonb_build_array($1::text,$1::text)::text,'[]'::jsonb,false,1 FROM cp_obligations
        ON CONFLICT(id) DO UPDATE SET stamp=EXCLUDED.stamp,value=EXCLUDED.value,dirty=false`,[now]);
    }
    for (let index = 0; index < selected.length; index++) {
      for (const [kind, id, value] of [
        ["work_items", `open-wi-${index}`, { id: `open-wi-${index}`, subject: selected[index], state: "OPEN", ...(scenario === "coordinator" ? { autonomousPlan: { capability: "hunt-packet" } } : {}) }],
        ["route_tasks", `open-rt-${index}`, { id: `open-rt-${index}`, workItemId: `open-wi-${index}`, state: "PENDING", disposition: null }],
        ["occurrences", `open-${index}`, { id: `open-${index}`, obligationId: scenario==="planner"?`hunt:packet:${selected[index]}`:`o-${index}`, sequence: history + 1, workItemId: `open-wi-${index}`, routeTaskId: `open-rt-${index}`, closedAt: null }],
      ]) await pg.query(`${template(String(kind))} VALUES ($1,1,$2::timestamptz,$2::timestamptz,$3::jsonb)`, [id, now, JSON.stringify(value)]);
    }
    if(scenario==="planner") {
      for(let index=0;index<selected.length;index++)await pg.query("UPDATE cp_obligations SET value=jsonb_set(value,'{openOccurrenceId}',to_jsonb($2::text)) WHERE id=$1",[`hunt:packet:${selected[index]}`,`open-${index}`]);
      await pg.query("UPDATE cp_lineage_cache SET stamp=replace(stamp,', ',','),dirty=false");
    }
    if (!legacy && scenario!=="planner") {
      const jobs=await importAt("lib/control-plane/repository/control-reads-backfill.ts");
      const statePlanning=await importAt("lib/control-plane/scheduler/state-planning.ts");
      const began=performance.now();
      let archived=0;
      for(const state of statePlanning.PLANNING_STATES)for(;;) {
        const rows=(await pg.query<{moved:number}>(jobs.ARCHIVE_STATE_SQL,[state])).rows;
        archived+=Number(rows[0].moved);if(Number(rows[0].moved)<100)break;
      }
      assert.equal(Number((await pg.query<{ n: number }>("SELECT count(*) AS n FROM cp_occurrences WHERE value->>'closedAt' IS NOT NULL")).rows[0].n), 0);
      process.stderr.write(`${JSON.stringify({ type: "migration", scenario, archived, ms: performance.now() - began })}\n`);
    }
  }
}

interface FixtureDatabase {
  query<T=Record<string,unknown>>(text:string,params?:unknown[],options?:unknown):Promise<{rows:T[];fields:{name:string;dataTypeID:number}[];affectedRows:number}>;
  exec(text:string):Promise<void>;
  close():Promise<void>;
}

async function fixtureDatabase():Promise<FixtureDatabase> {
  const name=`cp01-scale-${randomUUID()}`;
  const password=randomUUID();
  execFileSync("docker",["run","--detach","--rm","--name",name,"--memory=2g","--publish","127.0.0.1::5432",
    "--env","POSTGRES_PASSWORD","--env","POSTGRES_USER=fixture","--env","POSTGRES_DB=fixture","postgres:17-alpine",
    "-c","shared_buffers=128MB","-c","autovacuum=off","-c","max_parallel_workers_per_gather=0"],
    {env:{...process.env,POSTGRES_PASSWORD:password},stdio:["ignore","ignore","pipe"]});
  const port=Number(execFileSync("docker",["port",name,"5432/tcp"],{encoding:"utf8"}).trim().split(":").at(-1));
  let client:Client|null=null;
  try {
    for(let attempt=0;attempt<60;attempt++) {
      const candidate=new Client({host:"127.0.0.1",port,user:"fixture",password,database:"fixture",application_name:"cp01-scale",connectionTimeoutMillis:1000});
      try {await candidate.connect();client=candidate;break;}
      catch {await candidate.end().catch(()=>{});await new Promise(done=>setTimeout(done,250));}
    }
    if(!client)throw new Error("The isolated Postgres fixture did not become ready");
  }catch(error){execFileSync("docker",["rm","--force","--volumes",name],{stdio:"ignore"});throw error;}
  const connected=client;
  const close=async()=>{
    process.off("SIGTERM",terminate);
    try {await connected.end();}
    finally {execFileSync("docker",["rm","--force","--volumes",name],{stdio:"ignore"});}
  };
  const terminate=()=>{void close().finally(()=>process.exit(143));};
  process.once("SIGTERM",terminate);
  return {
    query:async<T,>(text:string,params:unknown[]=[])=>{
      const result=await connected.query(text,params);
      return {rows:result.rows as T[],fields:result.fields,affectedRows:result.rowCount??0};
    },
    exec:async text=>{await connected.query(text);},
    close,
  };
}
