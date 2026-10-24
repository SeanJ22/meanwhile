/** SRC-SO: one national source routine, independently clocked, with bounded reader partitions. */
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore, type RoutineDataStore } from "../lib/civic-data/store.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { recordRegisteredSourceAcquisitionFailure, sourceAcquisitionFailure } from "../lib/civic-data/source-acquisition-failure.ts";
import { controlPlaneUrlFromEnv, createPgRepositories } from "../lib/control-plane/repository/pg-store.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { VAULT_DIR } from "../lib/control-plane/scheduler/vault.ts";
import { US_JURISDICTIONS } from "../lib/coverage/states.ts";
import { readRegistrationProjection } from "../lib/registration/reader.ts";
import { openArchiveSource, type ArchiveObjectStore } from "../lib/sources/archive-download.ts";
import { streamCsvObjects } from "../lib/sources/prl/streaming.ts";
import { recordDoorEvidence } from "../lib/doors/shut.ts";
import { feedDoorId } from "../lib/doors/registry.ts";
import { recordDoorOutcome } from "../lib/doors/outcome.ts";
import { OPEN_DATA_SOURCES, OPEN_DATA_PARSER, SOCRATA_CATALOG, ECHO_EXPORT, zipPartition, type OpenDataSource, type OpenDataReport,type OpenDataPartitionRef } from "../lib/sources/open-data/model.ts";
import { normalizeEcho, openDataReports, type GovernmentJoin } from "../lib/sources/open-data/normalize.ts";
import { openDataFetch, socrataPages } from "../lib/sources/open-data/acquire.ts";
import { OpenDataSpool } from "../lib/sources/open-data/spool.ts";
import { publishOpenData, readOpenDataProjection, type OpenDataCapture } from "../lib/sources/open-data/publication.ts";
import { governmentJoinRows } from "../lib/sources/open-data/portals.ts";
import { saveSocrataLeads } from "../lib/sources/open-data/leads.ts";
import { facilityPoint,facilityCell } from "../lib/sources/open-data/geography.ts";
import { saveOpenDataPartition,openDataVault } from "../lib/sources/open-data/artifacts.ts";
import type { EvidenceStore } from "../lib/control-plane/evidence/store.ts";
import type { RoutineCandidate } from "../lib/civic-data/types.ts";
import { refreshSocrata, socrataStateDivisionId, type SocrataGovernmentState } from "../lib/sources/open-data/socrata.ts";
import { echoMinimumGap, retainEchoMinimumGaps, mergeEchoRetainedPartition, type EchoMinimumGap } from "../lib/sources/open-data/echo-gaps.ts";
import { materializeEchoPartitions } from "../lib/sources/open-data/echo-materialization.ts";

export function parseOpenDataArguments(args:readonly string[]):OpenDataSource {
  if(args.length!==2 || !args.includes("--promote"))throw Error("SRC-SO requires --promote and one --source.");
  const source=args.find(a=>a.startsWith("--source="))?.slice(9) as OpenDataSource;
  if(!OPEN_DATA_SOURCES.includes(source))throw Error("SRC-SO source is unsupported.");return source;
}
const ARCHIVE_ROOT="project/freshness/source/src-so/archive";
/** Held EPA source bytes. Every body key names its own content (`<source>/sources/<sha256>/part-N`), so one key never meets a
 * different body and the next run reuses bytes it already holds. The held-source pointer is the one rebuilt object: a
 * MUTABLE_INDEX named for its key, replaced by each run and read by the next run for its conditional check. */
