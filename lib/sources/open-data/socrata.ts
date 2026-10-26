import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { US_JURISDICTIONS } from "../../coverage/states.ts";
import { temporaryPath } from "../../civic-data/temporary-path.ts";
import type { RegistrationGovernmentListing } from "../../registration/listings.ts";
import type { CatalogPage } from "./acquire.ts";
import { divisionPartition, type OpenDataReport } from "./model.ts";
import { normalizeSocrata, openDataReports, type GovernmentJoin, type PortalBinding } from "./normalize.ts";
import { discoverGovernmentPortals, governmentJoinRows, portalBindingsFromPage, readStateGovernmentWebsite } from "./portals.ts";
import type { OpenDataCapture } from "./publication.ts";
import { OpenDataSpool } from "./spool.ts";
import type { KnownRelease } from "../known-release.ts";
import type { socrataDiscoveryProgress } from "./socrata-discovery-progress.ts";

export interface SocrataGovernmentState {
  readonly state:string;
  readonly fips:string;
  readonly divisionId?:string;
  readonly governments:readonly RegistrationGovernmentListing[];
}
/** Some registration directories hold state roots only as their counties' exact parent IDs. */
export function socrataStateDivisionId(divisions:readonly {ocdId:string;parentOcdId?:string|null}[],postal:string):string|undefined {
  return divisions.flatMap(row=>[row.ocdId,row.parentOcdId]).find((id):id is string=>typeof id==="string" &&
    /^ocd-division\/country:us\/(?:state|district|territory):([a-z]{2})$/.exec(id)?.[1]===postal.toLowerCase());
}
type Partition = {partition:string;rows:ReturnType<typeof normalizeSocrata>[];captures:readonly OpenDataCapture[]};
export interface PreparedSocrataCatalog {
  readonly spool:Awaited<ReturnType<typeof OpenDataSpool.create>>;
  readonly domains:ReadonlySet<string>;
  readonly captures:readonly OpenDataCapture[];
}
/** Follow the current native scroll before any held manifest or government inventory is read. */
export async function prepareSocrataCatalog(pages:AsyncIterable<CatalogPage>,signal:AbortSignal):Promise<PreparedSocrataCatalog> {
  const spool=await OpenDataSpool.create(),domains=new Set<string>(),captures:OpenDataCapture[]=[];
  let rows=0;
  try {
    for await(const page of pages) {
      signal.throwIfAborted();
      const capture:OpenDataCapture={url:page.url,retrievedAt:page.retrievedAt,rawHash:page.sha256,sourceRows:[],sourceCheck:page.sourceCheck};
      captures.push(capture);
      for(const raw of page.rows) {
        const row=normalizeSocrata(raw,page.retrievedAt);domains.add(row.nativeIds.domain);rows++;
        await spool.append(`domain:${row.nativeIds.domain}`,row,capture);
      }
    }
    if(!captures.length||!rows)throw Error("Socrata produced no captured source rows; prior facts remain live.");
    return {spool,domains,captures};
  } catch(error) {await spool.dispose();throw error;}
}

