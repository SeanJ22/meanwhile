import { personIdentityKeys } from "../../officials/people-identity.ts";
import { US_JURISDICTIONS } from "../../coverage/states.ts";
import type { Provenance } from "../types.ts";
import { isOfficialSource } from "../../civic-data/source-authority.ts";
import { legiscanIdentityJoins,type LegiscanIdentityHolder } from "./dataset.ts";
import { LEGISCAN_BULK_PARSER,billScope } from "./current-sessions.ts";
export { LEGISCAN_BULK_SCOPE,LEGISCAN_BULK_PARSER,LEGISCAN_SPONSOR_MATCH,billScope } from "./current-sessions.ts";

export const LEGISCAN_BULK_CONTRACT = "legiscan-bulk";
export const LEGISCAN_API = "https://api.legiscan.com/";
/** LegiScan state_id is its own identifier space, never Census FIPS. */
const LEGISCAN_STATES = "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC US".split(" ");
/** Inverse of the publisher's own state identifier space, including DC and US. */
export function legiscanStateId(state:string):number|null {
  const index=LEGISCAN_STATES.indexOf(state.toUpperCase());return index<0?null:index+1;
}
export interface Dataset {
  state_id: number; session_id: number; session_name: string; dataset_hash: string; dataset_date: string;
  access_key?: string;
  year_start?: number; year_end?: number; special?: number; prefile?: number;
}
export type HeldPerson = LegiscanIdentityHolder;
interface BillSponsor {
  peopleId: number; name: string; committee: boolean; nativeIds: Record<string,string[]>;
  officeholderId: string | null; joinReason: string | null;
  state?: string; chamber?: string | null; district?: string | null; fullName?: string;
}
export interface Bill {
  id: string; billId: number; state: string; sessionId: number; sessionName: string; ocdId: string; fips: string | null;
  number: string; title: string; description: string; status: number; statusLabel: string; statusDate: string | null;
  sourceUrl: string; governmentUrl: string | null; governmentSourceOfficial: boolean;
  sponsors: BillSponsor[];
  texts: {id:number;date:string|null;type:string;url:string;governmentUrl:string|null;governmentSourceOfficial:boolean}[];
  facts: Record<string,Provenance & {publishedAt:string}>;
}
/** Public facts and repeated sponsors are restored only after the complete part's canonical proof. */
export type StoredBill=Omit<Bill,"facts"|"sponsors"> & {sponsorRefs:number[]};
export interface BillPart {
  kind: "PART"; parserVersion:typeof LEGISCAN_BULK_PARSER; sourceRawHash?:string; dataset: Dataset; state: string; capturedAt: string; bills: StoredBill[]; sponsors:BillSponsor[];
  counts: {rows:number;joined:number;unjoined:number;sponsorsJoined:number;sponsorsUnjoined:number};
}
export interface BillPartPointer { scope:string; versionId:string; rawHash:string; rows:number; }
export interface BillSession {
  kind:"SESSION";parserVersion:typeof LEGISCAN_BULK_PARSER;dataset:Dataset;state:string;capturedAt:string;parts:BillPartPointer[];counts:BillPart["counts"];
  sponsorMatchVersion?: string;
  /** Parts retain their own source edition; this manifest proves their exact native members in this archive. */
  sourceMemberFormat?:2;
}
export interface BillIndex { kind:"INDEX";parserVersion?:typeof LEGISCAN_BULK_PARSER|"legiscan-bulk/2"; capturedAt:string; datasets:Dataset[]; }
export const billPartScope = (dataset:Dataset,index:number,evidenceHash:string) => `${billScope(dataset.session_id)}:${dataset.dataset_hash}:part:${index}:${evidenceHash}`;
export const stateOfDataset = (row:Dataset):string => {
  const state=LEGISCAN_STATES[row.state_id-1];
  if (!state) throw Error(`LEGISCAN_UNKNOWN_STATE_ID:${row.state_id}`);
  return state;
};
const object = (value:unknown):Record<string,unknown> => {
  if (!value || typeof value!=="object" || Array.isArray(value)) throw Error("LEGISCAN_OBJECT_REQUIRED");
  return value as Record<string,unknown>;
};
const positive = (value:unknown):number => {
  const n=Number(value); if (!Number.isSafeInteger(n)||n<=0) throw Error("LEGISCAN_NATIVE_ID_REQUIRED"); return n;
};
const text = (value:unknown):string => {if(typeof value!=="string"||!value.trim()) throw Error("LEGISCAN_TEXT_REQUIRED"); return value;};
const date = (value:unknown):string|null => {
  if (value===null || value===undefined || value==="" || value==="0000-00-00") return null;
  const result=text(value); if(!/^\d{4}-\d{2}-\d{2}$/.test(result)||!Number.isFinite(Date.parse(result))) throw Error("LEGISCAN_DATE_INVALID"); return result;
};
const url = (value:unknown):string|null => {
  if(value===null||value===undefined||value==="") return null;
  const result=text(value), parsed=new URL(result); if(!["http:","https:"].includes(parsed.protocol)) throw Error("LEGISCAN_URL_INVALID"); return result;
};
function publicDatasets(values:readonly unknown[]):Dataset[] {
  const rows=values.map(value=>{
    const row=object(value);
    const result={state_id:positive(row.state_id),session_id:positive(row.session_id),session_name:text(row.session_name),
      dataset_hash:text(row.dataset_hash),dataset_date:date(row.dataset_date)!,
      ...(row.year_start!==undefined?{year_start:positive(row.year_start),year_end:positive(row.year_end)}:{}),
      ...(row.special!==undefined?{special:Number(row.special)}:{}),...(row.prefile!==undefined?{prefile:Number(row.prefile)}:{})};
    if(!result.dataset_date) throw Error("LEGISCAN_DATASET_DATE_REQUIRED");
    if(result.year_start!==undefined&&result.year_end!<result.year_start||result.special!==undefined&&![0,1].includes(result.special)||result.prefile!==undefined&&![0,1].includes(result.prefile))throw Error("LEGISCAN_SESSION_YEARS_INVALID");
    stateOfDataset(result); return result;
  });
  if(new Set(rows.map(row=>row.session_id)).size!==rows.length) throw Error("LEGISCAN_DUPLICATE_SESSION");
  return rows;
}
export function parseDatasetList(value:unknown):Dataset[] {
  const response=object(value);
  if(response.status!=="OK"||!Array.isArray(response.datasetlist)||!response.datasetlist.length) throw Error("LEGISCAN_DATASET_LIST_INVALID");
  const datasetlist=response.datasetlist;
  return publicDatasets(datasetlist).map((row,index)=>({...row,access_key:text(object(datasetlist[index]).access_key)}));
}
/** The public catalogue schema is shared by published v2 and v4 indexes; bill parts are not. */
export function publicDatasetIndex(value:unknown):BillIndex {
  const index=object(value);
  if(index.kind!=="INDEX"||![undefined,"legiscan-bulk/2",LEGISCAN_BULK_PARSER].includes(index.parserVersion as string|undefined)||
    typeof index.capturedAt!=="string"||!Number.isFinite(Date.parse(index.capturedAt))||!Array.isArray(index.datasets)||!index.datasets.length)throw Error("LEGISCAN_DATASET_INDEX_INVALID");
  const datasets=publicDatasets(index.datasets);
  return {kind:"INDEX",...(index.parserVersion?{parserVersion:index.parserVersion as BillIndex["parserVersion"]}:{}),capturedAt:index.capturedAt,datasets};
}
type PersonJoinIndex={native:ReadonlyMap<string,ReadonlySet<string>>;seats:ReadonlyMap<string,readonly HeldPerson[]>};
function personJoinIndex(people:readonly HeldPerson[]):PersonJoinIndex {
  const index=new Map<string,Set<string>>(),seats=new Map<string,HeldPerson[]>();
  for(const person of people) for(const key of personIdentityKeys(person)) {
    const ids=index.get(key)??new Set<string>();ids.add(person.id);index.set(key,ids);
  }
  for(const person of people)for(const row of person.memberships??[]){
    if(row.current===false||!row.district||!person.state)continue;
    const key=`${person.state.toUpperCase()}:${row.chamber??person.chamber}:${districtKey(row.district)}`,holders=seats.get(key)??[];
    if(!holders.some(row=>row.id===person.id))holders.push(person);seats.set(key,holders);
  }
  return {native:index,seats};
}
const normalizedName=(value:string)=>value.normalize("NFKD").replace(/\p{M}/gu,"").toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();
const districtKey=(value:string)=>normalizedName(value).replace(/^(?:sd|hd|ad|wd|district|ward)\s*/,"").replace(/\bat large\b/g,"al").replace(/\b0+(?=\d)/g,"");
function sameName(left:string,right:string):boolean {
  const a=normalizedName(left).split(" "),b=normalizedName(right).split(" ");
  if(a.join(" ")===b.join(" "))return true;
  // The source often omits a middle name in `name` but supplies it in its components.
  return a.length>=2&&b.length>=2&&a[0]===b[0]&&a.at(-1)===b.at(-1)&&(a.length===2||b.length===2);
}
function matchesNameAndDistrict(sponsor:BillSponsor,person:HeldPerson):boolean {
  if(!sponsor.state||!sponsor.chamber||!sponsor.district||!person.name||person.level&&person.level!=="STATE"||person.state?.toUpperCase()!==sponsor.state)return false;
  if(!sameName(sponsor.fullName??sponsor.name,person.name)&&!sameName(sponsor.name,person.name))return false;
  // A held LegiScan ID is authoritative, including when it disagrees with a name.
  const native=[...personIdentityKeys(person)].filter(key=>key.startsWith("legiscan:"));
  if(native.length&&!native.includes(`legiscan:${sponsor.peopleId}`))return false;
  return (person.memberships??[]).some(row=>row.current!==false&&(row.chamber??person.chamber)===sponsor.chamber&&row.district&&districtKey(row.district)===districtKey(sponsor.district!));
}
function joinSponsorWithIndex(sponsor:BillSponsor, index:PersonJoinIndex):BillSponsor {
  if(sponsor.committee) return {...sponsor,officeholderId:null,joinReason:"Committee sponsor"};
  if(sponsor.joinReason?.startsWith("Ambiguous"))return {...sponsor,officeholderId:null};
  const native=[...(index.native.get(`legiscan:${sponsor.peopleId}`)??[])];
  if(native.length)return {...sponsor,officeholderId:native.length===1?native[0]:null,joinReason:native.length===1?null:"Ambiguous source identifiers"};
  const keys=new Set(Object.entries(sponsor.nativeIds).flatMap(([source,ids])=>ids.map(id=>`${source}:${id}`)));
  const ids=[...new Set([...keys].flatMap(key=>[...(index.native.get(key)??[])]))];
  if(ids.length)return {...sponsor,officeholderId:ids.length===1?ids[0]:null,joinReason:ids.length===1?null:"Ambiguous source identifiers"};
  const seat=`${sponsor.state}:${sponsor.chamber}:${districtKey(sponsor.district??"")}`;
  const matches=(index.seats.get(seat)??[]).filter(person=>matchesNameAndDistrict(sponsor,person));
  return {...sponsor,officeholderId:matches.length===1?matches[0].id:null,joinReason:matches.length===1?null:matches.length?"Ambiguous name and district":"No held source identifier or name and district"};
}
/** Publisher ID first, then other exact IDs, then the source name and legislative seat. */
export function joinSponsors(people:readonly HeldPerson[]):(sponsor:BillSponsor)=>BillSponsor {
  const index=personJoinIndex(people);return sponsor=>joinSponsorWithIndex(sponsor,index);
}
function billFacts(bill:Pick<Bill,"sourceUrl"|"texts">,datasetDate:string,capturedAt:string):Bill["facts"] {
  const provenance=(publishedAt:string):Provenance & {publishedAt:string}=>({sourceUrl:bill.sourceUrl,sourceOrg:"LegiScan",kind:"REFERENCE",secondHand:true,collectedAt:capturedAt,verifiedAt:capturedAt,publishedAt});
  return {id:provenance(datasetDate),number:provenance(datasetDate),session:provenance(datasetDate),jurisdiction:provenance(datasetDate),governmentLink:provenance(datasetDate),
    title:provenance(datasetDate),description:provenance(datasetDate),status:provenance(datasetDate),sponsors:provenance(datasetDate),
    ...Object.fromEntries(bill.texts.map(row=>[`text:${row.id}`,{...provenance(row.date??datasetDate),sourceUrl:row.url}]))};
}
export function hydrateBillPart(part:BillPart,person?:HeldPerson):Bill[] {
  if(!Array.isArray(part.sponsors))throw Error("LEGISCAN_SPONSOR_DICTIONARY_MISSING");
  const join=person?joinSponsors([person]):null;
  const matched=join?new Set(part.sponsors.flatMap((sponsor,index)=>join(sponsor).officeholderId===person!.id?[index]:[])):null;
  return part.bills.flatMap(row=>{
    const {sponsorRefs,...bill}=row;
    if(!Array.isArray(sponsorRefs))throw Error("LEGISCAN_SPONSOR_REFERENCES_MISSING");
    if(sponsorRefs.some(index=>!Number.isSafeInteger(index)||index<0||index>=part.sponsors.length))throw Error("LEGISCAN_SPONSOR_REFERENCE_INVALID");
    if(matched&&!sponsorRefs.some(index=>matched.has(index)))return [];
    return [{...bill,sponsors:sponsorRefs.map(index=>part.sponsors[index]),facts:billFacts(bill,part.dataset.dataset_date,part.capturedAt)}];
  });
}
function sponsorSeat(row:Record<string,unknown>,state:string){
  const chamber=state==="DC"||state==="NE"?"legislature":Number(row.role_id)===2?"upper":Number(row.role_id)===1?"lower":null;
  const fullName=[row.first_name,row.middle_name,row.last_name,row.suffix].filter(value=>typeof value==="string"&&value.trim()).join(" ");
  return {state,chamber,fullName:fullName||text(row.name),district:typeof row.district==="string"&&row.district.trim()?row.district:null};
}
function normalizeBill(value:unknown, dataset:Dataset, people:PersonJoinIndex,identityJoins:ReadonlyMap<number,string>,ambiguous:ReadonlyMap<number,string>):Omit<Bill,"facts"> {
  const raw=object(object(value).bill), state=stateOfDataset(dataset);
  if(raw.state!==state||positive(raw.state_id)!==dataset.state_id||positive(raw.session_id)!==dataset.session_id) throw Error("LEGISCAN_BILL_SCOPE_MISMATCH");
  const billId=positive(raw.bill_id), sourceUrl=url(raw.url)!;
  if(!sourceUrl||new URL(sourceUrl).hostname!=="legiscan.com") throw Error("LEGISCAN_BILL_SOURCE_INVALID");
  const status=Number(raw.status);
  if(!Number.isSafeInteger(status)||status<0) throw Error("LEGISCAN_STATUS_INVALID");
  if(!Array.isArray(raw.sponsors)||!Array.isArray(raw.texts)) throw Error("LEGISCAN_BILL_ARRAY_REQUIRED");
  const sourceSponsors=raw.sponsors.map(object);
  const sponsors=sourceSponsors.map(row=>{
    const peopleId=positive(row.people_id);
    const nativeIds:Record<string,string[]>={legiscan:[String(peopleId)]};
    const personId=identityJoins.get(peopleId);
    if(personId) nativeIds["ocd-person"]=[personId];
    for(const [field,source] of [["bioguide_id","congress"],["openstates_id","openstates"],["votesmart_id","votesmart"]]) {
      const id=row[field]; if((typeof id==="string"||typeof id==="number")&&String(id)!=="0"&&String(id)) nativeIds[source]=[String(id)];
    }
    return joinSponsorWithIndex({peopleId,name:text(row.name),...sponsorSeat(row,state),committee:Number(row.committee_sponsor)===1,nativeIds,officeholderId:null,
      joinReason:ambiguous.get(peopleId)??null},people);
  });
  const texts=raw.texts.map(value=>{
    const row=object(value), governmentUrl=url(row.state_link), link=url(row.url);
    if(!link) throw Error("LEGISCAN_TEXT_LINK_REQUIRED");
    return {id:positive(row.doc_id),date:date(row.date),type:text(row.type),url:link,governmentUrl,governmentSourceOfficial:Boolean(governmentUrl&&isOfficialSource(governmentUrl))};
  });
  const statusDate=date(raw.status_date), governmentUrl=url(raw.state_link);
  const jurisdiction=US_JURISDICTIONS.find(row=>row.usps===state),fips=jurisdiction?.fips??null;
  return {id:`legiscan:bill:${billId}`,billId,state,sessionId:dataset.session_id,sessionName:dataset.session_name,
    ocdId:state==="US"?"ocd-division/country:us":`ocd-division/country:us/${jurisdiction!.prefix}:${jurisdiction!.slug}`,fips,
    number:text(raw.bill_number),title:text(raw.title),description:typeof raw.description==="string"?raw.description:"",
    status,statusLabel:["Not available","Introduced","Engrossed","Enrolled","Passed","Vetoed","Failed"][status] ?? `Status ${status}`,
    statusDate,sourceUrl,governmentUrl,governmentSourceOfficial:Boolean(governmentUrl&&isOfficialSource(governmentUrl)),sponsors,texts};
}
export function sessionSponsorEvidence(bodies:readonly string[]):Record<string,unknown>[] {
  const uniqueSourceSponsors=new Map<string,Record<string,unknown>>();
  for(const body of bodies) {
    const raw=object(object(JSON.parse(body)).bill);
    if(!Array.isArray(raw.sponsors)) throw Error("LEGISCAN_BILL_ARRAY_REQUIRED");
    for(const sponsor of raw.sponsors) {
      const row=object(sponsor);
      const bio=row.bio&&typeof row.bio==="object"?row.bio as Record<string,unknown>:{};
      const identity={people_id:row.people_id,bio:{social:bio.social,links:bio.links},ballotpedia:row.ballotpedia,votesmart_id:row.votesmart_id,
        name:row.name,first_name:row.first_name,middle_name:row.middle_name,last_name:row.last_name,suffix:row.suffix,
        district:row.district,role_id:row.role_id,state_id:row.state_id,committee_sponsor:row.committee_sponsor};
      uniqueSourceSponsors.set(JSON.stringify(identity),identity);
    }
  }
  return JSON.parse(JSON.stringify([...uniqueSourceSponsors.values()])) as Record<string,unknown>[];
}
export function normalizeSession(dataset:Dataset,bodies:readonly string[],capturedAt:string,people:readonly HeldPerson[]=[],sessionSponsors?:readonly Record<string,unknown>[]):BillPart {
  const values=bodies.map(body=>JSON.parse(body) as unknown);
  const evidence=sessionSponsors??sessionSponsorEvidence(bodies);
  const identityJoins=new Map(legiscanIdentityJoins(people,evidence).map(row=>[row.legiscanPeopleId,row.personId]));
  const nativeJoins=personJoinIndex(people);
  const matches=new Map<number,Set<string>>(),ambiguous=new Map<number,string>();
  for(const row of evidence){
    // Older saved profile-only evidence has no name/seat and supplies no fallback.
    if(typeof row.name!=="string")continue;
    const peopleId=positive(row.people_id),personId=identityJoins.get(peopleId);
    const joined=joinSponsorWithIndex({peopleId,name:row.name,...sponsorSeat(row,stateOfDataset(dataset)),committee:Number(row.committee_sponsor)===1,
      nativeIds:{legiscan:[String(peopleId)],...(personId?{"ocd-person":[personId]}:{})},officeholderId:null,joinReason:null},nativeJoins);
    if(joined.joinReason?.startsWith("Ambiguous"))ambiguous.set(peopleId,joined.joinReason);
    if(joined.officeholderId){const ids=matches.get(peopleId)??new Set<string>();ids.add(joined.officeholderId);matches.set(peopleId,ids);if(ids.size>1)ambiguous.set(peopleId,"Ambiguous name and district");}
  }
  const bills=values.map(value=>normalizeBill(value,dataset,nativeJoins,identityJoins,ambiguous));
  if(new Set(bills.map(row=>row.id)).size!==bills.length) throw Error("LEGISCAN_DUPLICATE_BILL");
  const joined=bills.filter(row=>row.sponsors.some(sponsor=>sponsor.officeholderId)).length;
  const sourceSponsors=bills.flatMap(row=>row.sponsors),sponsors:BillSponsor[]=[],sponsorIndex=new Map<string,number>();
  const stored=bills.map(({sponsors:rows,...bill})=>({...bill,sponsorRefs:rows.map(sponsor=>{
    const key=JSON.stringify(sponsor);let index=sponsorIndex.get(key);
    if(index===undefined){index=sponsors.length;sponsors.push(sponsor);sponsorIndex.set(key,index);}
    return index;
  })}));
  const {access_key:_access,...publicDataset}=dataset;
  return {kind:"PART",parserVersion:LEGISCAN_BULK_PARSER,dataset:publicDataset,state:stateOfDataset(dataset),capturedAt,bills:stored,sponsors,
    counts:{rows:bills.length,joined,unjoined:bills.length-joined,sponsorsJoined:sourceSponsors.filter(row=>row.officeholderId).length,sponsorsUnjoined:sourceSponsors.filter(row=>!row.officeholderId).length}};
}
