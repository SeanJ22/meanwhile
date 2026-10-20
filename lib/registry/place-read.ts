import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import { readPublishedArraySlice,type PublishedArraySlice } from "../civic-data/published-array-slice.ts";
import type { PlaceCaptureRead } from "../civic-data/held-place-slices.ts";
import type { PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { PostgresRoutineDataStore } from "../civic-data/store.ts";
import { requireRegistryState,registryJurisdictions,stateRegistryRuntimeScope } from "../civic-data/state-scopes.ts";
import { readRegistryRuntimeProjection } from "./runtime-read-model.ts";
import type { RegistryRuntimeReadModel } from "./runtime-data-plane.ts";
import type { Body,Division } from "./types.ts";
import type { BodyRoster } from "./body-rosters.ts";

const escaped=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
const exact=(ids:readonly string[])=>ids.length?`^(?:${ids.map(escaped).join("|")})$`:"(?!)";
const arrayMember=(ids:readonly string[])=>ids.length?`"(?:${ids.map(escaped).join("|")})"`:"(?!)";

/** Audit authority needs one registered body, never its state's rosters or neighboring bodies. */
export async function readRegistryBodyProjection(state: string, bodyId: string, query?: ReadOnlyQuery | null): Promise<PublishedArraySlice<Body> | null> {
  return readPublishedArraySlice<Body>({ recordClass: "REGISTRY_RUNTIME_BINDING", scope: stateRegistryRuntimeScope(requireRegistryState(state)),
    path: ["registry", "bodies"], statePath: ["id"], statePattern: exact([bodyId]), query });
}

function selected(read:PlaceCaptureRead<RegistryRuntimeReadModel>,ids:ReadonlySet<string>):PlaceCaptureRead<RegistryRuntimeReadModel>{
  if(read.kind!=="PROMOTED"||!read.value)return read;
  const value=read.value,bodies=value.registry.bodies.filter(body=>[body.ocdId,...body.alsoServesOcdIds??[]].some(id=>id!==null&&ids.has(id)));
  const bodyIds=new Set(bodies.map(body=>body.id));
  return {...read,value:{...value,registry:{...value.registry,bodies,divisions:value.registry.divisions.filter(row=>ids.has(row.ocdId))},
    bodyRosters:value.bodyRosters.filter(roster=>bodyIds.has(roster.bodyId)),rosterReaderDispositions:[],
    statewideExecutives:value.statewideExecutives.filter(row=>ids.has(row.stateOcdId)),
    officialCandidacies:{...value.officialCandidacies,rows:value.officialCandidacies.rows.filter(row=>row.holder.divisions.some(id=>ids.has(id)))},
    officialPhotos:{photos:[]},rosterPhotos:{}}};
}

/** A place view carries the original GOOD version identity, never authority to publish a partial state payload. */
export async function readRegistryPlaceProjection(state:string,divisionIds:readonly string[],options:PromotedCivicDataReadOptions={},query?:ReadOnlyQuery|null):Promise<PlaceCaptureRead<RegistryRuntimeReadModel>>{
  state=requireRegistryState(state);
  if(divisionIds.some(id=>registryJurisdictions(id).some(own=>own!==state)))throw new Error(`REGISTRY_PLACE_STATE_MISMATCH:${state}`);
  const ids=[...new Set(divisionIds)],scope=stateRegistryRuntimeScope(state),metadata={recordClass:"REGISTRY_RUNTIME_BINDING"as const,scope};
  if(query===undefined&&options.store&&!(options.store instanceof PostgresRoutineDataStore))return selected(await readRegistryRuntimeProjection([state],options),new Set(ids));
  const read=<T>(path:readonly string[],statePath:readonly string[]=[],statePattern=".*",extra:{objectRecord?:boolean;omitKeys?:readonly string[];selectors?:readonly{path:readonly string[];pattern:string}[]}={})=>
    readPublishedArraySlice<T>({recordClass:"REGISTRY_RUNTIME_BINDING",scope,path,statePath,statePattern,...extra,query});
  const [header,registry,divisions,bodies,executives,candidacy,bridge]=await Promise.all([
    read<{formatVersion:1}>([],[],".*",{objectRecord:true,omitKeys:["registry","bodyRosters","rosterReaderDispositions","statewideExecutives","officialCandidacies","officialPhotos","rosterPhotos"]}),
    read<{generatedAt:string}>(["registry"],[],".*",{objectRecord:true,omitKeys:["divisions","bodies"]}),
    read<Division>(["registry","divisions"],["ocdId"],exact(ids)),
    read<Body>(["registry","bodies"],[],"",{selectors:[{path:["ocdId"],pattern:exact(ids)},{path:["alsoServesOcdIds"],pattern:arrayMember(ids)}]}),
    read<RegistryRuntimeReadModel["statewideExecutives"][number]>(["statewideExecutives"],["stateOcdId"],exact(ids)),
    read<Omit<RegistryRuntimeReadModel["officialCandidacies"],"rows">>(["officialCandidacies"],[],".*",{objectRecord:true,omitKeys:["rows"]}),
    read<RegistryRuntimeReadModel["officialCandidacies"]["rows"][number]>(["officialCandidacies","rows"],["holder","divisions"],arrayMember(ids)),
  ]);
  if(!header){if([registry,divisions,bodies,executives,candidacy,bridge].some(Boolean))throw new Error("REGISTRY_PLACE_POINTER_CHANGED");return{kind:"NOT_RECORDED",value:null,metadata};}
  const version=header.input.versionId;
  const checked=<T>(slice:PublishedArraySlice<T>|null):readonly T[]=>{
    if(!slice||slice.input.versionId!==version||slice.input.readModelSha256!==header.input.readModelSha256)throw new Error("REGISTRY_PLACE_POINTER_CHANGED");
    return slice.records;
  };
  const registryHeader=checked(registry)[0],bridgeHeader=checked(candidacy)[0],root=header.records[0];
  if(!root||root.formatVersion!==1||!registryHeader||!bridgeHeader)throw new Error("REGISTRY_PLACE_HEADER_INVALID");
  const bodyRows=checked(bodies),bodyIds=bodyRows.map(body=>body.id);
  const rosters=bodyIds.length?checked(await read<BodyRoster>(["bodyRosters"],["bodyId"],exact(bodyIds))):[];
  return{kind:"PROMOTED",metadata:{...metadata,versionId:version},value:{formatVersion:1,
    registry:{...registryHeader,divisions:[...checked(divisions)],bodies:[...bodyRows]},bodyRosters:[...rosters],rosterReaderDispositions:[],
    statewideExecutives:checked(executives),officialCandidacies:{...bridgeHeader,rows:checked(bridge)},officialPhotos:{photos:[]},rosterPhotos:{}}};
}
