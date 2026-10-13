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
import { OPEN_DATA_SOURCES, OPEN_DATA_PARSER, SOCRATA_CATALOG, ECHO_EXPORT, divisionPartition, zipPartition, type OpenDataSource, type OpenDataReport,type OpenDataPartitionRef } from "../lib/sources/open-data/model.ts";
import { normalizeSocrata, normalizeEcho, openDataReports, type GovernmentJoin, type PortalBinding } from "../lib/sources/open-data/normalize.ts";
import { openDataFetch, socrataPages } from "../lib/sources/open-data/acquire.ts";
import { OpenDataSpool } from "../lib/sources/open-data/spool.ts";
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
  const priorManifest=await readOpenDataProjection(source,"national",{store,bypassCache:true});
  if(priorManifest.kind==="STORE_UNREACHABLE")throw Error("Source manifest could not be read; the prior source stays live.");
  const partitions=new Map<string,OpenDataPartitionRef>((priorManifest.kind==="PROMOTED"?priorManifest.value.partitions??[]:[]).map(p=>[p.id,p]));
  const vault=openDataVault();
  const writePartition=async(partition:{partition:string;rows:Parameters<typeof openDataReports>[0];captures:readonly OpenDataCapture[]})=>{
    const reference=await saveOpenDataPartition({source,...partition,now:now()},vault);partitions.set(reference.id,reference);
  };
  const reports=new Map<string,OpenDataReport>(US_JURISDICTIONS.map(s=>[s.usps,{id:`state:${s.usps}`,state:s.usps,loaded:0,joined:0,unjoined:0}]));
  const addReports=(rows:Parameters<typeof openDataReports>[0])=>{for(const row of openDataReports(rows)){const prior=reports.get(row.state);reports.set(row.state,{...row,loaded:row.loaded+(prior?.loaded??0),joined:row.joined+(prior?.joined??0),unjoined:row.unjoined+(prior?.unjoined??0)});}};
  try {
    if(source==="socrata-discovery") {
      const domains=new Set<string>();
      for await (const page of socrataPages({signal,token:process.env.SOCRATA_APP_TOKEN})) {
        lastCapture={url:page.url,retrievedAt:page.retrievedAt,rawHash:page.sha256,sourceRows:[],sourceCheck:page.sourceCheck};
        for(const raw of page.rows){const row=normalizeSocrata(raw,page.retrievedAt);domains.add(row.nativeIds.domain);await spool.append(`domain:${row.nativeIds.domain}`,row,lastCapture);}
      }
      const held:GovernmentJoin[]=[],bindings:PortalBinding[]=[];
      // Only identifiers survive each state's directory read; source facts remain on disk.
      for(const state of US_JURISDICTIONS) {
        signal.throwIfAborted();
        const registration=await readRegistrationProjection(state.usps,{store,bypassCache:true});
        if(registration.kind!=="PROMOTED"){console.log(`SRC_SO_JOIN_GAP=${JSON.stringify({state:state.usps,reason:registration.kind})}`);continue;}
        const governments=[...(registration.value.governments ?? [])];
        const division=registration.value.divisions.find(d=>d.divisionType==="state");
        if(division){
          held.push({divisionId:division.ocdId,bodyIds:[],nativeIds:{ocd_id:division.ocdId,geoid:state.fips,state_fips:state.fips}});
          try {const website=await readStateGovernmentWebsite(state.usps,signal);
            if(website)governments.push({id:`usa-gov:${state.usps}`,state:state.usps,website,nativeIds:{usa_gov_state:state.usps,state_fips:state.fips},bodyIds:[],
              associations:[{divisionId:division.ocdId,layer:"state",geoid:state.fips,basis:"SOURCE_CODE"}]} as unknown as RegistrationGovernmentListing);
          } catch(error){console.log(`SRC_SO_STATE_PORTAL_GAP=${JSON.stringify({state:state.usps,reason:error instanceof Error?error.message:String(error)})}`);}
        }
        held.push(...governmentJoinRows(governments));
        const found=await discoverGovernmentPortals(governments,domains,signal);
        bindings.push(...found.bindings);if(found.gaps.length)console.log(`SRC_SO_PORTAL_GAPS=${JSON.stringify(found.gaps)}`);
      }
      const divisions=await OpenDataSpool.create();
      try {
        for await (const partition of spool.partitions()) {
          const rows=partition.rows.map(row=>normalizeSocrata(row.sourceRow,row.capturedAt,held,bindings));
          addReports(rows);
          await writePartition({...partition,rows});
          await saveSocrataLeads(repos,rows,now());
          for(const row of rows)for(const id of row.divisionIds){const capture=partition.captures.find(c=>c.sourceRows.includes(row.sourceRow)) ?? partition.captures[0];await divisions.append(divisionPartition(id),row,capture);}
        }
        for await(const partition of divisions.partitions())await writePartition(partition);
      } finally {await divisions.dispose();}
    } else {
      const prior=priorManifest;
      const candidate=prior.kind==="PROMOTED"?await store.readCandidate(prior.metadata.versionId!):null;
      const oldCapture=(candidate?.candidate.normalizedPayload as {captures?:OpenDataCapture[]}|null)?.captures?.at(-1);
      const archive=await openArchiveSource({id:source,url:ECHO_EXPORT,file:"ECHO_EXPORTER.csv",format:"csv-zip"},
        (url,init)=>openDataFetch(url,{...init,signal:AbortSignal.any([signal,...(init?.signal?[init.signal]:[])])}),archiveVault(),candidate?.candidate.normalization.parserVersion===OPEN_DATA_PARSER?oldCapture?.archive?.sha256:undefined);
      try {
        lastCapture={url:ECHO_EXPORT,retrievedAt:archive.retrievedAt,rawHash:archive.sourceSha256,sourceRows:[],
          sourceCheck:{requestedUrl:ECHO_EXPORT,finalUrl:archive.finalUrl,httpStatus:archive.lastCheckStatus as 200|304,checkedAt:archive.checkedAt,rawHash:archive.sourceSha256},
          archive:{sha256:archive.sourceSha256,member:archive.member,publishedAt:archive.publishedAt}};
        if(archive.unchanged){for(const row of prior.kind==="PROMOTED"?prior.value.reports:[])reports.set(row.state,row);}
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
          try {for await(const partition of spool.partitions()) {
            const state=partition.rows[0]?.state ?? null;
            if(state!==heldState){heldState=state;held=[];
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
    const publication=await publishOpenData({store,source,rows:[],reports:[...reports.values()],partitions:[...partitions.values()].sort((a,b)=>a.id.localeCompare(b.id)),captures:[lastCapture],now:now(),replace:true});
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
  } finally {await spool.dispose();}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)await main();
