/** SRC-SO: one national source routine, independently clocked, with bounded reader partitions. */
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { prepareProductionCivicDataWrite } from "../lib/civic-data/production-write.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
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
import { OPEN_DATA_SOURCES, SOCRATA_CATALOG, ECHO_EXPORT, divisionPartition, zipPartition, type OpenDataSource, type OpenDataReport,type OpenDataPartitionRef } from "../lib/sources/open-data/model.ts";
import { normalizeSocrata, normalizeEcho, openDataReports, type GovernmentJoin } from "../lib/sources/open-data/normalize.ts";
import { openDataFetch, socrataPages } from "../lib/sources/open-data/acquire.ts";
import { OpenDataSpool } from "../lib/sources/open-data/spool.ts";
import { createSocrataGovernmentIndex } from "../lib/sources/open-data/government-index.ts";
import { createOpenDataPublicationIndex } from "../lib/sources/open-data/publication-index.ts";
import { readOpenDataArea, openDataStatePartition } from "../lib/sources/open-data/area-read.ts";
import { publishOpenData, readOpenDataProjection, type OpenDataCapture } from "../lib/sources/open-data/publication.ts";
import { discoverGovernmentPortals, governmentJoinRows,readStateGovernmentWebsite } from "../lib/sources/open-data/portals.ts";
import type { RegistrationGovernmentListing } from "../lib/registration/listings.ts";
import { saveSocrataLeads } from "../lib/sources/open-data/leads.ts";
import { facilityPoint,facilityCell } from "../lib/sources/open-data/geography.ts";
import { saveOpenDataPartition,openDataVault } from "../lib/sources/open-data/artifacts.ts";

