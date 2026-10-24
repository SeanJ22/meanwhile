/** Reuse every held EPA artifact through the normal SQL/SDK/API reader; no source or production writes. */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile,readdir,mkdir,writeFile} from "node:fs/promises";
import {resolve,join} from "node:path";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {DurableEvidenceStore} from "../lib/control-plane/evidence/durable-store.ts";
import type {EvidenceStore} from "../lib/control-plane/evidence/store.ts";
import {US_JURISDICTIONS} from "../lib/coverage/states.ts";
import {requiredRoutineContract} from "../lib/civic-data/contracts.ts";
import {routineTaskDue,routineTaskFromContract} from "../lib/civic-data/runner.ts";
import {verifyRoutineReaderProjection} from "../lib/civic-data/reader-verification.ts";
import {installReaderDatabaseQuery} from "../lib/reader/database.ts";
import {echoMinimumGap,retainEchoMinimumGaps} from "../lib/sources/open-data/echo-gaps.ts";
import {readOpenDataPartition,saveOpenDataPartition} from "../lib/sources/open-data/artifacts.ts";
import {publishOpenData,readOpenDataProjection,type OpenDataCapture} from "../lib/sources/open-data/publication.ts";
import {openDataReaderRecord,type OpenDataPartitionRef,type OpenDataReport} from "../lib/sources/open-data/model.ts";
import {echoReaderArtifactRecord,normalizeEcho} from "../lib/sources/open-data/normalize.ts";
import {nearbyFacilityCells} from "../lib/sources/open-data/geography.ts";
import {readZipLocation} from "../lib/place-map/locations.ts";
import {openDataEvidence} from "../lib/ask/open-data.ts";
import {OpenDataFacts,openDataSources} from "../components/map/open-data.tsx";
import {FederalMoneyBenchmarkStore} from "./lib/federal-money-benchmark-store.mts";
import {installOpenDataReaderSql,installOpenDataReplayMap,installOpenDataReplayVault,normalOpenDataPage} from "./lib/open-data-replay-reader.mts";
import {createEpaReplayVault} from "./lib/epa-held-spool.mts";
import {compressedReplayVault} from "./lib/open-data-replay-vault.mts";
import {stateForZip} from "../lib/reader/national.ts";

