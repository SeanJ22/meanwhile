import type {RoutineDataStore} from "./store.ts";
import {readPromotedCivicData,type PromotedCivicDataReadOptions} from "./read-model.ts";
import type {PlaceCaptureRead} from "./held-place-slices.ts";
import type {RegistryPlanningView} from "./keyed-registry-planning.ts";
import {readRegistryPlaceRows,selectRegistryPlaceView,type RegistryPlaceSlice} from "./keyed-registry-place.ts";
import {currentStateAuthorityProjection} from "./state-reader.ts";
import {stateRegistryRuntimeScope} from "./state-scopes.ts";
import {currentReaderAuthorityEdge,ensurePromotedEdge,refuseDatabaseInEdgeOnlyContext,reportReaderStateFailure} from "../registry/runtime-edge.ts";
import {withStateRegistryFacts} from "../registry/state-composition.ts";
import {readerQuery} from "./promoted-reader-query.ts";

/** Reuse an already served source, otherwise read only the requested divisions' keyed subjects. */
export async function readPlaceRegistry(state:string,divisionIds:readonly string[],options:PromotedCivicDataReadOptions={}):Promise<PlaceCaptureRead<RegistryPlanningView>>{
  const scope=stateRegistryRuntimeScope(state),metadata={recordClass:"REGISTRY_RUNTIME_BINDING" as const,scope};
  const overlay=async(read:PlaceCaptureRead<RegistryPlanningView>)=>{
    if(read.kind!=="PROMOTED"||!read.value)return read;
    const facts=await currentReaderAuthorityEdge()?.stateRegistryFacts?.load(state).catch(error=>{reportReaderStateFailure("state-facts",state,null,error);return null;});
    if(!facts)return read;
    const ids=new Set(read.value.registry.bodies.map(body=>body.id));
    return {...read,value:withStateRegistryFacts(read.value,facts.bodies.filter(body=>ids.has(body.id)))};
  };
  if(!options.store){
    const held=currentStateAuthorityProjection<RegistryPlanningView>("registry-runtime",state)?.result;
    if(held)return overlay({...held,value:held.value?selectRegistryPlaceView(held.value,divisionIds):null});
    const edge=options.edge??(await ensurePromotedEdge("REGISTRY_RUNTIME_BINDING",scope))?.value;
    if(edge){
      const read=await readPromotedCivicData<RegistryPlanningView>("REGISTRY_RUNTIME_BINDING",scope,{...options,edge});
      return overlay({...read,value:read.value?selectRegistryPlaceView(read.value,divisionIds):null});
    }
  }
  const store=options.store as Partial<Pick<RoutineDataStore,"readRegistryPlaceView">>|undefined;
  let slice:RegistryPlaceSlice|null;
  if(store){
    if(!store.readRegistryPlaceView)throw new Error("HELD_PLACE_REGISTRY_KEYED_STORE_UNAVAILABLE");
    slice=await store.readRegistryPlaceView(state,divisionIds);
  }else{
    refuseDatabaseInEdgeOnlyContext(`The ${state} held place registry`);
    const query=readerQuery();
    if(!query)throw new Error("HELD_PLACE_READ_FAILED:REGISTRY_RUNTIME_BINDING:STORE_UNCONFIGURED");
    slice=await readRegistryPlaceRows(async(text,params)=>{const [rows]=await query([{text,params:params??[]}]);return rows;},state,divisionIds);
  }
  return overlay(slice?{kind:"PROMOTED",metadata:{...metadata,versionId:slice.versionId},value:slice.payload}:{kind:"NOT_RECORDED",metadata,value:null});
}
