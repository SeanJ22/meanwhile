import {readStateReference} from '../control-plane/expansion/state-references.ts';
import {loadRegistrationReference} from '../registration/reference.ts';
import {stateOfficesForStates} from '../reference/state-offices.ts';

export interface FreeGovernmentSource {jurisdictionId:string;governmentId?:string;bodyId?:string|null;name:string;state:string;govClass:string;website:string|null;directorySeeds:readonly string[];citation:string;}
const classes:Record<string,string>={STATE:'STATE',COUNTY:'COUNTY',MUNICIPAL:'CITY_OR_TOWN',TOWNSHIP:'CITY_OR_TOWN','SCHOOL DISTRICT':'SCHOOL_DISTRICT','SPECIAL DISTRICT':'SPECIAL_DISTRICT','DEPENDENT SCHOOL SYSTEM':'DEPENDENT_SCHOOL_SYSTEM','COUNTY-EQUIVALENT GOVERNMENT':'COUNTY','COUNTY SUBDIVISION GOVERNMENT':'CITY_OR_TOWN','PLACE GOVERNMENT':'CITY_OR_TOWN'};

/** Retain every registered government, including territory governments absent
 * from Census/NCES source listings. One planning state supplies source addresses;
 * each source worker receives only its government's descriptor. */
export function freeGovernmentSources(root:string,state:string):FreeGovernmentSource[]{
 const registered=loadRegistrationReference(root,state);
 const held=readStateReference(root,state,{facts:true});
 const seeds=stateOfficesForStates([state]).map(office=>office.url);
 const address=(web:string|null|undefined)=>{
  if(!web?.trim())return null;
  try{const url=new URL(/^https?:\/\//i.test(web)?web:'https://'+web);return ['http:','https:'].includes(url.protocol)?url.href:null;}
  catch{return null;}
 };
 const sources=new Map<string,FreeGovernmentSource>();
 for(const [pid,id,name,kind] of registered.reference.governments)sources.set(id,{jurisdictionId:id,name,state:state.toUpperCase(),govClass:classes[kind]??kind,website:address(held.facts[pid]?.web),directorySeeds:seeds,citation:`${registered.generatedAt}; registration reference ${state.toUpperCase()} sha256 ${registered.sha256}`});
 for(const row of registered.listings??[]){
  const id=row.jurisdictionId??row.id;
  sources.set(id,{jurisdictionId:id,governmentId:row.id,bodyId:row.bodyIds.length===1?row.bodyIds[0]:null,
   name:row.name,state:row.state.toUpperCase(),govClass:row.kind==='EDUCATION_AGENCY'?'SCHOOL_DISTRICT':row.kind==='DEPENDENT_SCHOOL_SYSTEM'?'DEPENDENT_SCHOOL_SYSTEM':row.governmentClass,
   website:address(row.govDomains?.[0]?.website??row.website),directorySeeds:seeds,
   citation:`${row.provenance.sourceUrl}; ${row.sourceVintage}; held ${state.toUpperCase()} government source listing`});
 }
 return [...sources.values()];
}