const args=new Map(process.argv.slice(2).map(arg=>{const at=arg.indexOf("=");return[arg.slice(0,at),arg.slice(at+1)];}));
const cache=resolve(args.get("--cache")??".scratch/src01-epa"),vaultRoot=resolve(args.get("--vault")!),nativeConnectionFile=args.get("--native-postgres-file");
const output=resolve(args.get("--output")??"docs/measurements/src-01/epa-reader-scale.json"),all=args.get("--states")==="all",wanted=new Set((args.get("--states")??"CT,CA").split(","));
interface State {state:string;vaultRoot:string;references:OpenDataPartitionRef[];capture:OpenDataCapture;result:{report:OpenDataReport;verifiedRows:number;sourceRows:number;rejectedExamples:{sourceRow:Record<string,unknown>}[]}}
const states:State[]=[];
for(const file of await readdir(cache))if(/^reader-state-.*\.json$/.test(file)){const state=JSON.parse(await readFile(join(cache,file),"utf8")) as State;if(resolve(state.vaultRoot)===vaultRoot)states.push(state);}
assert.equal(states.length,90,"Every captured source code must have completed materialization.");
const manifestFile=args.get("--manifest"),manifest=manifestFile?JSON.parse(await readFile(resolve(manifestFile),"utf8")) as {references:OpenDataPartitionRef[];reports:OpenDataReport[];capture:OpenDataCapture;excludedFacts:NonNullable<Parameters<typeof publishOpenData>[0]["excludedFacts"]>;vaultRoots:[string,string];vaultEncoding?:"raw"|"gzip-level1"}:null;
let references=manifest?.references??states.flatMap(state=>state.references);
const reports=manifest?.reports??states.map(state=>state.result.report),capture=manifest?.capture??states[0].capture;
const rejected=manifest?.excludedFacts??states.flatMap(state=>state.result.rejectedExamples.map(value=>echoMinimumGap(value.sourceRow)!.fact));
if(manifest){const byId=new Map(references.map(ref=>[ref.id,ref]));for(const state of states)state.references=state.references.map(ref=>{const accepted=byId.get(ref.id);assert.ok(accepted);assert.equal(accepted.count,ref.count);return accepted;});}
assert.equal(reports.reduce((n,r)=>n+r.loaded,0)+rejected.length,3229311);
const replayVaultTiming={compressionMs:0,decodeAndHashMs:0};
const storage=compressedReplayVault(vaultRoot,replayVaultTiming);
const rawVault=manifest?createEpaReplayVault(manifest.vaultRoots,manifest.vaultEncoding??"raw",replayVaultTiming):null;
const compactStorage=args.get("--compact-selected")==="true"?new DurableEvidenceStore(join(cache,"reader-scale-compact-vault"),{remote:null}):null;
const artifactTiming={elapsedMs:0,requests:0,bytes:0};
const vault:EvidenceStore={
  async put(){throw Error("Reader replay may not write artifact bytes.");},
  async get(key){const started=performance.now(),object=await(rawVault??compactStorage)?.get(key)??(rawVault?null:await storage.get(key));if(object){artifactTiming.elapsedMs+=performance.now()-started;artifactTiming.requests++;artifactTiming.bytes+=object.bytes.length;}return object;},
  async head(key){const compact=await(rawVault??compactStorage)?.head(key);return compact??(rawVault?null:await storage.head(key));},list:prefix=>(rawVault??storage).list(prefix),
};
if(args.get("--retention-only")==="true"){
  assert.ok(manifest,"Retention timing requires the complete accepted compact manifest.");
  const gaps=rejected.map(fact=>{const gap=echoMinimumGap((fact.record as {sourceRow:Record<string,unknown>}).sourceRow);assert.ok(gap);return gap;}),primary=references.filter(reference=>!reference.id.startsWith("cell:"));
  assert.equal(gaps.length,17);assert.equal(primary.length,47274);
  const started=performance.now(),cpu=process.cpuUsage();let peakRss=process.memoryUsage().rss;
  const sample=setInterval(()=>{peakRss=Math.max(peakRss,process.memoryUsage().rss);},100);
  try{
    const retained=await retainEchoMinimumGaps(gaps,references,[capture],vault),elapsedMs=performance.now()-started;
    assert.equal(retained.size,0,"These actual17 missing-name rows have never had a verified record in this captured edition.");
    const proof={status:"PASS",productionWrites:0,sourceRequests:0,scope:"Actual retention function over the complete accepted manifest and17 real minimum gaps; no changed future archive is invented.",manifestSha256:createHash("sha256").update(JSON.stringify(manifest)).digest("hex"),priorPrimaryReferences:primary.length,priorPrimaryRows:primary.reduce((n,ref)=>n+ref.count,0),gaps:gaps.map(gap=>({id:gap.id,state:gap.state,reason:gap.fact.detail})),retainedRows:0,elapsedMs,cpuMs:Object.values(process.cpuUsage(cpu)).reduce((a,b)=>a+b,0)/1000,peakRss:Math.max(peakRss,process.memoryUsage().rss),artifactEncoding:manifest.vaultEncoding,artifactRequests:artifactTiming.requests,artifactBytes:artifactTiming.bytes,artifactLocalGetMs:artifactTiming.elapsedMs,artifactReplayDecodeHashMs:replayVaultTiming.decodeAndHashMs};
    await writeFile(output,JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));
  }finally{clearInterval(sample);}
  process.exit(0);
}
installOpenDataReplayMap();
const samples: {state:string;zip:string;id:string}[]=[];
for(const state of states.filter(state=>all?US_JURISDICTIONS.some(row=>row.usps===state.state):wanted.has(state.state))){
  let sample:{state:string;zip:string;id:string}|undefined;
  for(const reference of state.references.filter(ref=>ref.id.startsWith("zip:"))){
    const zip=/^zip:(\d{5}):/.exec(reference.id)?.[1];if(all&&zip&&await stateForZip(zip)!==state.state)continue;
    const read=await readOpenDataPartition("epa-echo",reference,vault);
    for(const row of read.records)if(row.zip&&await readZipLocation(row.zip)){sample={state:state.state,zip:row.zip,id:row.id};break;}
    if(sample)break;
  }
  assert.ok(sample,`No actual readable source ZIP for ${state.state}`);samples.push(sample);
}
const compactProof={logicalReferences:0,uniqueBodies:0,rows:0,beforeBytes:0,afterBytes:0,allPublicRowsEqual:true,allInterpretedCellsRoundTrip:true};
if(compactStorage){
  const logical=new Set((await Promise.all(samples.map(async sample=>[`zip:${sample.zip}`,...nearbyFacilityCells((await readZipLocation(sample.zip))!)]))).flat()),replaced=new Map<string,OpenDataPartitionRef>();
  for(const reference of references.filter(reference=>[...logical].some(key=>reference.id===key||reference.id.startsWith(`${key}:state:`)))){
    compactProof.logicalReferences++;if(replaced.has(reference.key))continue;
    const read=await readOpenDataPartition("epa-echo",reference,vault);
    for(const row of read.records){const compact=echoReaderArtifactRecord(row);assert.deepEqual(openDataReaderRecord(compact),openDataReaderRecord(row));assert.deepEqual(normalizeEcho(compact.sourceRow,row.capturedAt,row.publishedAt),{...normalizeEcho(row.sourceRow,row.capturedAt,row.publishedAt),sourceRow:compact.sourceRow});}
    const next=await saveOpenDataPartition({source:"epa-echo",partition:reference.id,rows:read.records,captures:[{...capture,sourceRows:read.records.map(row=>row.sourceRow)}],now:capture.retrievedAt},compactStorage);
    assert.equal(next.count,reference.count);replaced.set(reference.key,next);compactProof.uniqueBodies++;compactProof.rows+=read.records.length;compactProof.beforeBytes+=(await vault.head(reference.key))!.byteLength;compactProof.afterBytes+=(await compactStorage.head(next.key))!.byteLength;
  }
  references=references.map(reference=>replaced.has(reference.key)?{...replaced.get(reference.key)!,id:reference.id}:reference);
  console.log(JSON.stringify({stage:"compact-selected",...compactProof}));
}
const task=routineTaskFromContract(requiredRoutineContract("epa-echo")),databaseRoot=resolve(args.get("--database")??join(cache,"reader-native-full"));
assert.ok(nativeConnectionFile,"Use an existing isolated native local PostgreSQL cluster.");
await mkdir(databaseRoot,{recursive:true});
const store=await FederalMoneyBenchmarkStore.open(databaseRoot,"epa-echo","epa-echo",{nativeConnectionFile});
await store.query([{text:"SET jit=off",params:[]}]);
await installOpenDataReaderSql(store.query);
const sqlTiming:{elapsedMs:number;statements:number;bytes:number}[]=[];
installReaderDatabaseQuery(async statements=>{const started=performance.now(),rows=await store.query(statements);sqlTiming.push({elapsedMs:performance.now()-started,statements:statements.length,bytes:Buffer.byteLength(JSON.stringify(rows))});return rows;});
const transport=installOpenDataReplayVault(vault),OriginalDate=globalThis.Date,realNow=Date.now;let controlledAt:number|undefined;
globalThis.Date=new Proxy(OriginalDate,{construct(target,values){return Reflect.construct(target,values.length?values:[controlledAt??realNow()]);},get(target,name,receiver){return name==="now"?()=>controlledAt??realNow():Reflect.get(target,name,receiver);}});
const proof={status:"RUNNING",scope:"Complete real EPA national manifest; selected normal reader locations",productionWrites:0,sourceRows:3229311,publishedRows:3229294,rejectedRows:rejected.length,references:references.length,vaultRoot,artifactRoots:manifest?.vaultRoots??null,artifactEncoding:manifest?.vaultEncoding??"raw",manifestSha256:manifest?createHash("sha256").update(JSON.stringify(manifest)).digest("hex"):null,states:states.map(state=>({state:state.state,sourceRows:state.result.sourceRows,publishedRows:state.result.verifiedRows,rejectedRows:state.result.rejectedExamples.length})),compactProof,deadlines:{sqlMs:1800,pageMs:3000},jit:"off, matching production reader startup options",clocks:[] as unknown[],readers:[] as {state:string;label:string;apiElapsedMs:number;pageTimings:{elapsedMs:number;sqlMs:number}[]}[],failures:[] as {state:string;label:string;detail:string}[],database:store.bytes};
try{
  const firstAt=realNow();
  for(const label of (args.get("--clocks")==="3"?["initial","tomorrow","nextWeekly"]:["initial"])){
    const before=await store.clock(task.sourceId,task.recordClass,task.scope,task.parserVersion),at=label==="initial"?firstAt:label==="tomorrow"?firstAt+86400000:Date.parse(before.lastSucceededObservedAt??before.lastSucceededAt!)+task.cadenceMs;
    controlledAt=at;await store.setReplayClock(at);const due=routineTaskDue(task,before,at);if(args.get("--read-only")!=="true")assert.equal(due,label!=="tomorrow");
    const publishStart=performance.now(),publication=due&&args.get("--read-only")!=="true"?await publishOpenData({store,source:"epa-echo",rows:[],reports,partitions:references,captures:[capture],excludedFacts:rejected,now:new OriginalDate(at).toISOString(),replace:true}):null,publishMs=performance.now()-publishStart;
    const projection=await readOpenDataProjection("epa-echo","national",{store,now:new OriginalDate(at).toISOString(),bypassCache:true});assert.equal(projection.kind,"PROMOTED");if(projection.kind!=="PROMOTED")throw Error("No promoted manifest.");
    assert.equal(projection.value.partitions?.length,references.length);assert.equal(projection.value.reports.length,reports.length);
    for(const report of reports)assert.deepEqual(projection.value.reports.find(value=>value.state===report.state),report);
    const typed=await verifyRoutineReaderProjection(requiredRoutineContract("epa-echo"),{store,now:new OriginalDate(at).toISOString(),expectedVersionId:projection.metadata.versionId!});assert.equal(typed.status,"PASS");
    let heldArtifactBytes=0;for(const reference of references){const head=await vault.head(reference.key);assert.ok(head);assert.equal(head.contentHash,`sha256-${reference.sha256}`);heldArtifactBytes+=head.byteLength;}
    proof.clocks.push({label,at:new OriginalDate(at).toISOString(),due,version:projection.metadata.versionId,confirmed:!!publication?.outcome.confirmed,publishMs,typedReader:typed.status,heldArtifacts:references.length,heldArtifactBytes});
    console.log(JSON.stringify({stage:"published-native-full-manifest",label,references:references.length}));
    for(const sample of samples){
      try{
      let queryAfter=sqlTiming.length,artifactBefore={...artifactTiming,decodeAndHashMs:replayVaultTiming.decodeAndHashMs},requestsAfter=transport.requested.length;
      const pageTimings:{offset:number;elapsedMs:number;sqlMs:number;sqlStatements:number;sqlBytes:number;artifactRequests:number;artifactBytes:number;artifactLocalGetMs:number;artifactReplayDecodeHashMs:number}[]=[];
      const page=await normalOpenDataPage(sample.zip,sample.id,value=>{const queries=sqlTiming.slice(queryAfter);pageTimings.push({...value,sqlMs:queries.reduce((n,row)=>n+row.elapsedMs,0),sqlStatements:queries.reduce((n,row)=>n+row.statements,0),sqlBytes:queries.reduce((n,row)=>n+row.bytes,0),artifactRequests:transport.requested.length-requestsAfter,artifactBytes:artifactTiming.bytes-artifactBefore.bytes,artifactLocalGetMs:artifactTiming.elapsedMs-artifactBefore.elapsedMs,artifactReplayDecodeHashMs:replayVaultTiming.decodeAndHashMs-artifactBefore.decodeAndHashMs});queryAfter=sqlTiming.length;artifactBefore={...artifactTiming,decodeAndHashMs:replayVaultTiming.decodeAndHashMs};requestsAfter=transport.requested.length;}),evidence=openDataEvidence(page.row),html=renderToStaticMarkup(React.createElement(OpenDataFacts,{records:[page.row],checkedAt:page.checkedAt}));
      assert.equal(evidence.id,sample.id);assert.ok(html.includes(`data-open-data-record="${sample.id}"`));assert.ok(openDataSources([page.row],page.checkedAt).some(value=>value.provenance.sourceUrl===page.row.sourceUrl));
      const result={...sample,label,apiElapsedMs:page.elapsedMs,apiPages:page.pages,pageTimings,apiRowsRead:page.recordsRead,recordId:page.row.id,sourceUrl:page.row.sourceUrl,sourceRetrievedAt:page.row.capturedAt,sourcePublishedAt:page.row.publishedAt,askKind:evidence.kind,renderedHtmlSha256:createHash("sha256").update(html).digest("hex")};proof.readers.push(result);console.log(JSON.stringify(result));
      await writeFile(output,JSON.stringify(proof,null,2));
      }catch(error){const failure={state:sample.state,label,detail:error instanceof Error?error.message:String(error)};proof.failures.push(failure);console.log(JSON.stringify({stage:"reader-failed",...failure}));await writeFile(output,JSON.stringify(proof,null,2));}
    }
  }
  proof.status=proof.failures.length?"READER_FAILED":proof.readers.every(row=>row.pageTimings.every(page=>page.elapsedMs<3000&&page.sqlMs<1800))?"PASS":"READER_DEADLINE_EXCEEDED";
  await writeFile(output,JSON.stringify(proof,null,2));
}finally{globalThis.Date=OriginalDate;transport.restore();installReaderDatabaseQuery(undefined);await store.close();await writeFile(output,JSON.stringify(proof,null,2));}
if(proof.status!=="PASS")process.exitCode=2;
