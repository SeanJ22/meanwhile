/** Read-only geographic replay: one current publisher dataset and one state's held people at a time. */
import { readFile,writeFile,mkdir,rm,rename,copyFile } from "node:fs/promises";
import {createReadStream} from "node:fs";
import {createGunzip} from "node:zlib";
import { spawn } from "node:child_process";
import { pathToFileURL,fileURLToPath } from "node:url";
import { dirname,resolve,join,basename } from "node:path";
import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { acquireDatasetList,acquireDataset } from "../lib/sources/legiscan/acquisition.ts";
import { LEGISCAN_BULK_PARSER,billScope,stateOfDataset,type BillSession,type BillPart,type BillPartPointer,type HeldPerson } from "../lib/sources/legiscan/bills.ts";
import { publishBulkCandidate,confirmBulkSession } from "../lib/sources/legiscan/publication.ts";
import { readBulkProjection,readBillsForState,billsForPerson } from "../lib/sources/legiscan/reader.ts";
import { legiscanBillEvidence } from "../lib/ask/legiscan-bills.ts";
import { FederalMoneyBenchmarkStore } from "./lib/federal-money-benchmark-store.mts";
import { routineTaskFromContract,routineTaskDue } from "../lib/civic-data/runner.ts";
import { requiredRoutineContract } from "../lib/civic-data/contracts.ts";
import { readerRoute } from "../lib/api/reader-route.ts";
import { installReaderDatabaseQuery } from "../lib/reader/database.ts";
import {localPostgresReader} from "./lib/local-postgres-reader.mts";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const args=process.argv.slice(2);
const arg=(name:string,fallback:string)=>args.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3)??fallback;
const connectionFile=arg("readonly-connection-file","/tmp/src-01-prod-readonly-url");
const outputDir=resolve(arg("output-dir","docs/measurements/src-01"));
const cacheDir=resolve(arg("cache-dir",".scratch/src01-legiscan"));
const nativeConnectionFile=arg("native-postgres-file","");
const stateArg=arg("state","");
const stateFile=(state:string)=>join(cacheDir,`${state}.json`);
const sha=(value:string)=>createHash("sha256").update(value).digest("hex");
async function implementationSnapshot(){
  const files=await Promise.all(["lib/sources/legiscan/acquisition.ts","lib/sources/legiscan/bills.ts","lib/sources/legiscan/publication.ts","lib/sources/legiscan/reader.ts",
    "lib/civic-data/payload-parts.ts","lib/civic-data/canonical-hash.ts","lib/reader/canonical.ts","lib/reader/database.ts","app/api/bills/route.ts",
    "lib/ask/legiscan-bills.ts","components/officials/legislator-bills.tsx","scripts/lib/local-postgres-reader.mts","scripts/replay-legiscan-all-states.mts"]
    .map(async path=>({path,sha256:sha(await readFile(join(root,path),"utf8"))})));
  return {sha256:sha(JSON.stringify(files)),files};
}
let readerClock:number|undefined;
const failure=(error:unknown)=>error instanceof Error?error.message:"Unknown replay failure";
async function atomicJson(path:string,value:unknown){const temporary=`${path}.${process.pid}.tmp`;await writeFile(temporary,JSON.stringify(value,null,2));await rename(temporary,path);}
async function cachedMembers(path:string){
  try{return JSON.parse(await readFile(path,"utf8"));}
  catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
  const stream=createReadStream(`${path}.gz`).pipe(createGunzip()).setEncoding("utf8");
  let json="";for await(const chunk of stream)json+=chunk;
  return JSON.parse(json);
}
type ReplayPerson=HeldPerson & {name:string;officeTitle:string;state:string};
type BillRead=Awaited<ReturnType<typeof readBillsForState>>;
interface CardProof {
  status:string;parserVersion?:string;reason?:string;elapsedMs?:number;personId?:string;personName?:string;officeTitle?:string;
  visibleBills?:number;totalPersonBills?:number;emptyAssociationGapVisible?:boolean;firstBill?:{id:string;number:string;title:string;sourceUrl:string|null};
  exactTitleAndLinkVisible?:boolean;apiReaderElapsedMs?:number;apiTransport?:string;measurementConditions?:string;implementationSha256?:string;browser?:string;runId?:string;screenshot?:string;
}
interface ReplaySummary {
  state:string;status:string;parserVersion?:string;startedAt?:string;finishedAt?:string;scope?:string;productionReadOnly?:boolean;
  catalog?:Record<string,unknown>;productionPeople?:Record<string,unknown>;dataset?:Record<string,unknown>;source?:Record<string,unknown>;
  emptyNewerDatasets?:{sessionId:number;sessionName:string;reason:string;publishedRows:number}[];
  initialPublication?:{indexVersion:string;sessionVersion:string;candidateState:string;publishedRows:number;parts:number;partVersions:BillPartPointer[];
    joinedRows:number;unjoinedRows:number;readModelHash:string|null;elapsedMs:number;resumedStoredPublicationReadMs?:number};
  connectedReader?:{reader:string;publishedRows:number;readerRows:number;distinctReaderIds:number;allPublishedIdsConsumed:boolean;completeHistoricalCoverage:boolean;
    selectedPerson:{id:string;name:string;officeTitle:string;state:string;rows:number}|null;askMatched:number;askShown:number;publishedIdHash:string;readerIdHash:string;
    readerElapsedMs:number;personFilterElapsedMs:number;askElapsedMs:number;apiReaderAndPersonElapsedMs:number;apiUnderThreeSeconds:boolean;timingScope:string};
  publisherReadback?:Record<string,unknown>;scheduling?:Record<string,unknown>;
  repeats?:{kind:string;now:string;confirmation:string;indexVersion:string;servingSessionVersion?:string;readerRows:number;distinctReaderIds:number;
    allPublishedIdsConsumed:boolean;readerIdHash:string;personRows:number;askMatched:number;checkedAt:string|null}[];
  storage?:{kind:string;productionWrites:number;metrics?:FederalMoneyBenchmarkStore["bytes"]};
  performance?:{workerElapsedMs:number;workerPeakRssBytes:number;databasePeakRssBytes:number|null;clock:string};
  originalPublicationPerformance?:ReplaySummary["performance"];
  normalRouteProof?:{status:string;route:string;clocks?:{kind:string;now:string;readerRows:number;distinctReaderIds:number;readerIdHash:string;personRows:number;askStateMatched:number;askPersonMatched:number;elapsedMs:number}[];reason?:string};
  failure?:{stage:string;reason:string};priorReplayFailure?:{stage:string;reason:string};personCardFailure?:string;cardProof?:CardProof;
  priorCardAttempts?:CardProof[];
}
interface ReplayReport {states:ReplaySummary[];coveredJurisdictions?:string[];status?:string;browserReplay?:{transport:string;browser:string;noProductionWrites:boolean;limitation:string};}
interface CardInput {holder:ReplayPerson|null;read:BillRead;firstBill:BillRead["bills"][number]|null;}
async function installLocalReader(store:FederalMoneyBenchmarkStore,directory:string){
  if(nativeConnectionFile){
    const reader=await localPostgresReader(directory,nativeConnectionFile,()=>readerClock??Date.now());
    installReaderDatabaseQuery(reader.query);
    return async()=>{installReaderDatabaseQuery(undefined);readerClock=undefined;await reader.close();if(arg("profile-reader","false")==="true")console.log(JSON.stringify({state:stateArg||arg("card-state",""),readerProfile:reader.metrics}));};
  }
  installReaderDatabaseQuery(async statements=>(await store.query([
    {text:"SET TRANSACTION READ ONLY",params:[]},{text:"SET LOCAL jit=off",params:[]},...statements,
  ])).slice(2));
  return async()=>{installReaderDatabaseQuery(undefined);readerClock=undefined;};
}
function normalBillsRead(state:string,now:string,person?:ReplayPerson){
  readerClock=Date.parse(now);
  const read=readerRoute("/api/bills",async(_request:Request)=>{
    const result=await readBillsForState(state,{now,...(person?{person}:{})});
    return person?{...result,bills:result.bills.sort((a,b)=>(b.statusDate??"").localeCompare(a.statusDate??""))}:result;
  });
  return read(new Request(`http://readonly-replay.local/api/bills?state=${state}${person?`&member=${encodeURIComponent(person.id)}`:""}`));
}
function normalAskRead(state:string,now:string,person?:ReplayPerson){
  readerClock=Date.parse(now);
  const read=readerRoute("/api/ask/grounded",async(_request:Request)=>legiscanBillEvidence({question:"Which bills are published here?",states:[state],
    subject:person?{kind:"PERSON",id:person.id,name:person.name}:null,person},{now}));
  return read(new Request("http://readonly-replay.local/api/ask/grounded",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({question:"Which bills are published here?",state,subject:person?.id})}));
}

