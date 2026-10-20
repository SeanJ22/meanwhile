import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { execFileSync } from "node:child_process";
import { Pool } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, open, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import type { StandingObligation } from "../lib/control-plane/scheduler/durable.ts";
import type { NeonBytesHour } from "../lib/db/transfer-by-caller.ts";

interface RunReport {
  sourceSha:string; run: number; ms: number; responseBytes: number; requestBytes: number; databaseWalBytes:number; peakRssBytes: number;
  output: unknown; digest: string; hours: NeonBytesHour[];
}

const arg = (name: string, fallback = "") => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const root = resolve(arg("root", process.cwd()));
const sourceRoot = resolve(arg("source", process.cwd()));
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
  if(scenario==="manual") {
    const reports=[];
    for(const size of [1,20001]) {
      for(let offset=size===1?0:1;offset<size;offset+=1000)await proxy("query",JSON.stringify({query:`INSERT INTO cp_field_manual_entries(id,revision,updated_at,value)
        SELECT 'history-route-'||n,1,$1::timestamptz,jsonb_build_object('id','history-route-'||n,'role','HUNTER','kind','ROUTE',
          'title','Successful route','summary','Saved source proof','outcome','YIELDED','observedAt',$1::text,
          'states','["az"]'::jsonb,'ocdIds','[]'::jsonb,'bodyIds','[]'::jsonb,'platforms','[]'::jsonb,
          'recordClasses','["meetings"]'::jsonb,'url','https://history-scale.invalid/route',
          'reach','{"states":["az"],"places":[],"platforms":[],"everywhere":false}'::jsonb,
          'payload',jsonb_build_object('id','scale-history-route','body',repeat(md5(n::text),56)))
        FROM generate_series($2::int,$3::int) n`,params:[now,offset,Math.min(size-1,offset+999)]}));
      const before=transfer.processNeonBytes().reduce((n:number,h:{bytes:Record<string,number>})=>n+h.bytes["control-plane"],0);
      const sentBefore=transfer.processNeonBytes().reduce((n:number,h:{sent:Record<string,{bytes:number}>})=>n+h.sent["control-plane"].bytes,0);
      const start=performance.now(),known=await repos.fieldManual.learnedRoutes(["scale-history-route","absent-route"]);
      assert.deepEqual(known,{present:true,routeIds:["scale-history-route"]});
      const routeMs=performance.now()-start,sourceStart=performance.now();
      const hints=await repos.fieldManual.sourceHints({state:"az"},"https://history-scale.invalid/");
      assert.equal(hints.length,1);assert.deepEqual(hints[0].workedFor,["meetings"]);
      const hours=transfer.takeNeonBytesHours();
      for(const hour of hours) {
        const summary=transfer.summarizeNeonBytes(hour,1000);
        assert.equal(summary.byCaller.reduce((n:number,row:{bytes:number})=>n+row.bytes,0),summary.controlPlaneBytes+summary.readerBytes);
      }
      reports.push({historyRows:size,routeMs,sourceMs:performance.now()-sourceStart,
        responseBytes:hours.reduce((n:number,h:{bytes:Record<string,number>})=>n+h.bytes["control-plane"],0)-before,
        requestBytes:hours.reduce((n:number,h:{sent:Record<string,{bytes:number}>})=>n+h.sent["control-plane"].bytes,0)-sentBefore,digest:digest({known,hints}),hours});
    }
    assert.equal(reports[0].digest,reports[1].digest);assert.equal(reports[0].responseBytes,reports[1].responseBytes);
    process.stderr.write(`${JSON.stringify({type:"repeated-history",reports})}\n`);
  }
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
    if(scenario==="pipeline" && run>0 && results[0].responseBytes>4096)assert.ok(report.responseBytes<results[0].responseBytes/2,"warm state promotion reads transfer changes and keys");
    results.push(report);
    process.send!({ type: "progress", scenario, run, responseBytes: report.responseBytes, requestBytes: report.requestBytes, ms: report.ms });
  }
  if(scenario==="manual") {
    const reports=[];
    for(let run=0;run<repetitions;run++) {
      const before=transfer.processNeonBytes().reduce((n:number,h:{bytes:Record<string,number>})=>n+h.bytes["control-plane"],0);
      const sentBefore=transfer.processNeonBytes().reduce((n:number,h:{sent:Record<string,{bytes:number}>})=>n+h.sent["control-plane"].bytes,0);
      const walBefore=BigInt(await proxy("wal")),began=performance.now();
      const output=await workload(repos,places,run,"source-hints"),ms=performance.now()-began;
      const walAfter=BigInt(await proxy("wal")),hours=transfer.takeNeonBytesHours();
      for(const hour of hours) {
        const summary=transfer.summarizeNeonBytes(hour,1000);
        assert.equal(summary.byCaller.reduce((sum:number,row:{bytes:number})=>sum+row.bytes,0),summary.controlPlaneBytes+summary.readerBytes);
      }
      reports.push({run,ms,responseBytes:hours.reduce((n:number,hour:{bytes:Record<string,number>})=>n+hour.bytes["control-plane"],0)-before,
        requestBytes:hours.reduce((n:number,hour:{sent:Record<string,{bytes:number}>})=>n+hour.sent["control-plane"].bytes,0)-sentBefore,
        databaseWalBytes:Number(walAfter-walBefore),peakRssBytes:Number(/VmHWM:\s+(\d+) kB/.exec(readFileSync("/proc/self/status","utf8"))![1])*1024,digest:digest(output),hours});
    }
    process.stderr.write(`${JSON.stringify({type:"companion-source-hints",reports})}\n`);
  }
  process.send!({ type: "done", results }, () => process.disconnect!());
}

