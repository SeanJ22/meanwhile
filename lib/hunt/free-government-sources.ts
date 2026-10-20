import {readStateReference} from '../control-plane/expansion/state-references.ts';
import {stateOfficesForStates} from '../reference/state-offices.ts';

export interface FreeGovernmentSource {jurisdictionId:string;governmentId?:string;bodyId?:string|null;name:string;state:string;govClass:string;website:string|null;directorySeeds:readonly string[];citation:string;}

/** The same seekable state holding used by CP's planner supplies source
 * addresses. Planning loads one state; source workers receive one government. */
export function freeGovernmentSources(root:string,state:string):FreeGovernmentSource[]{
 const held=readStateReference(root,state,{listings:true});
 if(!held.listings?.length)throw new Error(`PLACE_REFERENCE_LISTINGS_MISSING:${state.toUpperCase()}`);
 const seeds=stateOfficesForStates([state]).map(office=>office.url);
 const address=(web:string|null|undefined)=>{
  if(!web?.trim())return null;
  try{const url=new URL(/^https?:\/\//i.test(web)?web:'https://'+web);return ['http:','https:'].includes(url.protocol)?url.href:null;}
  catch{return null;}
 };
 return held.listings.map(row=>({jurisdictionId:row.jurisdictionId??row.id,governmentId:row.id,bodyId:row.bodyIds.length===1?row.bodyIds[0]:null,
  name:row.name,state:row.state.toUpperCase(),govClass:row.governmentClass,website:address(row.govDomains?.[0]?.website??row.website),directorySeeds:seeds,
  citation:`${row.provenance.sourceUrl}; ${row.sourceVintage}; held ${state.toUpperCase()} government source listing`}));
}