async function heldPeople(state:string,connection:string) {
  const sql=neon(connection);
  const scope=state==="US"?"US-AL:current-congress-directory":`US-${state}:openstates-people:v1`;
  const rows=await sql.query(`SELECT current_user AS role, source_id AS "sourceId", scope, current_version_id AS "versionId",
    (SELECT jsonb_agg(jsonb_build_object('id',p->>'id','personId',p->>'personId','nativeIds',p->'nativeIds',
      'name',p->>'name','officeTitle',p->>'officeTitle','state',p->>'state','level',p->>'level',
      'websiteUrl',p->'websiteUrl','profileUrls',p->'profileUrls',
      'provenance',jsonb_build_object('sourceUrl',p->'provenance'->>'sourceUrl','sourceOrg',p->'provenance'->>'sourceOrg',
        'collectedAt',p->'provenance'->>'collectedAt','verifiedAt',p->'provenance'->>'verifiedAt')))
     FROM jsonb_array_elements(payload->'roster'->'officeholders') p) AS people
    FROM civic_data_promotions WHERE scope=$1`,[scope]);
  const row=rows[0];
  if(!row||row.role!=="readonly"||row.scope!==scope||typeof row.sourceId!=="string"||typeof row.versionId!=="string"||
    row.people!==null&&!Array.isArray(row.people))throw Error(`Production readonly roster unavailable: ${scope}`);
  return {role:row.role,sourceId:row.sourceId,scope:row.scope,versionId:row.versionId,people:(row.people??[]) as ReplayPerson[]};
}

