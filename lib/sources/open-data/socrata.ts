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

/** Native catalog facts publish before visiting government websites for additional portal links. */
export async function refreshSocrata(input:{
  pages:AsyncIterable<CatalogPage>;
  states:AsyncIterable<SocrataGovernmentState>;
  signal:AbortSignal;
  writePartition:(partition:Partition)=>Promise<void>;
  saveLeads:(rows:ReturnType<typeof normalizeSocrata>[])=>Promise<void>;
  publish:(reports:OpenDataReport[],capture:OpenDataCapture)=>Promise<void>;
  gap:(detail:unknown)=>void;
  discover?:typeof discoverGovernmentPortals;
  stateWebsite?:typeof readStateGovernmentWebsite;
}) {
  const spool=await OpenDataSpool.create(),stateRoot=await mkdtemp(join(tmpdir(),"socrata-governments-"));
  const domains=new Set<string>(),held:GovernmentJoin[]=[],bindings:PortalBinding[]=[],states:string[]=[];
  let capture:OpenDataCapture|undefined;
  const materialize=async()=>{
    const reports=new Map<string,OpenDataReport>([...US_JURISDICTIONS.map(state=>state.usps),"UNRESOLVED"]
      .map(state=>[state,{id:`state:${state}`,state,loaded:0,joined:0,unjoined:0}])),divisions=await OpenDataSpool.create();
    try {
      for await(const partition of spool.partitions()) {
        const rows=partition.rows.map(row=>normalizeSocrata(row.sourceRow,row.capturedAt,held,bindings));
        for(const report of openDataReports(rows)) {
          const previous=reports.get(report.state);
          reports.set(report.state,{...report,loaded:report.loaded+(previous?.loaded??0),joined:report.joined+(previous?.joined??0),unjoined:report.unjoined+(previous?.unjoined??0)});
        }
        await input.writePartition({...partition,rows});
        for(const row of rows)for(const id of row.divisionIds) {
          const source=partition.captures.find(item=>item.sourceRows.includes(row.sourceRow)) ?? partition.captures[0];
          await divisions.append(divisionPartition(id),row,source);
        }
      }
      for await(const partition of divisions.partitions())await input.writePartition(partition);
    } finally {await divisions.dispose();}
    await input.publish([...reports.values()],capture!);
    for await(const partition of spool.partitions()) {
      const rows=partition.rows.map(row=>normalizeSocrata(row.sourceRow,row.capturedAt,held,bindings));
      try {await input.saveLeads(rows);}
      catch(error) {input.gap({partition:partition.partition,reason:error instanceof Error?error.message:String(error),work:"Save catalog source leads"});}
    }
  };
  try {
    for await(const page of input.pages) {
      capture={url:page.url,retrievedAt:page.retrievedAt,rawHash:page.sha256,sourceRows:[],sourceCheck:page.sourceCheck};
      for(const raw of page.rows) {
        const row=normalizeSocrata(raw,page.retrievedAt);domains.add(row.nativeIds.domain);
        await spool.append(`domain:${row.nativeIds.domain}`,row,capture);
      }
    }
    if(!capture)throw Error("Socrata produced no captured publication.");
    // Keep only native join identifiers across states; directory records remain in state files.
    for await(const state of input.states) {
      input.signal.throwIfAborted();
      states.push(state.state);await writeFile(temporaryPath(join(stateRoot,`${state.state}.json`)),JSON.stringify(state));
      held.push(...governmentJoinRows(state.governments));
      if(state.divisionId)held.push({divisionId:state.divisionId,bodyIds:[],nativeIds:{ocd_id:state.divisionId,geoid:state.fips,state_fips:state.fips}});
      for(const government of state.governments)if(government.website) {
        bindings.push(...portalBindingsFromPage(government,government.website,"",domains));
      }
    }
    await materialize();
    const nativeBindings=bindings.length;
    for(const postal of states) {
      if(input.signal.aborted)break;
      const state=JSON.parse(await readFile(join(stateRoot,`${postal}.json`),"utf8")) as SocrataGovernmentState;
      const governments=[...state.governments];
      if(state.divisionId)try {
        const website=await (input.stateWebsite??readStateGovernmentWebsite)(state.state,input.signal);
        if(website)governments.push({id:`usa-gov:${state.state}`,state:state.state,website,nativeIds:{usa_gov_state:state.state,state_fips:state.fips},bodyIds:[],
          associations:[{divisionId:state.divisionId,layer:"state",geoid:state.fips,basis:"SOURCE_CODE"}]} as unknown as RegistrationGovernmentListing);
      } catch(error) {input.gap({state:state.state,reason:error instanceof Error?error.message:String(error)});}
      const found=await (input.discover??discoverGovernmentPortals)(governments,domains,input.signal);
      for(const binding of found.bindings)if(!bindings.some(prior=>prior.domain===binding.domain && prior.divisionId===binding.divisionId))bindings.push(binding);
      if(found.gaps.length)input.gap(found.gaps);
    }
    if(bindings.length!==nativeBindings)await materialize();
  } finally {await spool.dispose();await rm(temporaryPath(stateRoot),{recursive:true,force:true});}
}
