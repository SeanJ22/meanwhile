/** Read-only EPA replay. Production supplies registrations; every publication write is local. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile, rm, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import React from "react";
import { neon } from "@neondatabase/serverless";
import { renderToStaticMarkup } from "react-dom/server";
import { OpenDataFacts, openDataSources } from "../components/map/open-data.tsx";
import { US_JURISDICTIONS } from "../lib/coverage/states.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { requiredRoutineContract } from "../lib/civic-data/contracts.ts";
import { routineTaskDue, routineTaskFromContract } from "../lib/civic-data/runner.ts";
import { verifyRoutineReaderProjection } from "../lib/civic-data/reader-verification.ts";
import { readRegistrationProjection } from "../lib/registration/reader.ts";
import { openArchiveSource } from "../lib/sources/archive-download.ts";
import { openDataArchiveStore } from "./open-data-refresh.mts";
import { streamCsvObjects } from "../lib/sources/prl/streaming.ts";
import { normalizeEcho } from "../lib/sources/open-data/normalize.ts";
import { OpenDataSpool } from "../lib/sources/open-data/spool.ts";
import { echoMinimumGap, type EchoMinimumGap } from "../lib/sources/open-data/echo-gaps.ts";
import { governmentJoinRows } from "../lib/sources/open-data/portals.ts";
import { facilityCell, facilityPoint } from "../lib/sources/open-data/geography.ts";
import { ECHO_EXPORT, zipPartition, openDataReaderRecord, openDataFactIssue, type OpenDataPartitionRef } from "../lib/sources/open-data/model.ts";
import { saveOpenDataPartition, readOpenDataPartition } from "../lib/sources/open-data/artifacts.ts";
import { publishOpenData, readOpenDataProjection, type OpenDataCapture } from "../lib/sources/open-data/publication.ts";
import { FederalMoneyBenchmarkStore } from "./lib/federal-money-benchmark-store.mts";
import { installReaderDatabaseQuery } from "../lib/reader/database.ts";
import { installOpenDataReaderSql, installOpenDataReplayVault, normalOpenDataPage } from "./lib/open-data-replay-reader.mts";
import { compressedReplayVault } from "./lib/open-data-replay-vault.mts";
import { lookupZcta } from "../lib/geo/zcta.ts";
import { openDataEvidence } from "../lib/ask/open-data.ts";

interface ArchiveMeta {url:string;finalUrl:string;sha256:string;byteLength:number;retrievedAt:string;httpStatus:number;lastModified:string|null;etag:string|null;contentType:string|null}
const args=new Map(process.argv.slice(2).map(arg=>{const at=arg.indexOf("=");return [arg.slice(0,at),arg.slice(at+1)];}));
const cache=resolve(args.get("--cache")??".scratch/src01-epa");
const temporaryRoot=resolve(args.get("--tmp-root")??join(process.cwd(),"..","src01-scratch","epa-tmp"));
await mkdir(temporaryRoot,{recursive:true});
process.env.TMPDIR=temporaryRoot;
const output=resolve(args.get("--output")??"docs/measurements/src-01/epa-all-states.json");
const urlFile=args.get("--readonly-url-file");
const realNow=Date.now;
let disposeNational:(()=>Promise<void>)|undefined;
const task=routineTaskFromContract(requiredRoutineContract("epa-echo"));
async function fileHash(path:string) {const hash=createHash("sha256");for await(const bytes of createReadStream(path))hash.update(bytes);return hash.digest("hex");}
async function readJson<T>(path:string):Promise<T|null> {try{return JSON.parse(await readFile(path,"utf8")) as T;}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return null;throw error;}}

async function acquireArchive():Promise<ArchiveMeta> {
  await mkdir(cache,{recursive:true});
  const prior=await readJson<ArchiveMeta>(join(cache,"archive.json"));
  if(prior){assert.equal(await fileHash(join(cache,"echo_exporter.zip")),prior.sha256);return prior;}
  const response=await fetch(ECHO_EXPORT,{signal:AbortSignal.timeout(180_000)});
  if(!response.ok||!response.body)throw Error(`EPA exporter HTTP ${response.status}`);
  const hash=createHash("sha256");let byteLength=0;
  async function* chunks(){const reader=response.body!.getReader();try{for(;;){const next=await reader.read();if(next.done)break;hash.update(next.value);byteLength+=next.value.length;yield next.value;}}finally{reader.releaseLock();}}
  await pipeline(chunks(),createWriteStream(join(cache,"echo_exporter.zip"),{flags:"wx"}));
  const meta:ArchiveMeta={url:ECHO_EXPORT,finalUrl:response.url,sha256:hash.digest("hex"),byteLength,retrievedAt:new Date().toISOString(),httpStatus:response.status,
    lastModified:response.headers.get("last-modified"),etag:response.headers.get("etag"),contentType:response.headers.get("content-type")};
  await writeFile(join(cache,"archive.json"),JSON.stringify(meta,null,2));return meta;
}
function heldArchiveFetch(meta:ArchiveMeta):typeof fetch {
  return (async()=>new Response(Readable.toWeb(createReadStream(join(cache,"echo_exporter.zip"))) as ReadableStream<Uint8Array>,{status:200,headers:{"content-length":String(meta.byteLength),
    ...(meta.lastModified?{"last-modified":meta.lastModified}:{}),...(meta.etag?{etag:meta.etag}:{})}})) as typeof fetch;
}
async function diskBytes(root:string):Promise<number>{let bytes=0;for(const entry of await readdir(root,{withFileTypes:true})){const path=join(root,entry.name);bytes+=entry.isDirectory()?await diskBytes(path):(await stat(path)).size;}return bytes;}
const safeError=(error:unknown)=>(error instanceof Error?error.message:String(error)).slice(0,1000);

async function main() {
  const started=realNow(),connection=urlFile?(await readFile(urlFile,"utf8")).trim():process.env.WTP_PRODUCTION_DATABASE_URL_READONLY;
  if(!connection||decodeURIComponent(new URL(connection).username)!=="readonly")throw Error("An existing production readonly-role connection is required.");
  process.env.DATABASE_URL=connection;
  // The production role supplies reads; disposable runner-cache writes stay off for this replay.
  process.env.WTP_CIVIC_READ_CACHE_URL="";
  const access=(await neon(connection).query("SELECT current_user::text AS role, has_table_privilege(current_user,'public.civic_data_candidates','INSERT, UPDATE, DELETE') AS can_write"))[0];
  assert.equal(access.role,"readonly");assert.equal(access.can_write,false);
  const production=new PostgresRoutineDataStore();
  const meta=await acquireArchive(),rawVault=new DurableEvidenceStore(join(cache,"archive-vault"),{remote:null});
  const nationalSpool=await OpenDataSpool.create(),nationalIngestStarted=realNow(),initialRunId=`national-${randomUUID()}`;
  disposeNational=nationalSpool.dispose;const ingestCpu=process.cpuUsage();
  const sourceMetrics=new Map<string,{rows:number;valid:number;program:number;noZip:number;coordinates:number;sample:{id:string;zip:string}|null;gaps:EchoMinimumGap[]}>();
  const archive=await openArchiveSource({id:"epa-echo",url:ECHO_EXPORT,file:"ECHO_EXPORTER.csv",format:"csv-zip"},heldArchiveFetch(meta),openDataArchiveStore(rawVault));
  assert.equal(archive.sourceSha256,meta.sha256);assert.equal(archive.member,"ECHO_EXPORTER.csv");
  const capture:OpenDataCapture={url:ECHO_EXPORT,retrievedAt:meta.retrievedAt,rawHash:meta.sha256,sourceRows:[],
    sourceCheck:{requestedUrl:ECHO_EXPORT,finalUrl:meta.finalUrl,httpStatus:200,checkedAt:meta.retrievedAt,rawHash:meta.sha256},archive:{sha256:meta.sha256,member:archive.member,publishedAt:archive.publishedAt}};
  let nationalRows=0;
  try {
    for await(const raw of streamCsvObjects(archive.textChunks)) {
      nationalRows++;const state=String(raw.FAC_STATE??"").trim().toUpperCase()||"UNRESOLVED";
      let metrics=sourceMetrics.get(state);if(!metrics){metrics={rows:0,valid:0,program:0,noZip:0,coordinates:0,sample:null,gaps:[]};sourceMetrics.set(state,metrics);}metrics.rows++;
      const gap=echoMinimumGap(raw);if(gap){metrics.gaps.push(gap);continue;}
      const row=normalizeEcho(raw,meta.retrievedAt,archive.publishedAt);metrics.valid++;
      if(row.id.startsWith("epa-echo:program:"))metrics.program++;if(!row.zip)metrics.noZip++;else if(!metrics.sample&&lookupZcta(row.zip))metrics.sample={id:row.id,zip:row.zip};
      await nationalSpool.append(row.zip?`${zipPartition(row.zip)}:state:${state}`:`unlocated:${state}`,row,capture);
      const point=facilityPoint(row);if(point){metrics.coordinates++;await nationalSpool.append(`${facilityCell(point.lat,point.lng)}:state:${state}`,row,capture);}
      if(nationalRows%250000===0)console.log(JSON.stringify({stage:"national-source-spool",rows:nationalRows,elapsedMs:realNow()-nationalIngestStarted,rss:process.memoryUsage().rss}));
    }
    await archive.accept?.();assert.ok(nationalRows);
  }finally{await archive.dispose();}
  const distribution={rows:nationalRows,states:[...sourceMetrics].map(([state,metrics])=>({state,rows:metrics.rows}))};
  const nationalIngestMs=realNow()-nationalIngestStarted,nationalSpoolBytes=await diskBytes(temporaryRoot);
  console.log(JSON.stringify({stage:"national-source-spool-complete",rows:nationalRows,elapsedMs:nationalIngestMs,diskBytes:nationalSpoolBytes,rss:process.memoryUsage().rss}));
  const weeklyArchive=await openArchiveSource({id:"epa-echo",url:ECHO_EXPORT,file:"ECHO_EXPORTER.csv",format:"csv-zip"},heldArchiveFetch(meta),openDataArchiveStore(rawVault),meta.sha256);
  assert.equal(weeklyArchive.sourceSha256,meta.sha256);assert.equal(weeklyArchive.unchanged,true);await weeklyArchive.dispose();
  const rawKeys=await rawVault.list("project/freshness/source/src-so/archive/");
  assert.ok(rawKeys.includes("project/freshness/source/src-so/archive/index/epa-echo/source.json"));
  assert.equal(rawKeys.filter(key=>key.includes("/epa-echo/sources/")).length,Math.ceil(meta.byteLength/(4*1024*1024)),"The next run reuses the held content-addressed bytes.");
  const proof:{[key:string]:unknown;states:Record<string,unknown>[]}={source:"epa-echo",scope:"Every exporter row and every state/territory named by the source, plus all 56 registered US jurisdictions",productionWrites:0,
    production:{project:"tiny-hill-13996172",branch:"br-delicate-lab-ax02xuo5",role:access.role,candidateTableWritePrivilege:access.can_write},archive:meta,sourceRows:distribution.rows,sourceStateCounts:distribution.states.map(({state,rows})=>({state,rows})),
    nationalIngest:{mode:"One actual production OpenDataSpool holds every real national row before materialization; source HTTP bytes are held from the actual official capture.",elapsedMs:nationalIngestMs,cpuMs:Object.values(process.cpuUsage(ingestCpu)).reduce((sum,value)=>sum+value,0)/1000,diskBytes:nationalSpoolBytes,rows:nationalRows},
    implementation:{spoolSha256:await fileHash("lib/sources/open-data/spool.ts"),replaySha256:await fileHash("scripts/replay-epa-all-states.mts")},
    archiveRuns:{initial:initialRunId,contentAddressedBodies:true,nextArchiveUnchanged:true,heldBytesReplay:true},
    pipeline:"actual archive reader and CSV parser -> normalizeEcho + held production registration joins -> saveOpenDataPartition -> registered publishOpenData -> typed reader partitions -> readerOpenData -> grounded Ask evidence and OpenDataFacts renderer",
    clockScope:"Future clocks replay held real publisher bytes and preserve source dates; they do not claim future HTTP observations.",states:[]};
  const sourceByState=new Map(distribution.states.map(row=>[row.state,row]));
  const states=[...new Set([...US_JURISDICTIONS.map(row=>row.usps),...sourceByState.keys()])].sort((a,b)=>(a==="UNRESOLVED"?"":a).localeCompare(b==="UNRESOLVED"?"":b));
  await mkdir(resolve(output,".."),{recursive:true});
  const save=async()=>writeFile(output,JSON.stringify({...proof,elapsedMs:realNow()-started},null,2));
  const nationalVaultRoot=join(cache,`national-reader-vault-${initialRunId}`);
  const replayTiming={compressionMs:0,artifactReadbackMs:0};
  const nationalVault=compressedReplayVault(nationalVaultRoot,replayTiming),nationalReferences:OpenDataPartitionRef[]=[],nationalReports:{id:string;state:string;loaded:number;joined:number;unjoined:number}[]=[];
  const materializationStarted=realNow();
  const iterator=nationalSpool.partitions({consume:true,maxRows:1000,maxBytes:4*1024*1024})[Symbol.asyncIterator]();
  let next=await iterator.next();
  try {for(const state of states) {
    Date.now=realNow;
    const stateStarted=realNow(),source=sourceByState.get(state),result:Record<string,unknown>={state,sourceRows:source?.rows??0,publishedRows:0,status:"FAIL",failures:[]},references:OpenDataPartitionRef[]=[];
    proof.states.push(result);
    try {
      const jurisdiction=US_JURISDICTIONS.find(row=>row.usps===state);
      const registrationStarted=realNow();
      const registration=jurisdiction?await readRegistrationProjection(state,{store:production,bypassCache:true}):null;
      result.registrationReadMs=realNow()-registrationStarted;
      result.registration=registration?{kind:registration.kind,version:registration.metadata.versionId,...registration.kind==="PROMOTED"?{governments:registration.value.governments?.length??0}: {}}:{kind:"OUTSIDE_REGISTERED_US_JURISDICTIONS",detail:"Source facts retain their native state code and unresolved joins."};
      const held=registration?.kind==="PROMOTED"?governmentJoinRows(registration.value.governments??[]):[];
      const metrics=sourceMetrics.get(state),report={id:`state:${state}`,state,loaded:0,joined:0,unjoined:0};
      const vault=nationalVault;
      const noZipRows=metrics?.noZip??0,coordinateRows=metrics?.coordinates??0,programIdentityRows=metrics?.program??0,inputRows=metrics?.rows??0,gaps=metrics?.gaps??[];
      const rejected={count:gaps.length,examples:gaps.map(gap=>gap.fact.record)},materializeStarted=realNow(),compressionStarted=replayTiming.compressionMs,readbackStarted=replayTiming.artifactReadbackMs;
      let readerFileRows=0,largestReaderFileBytes=0,largestReaderRows=0,peakRss=process.memoryUsage().rss;
      assert.equal(inputRows,source?.rows??0);
      while(!next.done&&(next.value.rows[0]?.state??"UNRESOLVED")===state) {
        const partition=next.value,rows=partition.rows.map(row=>normalizeEcho(row.sourceRow,row.capturedAt,row.publishedAt,held));
        if(!partition.partition.startsWith("cell:"))for(const row of rows){report.loaded++;if(row.divisionIds.length)report.joined++;else report.unjoined++;}
        const reference=await saveOpenDataPartition({source:"epa-echo",partition:partition.partition,rows,captures:partition.captures,now:meta.retrievedAt},vault);
        references.push(reference);
        const readbackAt=performance.now(),read=await readOpenDataPartition("epa-echo",reference,vault);assert.equal(read.records.length,rows.length);
        largestReaderFileBytes=Math.max(largestReaderFileBytes,(await vault.head(reference.key))!.byteLength);replayTiming.artifactReadbackMs+=performance.now()-readbackAt;largestReaderRows=Math.max(largestReaderRows,rows.length);peakRss=Math.max(peakRss,process.memoryUsage().rss);
        if(!partition.partition.startsWith("cell:"))readerFileRows+=read.records.length;
        next=await iterator.next();
      }
      result.materializeMs=realNow()-materializeStarted;result.proofCompressionMs=replayTiming.compressionMs-compressionStarted;result.proofReadbackMs=replayTiming.artifactReadbackMs-readbackStarted;result.normalMaterializeMs=Number(result.materializeMs)-Number(result.proofCompressionMs)-Number(result.proofReadbackMs);result.largestReaderFileBytes=largestReaderFileBytes;result.largestReaderRows=largestReaderRows;result.peakRss=peakRss;
      result.rejectedRows=rejected.count;result.rejectedExamples=rejected.examples;result.programIdentityRows=programIdentityRows;
      assert.equal(report.loaded+rejected.count,inputRows);assert.equal(readerFileRows,report.loaded);
      nationalReferences.push(...references);nationalReports.push(report);
      result.verifiedRows=report.loaded;result.status="MATERIALIZED";result.report=report;result.readerPartitionRows=readerFileRows;
      result.readerPartitions=references.length;result.noZipRows=noZipRows;result.coordinateRows=coordinateRows;result.clocks=[];
    }catch(error){(result.failures as string[]).push(safeError(error));throw error;}
    finally{Date.now=realNow;result.elapsedMs=realNow()-stateStarted;await writeFile(join(cache,`reader-state-${createHash("sha256").update(state).digest("hex").slice(0,16)}.json`),JSON.stringify({state,result,references,capture,vaultRoot:nationalVaultRoot}));await save();}
    console.log(JSON.stringify({state,status:result.status,sourceRows:result.sourceRows,publishedRows:result.publishedRows,elapsedMs:result.elapsedMs,failures:result.failures}));
  }
  }finally{await iterator.return?.(undefined);await nationalSpool.dispose();}
  proof.materializationMs=realNow()-materializationStarted;
  proof.proofOnlyMaterializationMs={compression:replayTiming.compressionMs,exactReadback:replayTiming.artifactReadbackMs,total:replayTiming.compressionMs+replayTiming.artifactReadbackMs};
  proof.normalMaterializationMs=Number(proof.materializationMs)-replayTiming.compressionMs-replayTiming.artifactReadbackMs;
  const databaseRoot=join(cache,"reader-postgres");await rm(databaseRoot,{recursive:true,force:true});
  const store=await FederalMoneyBenchmarkStore.open(databaseRoot,"epa-echo","epa-echo");
  await installOpenDataReaderSql(store.query);installReaderDatabaseQuery(store.query);
  const transport=installOpenDataReplayVault(nationalVault),OriginalDate=globalThis.Date;let controlledAt:number|undefined;
  globalThis.Date=new Proxy(OriginalDate,{construct(target,values){return Reflect.construct(target,values.length?values:[controlledAt??realNow()]);},get(target,name,receiver){return name==="now"?()=>controlledAt??realNow():Reflect.get(target,name,receiver);}});
  const firstAt=new Date(realNow()).toISOString(),tomorrowAt=new Date(Date.parse(firstAt)+86400000).toISOString(),allGaps=[...sourceMetrics.values()].flatMap(metrics=>metrics.gaps);
  try {
  const reports=states.map(state=>nationalReports.find(report=>report.state===state)??{id:`state:${state}`,state,loaded:0,joined:0,unjoined:0});
  const nationalClocks:Record<string,unknown>[]=[];let initialPublishMs=0;
  proof.localArtifactStorage={encoding:"gzip level1 only at the local EvidenceStore boundary; get returns and checks exact original bytes and metadata",vaultRoot:nationalVaultRoot,heldArtifacts:nationalReferences.length,compressedDiskBytes:await diskBytes(nationalVaultRoot),allReferencedBytesRetained:true};
  for(const label of ["initial","tomorrow","nextWeekly"]) {
    const clock=await store.clock(task.sourceId,task.recordClass,task.scope,task.parserVersion),nextAt=new Date(Date.parse(clock.lastSucceededObservedAt??clock.lastSucceededAt??firstAt)+task.cadenceMs).toISOString();
    const at=label==="initial"?firstAt:label==="tomorrow"?tomorrowAt:nextAt;controlledAt=Date.parse(at);await store.setReplayClock(controlledAt);
    const due=routineTaskDue(task,clock,Date.parse(at));assert.equal(due,label!=="tomorrow");
    const publishStarted=realNow(),publication=due?await publishOpenData({store,source:"epa-echo",rows:[],reports,partitions:nationalReferences,captures:[capture],excludedFacts:allGaps.map(gap=>gap.fact),now:at,replace:true}):null;
    if(label==="initial")initialPublishMs=realNow()-publishStarted;
    const projection=await readOpenDataProjection("epa-echo","national",{store,now:at,bypassCache:true});assert.equal(projection.kind,"PROMOTED");if(projection.kind!=="PROMOTED")throw Error("Missing actual combined national EPA projection.");
    const typed=await verifyRoutineReaderProjection(requiredRoutineContract("epa-echo"),{store,now:at,expectedVersionId:projection.metadata.versionId!});assert.equal(typed.status,"PASS");
    let availableArtifacts=0;for(const reference of nationalReferences){const meta=await nationalVault.head(reference.key);assert.ok(meta);assert.equal(meta.contentHash,`sha256-${reference.sha256}`);availableArtifacts++;}
    nationalClocks.push({label,at,due,availableArtifacts,clockBefore:clock,state:"PROMOTED",version:projection.metadata.versionId,outputRows:publication?.candidate.normalization.outputRecords??projection.value.reports.reduce((sum,report)=>sum+report.loaded,0),confirmed:!!publication?.outcome.confirmed,typedReader:typed.status});
    for(const result of proof.states) {
      if(result.status==="FAIL")continue;
      const state=String(result.state),sample=sourceMetrics.get(state)?.sample,jurisdiction=US_JURISDICTIONS.some(row=>row.usps===state),loaded=Number(result.verifiedRows);
      try {
        assert.equal(projection.value.reports.find(report=>report.state===state)?.loaded,loaded);
        let reader:Record<string,unknown>|null=null;
        if(sample){
          const page=await normalOpenDataPage(sample.zip,sample.id),row=page.row,read={checkedAt:page.checkedAt};
          assert.equal(openDataFactIssue(openDataReaderRecord(row)),null);
          const evidence=openDataEvidence(row),html=renderToStaticMarkup(React.createElement(OpenDataFacts,{records:[row],checkedAt:read.checkedAt}));
          assert.ok(html.includes(`data-open-data-record="${row.id}"`));assert.equal(evidence.id,row.id);assert.ok(openDataSources([row],read.checkedAt).some(value=>value.provenance.sourceUrl===row.sourceUrl));
          reader={status:"PASS",transport:"actual GET /api/open-data -> currentReaderSelection -> loadReaderProjection SQL -> real Netlify SDK over held local bytes",apiElapsedMs:page.elapsedMs,apiPages:page.pages,apiRowsRead:page.recordsRead,zip:sample.zip,recordId:row.id,title:row.title,sourceUrl:row.sourceUrl,askKind:evidence.kind,cardComponent:"components/map/open-data.tsx#OpenDataFacts",renderedHtmlSha256:createHash("sha256").update(html).digest("hex"),sourceRetrievedAt:row.capturedAt,sourcePublishedAt:row.publishedAt};
        }else if(jurisdiction&&loaded)throw Error("State source rows have no usable ZIP for their reader location replay.");
        (result.clocks as unknown[]).push({label,at,due,state:"PROMOTED",version:projection.metadata.versionId,publishedRows:loaded,confirmed:!!publication?.outcome.confirmed,typedReader:typed.status,reader});
        result.publishedRows=loaded;result.status=sample||!loaded?"PASS":"PUBLISHED_OUTSIDE_US_LOCATION_SCOPE";
        if(!sample&&loaded)result.locationReplay="The publisher supplied no usable US ZIP. Exact source partitions and the national publication passed; no US place-card claim is made.";
      }catch(error){result.status="FAIL";(result.failures as string[]).push(safeError(error));}
    }
    controlledAt=undefined;await save();console.log(JSON.stringify({stage:"national-publish-readers",label,version:projection.metadata.versionId,sourceRows:nationalRows,publishedRows:projection.value.reports.reduce((sum,report)=>sum+report.loaded,0),failedStates:proof.states.filter(result=>result.status==="FAIL").map(result=>result.state)}));
  }
  await writeFile(join(cache,"national-canonical-manifest.json"),JSON.stringify({references:nationalReferences,reports,capture,excludedFacts:allGaps.map(gap=>gap.fact),clocks:nationalClocks}));
  proof.readerStorage={kind:"actual PostgresRoutineDataStore over local on-disk PostgreSQL/PGlite; normal GET selected SQL and actual Netlify SDK; all archive and native artifact bytes held locally",productionWrites:0,storage:store.bytes};
  proof.nationalClocks=nationalClocks;proof.initialNationalPublishMs=initialPublishMs;
  proof.grossProcessingAndArtifactVerificationMs=nationalIngestMs+Number(proof.materializationMs)+initialPublishMs;
  proof.productionEquivalentProcessingMs=nationalIngestMs+Number(proof.normalMaterializationMs)+initialPublishMs;
  proof.deadlines={sourceParseLimitMs:20*60_000,parentRoutineLimitMs:30*60_000,sourceParseWithinLimit:nationalIngestMs<20*60_000,allProcessingWithinParentLimit:Number(proof.productionEquivalentProcessingMs)<30*60_000};
  proof.runtimeScope="Gross elapsed includes all national parsing/spooling, state registrations, artifact writes, proof-only gzip compression and exact artifact readback, and the combined national initial publisher. The production-equivalent measurement deducts the individually timed synchronous gzip calls and proof-only readback/head calls, which the production source worker does not perform; no count or runtime is extrapolated. It retains actual compressed local write latency and serial artifact writes (production allows four pending writes). Future-clock reader repetitions and the extra held-byte weekly HTTP replay are excluded. Production remote-vault latency and fresh publisher network time remain unmeasured.";
  proof.publishedRows=proof.states.reduce((sum,row)=>sum+Number(row.publishedRows),0);
  proof.rejectedRows=proof.states.reduce((sum,row)=>sum+Number(row.rejectedRows??0),0);
  proof.failedStates=proof.states.filter(row=>!["PASS","PUBLISHED_OUTSIDE_US_LOCATION_SCOPE"].includes(String(row.status))).map(row=>({state:row.state,failures:row.failures}));
  proof.status=(proof.failedStates as unknown[]).length===0&&Number(proof.publishedRows)+Number(proof.rejectedRows)===distribution.rows&&nationalIngestMs<20*60_000&&Number(proof.productionEquivalentProcessingMs)<30*60_000?"PASS":"FAIL";
  await save();console.log(JSON.stringify({status:proof.status,sourceRows:distribution.rows,publishedRows:proof.publishedRows,failedStates:proof.failedStates,output}));
  if(proof.status!=="PASS")process.exitCode=2;
  }finally{globalThis.Date=OriginalDate;Date.now=realNow;transport.restore();installReaderDatabaseQuery(undefined);await store.close();}
}
try{await main();}finally{Date.now=realNow;await disposeNational?.();}