async function replayState(state:string) {
  const connection=(await readFile(connectionFile,"utf8")).trim();
  if(decodeURIComponent(new URL(connection).username)!=="readonly")throw Error("Production connection must use readonly role");
  let stage="publisher catalog";
  const startedAt=new Date().toISOString();
  const workerStarted=performance.now();
  let store:FederalMoneyBenchmarkStore|undefined;
  let closeReader:(()=>Promise<void>)|undefined;
  const summary:ReplaySummary={state,status:"FAILED",parserVersion:LEGISCAN_BULK_PARSER,startedAt,scope:"one latest nonempty source dataset; historical sessions remain explicitly incomplete",productionReadOnly:true};
  const existingProof=await readFile(stateFile(state),"utf8").then(value=>JSON.parse(value) as ReplaySummary).catch(()=>null);
  summary.priorCardAttempts=[...(existingProof?.priorCardAttempts??[]),...(existingProof?.cardProof?[{...existingProof.cardProof,parserVersion:existingProof.parserVersion}]:[])];
  const priorProof=arg("resume-publication","false")==="true"?existingProof:null;
  try {
    const signal=AbortSignal.timeout(20*60_000);
    const list=await acquireDatasetList({signal});
    const datasets=list.datasets.filter(row=>stateOfDataset(row)===state).sort((a,b)=>b.session_id-a.session_id);
    summary.catalog={sourceUrl:list.capture.requestedUrl,rawHash:list.capture.rawHash,retrievedAt:list.capture.retrievedAt,nationalDatasets:list.datasets.length,stateDatasets:datasets.length};
    if(!datasets.length)throw Error("Publisher lists no datasets for the covered jurisdiction");
    stage="production people";
    const held=await heldPeople(state,connection);
    summary.productionPeople={role:held.role,sourceId:held.sourceId,scope:held.scope,versionId:held.versionId,rows:held.people.length};
    stage="publisher archive";
    const empty:NonNullable<ReplaySummary["emptyNewerDatasets"]>=[];
    let dataset=datasets[0],acquired:Awaited<ReturnType<typeof acquireDataset>>|undefined;
    for(const row of datasets){
      try {
        const saved=await readFile(join(cacheDir,`${state}-${row.session_id}-capture-meta.json`),"utf8").then(JSON.parse).catch(()=>null);
        if(saved&&saved.datasetHash===row.dataset_hash&&saved.datasetDate===row.dataset_date){
          const body=await readFile(join(cacheDir,`${state}-${row.session_id}-capture-body.json`),"utf8");
          if(sha(body)!==saved.capture.rawHash)throw Error("Cached source evidence hash differs");
          const envelope=JSON.parse(body);
          const members=await cachedMembers(join(cacheDir,`${state}-${row.session_id}-members.json`));
          if(!Array.isArray(members))throw Error("Cached bill member evidence is unavailable");
          if(JSON.stringify(members.map(sha))!==JSON.stringify(envelope.memberHashes))throw Error("Cached bill members differ from their source archive inventory");
          acquired={capture:{...saved.capture,body},bodies:members,archiveHash:envelope.archiveHash};
        }else{
          acquired=await acquireDataset(row,{signal});
          await writeFile(join(cacheDir,`${state}-${row.session_id}-capture-body.json`),acquired.capture.body);
          await writeFile(join(cacheDir,`${state}-${row.session_id}-members.json`),JSON.stringify(acquired.bodies));
          const {body:_body,...capture}=acquired.capture;
          await writeFile(join(cacheDir,`${state}-${row.session_id}-capture-meta.json`),JSON.stringify({datasetHash:row.dataset_hash,datasetDate:row.dataset_date,capture}));
        }
        dataset=row;break;
      }
      catch(error){if(failure(error)!=="LEGISCAN_ARCHIVE_BILLS_MISSING")throw error;empty.push({sessionId:row.session_id,sessionName:row.session_name,reason:failure(error),publishedRows:0});}
    }
    summary.emptyNewerDatasets=empty;
    if(!acquired)throw Error("Every publisher dataset archive is empty");
    const {access_key:_access,...publicDataset}=dataset;
    summary.dataset=publicDataset;
    summary.source={requestedUrl:acquired.capture.requestedUrl,finalUrl:acquired.capture.finalUrl,httpStatus:acquired.capture.httpStatus,retrievedAt:acquired.capture.retrievedAt,
      rawHash:acquired.capture.rawHash,archiveHash:acquired.archiveHash,sourceBillMembers:acquired.bodies.length};
    console.log(JSON.stringify({state,stage:"source acquired",sourceBillMembers:acquired.bodies.length,people:held.people.length}));
    const at=new Date(Math.max(Date.parse(acquired.capture.retrievedAt),Date.parse(list.capture.retrievedAt))).toISOString();
    const databaseDirectory=join(cacheDir,`${state}-database`);
    const resumePublication=priorProof?.parserVersion===LEGISCAN_BULK_PARSER&&(priorProof.initialPublication?.parts??0)>0;
    if(!resumePublication)await rm(databaseDirectory,{recursive:true,force:true});
    store=await FederalMoneyBenchmarkStore.open(databaseDirectory,"legiscan-bills","legiscan-bulk",{nativeConnectionFile:nativeConnectionFile||undefined});
    closeReader=await installLocalReader(store,databaseDirectory);
    summary.storage={kind:nativeConnectionFile?"actual PostgresRoutineDataStore over isolated native local PostgreSQL through Neon driver":"actual PostgresRoutineDataStore over isolated on-disk PGlite through Neon driver",productionWrites:0};
    stage="registered publication";
    const publicationStarted=performance.now();
    const marker=await publishBulkCandidate(store,{capture:list.capture,datasets:list.datasets},at);
    if(!marker.outcome.promoted)throw Error(`Dataset index rejected: ${JSON.stringify(marker.outcome.candidate.receipt?.checks.filter(row=>row.verdict!=="PASS"))}`);
    let published:Awaited<ReturnType<typeof publishBulkCandidate>>;
    if(resumePublication){
      const prior=await readBulkProjection(billScope(dataset.session_id),{store,now:at,bypassCache:true});
      const saved=prior.kind==="PROMOTED"?await store.readCandidate(prior.metadata.versionId!):null;
      if(prior.kind!=="PROMOTED"||prior.value.kind!=="SESSION"||prior.metadata.versionId!==priorProof!.initialPublication!.sessionVersion||
        prior.value.dataset.dataset_hash!==dataset.dataset_hash||prior.value.dataset.dataset_date!==dataset.dataset_date||!saved||saved.state!=="PROMOTED"||saved.receipt?.decision!=="GOOD")throw Error("Previously published replay no longer names the exact source edition");
      const evidence=JSON.parse((saved.candidate.normalizedPayload as {capture:{body:string}}).capture.body);
      if(evidence.parentCapture?.rawHash!==acquired.capture.rawHash)throw Error("Previously published replay source capture differs from actual cached source inventory");
      published={candidate:saved.candidate,outcome:{candidate:saved,promoted:prior.projection,readerReadback:null}};
      summary.priorReplayFailure=priorProof!.failure;
      summary.originalPublicationPerformance=priorProof!.originalPublicationPerformance??priorProof!.performance;
    }else published=await publishBulkCandidate(store,{capture:acquired.capture,dataset,bodies:acquired.bodies,people:state==="US"?[]:held.people,archiveHash:acquired.archiveHash},at);
    if(!published.outcome.promoted)throw Error(`Dataset rejected: ${JSON.stringify(published.outcome.candidate.receipt?.checks.filter(row=>row.verdict!=="PASS"))}`);
    const session=published.candidate.readModel as BillSession;
    summary.initialPublication={indexVersion:marker.candidate.id,sessionVersion:published.candidate.id,candidateState:published.outcome.candidate.state,
      publishedRows:session.counts.rows,parts:session.parts.length,partVersions:session.parts,joinedRows:session.counts.joined,unjoinedRows:session.counts.unjoined,readModelHash:published.candidate.normalization.normalizedHash,
      elapsedMs:resumePublication?priorProof!.initialPublication!.elapsedMs:Math.round(performance.now()-publicationStarted),
      ...(resumePublication?{resumedStoredPublicationReadMs:Math.round(performance.now()-publicationStarted)}:{})};
    console.log(JSON.stringify({state,stage:"registered promotion",publishedRows:session.counts.rows,parts:session.parts.length}));
    stage="reader projection";
    const readerStarted=performance.now();
    const reader=await normalBillsRead(state,at);
    const readerElapsedMs=Math.round(performance.now()-readerStarted);
    const personStarted=performance.now();
    const matchedPerson=held.people.find(person=>billsForPerson(reader.bills,person).length>0);
    const samplePerson=matchedPerson??held.people[0];
    const personBills=samplePerson?billsForPerson(reader.bills,samplePerson):[];
    const personFilterElapsedMs=Math.round(performance.now()-personStarted);
    const askStarted=performance.now();
    const evidence=await normalAskRead(state,at);
    const askElapsedMs=Math.round(performance.now()-askStarted);
    const apiStarted=performance.now();
    const apiRead=await normalBillsRead(state,at,samplePerson);
    const apiPersonRows=samplePerson?apiRead.bills.length:0;
    const apiElapsedMs=Math.round(performance.now()-apiStarted);
    if(apiPersonRows!==personBills.length)throw Error("Normal /api/bills reader projection differs from the published person's records");
    const visibleIds=reader.bills.map(row=>row.id).sort();
    const publishedIds:string[]=[];
    for(const pointer of session.parts){const part=await store.readPromotion<BillPart>("STATE_BILL",pointer.scope);if(!part||part.versionId!==pointer.versionId)throw Error("Published source part missing");publishedIds.push(...part.payload.bills.map(row=>row.id));}
    publishedIds.sort();
    if(JSON.stringify(visibleIds)!==JSON.stringify(publishedIds)||new Set(visibleIds).size!==visibleIds.length)throw Error("Published bill IDs differ from reader IDs or were duplicated");
    summary.connectedReader={reader:"readBillsForState → /api/bills → LegislatorBills; legiscanBillEvidence → Ask",publishedRows:session.counts.rows,readerRows:reader.bills.length,
      distinctReaderIds:new Set(visibleIds).size,allPublishedIdsConsumed:true,completeHistoricalCoverage:reader.complete,
      selectedPerson:samplePerson?{id:samplePerson.id,name:samplePerson.name,officeTitle:samplePerson.officeTitle,state:samplePerson.state,rows:personBills.length}:null,
      askMatched:evidence.denominators.legiscanBillsMatched,askShown:evidence.denominators.legiscanBillsShown,
      publishedIdHash:sha(JSON.stringify(publishedIds)),readerIdHash:sha(JSON.stringify(visibleIds)),
      readerElapsedMs,personFilterElapsedMs,askElapsedMs,apiReaderAndPersonElapsedMs:apiElapsedMs,apiUnderThreeSeconds:apiElapsedMs<3000,
      timingScope:"Actual readerRoute selection → exact canonical shelf → readBillsForState with exact member selection over local Postgres; excludes HTTP transport, production network latency, roster lookup, and browser rendering"};
    await writeFile(join(cacheDir,`${state}-card.json`),JSON.stringify({holder:samplePerson??null,read:{...reader,bills:[...personBills].sort((a,b)=>(b.statusDate??"").localeCompare(a.statusDate??""))},firstBill:reader.bills[0]??null}));
    stage="actual publisher readback";
    const recheck=await acquireDatasetList({signal:AbortSignal.timeout(60_000)});
    const observed=recheck.datasets.find(row=>row.session_id===dataset.session_id);
    if(!observed||observed.dataset_hash!==dataset.dataset_hash||observed.dataset_date!==dataset.dataset_date)throw Error("Publisher changed dataset during replay; repeat from its new source edition");
    summary.publisherReadback={requestedUrl:recheck.capture.requestedUrl,rawHash:recheck.capture.rawHash,retrievedAt:recheck.capture.retrievedAt,
      sessionId:observed.session_id,datasetHash:observed.dataset_hash,datasetDate:observed.dataset_date,samePublishedDataset:true};
    stage="scheduled repeats";
    const task=routineTaskFromContract(requiredRoutineContract("legiscan-bulk"));
    const clock={lastAttemptedAt:at,lastSucceededObservedAt:at,lastSucceededAt:at,lastSucceededParserVersion:task.parserVersion};
    summary.scheduling={cadenceMs:task.cadenceMs,initialDue:routineTaskDue(task,undefined,Date.parse(at)),tomorrowDue:routineTaskDue(task,clock,Date.parse(at)+86400000),nextScheduledDue:routineTaskDue(task,clock,Date.parse(at)+task.cadenceMs)};
    summary.repeats=[];
    const OriginalDate=Date,originalNow=Date.now;
    let replayAt:number|undefined;
    globalThis.Date=new Proxy(OriginalDate,{
      construct(target,values){return Reflect.construct(target,values.length?values:[replayAt??originalNow()]);},
      get(target,name,receiver){return name==="now"?()=>replayAt??originalNow():Reflect.get(target,name,receiver);},
    });
    try {for(const offset of [86400000,task.cadenceMs]){
      const now=new Date(Date.parse(at)+offset).toISOString();replayAt=Date.parse(now);
      await store.setReplayClock(Date.parse(now));
      const retrieval={...recheck.capture,retrievedAt:now};
      const nextMarker=await publishBulkCandidate(store,{capture:retrieval,datasets:recheck.datasets},now);
      if(!nextMarker.outcome.promoted)throw Error(`Next catalog publication refused: ${JSON.stringify(nextMarker.outcome.candidate.receipt?.checks.filter(row=>row.verdict!=="PASS"))}`);
      const confirmed=await confirmBulkSession(store,session,published.candidate.id,retrieval,now);
      if(confirmed.kind!=="CONFIRMED")throw Error(`Next scheduled confirmation refused: ${confirmed.kind}`);
      const next=await normalBillsRead(state,now);
      const nextIds=next.bills.map(row=>row.id).sort();
      const ask=await normalAskRead(state,now);
      if(JSON.stringify(nextIds)!==JSON.stringify(publishedIds)||new Set(nextIds).size!==nextIds.length)throw Error("Next scheduled reader lost or duplicated published records");
      summary.repeats.push({kind:offset===86400000?"TOMORROW_CONTROLLED_REPLAY":"NEXT_WEEKLY_SCHEDULED_REPLAY",now,confirmation:confirmed.kind,indexVersion:nextMarker.candidate.id,
        servingSessionVersion:(await store.readPromotion("STATE_BILL",billScope(dataset.session_id)))?.versionId,readerRows:next.bills.length,distinctReaderIds:new Set(nextIds).size,
        allPublishedIdsConsumed:true,readerIdHash:sha(JSON.stringify(nextIds)),personRows:samplePerson?billsForPerson(next.bills,samplePerson).length:0,askMatched:ask.denominators.legiscanBillsMatched,
        checkedAt:next.checkedAt});
    }}finally{globalThis.Date=OriginalDate;await store.setReplayClock(originalNow());}
    summary.status=matchedPerson?"PUBLISHED_TO_PERSON_AND_ASK":"PUBLISHED_TO_STATE_AND_ASK_PERSON_JOIN_MISSING";
    if(!matchedPerson)summary.personCardFailure="No held production person shares an exact source identity or independently saved profile URL with any source sponsor. The real held-person card preserves an empty sponsored-bills gap; state bills and state Ask retain every source row.";
    summary.finishedAt=new Date().toISOString();
  } catch(error){summary.failure={stage,reason:failure(error)};summary.finishedAt=new Date().toISOString();if(failure(error)==="Invalid string length")console.error(error);}
  finally{
    await closeReader?.();
    if(store){await store.close();summary.storage!.metrics=store.bytes;}
    summary.performance={workerElapsedMs:Math.round(performance.now()-workerStarted),workerPeakRssBytes:process.resourceUsage().maxRSS*1024,
      databasePeakRssBytes:store?.bytes.databasePeakRssBytes??null,clock:"wall duration uses performance.now; synthetic observations are explicitly labeled"};
  }
  await writeFile(stateFile(state),JSON.stringify(summary,null,2));
  console.log(JSON.stringify({state,status:summary.status,publishedRows:summary.initialPublication?.publishedRows,readerRows:summary.connectedReader?.readerRows,person:summary.connectedReader?.selectedPerson?.name,failure:summary.failure}));
}

