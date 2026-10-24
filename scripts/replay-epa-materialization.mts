/** Full held-national EPA materialization, using the production reader and four-writer loop. */
import assert from "node:assert/strict";
import { createHash,randomUUID } from "node:crypto";
import { readFile,writeFile,mkdir,statfs,stat } from "node:fs/promises";
import { join,resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gunzipSync } from "node:zlib";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { readEpaBaselineStates,cacheEpaBaselineRegistrations,reconstructEpaHeldSpoolMetadata,epaMetadataSha256,createEpaReplayVault,type EpaHeldSpoolMetadata } from "./lib/epa-held-spool.mts";
import { createOpenDataSpoolReader } from "../lib/sources/open-data/spool-reader.ts";
import { materializeEchoPartitions } from "../lib/sources/open-data/echo-materialization.ts";
import { openDataReports,echoReaderArtifactRecord } from "../lib/sources/open-data/normalize.ts";
import { governmentJoinRows } from "../lib/sources/open-data/portals.ts";
import { echoMinimumGap } from "../lib/sources/open-data/echo-gaps.ts";
import { saveOpenDataPartition } from "../lib/sources/open-data/artifacts.ts";
import type { OpenDataPartitionRef,OpenDataProjection,OpenDataReport } from "../lib/sources/open-data/model.ts";
import { US_JURISDICTIONS } from "../lib/coverage/states.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import type { ObjectMeta } from "../lib/control-plane/evidence/store.ts";
import type { readRegistrationProjection } from "../lib/registration/reader.ts";