export function openDataArchiveStore(vault:EvidenceStore=new DurableEvidenceStore(join(process.cwd(),...VAULT_DIR))):ArchiveObjectStore {
  const index=(path:string)=>path.endsWith("/source.json");
  const key=(path:string)=>index(path)?`${ARCHIVE_ROOT}/index/${path}`:`${ARCHIVE_ROOT}/${path}`;
  return {get:async path=>(await vault.get(key(path)))?.bytes ?? null,head:async path=>{const v=await vault.head(key(path));return v?{size:v.byteLength}:null;},
    put:async(path,bytes,contentType="application/octet-stream")=>{
      if(!index(path)&&!/\/sources\/[a-f0-9]{64}\/part-\d+$/.test(path))throw Error(`Archive body ${path} is not content-addressed.`);
      return vault.put(key(path),bytes,index(path)
        ?{contentType,contentHash:`manifest:${key(path)}`,byteLength:bytes.length,objectClass:"MUTABLE_INDEX"}
        :{contentType,contentHash:`sha256-${createHash("sha256").update(bytes).digest("hex")}`,byteLength:bytes.length,objectClass:"IMMUTABLE_BODY"});
    }};
}
type Spool=Awaited<ReturnType<typeof OpenDataSpool.create>>;
type Publication=Awaited<ReturnType<typeof publishOpenData>>;
/** One national run: the prior manifest, the partitions this run replaces, per-state reports and the registered publisher. */
async function openDataRun(input:{source:OpenDataSource;store:RoutineDataStore;vault:EvidenceStore;now:()=>string}) {
  const prior=await readOpenDataProjection(input.source,"national",{store:input.store,bypassCache:true});
  if(prior.kind==="STORE_UNREACHABLE")throw Error("Source manifest could not be read; the prior source stays live.");
  const partitions=new Map<string,OpenDataPartitionRef>((prior.kind==="PROMOTED"?prior.value.partitions??[]:[]).map(p=>[p.id,p]));
  const replacedLogicalPartitions=new Set<string>();
  const reports=new Map<string,OpenDataReport>(US_JURISDICTIONS.map(s=>[s.usps,{id:`state:${s.usps}`,state:s.usps,loaded:0,joined:0,unjoined:0}]));
  return {prior,reports,
    addReports(rows:Parameters<typeof openDataReports>[0]){for(const row of openDataReports(rows)){const held=reports.get(row.state);reports.set(row.state,{...row,loaded:row.loaded+(held?.loaded??0),joined:row.joined+(held?.joined??0),unjoined:row.unjoined+(held?.unjoined??0)});}},
    async writePartition(partition:{partition:string;rows:Parameters<typeof openDataReports>[0];captures:readonly OpenDataCapture[]}) {
      if(input.source==="epa-echo") {
        const logical=partition.partition.replace(/:part:\d+$/,"");
        if(!replacedLogicalPartitions.has(logical)){replacedLogicalPartitions.add(logical);for(const key of partitions.keys())if(key===logical||key.startsWith(`${logical}:part:`))partitions.delete(key);}
      }
      const reference=await saveOpenDataPartition({source:input.source,...partition,now:input.now()},input.vault);partitions.set(reference.id,reference);
    },
    publish:(capture:OpenDataCapture,excludedFacts:RoutineCandidate["excludedFacts"]=[])=>publishOpenData({store:input.store,source:input.source,rows:[],reports:[...reports.values()],
      partitions:[...partitions.values()].sort((a,b)=>a.id.localeCompare(b.id)),captures:[capture],excludedFacts,now:input.now(),replace:true}),
  };
}
/** The scheduled EPA ECHO run: conditional check from the held source, minimum-fact gaps, bounded reader partitions, registered publication. */
export async function refreshEchoNational(input:{store:RoutineDataStore;vault:EvidenceStore;archive:ArchiveObjectStore;spool:Spool;signal:AbortSignal;now:()=>string;
  readStateJoins:(state:string)=>Promise<GovernmentJoin[]>;fetchImpl?:typeof fetch}):Promise<{publication:Publication;reports:OpenDataReport[];gaps:EchoMinimumGap[];unchanged:boolean}> {
  const {store,vault,spool,signal}=input,run=await openDataRun({source:"epa-echo",store,vault,now:input.now}),prior=run.prior;
  const candidate=prior.kind==="PROMOTED"?await store.readCandidate(prior.metadata.versionId!):null;
  const priorCaptures=(candidate?.candidate.normalizedPayload as {captures?:OpenDataCapture[]}|null)?.captures??[];
  const archive=await openArchiveSource({id:"epa-echo",url:ECHO_EXPORT,file:"ECHO_EXPORTER.csv",format:"csv-zip"},
    (url,init)=>openDataFetch(url,{...init,signal:AbortSignal.any([signal,...(init?.signal?[init.signal]:[])])},input.fetchImpl),input.archive,
    candidate?.candidate.normalization.parserVersion===OPEN_DATA_PARSER?priorCaptures.at(-1)?.archive?.sha256:undefined);
  const gaps:EchoMinimumGap[]=[];let excluded:RoutineCandidate["excludedFacts"]=[];
  const capture:OpenDataCapture={url:ECHO_EXPORT,retrievedAt:archive.retrievedAt,rawHash:archive.sourceSha256,sourceRows:[],
    sourceCheck:{requestedUrl:ECHO_EXPORT,finalUrl:archive.finalUrl,httpStatus:archive.lastCheckStatus as 200|304,checkedAt:archive.checkedAt,rawHash:archive.sourceSha256},
    archive:{sha256:archive.sourceSha256,member:archive.member,publishedAt:archive.publishedAt}};
  try {
    if(archive.unchanged){excluded=candidate?.candidate.excludedFacts??[];for(const row of prior.kind==="PROMOTED"?prior.value.reports:[])run.reports.set(row.state,row);}
    else {
      if(archive.member!=="ECHO_EXPORTER.csv")throw Error("EPA exporter archive has a different source member.");
      let count=0;
      for await(const raw of streamCsvObjects(archive.textChunks)) {
        signal.throwIfAborted();
        const gap=echoMinimumGap(raw);if(gap){gaps.push(gap);continue;}
        const row=normalizeEcho(raw,archive.retrievedAt,archive.publishedAt);
        await spool.append(row.zip?`${zipPartition(row.zip)}:state:${row.state??"UNRESOLVED"}`:`unlocated:${row.state??"UNRESOLVED"}`,row,capture);count++;
        const point=facilityPoint(row);if(point)await spool.append(`${facilityCell(point.lat,point.lng)}:state:${row.state??"UNRESOLVED"}`,row,capture);
      }
      await archive.accept?.();if(!count)throw Error("EPA exporter has no facility rows; prior data remain live.");
      const retained=await retainEchoMinimumGaps(gaps,prior.kind==="PROMOTED"?prior.value.partitions??[]:[],priorCaptures,vault);
      const currentPartitions=async function*(){for await(const partition of spool.partitions({consume:true,maxRows:1000,maxBytes:4*1024*1024}))yield mergeEchoRetainedPartition(partition,retained);yield* retained.values();};
      await materializeEchoPartitions({partitions:currentPartitions(),addReports:rows=>run.addReports(rows),writePartition:partition=>run.writePartition(partition),readStateJoins:input.readStateJoins});
      excluded=gaps.map(gap=>gap.fact);
    }
  } finally {await archive.dispose();}
  return {publication:await run.publish(capture,excluded),reports:[...run.reports.values()],gaps,unchanged:archive.unchanged===true};
}
async function main() {
  const source=parseOpenDataArguments(process.argv.slice(2));installNeonRequestDeadline();prepareProductionCivicDataWrite();
  const store=new PostgresRoutineDataStore(), now=()=>new Date().toISOString();
  const connection=controlPlaneUrlFromEnv();if(!connection)throw Error("SRC-SO control-plane repository is unavailable.");
  const repos=await createPgRepositories(connection,now(),{skipBootstrap:true});
  const spool=await OpenDataSpool.create();
  const signal=AbortSignal.timeout(20*60_000);
  try {
    const vault=openDataVault();
    let publication:Publication|undefined,reports:OpenDataReport[]=[],gaps:EchoMinimumGap[]=[];
    if(source==="socrata-discovery") {
      const run=await openDataRun({source,store,vault,now});
      const states=async function*():AsyncGenerator<SocrataGovernmentState>{
        for(const state of US_JURISDICTIONS) {
          const registration=await readRegistrationProjection(state.usps,{store,bypassCache:true});
          if(registration.kind!=="PROMOTED"){console.log(`SRC_SO_JOIN_GAP=${JSON.stringify({state:state.usps,reason:registration.kind})}`);continue;}
          yield {state:state.usps,fips:state.fips,governments:registration.value.governments??[],divisionId:socrataStateDivisionId(registration.value.divisions,state.usps)};
        }
      };
      await refreshSocrata({pages:socrataPages({signal,token:process.env.SOCRATA_APP_TOKEN}),states:states(),signal,writePartition:partition=>run.writePartition(partition),
        saveLeads:rows=>saveSocrataLeads(repos,rows,now()).then(()=>{}),gap:detail=>console.log(`SRC_SO_PORTAL_GAPS=${JSON.stringify(detail)}`),
        publish:async(rows,capture)=>{for(const [state,row]of run.reports)run.reports.set(state,{...row,loaded:0,joined:0,unjoined:0});for(const row of rows)run.reports.set(row.state,row);publication=await run.publish(capture);}});
      if(!publication)throw Error("Source produced no captured publication.");
      reports=[...run.reports.values()];
    } else ({publication,reports,gaps}=await refreshEchoNational({store,vault,archive:openDataArchiveStore(),spool,signal,now,readStateJoins:async state=>{
      const registration=await readRegistrationProjection(state,{store,bypassCache:true});
      if(registration.kind==="PROMOTED")return governmentJoinRows(registration.value.governments??[]);
      console.log(`SRC_SO_JOIN_GAP=${JSON.stringify({state,reason:registration.kind})}`);return [];
    }}));
    await recordDoorEvidence(repos.doors,feedDoorId(source),{kind:"GOOD",rows:reports.reduce((n,r)=>n+r.loaded,0)},now(),repos);
    await recordDoorOutcome(repos.doors,feedDoorId(source),"SUCCESS",now(),!publication.outcome.confirmed);
    console.log(`SRC_SO_ROWS=${JSON.stringify(reports)}`);
    if(gaps.length)console.log(`SRC_SO_FACILITY_GAPS=${JSON.stringify(gaps.map(({id,state,fact})=>({id,state,reason:fact.detail})))}`);
    printSourceRunnerReceipt(source,publication.candidate,publication.outcome);
  } catch(error) {
    const reason=error instanceof Error?error.message:String(error);
    const failed=await recordRegisteredSourceAcquisitionFailure({store,contractId:source,requestedUrl:source==="socrata-discovery"?SOCRATA_CATALOG:ECHO_EXPORT,
      failure:sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE",reason)});
    await recordDoorEvidence(repos.doors,feedDoorId(source),{kind:"PARSE_FAILURE",detail:reason},now(),repos);
    console.log(failed.line);process.exitCode=2;
  } finally {await spool.dispose();}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)await main();
