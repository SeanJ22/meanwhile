import type { RoutineDataStore, SlimRoster } from "../../civic-data/store.ts";
import type { NhMemberReadModel } from "../../civic-data/candidate-builders.ts";
import type { RoutineRecordClass } from "../../civic-data/types.ts";
import { PEOPLE_SOURCE_IDS,peopleSourceRecordClass,peopleSourceScope } from "../../officials/people-sources.ts";
import { mergePeopleSets } from "../../officials/merge-people.ts";
import { officialStateLegislatorTargetByScope } from "../../state-rollcalls/authority.ts";
import { nhMembersReadModel } from "../../state-rollcalls/legislators.ts";
import type { OfficeholderSet } from "../../officials/types.ts";
import type { HeldPerson } from "./bills.ts";

async function nhSponsorRoster(store:RoutineDataStore):Promise<OfficeholderSet|null>{
  const head=await store.readSourceHead("STATE_LEGISLATOR","US-NH");
  if(!head||head.sourceId!=="nh-general-court"||head.candidateState!=="PROMOTED"||!head.acquisitionSucceeded||
    head.versionId!==head.lastKnownGoodVersionId||head.proofCoupled!==true)return null;
  const names=["formatVersion","jurisdiction","term","members","identities","memberSourceDates"] as const;
  const fields=await Promise.all(names.map(async name=>[name,await store.readCandidatePath(head.versionId,["readModel",name])]as const));
  const value=Object.fromEntries(fields) as unknown as NhMemberReadModel;
  if(value.formatVersion!==1||value.jurisdiction!=="US-NH"||!Array.isArray(value.members)||!Array.isArray(value.identities)||
    value.members.length!==value.identities.length||value.identities.some(row=>!row.officeholderId.startsWith("nh-general-court:")))
    throw Error("NH member sponsor identity fields differ from their official source");
  const retrievedAt=await store.readCandidatePath<string>(head.versionId,["retrieval","retrievedAt"]);
  return nhMembersReadModel(value,{retrievedAt,sourceThrough:head.sourceThrough??null}).roster;
}

/** Sponsor matching uses the same people merge and source priority, without old source bodies or office books. */
export async function readBillSponsorPeople(store:RoutineDataStore,state:string):Promise<readonly HeldPerson[]>{
  if(state==="US")return[];
  const jurisdiction=`US-${state.toUpperCase()}`,target=officialStateLegislatorTargetByScope(jurisdiction);
  const selected:{recordClass:RoutineRecordClass;scope:string}[]=[{recordClass:"STATE_LEGISLATOR",scope:`${jurisdiction}:openstates-people:v1`},
    ...(target&&target.state!=="NH"?[{recordClass:"STATE_LEGISLATOR" as const,scope:target.jurisdiction}]:[]),
    ...PEOPLE_SOURCE_IDS.map(source=>({recordClass:peopleSourceRecordClass(source),scope:peopleSourceScope(jurisdiction,source)}))];
  const grouped=new Map<RoutineRecordClass,string[]>();
  for(const row of selected)grouped.set(row.recordClass,[...grouped.get(row.recordClass)??[],row.scope]);
  const results=await Promise.allSettled([...grouped].map(([recordClass,scopes])=>store.readSlimRosters(recordClass,scopes)));
  const rosters=new Map<string,SlimRoster>();
  for(const result of results)if(result.status==="fulfilled")for(const row of result.value)rosters.set(row.scope,row);
  const nh=target?.state==="NH"?await nhSponsorRoster(store).catch(()=>null):null;
  const ordered=selected.flatMap((row,index)=>{
    const roster=rosters.get(row.scope)?.roster;
    return[...(roster?[roster]:[]),...(index===0&&nh?[nh]:[])];
  });
  return mergePeopleSets(ordered)?.officeholders??[];
}