const args=new Map(process.argv.slice(2).map(argument=>{const at=argument.indexOf("=");return at<0?[argument,"true"]:[argument.slice(0,at),argument.slice(at+1)];}));
const cache=resolve(args.get("--cache")??".scratch/src01-epa"),vaultRoot=resolve(args.get("--baseline-vault")??join(cache,"national-reader-vault-national-fc8b79c7-5f7b-4a48-ab7b-b623f31ba1e0"));
const baseline=await readEpaBaselineStates(cache,vaultRoot);
const registrationRoot=join(cache,"materializer-registrations"),metadataFile=join(cache,"four-writer-spool-metadata.json");
if(args.has("--prepare-registrations")){
  const url=(await readFile(args.get("--readonly-url-file")??"/tmp/src-01-prod-readonly-url","utf8")).trim();
  assert.equal(decodeURIComponent(new URL(url).username),"readonly");process.env.DATABASE_URL=url;process.env.WTP_CIVIC_READ_CACHE_URL="";
  const registration=await cacheEpaBaselineRegistrations(baseline,registrationRoot,new PostgresRoutineDataStore());
  console.log(JSON.stringify({status:"PASS",productionWrites:0,registrationRoot,...registration}));
}else if(args.has("--prepare-metadata")){
  const metadata=await reconstructEpaHeldSpoolMetadata(args.get("--snapshot")??"/workspace/src01-scratch/epa-held-national-final/snapshot.json",join(cache,"distribution.json"),baseline[0].capture,baseline);
  await writeFile(metadataFile,JSON.stringify(metadata));
  console.log(JSON.stringify({status:"PASS",metadataFile,sha256:epaMetadataSha256(metadata),facts:metadata.facts,members:metadata.members,logicalPartitions:metadata.sinks.length,elapsedMs:metadata.elapsedMs,cpuMs:metadata.cpuMs}));
}else if(args.has("--materialize")){
  const metadata=JSON.parse(await readFile(metadataFile,"utf8")) as EpaHeldSpoolMetadata;
  const runId=randomUUID(),vaultRoots:[string,string]=[join("/tmp",`src-01-epa-encoded-${runId}`),join("/workspace/src01-scratch",`epa-encoded-${runId}`)],vaultEncoding="gzip-level1" as const,codecTiming={compressionMs:0};
  await Promise.all(vaultRoots.map(root=>mkdir(root,{recursive:true})));
  const encodedVault=createEpaReplayVault(vaultRoots,vaultEncoding,codecTiming),references:OpenDataPartitionRef[]=[],expected=new Map(baseline.flatMap(state=>state.references.map(reference=>[reference.id,reference] as const)));
  const reports=new Map<string,OpenDataReport>(US_JURISDICTIONS.map(state=>[state.usps,{id:`state:${state.usps}`,state:state.usps,loaded:0,joined:0,unjoined:0}]));
  const baselineReport=new Map(baseline.map(state=>[state.state,state.result.report]));
  const remainingByState=new Map(baseline.map(state=>[state.state,state.references.length]));
  const uniqueBodies=new Map<string,number>(),shardBytes=[0,0];let offeredBytes=0,activeWrites=0,peakWrites=0,primaryRows=0,physicalRows=0,nextPrimaryMilestone=250000;
  let peakRss=process.memoryUsage().rss,minAvailableMemory=Infinity,minTmpFree=Infinity,minWorkspaceFree=Infinity,minCgroupMargin=Infinity,peakCgroupCurrent=0,cgroupLimit=Infinity,monitorFailure:unknown;
  const memoryReserve=768*1024*1024;
  async function monitor(){
    peakRss=Math.max(peakRss,process.memoryUsage().rss);
    const memory=await readFile("/proc/meminfo","utf8"),available=Number(/^MemAvailable:\s+(\d+)/m.exec(memory)?.[1])*1024;
    assert.ok(Number.isFinite(available));minAvailableMemory=Math.min(minAvailableMemory,available);assert.ok(available>=memoryReserve,"Proof host has less than 0.75 GiB available memory.");
    const [limitText,currentText]=await Promise.all([readFile("/sys/fs/cgroup/memory.max","utf8"),readFile("/sys/fs/cgroup/memory.current","utf8")]);
    const current=Number(currentText.trim());assert.ok(Number.isFinite(current));peakCgroupCurrent=Math.max(peakCgroupCurrent,current);
    if(limitText.trim()!=="max"){cgroupLimit=Number(limitText.trim());assert.ok(Number.isFinite(cgroupLimit));const margin=cgroupLimit-current;minCgroupMargin=Math.min(minCgroupMargin,margin);assert.ok(margin>=memoryReserve,"Proof cgroup has less than 0.75 GiB raw memory margin.");}
    const [tmp,workspace]=await Promise.all(vaultRoots.map(root=>statfs(root))),tmpFree=Number(tmp.bavail)*Number(tmp.bsize),workspaceFree=Number(workspace.bavail)*Number(workspace.bsize);
    minTmpFree=Math.min(minTmpFree,tmpFree);minWorkspaceFree=Math.min(minWorkspaceFree,workspaceFree);
    assert.ok(tmpFree>=memoryReserve&&workspaceFree>=memoryReserve,"Proof raw storage has less than 0.75 GiB free.");
  }
  const vault={...encodedVault,put:async(key:string,bytes:Uint8Array,meta:ObjectMeta)=>{
    offeredBytes+=bytes.length;if(!uniqueBodies.has(key)){uniqueBodies.set(key,bytes.length);shardBytes[parseInt(key.split("/").at(-1)![0],16)<10?0:1]+=bytes.length;}
    await encodedVault.put(key,bytes,meta);
  }};
  await assert.rejects(stat(metadata.snapshot.source),{code:"ENOENT"});assert.equal((await stat(metadata.snapshot.target)).size,metadata.snapshot.bytes);
  const database=new DatabaseSync(metadata.snapshot.target,{readOnly:true});database.exec("PRAGMA query_only=ON; PRAGMA cache_size=-32768");let readerClosed=false;
  const partitions=createOpenDataSpoolReader({database,sinks:new Map(metadata.sinks.map(sink=>[JSON.stringify([sink.state,sink.partition]),sink])),schemas:metadata.schemas,metadataById:metadata.metadataById,dispose:async()=>{database.close();readerClosed=true;}});
  await monitor();const started=performance.now(),cpu=process.cpuUsage(),progressStarted=Date.now();
  const sampling=setInterval(()=>{void monitor().catch(error=>{monitorFailure??=error;});},1000);
  const progress=setInterval(()=>console.log(JSON.stringify({stage:"four-writer-materialization",readerPartitions:references.length,primaryRows,physicalRows,elapsedMs:Date.now()-progressStarted,activeWrites,peakWrites,rss:process.memoryUsage().rss,uniqueRawBytes:shardBytes})),30000);
  try {
    await materializeEchoPartitions({partitions:partitions({consume:true,maxRows:1000,maxBytes:4*1024*1024}),readStateJoins:async state=>{
      if(monitorFailure)throw monitorFailure;
      console.log(JSON.stringify({stage:"state-materialization-start",state,elapsedMs:performance.now()-started}));
      const projection=JSON.parse(await readFile(join(registrationRoot,`${state}.json`),"utf8")) as Awaited<ReturnType<typeof readRegistrationProjection>>;
      assert.equal(projection.kind,"PROMOTED");if(projection.kind!=="PROMOTED")throw Error(`Missing held ${state} registration.`);
      assert.equal(projection.metadata.versionId,baseline.find(value=>value.state===state)!.result.registration.version);
      return governmentJoinRows(projection.value.governments??[]);
    },addReports:rows=>{
      primaryRows+=rows.length;
      if(primaryRows>=nextPrimaryMilestone){console.log(JSON.stringify({stage:"primary-row-milestone",primaryRows,elapsedMs:performance.now()-started}));while(primaryRows>=nextPrimaryMilestone)nextPrimaryMilestone+=250000;}
      for(const row of openDataReports(rows)){const prior=reports.get(row.state);reports.set(row.state,{...row,loaded:row.loaded+(prior?.loaded??0),joined:row.joined+(prior?.joined??0),unjoined:row.unjoined+(prior?.unjoined??0)});}
    },writePartition:async partition=>{
      if(monitorFailure)throw monitorFailure;activeWrites++;peakWrites=Math.max(peakWrites,activeWrites);
      try{const previous=expected.get(partition.partition);assert.ok(previous);assert.equal(partition.rows.length,previous.count);
        const reference=await saveOpenDataPartition({source:"epa-echo",...partition,now:metadata.metadataById[0].retrievedAt},vault);
        references.push(reference);physicalRows+=reference.count;
        const state=partition.rows[0]?.state??"UNRESOLVED",remaining=remainingByState.get(state)!-1;assert.ok(remaining>=0);remainingByState.set(state,remaining);
        if(remaining===0)console.log(JSON.stringify({stage:"state-materialization-complete",state,primaryRows:baselineReport.get(state)!.loaded,elapsedMs:performance.now()-started}));
      }finally{activeWrites--;}
    }});
    if(monitorFailure)throw monitorFailure;
  }finally{clearInterval(sampling);clearInterval(progress);if(!readerClosed)database.close();}
  const materializationMs=performance.now()-started,materializationCpuMs=Object.values(process.cpuUsage(cpu)).reduce((a,b)=>a+b,0)/1000;
  await monitor();assert.equal(references.length,expected.size);assert.equal(primaryRows,metadata.facts);assert.equal(physicalRows,metadata.members);assert.equal(peakWrites,4);
  for(const [state,report]of reports)assert.deepEqual(report,baselineReport.get(state));
  const gaps=baseline.flatMap(state=>state.result.rejectedExamples.map(value=>{const gap=echoMinimumGap(value.sourceRow);assert.ok(gap);return gap.fact;}));assert.equal(gaps.length,17);
  const manifestFile=resolve(args.get("--manifest")??join(cache,"four-writer-compact-manifest.json"));
  const manifest={sourceId:"epa-echo",sourceSha256:metadata.snapshot.sourceSha256,sourceRows:metadata.snapshot.sourceRows,references:references.sort((a,b)=>a.id.localeCompare(b.id)),reports:[...reports.values()],capture:baseline[0].capture,excludedFacts:gaps,states:baseline.map(state=>state.result),vaultRoots,vaultEncoding};
  await writeFile(manifestFile,JSON.stringify(manifest));
  const maxRssBytes=Math.max(peakRss,process.resourceUsage().maxRSS*1024),reservationMiB=Math.ceil(maxRssBytes*1.05/1024/1024);
  const implementation=Object.fromEntries(await Promise.all(["lib/sources/open-data/spool.ts","lib/sources/open-data/spool-reader.ts","lib/sources/open-data/echo-materialization.ts","lib/sources/open-data/normalize.ts","lib/sources/open-data/artifacts.ts","scripts/replay-epa-materialization.mts","scripts/lib/epa-held-spool.mts"].map(async file=>[file,createHash("sha256").update(await readFile(file)).digest("hex")])));
  const result:{[key:string]:unknown}={status:"MATERIALIZED_PENDING_EXHAUSTIVE_COMPARISON",productionWrites:0,sourceRows:metadata.snapshot.sourceRows,validPrimaryRows:primaryRows,excludedRows:gaps.length,physicalReaderRows:physicalRows,readerPartitions:references.length,logicalPartitions:metadata.sinks.length,manifestFile,vaultRoots,vaultEncoding,implementation,
    feedsFrom:"Official EPA archive -> streamCsvObjects -> normalizeEcho -> OpenDataSpool source facts and location references",
    feeds:"publishOpenData canonical national manifest -> normal GET /api/open-data -> grounded Ask and OpenDataFacts cards",
    materialization:{elapsedMs:materializationMs,cpuMs:materializationCpuMs,peakPendingWrites:peakWrites,peakRssBytes:maxRssBytes,includedSynchronousGzipElapsedMs:codecTiming.compressionMs,resourceSamplingIntervalMs:1000,minHostAvailableBytes:minAvailableMemory,cgroupLimitBytes:Number.isFinite(cgroupLimit)?cgroupLimit:null,peakCgroupCurrentBytes:peakCgroupCurrent,minCgroupRawMarginBytes:Number.isFinite(minCgroupMargin)?minCgroupMargin:null,minTmpFreeBytes:minTmpFree,minWorkspaceFreeBytes:minWorkspaceFree,rawOfferedBytes:offeredBytes,uniqueLogicalBodies:uniqueBodies.size,uniqueLogicalBytes:shardBytes.reduce((a,b)=>a+b,0),shardLogicalBytes:shardBytes},
    memoryCapacity:{scope:"Four-writer materializer-phase memory-only estimates, not whole-job peaks or observed production concurrency. Existing source reservations, worker slots and Admin settings are unchanged.",serverMiB:8192,reserveMiB:768,measuredPhasePeakPlus5PercentMiB:reservationMiB,phaseOnlyWorkersWithoutResearchParent:Math.floor((8192-768)/reservationMiB),researchParentMiB:2928,phaseOnlyWorkersWithResearchParent:Math.floor((8192-768-2928)/reservationMiB),noHistoryFallbackMiB:342,noHistoryFallbackOnlyWorkersWithoutResearchParent:Math.floor((8192-768)/342),noHistoryFallbackOnlyWorkersWithResearchParent:Math.floor((8192-768-2928)/342),phaseOnlyEstimateExceedsNoHistoryFallback:reservationMiB>342,fallbackScope:"The routine entry has no table override and uses WORKER_ENTRY_PEAK_MIB.lease. The largest of the host last five job-family peaks plus 5% can replace this default. Production host history and actual admission are unmeasured; counts are conditional arithmetic only."},
    runtimeScope:"Continuous same production shared iterator, normalizer, full-source binding, compact writer, and four pending EvidenceStore writes. The proof-only level1 gzip codec retains exact logical bytes and metadata. Every gzip call and encoded file write stays in the measured total; no exact artifact readback, pause, or timing deduction occurs. Production Netlify latency and fresh source network latency are unmeasured."};
  const output=resolve(args.get("--output")??"docs/measurements/src-01/epa-four-writer-performance.json");await writeFile(output,JSON.stringify(result,null,2));
  console.log(JSON.stringify({stage:"four-writer-materialization-complete",manifestFile,...result.materialization as object}));
}else if(args.has("--compare")){
  const manifestFile=resolve(args.get("--manifest")??join(cache,"four-writer-compact-manifest.json"));
  const manifest=JSON.parse(await readFile(manifestFile,"utf8")) as {references:OpenDataPartitionRef[];vaultRoots:[string,string];vaultEncoding:"raw"|"gzip-level1"};
  const references=manifest.references,acceptedVault=createEpaReplayVault(manifest.vaultRoots,manifest.vaultEncoding);
  const output=resolve(args.get("--output")??"docs/measurements/src-01/epa-four-writer-performance.json"),result=JSON.parse(await readFile(output,"utf8")) as {[key:string]:unknown};
  const verificationStarted=performance.now(),oldVault=new DurableEvidenceStore(vaultRoot,{remote:null}),current=new Map(references.map(reference=>[reference.id,reference])),comparison=createHash("sha256"),primaryIds=new Set<string>();let compared=0;
  let comparisonPeakRss=process.memoryUsage().rss,comparisonMinMargin=Infinity;
  async function sampleComparisonMemory(){comparisonPeakRss=Math.max(comparisonPeakRss,process.memoryUsage().rss);const [limit,current]=await Promise.all([readFile("/sys/fs/cgroup/memory.max","utf8"),readFile("/sys/fs/cgroup/memory.current","utf8")]);if(limit.trim()!=="max"){const margin=Number(limit)-Number(current);assert.ok(Number.isFinite(margin)&&margin>=768*1024*1024,"National identity comparison must retain the 0.75 GiB memory reserve.");comparisonMinMargin=Math.min(comparisonMinMargin,margin);}}
  await sampleComparisonMemory();
  for(const state of baseline)for(const oldReference of state.references){
    const old=await oldVault.get(oldReference.key);assert.ok(old);const oldMeta=JSON.parse(old.meta.custom!.originalMetadata!) as ObjectMeta;
    const bytes=gunzipSync(old.bytes,{maxOutputLength:oldMeta.byteLength});assert.equal(createHash("sha256").update(bytes).digest("hex"),oldReference.sha256);
    const previous=JSON.parse(new TextDecoder().decode(bytes)) as OpenDataProjection;
    const projected={...previous,records:previous.records.map(echoReaderArtifactRecord)},expectedBytes=new TextEncoder().encode(JSON.stringify(projected));
    if(!oldReference.id.startsWith("cell:"))for(const row of projected.records){assert.ok(!primaryIds.has(row.id),`Duplicate national primary source identity ${row.id}.`);primaryIds.add(row.id);}
    const reference=current.get(oldReference.id);assert.ok(reference);assert.equal(reference.count,oldReference.count);assert.equal(reference.sha256,createHash("sha256").update(expectedBytes).digest("hex"));
    const actual=await acceptedVault.get(reference.key);assert.ok(actual);assert.equal(Buffer.compare(actual.bytes,expectedBytes),0);
    comparison.update(JSON.stringify([reference.id,reference.sha256,reference.count])).update("\n");compared++;
    if(compared%5000===0){await sampleComparisonMemory();console.log(JSON.stringify({stage:"exhaustive-baseline-comparison",compared,uniquePrimaryNativeIds:primaryIds.size,elapsedMs:performance.now()-verificationStarted}));}
  }
  await sampleComparisonMemory();
  assert.equal(primaryIds.size,(result.validPrimaryRows as number));
  result.comparison={partitions:compared,uniquePrimaryNativeIds:primaryIds.size,peakRssBytes:comparisonPeakRss,minCgroupRawMarginBytes:Number.isFinite(comparisonMinMargin)?comparisonMinMargin:null,memorySamplingEveryPartitions:5000,elapsedMs:performance.now()-verificationStarted,sha256:comparison.digest("hex"),proofScriptSha256:createHash("sha256").update(await readFile("scripts/replay-epa-materialization.mts")).digest("hex"),allNativeValuesAndSelectedSourceCellsByteExact:true,allNewLogicalArtifactBytesRetained:true};
  await writeFile(output,JSON.stringify(result,null,2));
  await finalizeTiming();
}else if(args.has("--finalize-timing"))await finalizeTiming();
else throw Error("Choose --prepare-registrations, --prepare-metadata, --materialize, --compare, or --finalize-timing.");

