import { STATE_PEOPLE_JURISDICTIONS } from "./people-identity.ts";
import { PEOPLE_SOURCE_IDS } from "./people-sources.ts";
import { officeIdentity } from "./office-identity.ts";
import { portraitBindingMatches } from "../photos/binding.ts";
import { readPeopleSourceProjection } from "../civic-data/people-source-read.ts";
import { readOpenStatesPeopleProjection, readOfficialStateLegislatorsProjection, readStatePeopleProjection } from "../state-rollcalls/legislators.ts";
import { officialStateLegislatorTargetByScope } from "../state-rollcalls/authority.ts";
import { readFederalDirectoryProjection } from "./federal-directory-read-model.ts";
import { mergePeopleSets } from "./merge-people.ts";
import type { Officeholder, OfficeholderSet } from "./types.ts";
import type { PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { runBoundedWorkPool } from "../ops/bounded-work-pool.ts";

export const personHasPublishedPhoto = (person:Officeholder) => Boolean(person.photo && portraitBindingMatches(person.personId ?? person.id,person.photo));
const isLegislator = (person:Officeholder) => person.level === "STATE" && ["state_senator","state_lower_house"].includes(officeIdentity(person.officeTitle) ?? "");
function statewidePeople(roster:OfficeholderSet):Officeholder[] {
  const rootIds=new Set(roster.divisions.filter(row=>/^ocd-division\/country:us\/(?:state|district|territory):[a-z]{2}$/.test(row.ocdId)).map(row=>row.officeholderId));
  return roster.officeholders.filter(person=>rootIds.has(person.id)&&person.level==="STATE"&&!isLegislator(person));
}
export function summarizePeopleRoster(roster:OfficeholderSet) {
  const statewide=statewidePeople(roster);
  const count=(people:readonly Officeholder[])=>({people:people.length,photos:people.filter(personHasPublishedPhoto).length});
  return {statewideOffices:statewide.map(person=>({personId:person.personId??person.id,name:person.name,office:person.officeTitle,selectionMethod:person.selectionMethod??"UNKNOWN",
    phone:person.phone,website:person.websiteUrl,photo:person.photo?.url??null,source:person.provenance.sourceUrl})),
    photos:{federal:count(roster.officeholders.filter(person=>person.level==="FEDERAL")),governors:count(statewide.filter(person=>officeIdentity(person.officeTitle)==="governor")),
      attorneysGeneral:count(statewide.filter(person=>officeIdentity(person.officeTitle)==="attorney_general")),legislators:count(roster.officeholders.filter(isLegislator)),statewide:count(statewide)},
    disagreements:roster.disagreements??[]};
}
/** Read-only reports use the same source shards and person merge as ZIP/address/map readers. */
export async function collectPeopleCoverage(options:PromotedCivicDataReadOptions={}) {
  const observedAt=options.now??new Date().toISOString(),states:unknown[]=[],issues:{scope:string;detail:string}[]=[];
  const federal=await readFederalDirectoryProjection({...options,now:observedAt,bypassCache:true});
  const federalRoster=federal.kind==="PROMOTED"||federal.kind==="BOOTSTRAP"?federal.value.roster:null;
  if(!federalRoster)issues.push({scope:"US",detail:`Federal directory read ${federal.kind}`});
  const results=await runBoundedWorkPool(STATE_PEOPLE_JURISDICTIONS,4,async jurisdiction=>{
    const sources:{sourceId:string;status:string;people:number|null;legislators:number|null;photos:number|null;disagreements:number|null}[]=[];
    const target=officialStateLegislatorTargetByScope(jurisdiction);
    const reads=await Promise.allSettled([
      readOpenStatesPeopleProjection(jurisdiction,{...options,now:observedAt,bypassCache:true}),
      ...(target?[readOfficialStateLegislatorsProjection(target.jurisdiction,{...options,now:observedAt,bypassCache:true})]:[]),
      ...PEOPLE_SOURCE_IDS.filter(id=>id!=="people-portraits").map(id=>readPeopleSourceProjection(jurisdiction,id,{...options,now:observedAt,bypassCache:true})),
    ]);
    const ids=["plural-openstates",...(target?[target.sourceId]:[]),...PEOPLE_SOURCE_IDS.filter(id=>id!=="people-portraits")];
    reads.forEach((result,index)=>{
      const read=result.status==="fulfilled"?result.value:null,roster=read&&(read.kind==="PROMOTED"||read.kind==="BOOTSTRAP")?read.value.roster:null;
      sources.push({sourceId:ids[index],status:read?.kind??"STORE_UNREACHABLE",people:roster?.officeholders.length??null,
        legislators:roster?roster.officeholders.filter(isLegislator).length:null,photos:roster?roster.officeholders.filter(personHasPublishedPhoto).length:null,
        disagreements:roster?roster.disagreements?.length??0:null});
    });
    const composite=await readStatePeopleProjection(jurisdiction,{...options,now:observedAt,bypassCache:true});
    const held=composite.kind==="PROMOTED"||composite.kind==="BOOTSTRAP"?composite.value.roster:null;
    const federalSlice=federalRoster?{...federalRoster,officeholders:federalRoster.officeholders.filter(person=>person.state===jurisdiction.slice(3)),
      divisions:federalRoster.divisions.filter(link=>federalRoster.officeholders.some(person=>person.id===link.officeholderId&&person.state===jurisdiction.slice(3)))}:null;
    const combined=mergePeopleSets([...(federalSlice?[federalSlice]:[]),...(held?[held]:[])]);
    states.push({state:jurisdiction.slice(3),status:composite.kind,sources,...(combined?summarizePeopleRoster(combined):{statewideOffices:null,photos:null,disagreements:null})});
  });
  for(const result of results)if(!result.ok)issues.push({scope:STATE_PEOPLE_JURISDICTIONS[result.index],detail:"The state could not be read; its counts remain unknown."});
  return {step:"SL-03",observedAt,states:states.sort((a,b)=>(a as {state:string}).state.localeCompare((b as {state:string}).state)),issues};
}
/** A day report compares captured observations; it never invents a future run. */
export function comparePeopleCoverage(before:Awaited<ReturnType<typeof collectPeopleCoverage>>,after:Awaited<ReturnType<typeof collectPeopleCoverage>>) {
  const elapsedMs=Date.parse(after.observedAt)-Date.parse(before.observedAt);
  if(!Number.isFinite(elapsedMs)||elapsedMs<86_400_000)throw Error("SL03_ONE_DAY_OBSERVATION_NOT_YET_HELD");
  return {step:"SL-03",before:before.observedAt,after:after.observedAt,elapsedMs,
    states:after.states.map(value=>{const row=value as {state:string;photos:unknown};return {state:row.state,before:(before.states.find(prior=>(prior as {state:string}).state===row.state) as {photos?:unknown}|undefined)?.photos??null,after:row.photos};})};
}