async function main(){
  await mkdir(cacheDir,{recursive:true});await mkdir(outputDir,{recursive:true});
  const temporaryDirectory=resolve(arg("temp-dir","/workspace/src01-scratch"));await mkdir(temporaryDirectory,{recursive:true});process.env.TMPDIR=temporaryDirectory;
  if(arg("cards","false")==="true"){await replayCards();return;}
  if(stateArg){await replayState(stateArg);return;}
  const catalogProofFile=arg("catalog-proof-file",join(outputDir,"legiscan-all-states.json"));
  const priorCatalog=arg("aggregate","false")==="true"?await readFile(catalogProofFile,"utf8").then(value=>JSON.parse(value) as {coveredJurisdictions?:string[];nationalDatasets?:number;recordedAt?:string}).catch(()=>null):null;
  const heldCatalog=priorCatalog?.coveredJurisdictions?.length===52&&new Set(priorCatalog.coveredJurisdictions).size===52&&priorCatalog.nationalDatasets===1000?priorCatalog:null;
  const catalog=heldCatalog?null:await acquireDatasetList({signal:AbortSignal.timeout(60000)});
  const jurisdictions=heldCatalog?[...heldCatalog.coveredJurisdictions!].sort():[...new Set(catalog!.datasets.map(stateOfDataset))].sort();
  const nationalDatasets=heldCatalog?.nationalDatasets??catalog!.datasets.length;
  if(arg("aggregate","false")==="true"){
    const summaries=await Promise.all(jurisdictions.map(async state=>await readFile(stateFile(state),"utf8").then(value=>JSON.parse(value) as ReplaySummary).catch(()=>({state,status:"PENDING"} as ReplaySummary))));
    const wasmPilot=await readFile(join(cacheDir,"failures/US-wasm-timeout.json"),"utf8").then(value=>JSON.parse(value) as ReplaySummary).catch(()=>null);
    for(const summary of summaries)if(summary.cardProof?.screenshot){
      const destination=join(outputDir,basename(summary.cardProof.screenshot));
      if(destination!==summary.cardProof.screenshot){await copyFile(summary.cardProof.screenshot,destination);summary.cardProof.screenshot=destination;}
    }
    const complete=summaries.every(row=>row.parserVersion===LEGISCAN_BULK_PARSER&&row.status.startsWith("PUBLISHED_")&&row.cardProof?.status==="PASS"&&row.normalRouteProof?.status==="PASS");
    const states=summaries.map(row=>{
      const published=row.parserVersion===LEGISCAN_BULK_PARSER&&row.initialPublication?.candidateState==="PROMOTED"&&row.connectedReader?.allPublishedIdsConsumed===true;
      const failures=[...(!published?[row.failure?.reason??"Registered source publication is pending"]:[]),
        ...(row.normalRouteProof?.status!=="PASS"?[row.normalRouteProof?.reason??"Normal reader and Ask proof is pending"]:[]),
        ...(row.cardProof?.status!=="PASS"?[row.cardProof?.reason??`Cold card ${row.cardProof?.elapsedMs??"unmeasured"}ms (${row.cardProof?.status??"PENDING"}); required below3000ms`]:[])];
      return {...row,sourcePublicationStatus:row.status,status:failures.length?published?"FAIL":"PENDING":"PASS",
        normalReaderStatus:row.normalRouteProof?.status??"PENDING",coldCardStatus:row.cardProof?.status??"PENDING",readinessFailures:failures};
    });
    await atomicJson(join(outputDir,"legiscan-all-states.json"),{source:"legiscan-bulk",status:complete?"COMPLETE":"IN_PROGRESS",parserVersion:LEGISCAN_BULK_PARSER,
      productionReadOnly:true,connectionRole:"readonly",recordedAt:new Date().toISOString(),nationalDatasets,
      catalogInventory:heldCatalog?{kind:"saved actual publisher catalog inventory; aggregation makes no source request",proofFile:catalogProofFile,recordedAt:heldCatalog.recordedAt}:{kind:"fresh publisher read",rawHash:catalog!.capture.rawHash,retrievedAt:catalog!.capture.retrievedAt},
      implementationSnapshot:await implementationSnapshot(),implementationScope:"Final source and reader code snapshot. Per-card implementation hashes are recorded when measured; earlier passing receipts predate hash instrumentation and retain their original transport and timing evidence.",
      scope:"Latest nonempty publisher dataset for all52covered jurisdictions; the full1000-session historical catalog is not replayed or claimed complete.",
      coveredJurisdictions:jurisdictions,completedJurisdictions:summaries.filter(row=>row.parserVersion===LEGISCAN_BULK_PARSER&&row.initialPublication?.parts).length,
      priorFailedPilots:wasmPilot?[{state:"US",engine:"PGlite WASM; earlier injected-store reader re-read saved source candidates",publishedRows:wasmPilot.initialPublication?.publishedRows,
        parts:wasmPilot.initialPublication?.parts,publicationElapsedMs:wasmPilot.initialPublication?.elapsedMs,performance:wasmPilot.performance,
        readerElapsedMs:wasmPilot.connectedReader?.readerElapsedMs,apiReaderAndPersonElapsedMs:wasmPilot.connectedReader?.apiReaderAndPersonElapsedMs,
        failure:wasmPilot.failure,explanation:"The old harness reused its acquisition-only twenty-minute abort signal after a longer local WASM publication; this is a failed replay, not a passed production deadline."}]:[],
      upstream:"Standing routine scheduler → publisher dataset catalog/archives + exact held production people",
      downstream:"Registered index/PART/SESSION publisher → normal readerRoute canonical GOOD/hash SQL → /api/bills, LegislatorBills/PersonCard, state/person Ask",
      browserReplay:{transport:"Local HTTP executes actual normal readerRoute and PostgreSQL canonical reader SQL; unstyled actual card components",browser:"/usr/bin/chromium substituted for missing pinned1234",
        noProductionWrites:true,limitation:"Production network latency and seatHolderById lookup are excluded. Exact production-held identity is supplied from readonly captured roster. This is not a deployed production page."},states});
    return;
  }
  const selected=arg("only","").split(",").filter(Boolean);
  const states=selected.length?jurisdictions.filter(state=>selected.includes(state)):jurisdictions;
  const summaries:ReplaySummary[]=[];
  for(const state of states){
    const existing=await readFile(stateFile(state),"utf8").then(value=>JSON.parse(value) as ReplaySummary).catch(()=>null);
    const reusable=existing?.parserVersion===LEGISCAN_BULK_PARSER&&existing?.storage?.kind?.includes("PostgresRoutineDataStore")&&(existing.initialPublication?.parts??0)>0&&existing.status?.startsWith("PUBLISHED_")&&existing.repeats?.length===2;
    if(arg("resume","false")!=="true"||!reusable){
      await new Promise<void>((resolveChild,reject)=>{
        const child=spawn(process.execPath,["--max-old-space-size=4096","--experimental-strip-types","--import",join(root,"scripts/register-test-loader.mjs"),fileURLToPath(import.meta.url),
          `--state=${state}`,`--readonly-connection-file=${connectionFile}`,`--cache-dir=${cacheDir}`,`--output-dir=${outputDir}`,`--temp-dir=${temporaryDirectory}`,`--resume-publication=${arg("resume","false")}`,
          ...(nativeConnectionFile?[`--native-postgres-file=${nativeConnectionFile}`]:[])],{cwd:root,env:process.env,stdio:"inherit"});
        child.on("error",reject);child.on("close",(code,signal)=>code===0?resolveChild():reject(Error(`${state} replay child exited ${code}${signal?` (${signal})`:""}`)));
      }).catch(async error=>{await writeFile(stateFile(state),JSON.stringify({state,status:"FAILED",failure:{stage:"state worker",reason:failure(error)}},null,2));});
    }
    summaries.push(JSON.parse(await readFile(stateFile(state),"utf8")));
    const complete=summaries.length===jurisdictions.length&&summaries.every(row=>row.cardProof?.status==="PASS"&&row.normalRouteProof?.status==="PASS");
    const output={source:"legiscan-bulk",status:complete?"COMPLETE":"IN_PROGRESS",phase:complete?"COMPLETE":summaries.length===jurisdictions.length&&summaries.every(row=>row.status.startsWith("PUBLISHED_"))?"SOURCE_PUBLICATION_COMPLETE_NORMAL_ROUTE_AND_BROWSER_PROOF_PENDING":"SOURCE_PUBLICATION",parserVersion:LEGISCAN_BULK_PARSER,productionReadOnly:true,recordedAt:new Date().toISOString(),scope:"Latest nonempty publisher dataset for every covered jurisdiction; full 1000-session history is not replayed.",
      coveredJurisdictions:jurisdictions,completedJurisdictions:summaries.length,nationalDatasets,
      connectionRole:"readonly",upstream:"Standing routine scheduler → publisher dataset list/archive + held production people",downstream:"Registered index/session promotion → readBillsForState → /api/bills/LegislatorBills and Ask",states:summaries};
    await atomicJson(join(outputDir,"legiscan-all-states.json"),output);
    if(summaries.at(-1)?.status.startsWith("PUBLISHED_")&&arg("verify-reader","true")==="true"){
      await runCardWorker(state).catch(async error=>{
        const failed=summaries.at(-1)!;failed.cardProof={status:"FAIL",reason:failure(error)};
        await writeFile(stateFile(state),JSON.stringify(failed,null,2));
        await atomicJson(join(outputDir,"legiscan-all-states.json"),output);
      });
      summaries[summaries.length-1]=JSON.parse(await readFile(stateFile(state),"utf8")) as ReplaySummary;
    }
  }
}