export function parseOpenDataArguments(args:readonly string[]):OpenDataSource {
  if(args.length!==2 || !args.includes("--promote"))throw Error("SRC-SO requires --promote and one --source.");
  const source=args.find(a=>a.startsWith("--source="))?.slice(9) as OpenDataSource;
  if(!OPEN_DATA_SOURCES.includes(source))throw Error("SRC-SO source is unsupported.");return source;
}
function archiveVault():ArchiveObjectStore {
  const vault=new DurableEvidenceStore(join(process.cwd(),...VAULT_DIR));
  const key=(path:string)=>`project/freshness/source/src-so/archive/${path}`;
  return {get:async path=>(await vault.get(key(path)))?.bytes ?? null,head:async path=>{const v=await vault.head(key(path));return v?{size:v.byteLength}:null;},
    put:async(path,bytes,contentType="application/octet-stream")=>vault.put(key(path),bytes,{contentType,contentHash:`sha256-${createHash("sha256").update(bytes).digest("hex")}`,byteLength:bytes.length,
      objectClass:path.endsWith("source.json")?"MUTABLE_INDEX":"IMMUTABLE_BODY"})};
}
async function main() {
  const source=parseOpenDataArguments(process.argv.slice(2));installNeonRequestDeadline();prepareProductionCivicDataWrite();
  const store=new PostgresRoutineDataStore(), now=()=>new Date().toISOString();
  const connection=controlPlaneUrlFromEnv();if(!connection)throw Error("SRC-SO control-plane repository is unavailable.");
  const repos=await createPgRepositories(connection,now(),{skipBootstrap:true});
  const spool=await OpenDataSpool.create();
  const signal=AbortSignal.timeout(20*60_000);
  let lastCapture:OpenDataCapture|undefined;
  const priorManifest=await readOpenDataProjection(source,"release",{store,bypassCache:true});
  if(priorManifest.kind==="STORE_UNREACHABLE")throw Error("Source manifest could not be read; the prior source stays live.");
  const partitions=await createOpenDataPublicationIndex();
  let sourceChanged=true;
  const vault=openDataVault();
  const writePartition=async(partition:{partition:string;rows:Parameters<typeof openDataReports>[0];captures:readonly OpenDataCapture[]})=>{
    const reference=await saveOpenDataPartition({source,...partition,now:now()},vault);
    const state=partition.rows[0]?.state;
    if(state&&US_JURISDICTIONS.some(row=>row.usps===state))partitions.append(state,reference);
    else await publishOpenData({store,source,partition:`native:${reference.id}`,rows:[],reports:openDataReports(partition.rows),partitions:[reference],
      captures:partition.captures.map(capture=>({...capture,sourceRows:[]})),now:now()});
  };
  const reports=new Map<string,OpenDataReport>(US_JURISDICTIONS.map(s=>[s.usps,{id:`state:${s.usps}`,state:s.usps,loaded:0,joined:0,unjoined:0}]));
  const addReports=(rows:Parameters<typeof openDataReports>[0])=>{for(const row of openDataReports(rows)){const prior=reports.get(row.state);reports.set(row.state,{...row,loaded:row.loaded+(prior?.loaded??0),joined:row.joined+(prior?.joined??0),unjoined:row.unjoined+(prior?.unjoined??0)});}};
  try {
    if(source==="socrata-discovery") {
      const joins=await createSocrataGovernmentIndex();
      const sourceSlices=await OpenDataSpool.create(),divisions=await OpenDataSpool.create();
      try {
        for await (const page of socrataPages({signal,token:process.env.SOCRATA_APP_TOKEN,trackResource:id=>joins.track(id)})) {
          lastCapture={url:page.url,retrievedAt:page.retrievedAt,rawHash:page.sha256,sourceRows:[],sourceCheck:page.sourceCheck};
          for(const raw of page.rows){const row=normalizeSocrata(raw,page.retrievedAt);joins.addDomain(row.nativeIds.domain);await spool.append(`domain:${row.nativeIds.domain}`,row,lastCapture);}
        }
        for(const state of US_JURISDICTIONS) {
          signal.throwIfAborted();
          const registration=await readRegistrationProjection(state.usps,{store,bypassCache:true});
          if(registration.kind!=="PROMOTED"){console.log(`SRC_SO_JOIN_GAP=${JSON.stringify({state:state.usps,reason:registration.kind})}`);continue;}
          const governments=[...(registration.value.governments ?? [])];
          const held:GovernmentJoin[]=[];
          const division=registration.value.divisions.find(d=>d.divisionType==="state");
          if(division){
            held.push({divisionId:division.ocdId,bodyIds:[],nativeIds:{ocd_id:division.ocdId,geoid:state.fips,state_fips:state.fips}});
            try {const website=await readStateGovernmentWebsite(state.usps,signal);
              if(website)governments.push({id:`usa-gov:${state.usps}`,state:state.usps,website,nativeIds:{usa_gov_state:state.usps,state_fips:state.fips},bodyIds:[],
                associations:[{divisionId:division.ocdId,layer:"state",geoid:state.fips,basis:"SOURCE_CODE"}]} as unknown as RegistrationGovernmentListing);
            } catch(error){console.log(`SRC_SO_STATE_PORTAL_GAP=${JSON.stringify({state:state.usps,reason:error instanceof Error?error.message:String(error)})}`);}
          }
          held.push(...governmentJoinRows(governments));
          const found=await discoverGovernmentPortals(governments,joins.domains,signal);
          joins.append(state.usps,held,found.bindings);
          if(found.gaps.length)console.log(`SRC_SO_PORTAL_GAPS=${JSON.stringify(found.gaps)}`);
        }
        for await(const {row:raw,capture}of spool.records()) {
          signal.throwIfAborted();let matched=false;
          for await(const match of joins.matches(raw)) {
            const row=normalizeSocrata(raw.sourceRow,raw.capturedAt,match.governments,match.bindings);
            if(!row.divisionIds.length)continue;
            matched=true;
            await sourceSlices.append(`domain:${row.nativeIds.domain}:state:${match.state}`,row,capture);
            for(const id of row.divisionIds)await divisions.append(divisionPartition(id),row,capture);
          }
          if(!matched)await sourceSlices.append(`domain:${raw.nativeIds.domain}:state:${raw.state??"UNRESOLVED"}`,raw,capture);
        }
        for await(const partition of sourceSlices.partitions({pageRows:250,pageBytes:8*1024*1024})) {
          addReports(partition.rows);await writePartition(partition);
          await saveSocrataLeads(repos,partition.rows,now());
        }
        for await(const partition of divisions.partitions({pageRows:500,pageBytes:8*1024*1024}))await writePartition(partition);
      } finally {await sourceSlices.dispose();await divisions.dispose();await joins.dispose();}
    } else {
      const prior=priorManifest;

      const archive=await openArchiveSource({id:source,url:ECHO_EXPORT,file:"ECHO_EXPORTER.csv",format:"csv-zip"},
        (url,init)=>openDataFetch(url,{...init,signal:AbortSignal.any([signal,...(init?.signal?[init.signal]:[])])}),archiveVault(),prior.kind==="PROMOTED"?prior.value.archive?.sha256:undefined);
      try {
        lastCapture={url:ECHO_EXPORT,retrievedAt:archive.retrievedAt,rawHash:archive.sourceSha256,sourceRows:[],
          sourceCheck:{requestedUrl:ECHO_EXPORT,finalUrl:archive.finalUrl,httpStatus:archive.lastCheckStatus as 200|304,checkedAt:archive.checkedAt,rawHash:archive.sourceSha256},
          archive:{sha256:archive.sourceSha256,member:archive.member,publishedAt:archive.publishedAt}};
        if(archive.unchanged){sourceChanged=false;for(const row of prior.kind==="PROMOTED"?prior.value.reports:[])reports.set(row.state,row);}
        else {
          if(archive.member!=="ECHO_EXPORTER.csv")throw Error("EPA exporter archive has a different source member.");
          let count=0;
          for await(const raw of streamCsvObjects(archive.textChunks)) {
            signal.throwIfAborted();
            const row=normalizeEcho(raw,archive.retrievedAt,archive.publishedAt);
            await spool.append(row.zip?`${zipPartition(row.zip)}:state:${row.state??"UNRESOLVED"}`:`unlocated:${row.state??"UNRESOLVED"}`,row,lastCapture);count++;
            const point=facilityPoint(row);if(point)await spool.append(`${facilityCell(point.lat,point.lng)}:state:${row.state??"UNRESOLVED"}`,row,lastCapture);
          }
          await archive.accept?.();if(!count)throw Error("EPA exporter has no facility rows; prior data remain live.");
          let heldState:string|null=null,held:GovernmentJoin[]=[];
          const pending=new Set<Promise<void>>();
          let writeFailure:unknown;
          try {for await(const partition of spool.partitions({pageRows:500,pageBytes:8*1024*1024})) {
            const state=partition.rows[0]?.state ?? null;
            if(state!==heldState){await Promise.all(pending);if(writeFailure)throw writeFailure;heldState=state;held=[];
              if(state && US_JURISDICTIONS.some(s=>s.usps===state)){const registration=await readRegistrationProjection(state,{store,bypassCache:true});
                if(registration.kind==="PROMOTED")held=governmentJoinRows(registration.value.governments??[]);
                else console.log(`SRC_SO_JOIN_GAP=${JSON.stringify({state,reason:registration.kind})}`);
              }
            }
            const rows=partition.rows.map(row=>normalizeEcho(row.sourceRow,row.capturedAt,row.publishedAt,held));
            if(!partition.partition.startsWith("cell:"))addReports(rows);
            const writing:Promise<void>=writePartition({...partition,rows}).catch(error=>{writeFailure??=error;}).finally(()=>pending.delete(writing));pending.add(writing);
            if(pending.size>=4)await Promise.race(pending);
            if(writeFailure)throw writeFailure;
          }await Promise.all(pending);if(writeFailure)throw writeFailure;}finally{await Promise.allSettled(pending);}
        }
      } finally {await archive.dispose();}
    }
    if(!lastCapture)throw Error("Source produced no captured publication.");
    const stateScopes:string[]=!sourceChanged&&priorManifest.kind==="PROMOTED"?[...priorManifest.value.stateScopes??[]]:[];
    for(const state of US_JURISDICTIONS) {
      if(!sourceChanged)continue;
      const partition=openDataStatePartition(state.usps);
      if(!reports.get(state.usps)!.loaded) {
        if(await store.readPromotionIdentity("CURATED_READER_RECORD",`${source}:${partition}`))stateScopes.push(`${source}:${partition}`);
        continue;
      }
      const held=await readOpenDataArea(source,state.usps,undefined,{store,bypassCache:true});
      if(held.kind==="STORE_UNREACHABLE")throw Error(`The prior ${state.usps} source manifest could not be read.`);
      const refs=new Map<string,OpenDataPartitionRef>();
      for(const reference of held.kind==="PROMOTED"?held.value.partitions??[]:[])
        if(source!=="socrata-discovery"||!reference.id.startsWith("domain:"))refs.set(reference.id,reference);
      for(const reference of partitions.forState(state.usps))refs.set(reference.id,reference);
      await publishOpenData({store,source,partition,rows:[],reports:[reports.get(state.usps)!],partitions:[...refs.values()],captures:[lastCapture],now:now()});
      stateScopes.push(`${source}:${partition}`);
    }
    const publication=await publishOpenData({store,source,rows:[],reports:[...reports.values()],stateScopes,archive:lastCapture.archive,captures:[lastCapture],now:now()});
    await recordDoorEvidence(repos.doors,feedDoorId(source),{kind:"GOOD",rows:[...reports.values()].reduce((n,r)=>n+r.loaded,0)},now(),repos);
    await recordDoorOutcome(repos.doors,feedDoorId(source),"SUCCESS",now(),!publication.outcome.confirmed);
    console.log(`SRC_SO_ROWS=${JSON.stringify([...reports.values()])}`);
    printSourceRunnerReceipt(source,publication.candidate,publication.outcome);
  } catch(error) {
    const reason=error instanceof Error?error.message:String(error);
    const failed=await recordRegisteredSourceAcquisitionFailure({store,contractId:source,requestedUrl:source==="socrata-discovery"?SOCRATA_CATALOG:ECHO_EXPORT,
      failure:sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE",reason)});
    await recordDoorEvidence(repos.doors,feedDoorId(source),{kind:"PARSE_FAILURE",detail:reason},now(),repos);
    console.log(failed.line);process.exitCode=2;
  } finally {await spool.dispose();await partitions.dispose();}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)await main();