/** Refresh timing receipts without repeating the exhaustive artifact comparison. */
async function finalizeTiming(){
  const output=resolve(args.get("--output")??"docs/measurements/src-01/epa-four-writer-performance.json"),result=JSON.parse(await readFile(output,"utf8")) as {[key:string]:unknown};
  assert.ok(result.comparison,"Artifact comparison must complete before timing is finalized.");
  const baselineProof=JSON.parse(await readFile("docs/measurements/src-01/epa-all-states.json","utf8")) as {archive:{elapsedMs:number};nationalIngest:{elapsedMs:number};materializationMs:number};
  const sourceArchiveDownloadMs=baselineProof.archive.elapsedMs;assert.ok(Number.isFinite(sourceArchiveDownloadMs)&&sourceArchiveDownloadMs>=0);
  const readerProofFile=resolve(args.get("--reader-proof")??"docs/measurements/src-01/epa-reader-all-states.json");let initialNationalPublishMs:number|null=null;
  try{const readerProof=JSON.parse(await readFile(readerProofFile,"utf8")) as {clocks?:{publishMs?:number}[]};initialNationalPublishMs=readerProof.clocks?.[0]?.publishMs??null;}
  catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
  const retentionProofFile=resolve(args.get("--retention-proof")??"docs/measurements/src-01/epa-retention-performance.json");let changedEditionRetentionMs:number|null=null;
  try{const retentionProof=JSON.parse(await readFile(retentionProofFile,"utf8")) as {status:string;elapsedMs:number;priorPrimaryRows:number};assert.equal(retentionProof.status,"PASS");assert.equal(retentionProof.priorPrimaryRows,result.validPrimaryRows);assert.ok(Number.isFinite(retentionProof.elapsedMs)&&retentionProof.elapsedMs>=0);changedEditionRetentionMs=retentionProof.elapsedMs;}
  catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
  const registrationMs=baseline.reduce((n,state)=>n+(state.result.registrationReadMs??0),0),setupMs=Math.max(0,baselineProof.materializationMs-baseline.reduce((n,state)=>n+state.result.elapsedMs,0));
  const materializationMs=(result.materialization as {elapsedMs:number}).elapsedMs;
  const processingMs=initialNationalPublishMs===null||changedEditionRetentionMs===null?null:sourceArchiveDownloadMs+baselineProof.nationalIngest.elapsedMs+materializationMs+registrationMs+setupMs+initialNationalPublishMs+changedEditionRetentionMs;
  result.productionEquivalent={sourceArchiveDownloadMs,sourceIngestMs:baselineProof.nationalIngest.elapsedMs,continuousMaterializationMs:materializationMs,heldBaselineRegistrationMs:registrationMs,heldBaselineIndexAndBookkeepingMs:setupMs,initialNationalPublishMs,readerProofFile,changedEditionRetentionMs,retentionProofFile,totalMs:processingMs,parentLimitMs:30*60_000,withinParentLimit:processingMs===null?null:processingMs<30*60_000,scope:"Conservative changed-edition processing: the actual archive HTTP download, measured held-byte source ingestion and unchanged indexing, complete continuous four-writer materialization, actual production registration reads, actual national publisher and actual retention over all primary records for the17 real gaps. No extrapolated rows or latency deductions; all proof-codec overhead remains included. Future source HTTP and production remote-vault latency are unmeasured."};
  result.timingReceiptScriptSha256=createHash("sha256").update(await readFile("scripts/replay-epa-materialization.mts")).digest("hex");
  result.status=processingMs===null?"PASS_PENDING_ACTUAL_PUBLISH_OR_RETENTION_TIMING":processingMs<30*60_000?"PASS":"FAIL_PARENT_DEADLINE";
  await writeFile(output,JSON.stringify(result,null,2));console.log(JSON.stringify({status:result.status,output,productionEquivalent:result.productionEquivalent}));
}
