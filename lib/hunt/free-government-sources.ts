import {loadRegistrationReference} from '../registration/reference.ts';
import {readCensusGovernmentFacts} from '../registration/jurisdictions.ts';
import {stateOfficesForStates} from '../reference/state-offices.ts';
import type {JurisdictionClass} from './jurisdiction-universe.ts';
export interface FreeGovernmentSource {jurisdictionId:string;governmentId?:string;bodyId?:string|null;name:string;state:string;govClass:string;website:string|null;directorySeeds:readonly string[];citation:string;}
const classes:Record<string,JurisdictionClass>={STATE:'STATE',COUNTY:'COUNTY',MUNICIPAL:'CITY_OR_TOWN',TOWNSHIP:'CITY_OR_TOWN','SCHOOL DISTRICT':'SCHOOL_DISTRICT','SPECIAL DISTRICT':'SPECIAL_DISTRICT','DEPENDENT SCHOOL SYSTEM':'DEPENDENT_SCHOOL_SYSTEM','COUNTY-EQUIVALENT GOVERNMENT':'COUNTY','COUNTY SUBDIVISION GOVERNMENT':'CITY_OR_TOWN','PLACE GOVERNMENT':'CITY_OR_TOWN'};
/** Background source addresses come from the held national enumeration, one
 * planning state at a time. They create free source reads, never paid focus. */
export function freeGovernmentSources(root:string,state:string):FreeGovernmentSource[]{
 const loaded=loadRegistrationReference(root,state),{reference,sha256}=loaded,facts=readCensusGovernmentFacts(root,[state]);
 const seeds=stateOfficesForStates([state]).map(office=>office.url);
 const address=(web:string|null|undefined)=>{if(!web?.trim())return null;try{const url=new URL(/^https?:\/\//i.test(web)?web:'https://'+web);return ['http:','https:'].includes(url.protocol)?url.href:null;}catch{return null;}};
 if(loaded.listings?.length)return loaded.listings.map(row=>({jurisdictionId:row.jurisdictionId??row.id,governmentId:row.id,bodyId:row.bodyIds.length===1?row.bodyIds[0]:null,
  name:row.name,state:row.state.toUpperCase(),govClass:row.governmentClass,website:address(row.govDomains?.[0]?.website??row.website),directorySeeds:seeds,
  citation:`${row.provenance.sourceUrl}; ${row.sourceVintage}; registration reference sha256 ${sha256}`}));
 return reference.governments.flatMap(([pid,id,name,kind])=>{
  const govClass=classes[kind];if(!govClass)return [];
  const web=facts.byPid.get(pid)?.web.trim();
  let website:string|null=null;
  if(web){try{const address=new URL(/^https?:\/\//i.test(web)?web:'https://'+web);if(['http:','https:'].includes(address.protocol))website=address.href;}catch{/* An invalid published address stays a blank. */}}
  return [{jurisdictionId:id,name,state:state.toUpperCase(),govClass,website,directorySeeds:seeds,citation:`${facts.source}; registration reference ${state.toUpperCase()} sha256 ${sha256}`}];
 });
}