/** Native catalog facts publish before visiting government websites for additional portal links. */
export async function refreshSocrata(input:{
  pages?:AsyncIterable<CatalogPage>;
  preparedCatalog?:PreparedSocrataCatalog;
  states:AsyncIterable<SocrataGovernmentState>;
  signal:AbortSignal;
  writePartition:(partition:Partition)=>Promise<void>;
  saveLeads:(rows:ReturnType<typeof normalizeSocrata>[])=>Promise<void>;
  publish:(reports:OpenDataReport[],capture:OpenDataCapture,captures?:readonly OpenDataCapture[])=>Promise<void>;
  onDiscoveryComplete?:(input:{reports:OpenDataReport[];captures:readonly OpenDataCapture[];observations:readonly Omit<KnownRelease,"bytes">[];
    bindings:readonly PortalBinding[];basis?:OpenDataCapture;complete:boolean})=>Promise<void>;
  sourceWork?:Awaited<ReturnType<typeof socrataDiscoveryProgress>>;
  initialBindings?:readonly PortalBinding[];
  gap:(detail:unknown)=>void;
  discover?:typeof discoverGovernmentPortals;
  stateWebsite?:typeof readStateGovernmentWebsite;
}) {
  const catalog=input.preparedCatalog??(input.pages?await prepareSocrataCatalog(input.pages,input.signal):null);
  if(!catalog)throw Error("Socrata has no source catalog.");
  const spool=catalog.spool,stateRoot=await mkdtemp(join(tmpdir(),"socrata-governments-"));
  const domains=catalog.domains,held:GovernmentJoin[]=[],bindings:PortalBinding[]=[...input.initialBindings??[]],states:string[]=[],observations=new Map<string,Omit<KnownRelease,"bytes">>();
  const freshBindings=new Set<string>(),completedStates=new Set<string>();
  const bindingKey=(row:PortalBinding)=>JSON.stringify([row.domain,row.divisionId]);
  const addBindings=(rows:readonly PortalBinding[])=>{for(const row of rows){
    freshBindings.add(bindingKey(row));const index=bindings.findIndex(prior=>bindingKey(prior)===bindingKey(row));
    if(index<0)bindings.push(row);else bindings[index]=row;
  }};
  let stateObservations=new Map<string,Omit<KnownRelease,"bytes">>();
  let reports:OpenDataReport[]=[],complete=true;
  const gap=(detail:unknown)=>{complete=false;input.gap(detail);};
  const observe=(release:KnownRelease)=>{
    if(release.outage)complete=false;
    const {bytes:_bytes,...metadata}=release;
    // Only scalar source metadata is needed after the normal parser has used these bytes.
    observations.set(JSON.stringify([release.sourceId,release.releaseId]),metadata);
    stateObservations.set(JSON.stringify([release.sourceId,release.releaseId]),metadata);
  };
  const materialize=async()=>{
    const currentReports=new Map<string,OpenDataReport>([...US_JURISDICTIONS.map(state=>state.usps),"UNRESOLVED"]
      .map(state=>[state,{id:`state:${state}`,state,loaded:0,joined:0,unjoined:0}])),divisions=await OpenDataSpool.create();
    try {
      for await(const partition of spool.partitions()) {
        const rows=partition.rows.map(row=>normalizeSocrata(row.sourceRow,row.capturedAt,held,bindings));
        for(const report of openDataReports(rows)) {
          const previous=currentReports.get(report.state);
          currentReports.set(report.state,{...report,loaded:report.loaded+(previous?.loaded??0),joined:report.joined+(previous?.joined??0),unjoined:report.unjoined+(previous?.unjoined??0)});
        }
        await input.writePartition({...partition,rows});
        for(const row of rows)for(const id of row.divisionIds) {
          const source=partition.captures.find(item=>item.sourceRows.includes(row.sourceRow)) ?? partition.captures[0];
          await divisions.append(divisionPartition(id),row,source);
        }
      }
      for await(const partition of divisions.partitions())await input.writePartition(partition);
    } finally {await divisions.dispose();}
    reports=[...currentReports.values()];await input.publish(reports,catalog.captures.at(-1)!,catalog.captures);
    for await(const partition of spool.partitions()) {
      const rows=partition.rows.map(row=>normalizeSocrata(row.sourceRow,row.capturedAt,held,bindings));
      try {await input.saveLeads(rows);}
      catch(error) {gap({partition:partition.partition,reason:error instanceof Error?error.message:String(error),work:"Save catalog source leads"});}
    }
  };
  try {
    // Keep only native join identifiers across states; directory records remain in state files.
    for await(const state of input.states) {
      input.signal.throwIfAborted();
      states.push(state.state);await writeFile(temporaryPath(join(stateRoot,`${state.state}.json`)),JSON.stringify(state));
      held.push(...governmentJoinRows(state.governments));
      if(state.divisionId)held.push({divisionId:state.divisionId,bodyIds:[],nativeIds:{ocd_id:state.divisionId,geoid:state.fips,state_fips:state.fips}});
      for(const government of state.governments)if(government.website) {
        addBindings(portalBindingsFromPage(government,government.website,"",domains));
      }
      const completed=input.sourceWork?.completed(state.state);
      if(completed){completedStates.add(state.state);addBindings(completed.bindings);
        for(const row of completed.observations)observations.set(JSON.stringify([row.sourceId,row.releaseId]),row);}
    }
    await materialize();
    const nativeBindings=bindings.length;
    for(const postal of states) {
      if(input.signal.aborted)break;
      if(completedStates.has(postal))continue;
      stateObservations=new Map();let stateComplete=true;
      const state=JSON.parse(await readFile(join(stateRoot,`${postal}.json`),"utf8")) as SocrataGovernmentState;
      const governments=[...state.governments];
      if(state.divisionId)try {
        const website=await (input.stateWebsite??readStateGovernmentWebsite)(state.state,input.signal,observe,input.sourceWork?.acquire);
        if(website)governments.push({id:`usa-gov:${state.state}`,state:state.state,website,nativeIds:{usa_gov_state:state.state,state_fips:state.fips},bodyIds:[],
          associations:[{divisionId:state.divisionId,layer:"state",geoid:state.fips,basis:"SOURCE_CODE"}]} as unknown as RegistrationGovernmentListing);
      } catch(error) {stateComplete=false;gap({state:state.state,reason:error instanceof Error?error.message:String(error)});}
      const found=await (input.discover??discoverGovernmentPortals)(governments,domains,input.signal,observe,input.sourceWork?.acquire);
      addBindings(found.bindings);
      if(found.gaps.length){stateComplete=false;gap(found.gaps);}
      await input.sourceWork?.saveState({state:postal,bindings:found.bindings,observations:[...stateObservations.values()],
        complete:stateComplete&&!input.signal.aborted&&[...stateObservations.values()].every(row=>!row.outage)});
    }
    if(bindings.length!==nativeBindings)await materialize();
    const finished=complete&&!input.signal.aborted&&bindings.every(row=>freshBindings.has(bindingKey(row)));
    await input.onDiscoveryComplete?.({reports,captures:catalog.captures,observations:[...observations.values()],bindings,basis:input.sourceWork?.basis,complete:finished});
    if(finished)await input.sourceWork?.clear();
  } finally {await spool.dispose();await rm(temporaryPath(stateRoot),{recursive:true,force:true});}
}