async function runCardWorker(state:string){
  const prior=JSON.parse(await readFile(stateFile(state),"utf8")) as ReplaySummary;
  if(prior.parserVersion===LEGISCAN_BULK_PARSER&&prior.cardProof?.status==="PASS"&&prior.normalRouteProof?.status==="PASS")return;
  await new Promise<void>((resolveChild,reject)=>{
    const child=spawn(process.execPath,["--max-old-space-size=4096","--experimental-strip-types","--import",join(root,"scripts/register-test-loader.mjs"),fileURLToPath(import.meta.url),
      "--cards=true",`--card-state=${state}`,`--cache-dir=${cacheDir}`,`--output-dir=${outputDir}`,`--temp-dir=${process.env.TMPDIR}`,
      ...(nativeConnectionFile?[`--native-postgres-file=${nativeConnectionFile}`]:[])],{cwd:root,env:process.env,stdio:"inherit"});
    child.on("error",reject);child.on("close",(code,signal)=>code===0?resolveChild():reject(Error(`${state} card worker exited ${code}${signal?` (${signal})`:""}`)));
  });
}

/** Real reader components consume each replayed state's normal /api/bills response shape. */
async function replayCards(){
  const selectedState=arg("card-state","");
  if(!selectedState){
    const report=JSON.parse(await readFile(join(outputDir,"legiscan-all-states.json"),"utf8")) as ReplayReport;
    for(const summary of report.states)await runCardWorker(summary.state);
    return;
  }
  const [{build},{createServer},{launchGuarded}]=await Promise.all([import("esbuild"),import("node:http"),import("./browser.mts")]);
  const implementation=await implementationSnapshot();
  const path=join(outputDir,"legiscan-all-states.json"),report=JSON.parse(await readFile(path,"utf8")) as ReplayReport;
  const output=await build({stdin:{contents:`import React from "react";import {createRoot} from "react-dom/client";
    import {PersonCard} from "./components/ui/person-card.tsx";import {LegislatorBills} from "./components/officials/legislator-bills.tsx";
    fetch("/input").then(response=>response.json()).then(({holder})=>createRoot(document.getElementById("root")).render(
      <PersonCard title={holder.name} identity={<h1>{holder.name}</h1>} contact={<p>{holder.officeTitle}</p>} sections={{}} sources={[]} independent afterSections={<LegislatorBills holder={holder}/>}/>));`,
    resolveDir:root,sourcefile:"legiscan-all-states-card.tsx",loader:"tsx"},bundle:true,write:false,outfile:".scratch/legiscan-all-states-card.js",
    platform:"browser",format:"iife",jsx:"automatic",define:{"process.env.NODE_ENV":'"production"'},logLevel:"silent"});
  const js=output.outputFiles.find(row=>row.path.endsWith(".js"))!.text;
  let active:(CardInput & {holder:ReplayPerson;state:string;now:string;apiElapsedMs?:number})|undefined,activeStore:FederalMoneyBenchmarkStore|undefined;
  let closeReader:(()=>Promise<void>)|undefined;
  const server=createServer(async(request,response)=>{
    const url=new URL(request.url??"/","http://localhost");
    if(!active){response.writeHead(503).end();return;}
    if(url.pathname==="/card.js")response.writeHead(200,{"content-type":"application/javascript"}).end(js);
    else if(url.pathname==="/input")response.writeHead(200,{"content-type":"application/json"}).end(JSON.stringify({holder:active.holder}));
    else if(url.pathname==="/api/bills"){
      const valid=url.searchParams.get("state")===active.state&&url.searchParams.get("member")===active.holder.id;
      if(!valid||!activeStore){response.writeHead(400,{"content-type":"application/json"}).end(JSON.stringify({error:"Wrong source person or jurisdiction"}));return;}
      const started=performance.now();
      const profileStartedUs=Number(process.hrtime.bigint()/BigInt(1000));
      try {
        const read=await normalBillsRead(active.state,active.now,active.holder);
        active.apiElapsedMs=Math.round(performance.now()-started);
        if(arg("profile-reader","false")==="true")console.log(JSON.stringify({state:active.state,apiInterval:{startedUs:profileStartedUs,endedUs:Number(process.hrtime.bigint()/BigInt(1000)),elapsedMs:active.apiElapsedMs}}));
        response.writeHead(200,{"content-type":"application/json"}).end(JSON.stringify(read));
      }catch(error){response.writeHead(503,{"content-type":"application/json"}).end(JSON.stringify({error:failure(error)}));}
    }else if(url.pathname==="/")response.writeHead(200,{"content-type":"text/html"}).end('<!doctype html><meta name="viewport" content="width=device-width"><div id="root"></div><script src="/card.js"></script>');
    else response.writeHead(200,{"content-type":"application/json"}).end("{}");
  });
  await new Promise<void>((resolveListen,reject)=>{server.on("error",reject);server.listen(0,"127.0.0.1",resolveListen);});
  const address=server.address();if(!address||typeof address==="string")throw Error("Local replay reader unavailable");
  const browser=await launchGuarded({label:"src-01-legiscan-all-states",blockWrites:true});
  try {for(const summary of report.states.filter(row=>row.state===selectedState)){
    if(!summary.connectedReader)throw Error("No published source-to-reader proof is available");
    if(summary.cardProof?.elapsedMs&&summary.cardProof.status!=="PASS")summary.priorCardAttempts=[...(summary.priorCardAttempts??[]),summary.cardProof];
    delete summary.cardProof;delete summary.normalRouteProof;
    const input=JSON.parse(await readFile(join(cacheDir,`${summary.state}-card.json`),"utf8")) as CardInput;
    if(!input.holder&&summary.personCardFailure){
      const held=await heldPeople(summary.state,(await readFile(connectionFile,"utf8")).trim());
      input.holder=held.people[0]??null;
      if(input.holder)summary.connectedReader.selectedPerson={id:input.holder.id,name:input.holder.name,officeTitle:input.holder.officeTitle,state:input.holder.state,rows:0};
    }
    if(!input.holder||!summary.repeats?.at(-1))throw Error("The source-to-person replay is incomplete");
    active={...input,holder:input.holder,state:summary.state,now:summary.repeats.at(-1)!.now};
    activeStore=await FederalMoneyBenchmarkStore.open(join(cacheDir,`${summary.state}-database`),"legiscan-bills","legiscan-bulk",{nativeConnectionFile:nativeConnectionFile||undefined});
    closeReader=await installLocalReader(activeStore,join(cacheDir,`${summary.state}-database`));
    const context=await browser.context({viewport:{width:1000,height:900}}),page=await context.newPage();
    try {
      const start=Date.now();await page.goto(`http://127.0.0.1:${address.port}/`);
      const first=active.read.bills[0];
      if(first)await page.locator(`[data-bill-id="${first.id}"]`).waitFor({state:"visible",timeout:60_000});
      else await page.getByText(/Still gathering:.*sponsored bills/).waitFor({state:"visible",timeout:60_000});
      const elapsedMs=Date.now()-start;
      const visible=await page.locator("[data-bill-id]").count();
      const link=first?await page.locator(`[data-bill-id="${first.id}"] a`).first().getAttribute("href"):null;
      const text=first?await page.locator("[data-legislator-bills]").innerText():"";
      if(visible!==Math.min(20,active.read.bills.length)||first&&(link!==first.sourceUrl||!text.includes(first.title)))throw Error("Rendered card differs from published source bills");
      summary.cardProof={status:elapsedMs<3000?"PASS":"SLOW",parserVersion:LEGISCAN_BULK_PARSER,elapsedMs,personId:active.holder.id,personName:active.holder.name,officeTitle:active.holder.officeTitle,
        visibleBills:visible,totalPersonBills:active.read.bills.length,...(first?{firstBill:{id:first.id,number:first.number,title:first.title,sourceUrl:link},exactTitleAndLinkVisible:true}:{emptyAssociationGapVisible:true}),
        apiReaderElapsedMs:active.apiElapsedMs,apiTransport:`Local HTTP invokes actual readerRoute → canonical GOOD/hash SQL shelf → readBillsForState exact member selection; ${nativeConnectionFile?"native binary PostgreSQL, two reader connections for two bounded batches (production maximum four)":"publisher JSON/stdio transport"}; exact production-held identity supplied from saved readonly roster`,
        measurementConditions:arg("performance-conditions","Parallel source and reader work may be active; this timing has no isolation claim"),
        implementationSha256:implementation.sha256,
        browser:"system Chromium substitute for pinned1234",runId:browser.runId};
      if(["AL","AK","DC","US"].includes(summary.state)){
        const screenshot=join(outputDir,`legiscan-${summary.state.toLowerCase()}-card.png`);await page.screenshot({path:screenshot,fullPage:true});summary.cardProof.screenshot=screenshot;
      }
      const firstClock=new Date(Date.parse(summary.repeats![0].now)-86400000).toISOString();
      const clocks:NonNullable<ReplaySummary["normalRouteProof"]>["clocks"]=[];
      for(const clock of [{kind:"INITIAL_SOURCE_PUBLICATION_READBACK",now:firstClock},...summary.repeats!.map(row=>({kind:row.kind,now:row.now}))]){
        const clockStarted=performance.now();
        const read=await normalBillsRead(summary.state,clock.now),ids=read.bills.map(row=>row.id).sort();
        const person=await normalBillsRead(summary.state,clock.now,active.holder);
        const [ask,personAsk]=await Promise.all([normalAskRead(summary.state,clock.now),normalAskRead(summary.state,clock.now,active.holder)]);
        if(ids.length!==summary.initialPublication!.publishedRows||new Set(ids).size!==ids.length||sha(JSON.stringify(ids))!==summary.connectedReader!.publishedIdHash||
          person.bills.length!==summary.connectedReader!.selectedPerson!.rows||ask.denominators.legiscanBillsMatched!==ids.length||personAsk.denominators.legiscanBillsMatched!==person.bills.length)throw Error("Normal /api/bills or Ask route lost, duplicated, or misjoined a published source row");
        clocks.push({kind:clock.kind,now:clock.now,readerRows:ids.length,distinctReaderIds:new Set(ids).size,readerIdHash:sha(JSON.stringify(ids)),personRows:person.bills.length,
          askStateMatched:ask.denominators.legiscanBillsMatched,askPersonMatched:personAsk.denominators.legiscanBillsMatched,elapsedMs:Math.round(performance.now()-clockStarted)});
      }
      summary.normalRouteProof={status:"PASS",route:"Actual readerRoute selection → canonical GOOD/hash shelf → /api/bills and state/person Ask; final locally replayed store read at each explicitly controlled clock",clocks};
    }catch(error){
      if(summary.cardProof)summary.normalRouteProof={status:"FAIL",route:"Actual normal /api/bills and Ask",reason:failure(error)};
      else summary.cardProof={status:"FAIL",reason:failure(error)};
    }
    finally{await context.close();await closeReader?.();closeReader=undefined;await activeStore.close({dropNativeDatabase:summary.cardProof?.status==="PASS"&&summary.normalRouteProof?.status==="PASS"&&arg("retain-db","false")==="false"});activeStore=undefined;}
    await atomicJson(path,report);
    await writeFile(stateFile(summary.state),JSON.stringify(summary,null,2));
    if(summary.cardProof?.status==="PASS"&&summary.normalRouteProof?.status==="PASS"&&arg("retain-db","false")==="false")await rm(join(cacheDir,`${summary.state}-database`),{recursive:true,force:true});
    console.log(JSON.stringify({state:summary.state,cardProof:summary.cardProof.status,elapsedMs:summary.cardProof.elapsedMs}));
  }}finally{await browser.close();await new Promise<void>((resolveClose,reject)=>server.close(error=>error?reject(error):resolveClose()));}
  report.browserReplay={transport:"local read-only /api/bills HTTP executes actual normal reader against previously replayed PostgreSQL database; unstyled actual card components",browser:"/usr/bin/chromium; pinned1234 unavailable",noProductionWrites:true,
    limitation:"Production network latency and the production seatHolderById roster lookup are excluded; the exact readonly production-held person is supplied locally. This is not a deployed production page."};
  report.status=report.states.length===report.coveredJurisdictions?.length&&report.states.every(row=>row.parserVersion===LEGISCAN_BULK_PARSER&&row.cardProof?.status==="PASS"&&row.normalRouteProof?.status==="PASS")?"COMPLETE":"INCOMPLETE";
  await atomicJson(path,report);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