async function workload(repos: ControlPlaneRepositories, places: string[], run: number, kind=scenario): Promise<unknown> {
  if(kind==="orders") {
    const {ADMIN_CONFIG_ID,withExpansionScopes}=await importAt("lib/control-plane/gateway/admin-config.ts");
    const {expansionScopesOf}=await importAt("lib/control-plane/expansion/scopes.ts");
    const {requestHuntStop,applyHuntOrders,HUNT_STATES}=await importAt("lib/control-plane/hunt-orders.ts");
    const scopes=[...Array.from({length:79},(_,n)=>({key:`zcta:2020/${85000+n}`,geography:{type:"zcta",geoid:String(85000+n),version:"zcta:2020",label:`ZIP ${85000+n}`,stateAbbr:"AZ"},
      priority:1,budgetUsd:10,decidedAt:now,decidedBy:"owner",receiptId:`send-${run}-${n}`,previous:null,note:null})),
      {key:"zcta:2020/03301",geography:{type:"zcta",geoid:"03301",version:"zcta:2020",label:"ZIP 03301",stateAbbr:"NH"},
        priority:1,budgetUsd:10,decidedAt:now,decidedBy:"owner",receiptId:`send-${run}-nh`,previous:null,note:null}];
    const held=await repos.adminConfig.mustRead(ADMIN_CONFIG_ID,{expansionScopes:true});
    await repos.adminConfig.save(held,withExpansionScopes(held.value,{scopes,decidedAt:now}),now);
    const revision=(await repos.adminConfig.mustRead(ADMIN_CONFIG_ID)).revision;
    await Promise.all(scopes.slice(0,79).map((scope,n)=>requestHuntStop(repos,{receiptId:`stop-${run}-${n}`,state:"az",scopeKey:scope.key,at:now,actor:"owner"})));
    const pending=await repos.huntOrders.pending("az");
    assert.equal(pending.length,79);assert.ok(pending.every((order:{value:{confirmedAt:string|null}})=>order.value.confirmedAt===null));
    assert.equal((await repos.adminConfig.mustRead(ADMIN_CONFIG_ID)).revision,revision);
    assert.equal(await applyHuntOrders(repos,"az",now),79);
    const remaining=await repos.adminConfig.mustRead(ADMIN_CONFIG_ID,{expansionScopes:true});
    assert.deepEqual(expansionScopesOf(remaining.value).scopes.map((scope:{geography:{stateAbbr:string}})=>scope.geography.stateAbbr),["NH"]);
    assert.equal((await repos.huntOrders.pending("az")).length,0);
    await repos.adminConfig.save(remaining,withExpansionScopes(remaining.value,{scopes,decidedAt:now}),now);
    await requestHuntStop(repos,{receiptId:`state-stop-${run}`,state:"az",at:now,actor:"owner"});
    assert.equal(await applyHuntOrders(repos,"az",now),1);
    assert.equal(expansionScopesOf((await repos.adminConfig.mustRead(ADMIN_CONFIG_ID,{expansionScopes:true})).value).scopes.length,1);
    await requestHuntStop(repos,{receiptId:`all-stop-${run}`,at:now,actor:"owner"});
    for(const state of HUNT_STATES)assert.equal(await applyHuntOrders(repos,state,now),1);
    assert.equal(expansionScopesOf((await repos.adminConfig.mustRead(ADMIN_CONFIG_ID,{expansionScopes:true})).value).scopes.length,0);
    return {independentOrders:79,stateOrders:1,globalOrders:HUNT_STATES.length,remaining:0,configRevisionUnchanged:revision===(await repos.adminConfig.mustRead(ADMIN_CONFIG_ID)).revision};
  }
  if(kind==="pipeline") {
    const {readPipelineStates}=await importAt("lib/control-plane/promotion/pipeline.ts");
    const states=await readPipelineStates(repos);
    assert.equal(states.length,Number(arg("expected-subjects"))*history);
    const {planningStateOf}=await importAt("lib/control-plane/scheduler/state-planning.ts");
    assert.ok(states.every((row:{subjectId:string})=>planningStateOf(row.subjectId)===arg("planning-state")));
    const copy=await open(join(arg("copies"),`cp_log_promotion_pipeline:${arg("planning-state")}.ndjson`),"r");
    let heldReadClock:string|null=null;
    try {const buffer=Buffer.alloc(256);const {bytesRead}=await copy.read(buffer,0,buffer.length,0);heldReadClock=/"through":"([^"]+)"/.exec(buffer.subarray(0,bytesRead).toString())?.[1]??null;}
    finally{await copy.close();}
    assert.ok(heldReadClock && Date.parse(heldReadClock)>=Date.parse(now));
    return {state:arg("planning-state"),items:states.length,verified:states.filter((row:{stage:string})=>row.stage==="VERIFIED").length,heldReadClock};
  }

  if (kind === "planner") {
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
    for(const unit of registry.units as {obligation:StandingObligation}[]) {
      assert.equal(unit.obligation.autonomousPlan?.jurisdiction,state.toUpperCase(),unit.obligation.subjectId);
      const contract=unit.obligation.autonomousPlan?.contract;assert.ok(contract?.schemaVersion===2);
      assert.equal(contract.jurisdiction.state,state.toUpperCase(),unit.obligation.subjectId);
    }
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
  if (kind === "admin") {
    const values = [];
    for (let call = 0; call < 79; call++) values.push((await repos.adminConfig.read("current"))?.value.apiFallback);
    return { calls: values.length, settings: values[0] };
  }
  if (kind === "spend") {
    const spend = await importAt("lib/control-plane/spend-window.ts");
    const entry = costEntry(`added-${run}`, places[0]);
    await spend.countCharge(repos, entry, now);
    const totals = [];
    for (let point = 0; point < 7; point++) {
      const held = await spend.readSpendWindow(repos, now);
      totals.push(held.usd);
    }
    return { admissions: totals.length, usd: totals[0] };
  }
  if (kind === "method") {
    let works = await repos.fixMap.worksFor(["scale-method"]);
    for (let packet = 1; packet < places.length; packet++) works = await repos.fixMap.worksFor(["scale-method"]);
    const proof = await repos.fixMap.statistics("scale-method");
    const tried = await repos.fixMap.forPlaces("scale-method", places);
    return { packets: places.length, works: [...works], proofCount: proof.total, triedCount: tried.length };
  }
  if(kind==="source-hints") {
    const sample=JSON.parse(await readFile(join(sourceRoot,"tests/fixtures/field-manual-pages/manual.json"),"utf8")) as {entries:{url:string|null}[]};
    const origins=new Map<string,number>();
    for(const entry of sample.entries) {
      if(!entry.url)continue;
      try {const origin=new URL(entry.url).origin;origins.set(origin,(origins.get(origin)??0)+1);}catch{}
    }
    const origin=[...origins].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0]?.[0];
    assert.ok(origin,"the source fixture must include URLs");
    const hints=[];
    for(const place of places) {
      const state=/\/(?:state|district|territory):([a-z]{2})(?:\/|$)/.exec(place)?.[1];
      const rows=await repos.fieldManual.sourceHints({state,ocdIds:[place]},origin);
      assert.ok(rows.every(row=>new URL(row.url).origin===origin));
      hints.push({place,rows});
    }
    return hints;
  }
  if (kind === "manual") {
    const manual = await importAt("lib/control-plane/field-manual.ts");
    const changed = await repos.fieldManual.mustRead("note-0-1");
    await repos.fieldManual.compareAndSet(changed.id, changed.revision, { ...changed.value, summary: `Calendar lesson ${run}` }, now);
    const notes = [];
    for (const place of places) {
      const query = { role: "SCOUT", state: /\/state:([a-z]{2})(?:\/|$)/.exec(place)?.[1], ocdIds: [place], limit: 12 };
      const result = await manual.readFieldManualRows(repos, query);
      if (result.error) throw new Error(result.error);
      assert.ok(result.projection.entryIds.length<=query.limit);
      assert.ok(result.store.entries.length<=query.limit);
      notes.push({ place, ids: [...result.projection.entryIds].sort() });
      process.stderr.write(`${JSON.stringify({type:"packet-progress",kind,run,completed:notes.length,total:places.length})}\n`);
    }
    return notes;
  }
  if (kind === "coordinator") {
    const pg = await importAt("lib/control-plane/repository/pg-store.ts");
    const rows = await pg.readCoordinatorWorkItems(repos);
    assert.equal(rows.length, places.length + 1);
    assert.ok(rows.some((row: { id: string }) => row.id === "wi-0-1"), "Archived non-hunt continuation must remain visible");
    return rows.map((row: { id: string }) => row.id).sort();
  }
  if (kind === "dispatch") {
    const durable = await importAt("lib/control-plane/scheduler/durable.ts");
    const obligations = places.map((subjectId, index) => ({ id: `o-${index}`, subjectId, openOccurrenceId: `open-${index}`, occurrenceCount: history + 1, updatedAt: now } as StandingObligation));
    const snapshot = await repos.dispatchState.readOpen({ since: run === 0 ? null : now });
    await durable.scanOccurrences(repos, { obligations, settledRouteTaskIds: new Set(), neverClaimedRouteTaskIds: new Set(snapshot.routeTasks.keys()), snapshot });
    return Promise.all(obligations.map(obligation => durable.resumeOpenOccurrence(repos, obligation, snapshot)));
  }
  throw new Error(`Unknown kind ${kind}`);
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
  if(scenario==="pipeline") {
    const shape=(await pg.query("SELECT count(*)::text AS records,round(avg(octet_length(record::text)))::integer AS mean_bytes,max(octet_length(record::text)) AS max_bytes,min(changed_at) AS earliest_change,max(changed_at) AS latest_change,now() AS database_clock FROM cp_log_promotion_pipeline")).rows[0];
    process.stderr.write(`${JSON.stringify({type:"input-shape",...shape})}\n`);
  }

  if(scenario==="manual" || scenario==="source-hints") {
    const shape=(await pg.query(`WITH sizes AS MATERIALIZED (SELECT octet_length(value::text) AS bytes,
      jsonb_array_length(value #> '{reach,places}')>0 AS place_reach,jsonb_array_length(value #> '{reach,states}')>0 AS state_reach,
      jsonb_array_length(value #> '{reach,platforms}')>0 AS platform_reach,(value #>> '{reach,everywhere}')::boolean AS everywhere,
      (value #>> '{reach,method}')::boolean AS method FROM cp_field_manual_entries)
      SELECT count(*)::text AS records,round(avg(bytes))::int AS mean_bytes,percentile_disc(0.95) WITHIN GROUP(ORDER BY bytes) AS p95_bytes,max(bytes) AS max_bytes,
        count(*) FILTER(WHERE place_reach)::text AS places,count(*) FILTER(WHERE state_reach)::text AS states,
        count(*) FILTER(WHERE platform_reach)::text AS platforms,count(*) FILTER(WHERE everywhere)::text AS everywhere,
        count(*) FILTER(WHERE method)::text AS methods,(SELECT count(*) FROM scale_manual_samples)::int AS source_samples FROM sizes`)).rows[0];
    process.stderr.write(`${JSON.stringify({type:"input-shape",...shape})}\n`);
  }
  const fixtureSetupMs = performance.now() - setupStarted;
  process.stderr.write(`${JSON.stringify({ type: "fixture", scenario, divisions: places.length, fixtureSetupMs })}\n`);
  const directory = await mkdtemp(join(tmpdir(), "cp-01-scale-"));
  const { writeFile } = await import("node:fs/promises");
  const selectedFile = join(directory, "selected.json");
  const packetStates=arg("planning-states")?new Set(arg("planning-states").split(",")):null;
  const selectedForWork=selected.filter(place=>places.includes(place) && (packetStates===null || packetStates.has(/\/(?:state|territory|district):([^/]+)/.exec(place)![1])));
  await writeFile(selectedFile, JSON.stringify(selectedForWork));
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
    let observedPeakRssBytes=0,fixtureResponseBytes=0,fixtureRequestBytes=0;
    const memory=setInterval(()=>{
      try {const held=/VmHWM:\s+(\d+) kB/.exec(readFileSync(`/proc/${child.pid}/status`,"utf8"));if(held)observedPeakRssBytes=Math.max(observedPeakRssBytes,Number(held[1])*1024);}catch{}
    },50);
    child.on("error",error=>{clearInterval(memory);reject(error);});
    child.on("exit", (code,signal) => {
      clearInterval(memory);
      if(code===0 && completed!==null)resolve(completed);
      else {
        process.stderr.write(`${JSON.stringify({type:"failed-worker",scenario,state,code,signal,observedPeakRssBytes,fixtureResponseBytes,fixtureRequestBytes})}\n`);
        reject(new Error(`Scale worker exited ${code} (${signal}) without completing its run`));
      }
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
      fixtureRequestBytes+=Buffer.byteLength(message.body);
      try {
        const request = JSON.parse(message.body);
        const execute = async (query: { query: string; params?: unknown[] }) => {
          return wire(await pg.query<Record<string, unknown>>(query.query, query.params ?? []));
        };
        const response = request.queries ? { results: await Promise.all(request.queries.map(execute)) } : await execute(request);
        const body=JSON.stringify(response);fixtureResponseBytes+=Buffer.byteLength(body);
        if(child.connected)child.send({ id: message.id, body });
      } catch (error) { if(child.connected)child.send({ id: message.id, error: error instanceof Error ? error.message : String(error) }); }
    });
  });
    return reports;
  };
  const results:RunReport[]=[];
  if(scenario==="planner" || scenario==="pipeline") {
    const statePlanning=await importAt("lib/control-plane/scheduler/state-planning.ts");
    const started=performance.now();
    const round=await statePlanning.runStatePlanningRound(async(state:string)=>{
      const reports=await launch(state);results.push(...reports);return true;
    },arg("planning-states")?arg("planning-states").split(","):statePlanning.PLANNING_STATES);
    assert.equal(round.failed.length,0);
    planningRoundWallMs=performance.now()-started;
    process.stderr.write(`${JSON.stringify({type:"planning-round",states:round.completed,wallMs:planningRoundWallMs})}\n`);
  }else results.push(...await launch());
  if(scenario==="orders")assert.ok(pg.peakConcurrentQueries()>1,"the stop workload must exercise concurrent database writes");
  const peak = Math.max(...results.map(result => result.peakRssBytes));
  const runnerAvailable = Number(arg("runner-available-bytes", "NaN"));
  const documentedHost = 8 * 1024 ** 3;
  const parentReserve = 2928 * 1024 ** 2;
  const margin = 0.75 * 1024 ** 3;
  const warmRows=scenario==="planner" || scenario==="pipeline"?results.filter(result=>result.run===repetitions-1):[results.at(-1)!];
  const warm={responseBytes:warmRows.reduce((n,row)=>n+row.responseBytes,0),requestBytes:warmRows.reduce((n,row)=>n+row.requestBytes,0),databaseWalBytes:warmRows.reduce((n,row)=>n+row.databaseWalBytes,0),ms:warmRows.reduce((n,row)=>n+row.ms,0)};
  console.log(JSON.stringify({ scenario, root,sourceSha,planningRoundWallMs, input: { subjects: places.length,nationalSubjectsAvailable:all.length,ocdDivisions: all.filter(place=>place.startsWith("ocd-division/")).length,censusGovernments:all.filter(place=>place.startsWith("government:")).length,
    scopes: [...byState.keys()].sort(), selectedPlaces: selectedForWork.length, historiesPerPlace: history },
    measurement: "Postgres 17 in an isolated local container; exact serialized fixture-adapter request/response bodies through the production Neon counter and physical WAL written per workload. Excludes real Neon framing and network latency. Database memory is separate from the measured worker.",
    assumptions: { runsPerDay, runnerAvailableBytes: Number.isFinite(runnerAvailable) ? runnerAvailable : null, reserveBytes: margin,
      documentedHostBytes: documentedHost, documentedHostSource: "deploy/runner/README.md", existingParentReserveBytes: parentReserve,
      parentReserveSource: "lib/control-plane/workers/worker-slots.ts", productionHeartbeatAvailable: false },
    fixtureSetupMs,fixturePeakConcurrentQueries:pg.peakConcurrentQueries(), peakRssBytes: peak, workerPeakSource: "/proc/self/status VmHWM", copiesAtMargin: Number.isFinite(runnerAvailable) ? Math.max(0, Math.floor((runnerAvailable - margin) / peak)) : null,
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
    if (value instanceof Date) return value.toISOString().replace("T"," ").replace(/Z$/,"+00");
    return String(value);
  };
  return { command: "SELECT", rowCount: result.affectedRows ?? result.rows.length, rowAsArray: true, fields: result.fields,
    rows: result.rows.map(row => result.fields.map(field => encode(row[field.name], field.dataTypeID))) };
}

async function seed(pg: FixtureDatabase, places: string[], selected: string[]) {
  const template = (kind: string) => `INSERT INTO cp_${kind} (id, revision, updated_at, changed_at, value)`;
  if(scenario==="pipeline") {
    const {VERIFICATION_CHECKS}=await importAt("lib/control-plane/promotion/types.ts");
    await pg.query(`INSERT INTO cp_log_promotion_pipeline(log_key,record_id,position,recorded_at,changed_at,record)
      SELECT 'pipeline-'||p.ordinal||'-'||h.n,'pipeline-'||p.ordinal||'-'||h.n||'-'||stage.n,
        p.ordinal::bigint*$3::bigint*2+(h.n-1)*2+stage.n,$1::timestamptz,$1::timestamptz,
        jsonb_build_object('formatVersion',1,'recordId','pipeline-'||p.ordinal||'-'||h.n||'-'||stage.n,
          'itemId','pipeline-'||p.ordinal||'-'||h.n,'at',$1::text,'actor',jsonb_build_object('role',CASE WHEN stage.n=0 THEN 'SCOUT' ELSE 'VALIDATOR' END,'lane','DETERMINISTIC','instance','fixture')) ||
        CASE WHEN stage.n=0 THEN jsonb_build_object('stage','SCOUTED','subjectId',p.id,'recordClass','OFFICIAL_ROSTER',
          'source',jsonb_build_object('kind','SCOUT_RESULT','attemptId','attempt-'||p.ordinal,'obligationId',p.id,'outcome','EVIDENCE_FOUND','routeId',NULL),
          'canonicalUrl',NULL,'artifactIds',jsonb_build_array('artifact-'||p.ordinal||'-'||h.n),'scoutAttemptId','attempt-'||p.ordinal,'summary','Generated official source sample '||repeat(md5(p.id||h.n),32))
        ELSE jsonb_build_object('stage','VERIFIED','checks',$2::jsonb) END
      FROM scale_places p CROSS JOIN generate_series(1,$3::integer) h(n) CROSS JOIN generate_series(0,1) stage(n)`,
      [now,JSON.stringify(VERIFICATION_CHECKS.map((name:string)=>({name,result:"PASS",detail:"Generated source verification"}))),history]);
  } else if (scenario === "manual" || scenario==="source-hints") {
    const manual = await importAt("lib/control-plane/field-manual.ts");
    const samples=(JSON.parse(await readFile(join(sourceRoot,"tests/fixtures/field-manual-pages/manual.json"),"utf8")) as {entries:unknown[]}).entries.map(entry=>manual.normalizeEntry(entry));
    assert.ok(samples.length);
    await pg.exec("CREATE TABLE scale_manual_samples(ordinal integer PRIMARY KEY,value jsonb NOT NULL)");
    await pg.query("INSERT INTO scale_manual_samples SELECT (ordinal-1)::integer,value FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY samples(value,ordinal)",[JSON.stringify(samples)]);
    for(let at=0;at<places.length;at+=250) {
      await pg.query(`WITH source AS (
      SELECT p.ordinal,p.id,p.state,h.n,sample.value,
        (p.ordinal::bigint*$3::integer+h.n-1)%7126 AS bucket,(p.ordinal::bigint*$3::integer+h.n-1)%1000 AS size_bucket
      FROM scale_places p CROSS JOIN generate_series(1,$3::integer) h(n)
      JOIN scale_manual_samples sample ON sample.ordinal=(p.ordinal::bigint*$3::integer+h.n-1)%$2::integer
      WHERE p.ordinal>=$4::integer AND p.ordinal<$5::integer
    ), scope AS (
      SELECT *,bucket>=6571 AS is_place,bucket>=1467 AND bucket<6571 AS is_state,
        (bucket>=368 AND bucket<1467 OR bucket=6570 OR bucket>=7066) AS is_platform,
        (bucket>=162 AND bucket<368 OR bucket>=1270 AND bucket<1467) AS is_everywhere,
        (bucket>=45 AND bucket<162 OR bucket>=1213 AND bucket<1270 OR bucket>=6487 AND bucket<6570) AS is_method,
        CASE WHEN size_bucket=0 THEN 75228 WHEN size_bucket<60 THEN 3601 ELSE 1579 END AS target_bytes FROM source
    ), shaped AS (
      SELECT ordinal,n,id,target_bytes,value || jsonb_build_object('id','note-'||ordinal||'-'||n,'role','SCOUT',
        'kind',CASE WHEN is_method THEN 'METHOD' WHEN value->>'kind' IN('METHOD','ROUTE','MANIFEST_BRANCH') THEN 'LESSON' ELSE value->>'kind' END,
        'states',jsonb_build_array(state),'ocdIds',CASE WHEN is_place THEN jsonb_build_array(id) ELSE '[]'::jsonb END,'bodyIds','[]'::jsonb,
        'url',CASE WHEN is_method THEN NULL ELSE value->>'url' END,'platforms',CASE WHEN is_platform THEN jsonb_build_array('legistar') ELSE '[]'::jsonb END,
        'reach',jsonb_build_object('places',CASE WHEN is_place THEN jsonb_build_array(lower(id)) ELSE '[]'::jsonb END,
          'states',CASE WHEN is_state THEN jsonb_build_array(state) ELSE '[]'::jsonb END,
          'platforms',CASE WHEN is_platform THEN jsonb_build_array('legistar') ELSE '[]'::jsonb END,'everywhere',is_everywhere,'method',is_method),
        'payload',(CASE WHEN jsonb_typeof(value->'payload')='object' THEN value->'payload' ELSE jsonb_build_object('sourcePayload',value->'payload') END)||jsonb_build_object('scaleExcerpt','')) AS value
      FROM scope
    ) ${template("field_manual_entries")} SELECT 'note-'||ordinal||'-'||n,1,$1::timestamptz,$1::timestamptz,
      jsonb_set(value,'{payload,scaleExcerpt}',to_jsonb(left(repeat(md5(id||n),((target_bytes+31)/32)::integer),greatest(0,target_bytes-octet_length(value::text)))))
      FROM shaped`,[now,samples.length,history,at,at+250]);
      if(at%2500===0)await pg.exec("ANALYZE cp_field_manual_entries; ANALYZE cp_manual_method_meta; ANALYZE cp_manual_method_rank; ANALYZE cp_manual_source_facts; ANALYZE cp_manual_source_classes");
    }
  } else if (scenario === "method") {
    await pg.query(`INSERT INTO cp_fix_map (method_id,place_id,state,tried_at,attempt_id,cause,updated_at)
      SELECT 'scale-method',id,'WORKS',$1::timestamptz,'attempt-' || ordinal,NULL,$1::timestamptz FROM scale_places`, [now]);
  } else if (scenario === "admin" || scenario === "orders") {
    const admin = await importAt("lib/control-plane/gateway/admin-config.ts");
    const config = admin.defaultAdminConfig(now);
    await pg.query(`${template("admin_config")} VALUES('current',1,$1::timestamptz,$1::timestamptz,$2::jsonb)`,[now,JSON.stringify(config)]);
    await pg.query(`INSERT INTO cp_admin_setting_history(config_id,id,updated_at,value)
      SELECT 'current','setting-'||ordinal,$1::timestamptz,jsonb_build_object('id','setting-'||ordinal,'key','workers','before',1,'after',2,'at',$1::text,'actor','factory') FROM scale_places`,[now]);
    await pg.exec("ALTER TABLE cp_admin_place_targets DISABLE TRIGGER cp_admin_place_targets_planning_changed");
    await pg.query(`INSERT INTO cp_admin_place_targets(config_id,id,updated_at,value)
      SELECT 'current','geo:'||state||'.place.'||ordinal,$1::timestamptz,jsonb_build_object('key','geo:'||state||'.place.'||ordinal,'goalPercent',100,'setAt',$1::text,'decidedBy','factory','receiptId','receipt-'||ordinal) FROM scale_places`,[now]);
    await pg.exec("ALTER TABLE cp_admin_place_targets ENABLE TRIGGER cp_admin_place_targets_planning_changed");
  } else if (scenario === "spend") {
    await pg.query(`INSERT INTO cp_model_charges (id,charged_at,job_id,route_task_id,obligation_id,jurisdiction,attempt_id,usd,known_usd,measured,bounded,assignment_refs,is_scout,scout_usd,cache)
      SELECT 'charge-' || ordinal,$1::timestamptz,'job-' || ordinal,'task-' || ordinal,NULL,id,'attempt-' || ordinal,0.01,0.01,true,false,NULL,
        true,0.01,NULL FROM scale_places`, [now]);
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
    if (scenario!=="planner") {
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
  query<T=Record<string,unknown>>(text:string,params?:unknown[]):Promise<{rows:T[];fields:{name:string;dataTypeID:number}[];affectedRows:number}>;
  exec(text:string):Promise<void>;
  close():Promise<void>;
  peakConcurrentQueries():number;
}

async function fixtureDatabase():Promise<FixtureDatabase> {
  const name=`cp01-scale-${randomUUID()}`;
  const password=randomUUID();
  execFileSync("docker",["run","--detach","--rm","--name",name,"--memory=2g","--publish","127.0.0.1::5432",
    "--env","POSTGRES_PASSWORD","--env","POSTGRES_USER=fixture","--env","POSTGRES_DB=fixture","postgres:17-alpine",
    "-c","shared_buffers=128MB","-c","autovacuum=off","-c","max_parallel_workers_per_gather=0"],
    {env:{...process.env,POSTGRES_PASSWORD:password},stdio:["ignore","ignore","pipe"]});
  const port=Number(execFileSync("docker",["port",name,"5432/tcp"],{encoding:"utf8"}).trim().split(":").at(-1));
  const connected=new Pool({host:"127.0.0.1",port,user:"fixture",password,database:"fixture",application_name:"cp01-scale",connectionTimeoutMillis:1000,max:16});
  try {
    let ready=false;
    for(let attempt=0;attempt<60;attempt++) {
      try {await connected.query("SELECT 1");ready=true;break;}
      catch {await new Promise(done=>setTimeout(done,250));}
    }
    if(!ready)throw new Error("The isolated Postgres fixture did not become ready");
  }catch(error){await connected.end();execFileSync("docker",["rm","--force","--volumes",name],{stdio:"ignore"});throw error;}
  let connectionError:Error|null=null;
  connected.on("error",error=>{connectionError=error;});
  const close=async()=>{
    process.off("SIGTERM",terminate);
    try {await connected.end();}
    finally {execFileSync("docker",["rm","--force","--volumes",name],{stdio:"ignore"});}
    if(connectionError)throw connectionError;
  };
  const terminate=()=>{void close().finally(()=>process.exit(143));};
  process.once("SIGTERM",terminate);
  let activeQueries=0,peakConcurrentQueries=0;
  return {
    query:async<T,>(text:string,params:unknown[]=[])=>{
      if(connectionError)throw connectionError;
      const client=await connected.connect();
      activeQueries++;peakConcurrentQueries=Math.max(peakConcurrentQueries,activeQueries);
      try {
        const result=await client.query(text,params);
        return {rows:result.rows as T[],fields:result.fields,affectedRows:result.rowCount??0};
      }finally{activeQueries--;client.release();}
    },
    exec:async text=>{if(connectionError)throw connectionError;await connected.query(text);},
    close,peakConcurrentQueries:()=>peakConcurrentQueries,
  };
}
