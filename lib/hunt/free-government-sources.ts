import {readStateReference} from '../control-plane/expansion/state-references.ts';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {RegistrationReference} from '../registration/reference.ts';
import {referenceGovernmentListings} from '../registration/listings.ts';
import {stateOfficesForStates} from '../reference/state-offices.ts';

export interface FreeGovernmentSource {jurisdictionId:string;governmentId?:string;bodyId?:string|null;name:string;state:string;govClass:string;website:string|null;directorySeeds:readonly string[];citation:string;}
const classes:Record<string,string>={STATE:'STATE',COUNTY:'COUNTY',MUNICIPAL:'CITY_OR_TOWN',TOWNSHIP:'CITY_OR_TOWN','SCHOOL DISTRICT':'SCHOOL_DISTRICT','SPECIAL DISTRICT':'SPECIAL_DISTRICT','DEPENDENT SCHOOL SYSTEM':'DEPENDENT_SCHOOL_SYSTEM','COUNTY-EQUIVALENT GOVERNMENT':'COUNTY','COUNTY SUBDIVISION GOVERNMENT':'CITY_OR_TOWN','PLACE GOVERNMENT':'CITY_OR_TOWN'};

/** Retain every registered government, including territory governments absent
 * from Census/NCES source listings. One planning state supplies source addresses;
 * each source worker receives only its government's descriptor. */
export function freeGovernmentSources(root:string,state:string):FreeGovernmentSource[]{
 const text=readFileSync(join(root,'data','derived','registration',`${state.toLowerCase()}.json`),'utf8');
 const reference=JSON.parse(text) as RegistrationReference;
 if(reference.formatVersion!==1 || reference.state!==state.toLowerCase())throw new Error(`REGISTRATION_REFERENCE_INVALID:${state}`);
 const index=JSON.parse(readFileSync(join(root,'data','derived','registration','index.json'),'utf8')) as {generatedAt:string;states:Record<string,{sha256:string;generatedAt?:string}>};
 const sha256=createHash('sha256').update(text).digest('hex'),entry=index.states[state.toLowerCase()];
 if(entry?.sha256!==sha256)throw new Error(`REGISTRATION_REFERENCE_DRIFT:${state}`);
 const held=readStateReference(root,state,{facts:true,listings:true});
 const registered={reference,sha256,generatedAt:entry.generatedAt??index.generatedAt,listings:held.listings};
 const seeds=stateOfficesForStates([state]).map(office=>office.url);
 const address=(web:string|null|undefined)=>{
  if(!web?.trim())return null;
  try{const url=new URL(/^https?:\/\//i.test(web)?web:'https://'+web);return ['http:','https:'].includes(url.protocol)?url.href:null;}
  catch{return null;}
 };
 const sources=new Map<string,FreeGovernmentSource>();
 for(const [pid,id,name,kind] of registered.reference.governments)if(kind==='STATE')sources.set(id,{jurisdictionId:id,name,state:state.toUpperCase(),govClass:classes[kind]??kind,website:address(held.facts[pid]?.web),directorySeeds:seeds,citation:`${registered.generatedAt}; registration reference ${state.toUpperCase()} sha256 ${registered.sha256}`});
 for(const row of referenceGovernmentListings(registered)){
  const id=row.jurisdictionId??row.id;
  sources.set(id,{jurisdictionId:id,governmentId:row.id,bodyId:row.bodyIds.length===1?row.bodyIds[0]:null,
   name:row.name,state:row.state.toUpperCase(),govClass:row.kind==='EDUCATION_AGENCY'?'SCHOOL_DISTRICT':row.kind==='DEPENDENT_SCHOOL_SYSTEM'?'DEPENDENT_SCHOOL_SYSTEM':row.governmentClass,
   website:address(row.govDomains?.[0]?.website??row.website??held.facts[row.nativeIds.census_pid6]?.web),directorySeeds:seeds,
   citation:`${row.provenance.sourceUrl}; ${row.sourceVintage}; held ${state.toUpperCase()} government source listing`});
 }
 return [...sources.values()];
}
