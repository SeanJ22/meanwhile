import { personIdentityKeys } from "../../officials/people-identity.ts";
import { US_JURISDICTIONS } from "../../coverage/states.ts";
import type { Provenance } from "../types.ts";
import { isOfficialSource } from "../../civic-data/source-authority.ts";
import { legiscanIdentityJoins,type LegiscanIdentityHolder } from "./dataset.ts";

export const LEGISCAN_BULK_CONTRACT = "legiscan-bulk";
export const LEGISCAN_BULK_SCOPE = "US:legiscan-datasets";
export const LEGISCAN_BULK_PARSER = "legiscan-bulk/4";
export const LEGISCAN_API = "https://api.legiscan.com/";
/** LegiScan state_id is its own identifier space, never Census FIPS. */
const LEGISCAN_STATES = "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC US".split(" ");
export interface Dataset {
  state_id: number; session_id: number; session_name: string; dataset_hash: string; dataset_date: string;
  access_key?: string;
}
export type HeldPerson = LegiscanIdentityHolder;
interface BillSponsor {
  peopleId: number; name: string; committee: boolean; nativeIds: Record<string,string[]>;
  officeholderId: string | null; joinReason: string | null;
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
}
export interface BillIndex { kind:"INDEX";parserVersion:typeof LEGISCAN_BULK_PARSER; capturedAt:string; datasets:Dataset[]; }
export const billScope = (sessionId:number) => `legiscan-bills:session:${sessionId}`;
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
export function parseDatasetList(value:unknown):Dataset[] {
  const response=object(value);
  if(response.status!=="OK"||!Array.isArray(response.datasetlist)||!response.datasetlist.length) throw Error("LEGISCAN_DATASET_LIST_INVALID");
  const rows=response.datasetlist.map(value=>{
    const row=object(value);
    const result={state_id:positive(row.state_id),session_id:positive(row.session_id),session_name:text(row.session_name),
      dataset_hash:text(row.dataset_hash),dataset_date:date(row.dataset_date)!,access_key:text(row.access_key)};
    if(!result.dataset_date) throw Error("LEGISCAN_DATASET_DATE_REQUIRED");
    stateOfDataset(result); return result;
  });
  if(new Set(rows.map(row=>row.session_id)).size!==rows.length) throw Error("LEGISCAN_DUPLICATE_SESSION");
  return rows;
}
type PersonJoinIndex=ReadonlyMap<string,ReadonlySet<string>>;
function personJoinIndex(people:readonly HeldPerson[]):PersonJoinIndex {
  const index=new Map<string,Set<string>>();
  for(const person of people) for(const key of personIdentityKeys(person)) {
    const ids=index.get(key)??new Set<string>();ids.add(person.id);index.set(key,ids);
  }
  return index;
}
function joinSponsorWithIndex(sponsor:BillSponsor, index:PersonJoinIndex):BillSponsor {
  if(sponsor.committee) return {...sponsor,officeholderId:null,joinReason:"Committee sponsor"};
  if(sponsor.joinReason==="Ambiguous source identifiers")return {...sponsor,officeholderId:null};
  const keys=new Set(Object.entries(sponsor.nativeIds).flatMap(([source,ids])=>ids.map(id=>`${source}:${id}`)));
  const ids=[...new Set([...keys].flatMap(key=>[...(index.get(key)??[])]))];
  return {...sponsor,officeholderId:ids.length===1?ids[0]:null,joinReason:ids.length===1?null:ids.length?"Ambiguous source identifiers":"No held source identifier"};
}
/** Exact identifiers only. Ambiguous or absent matches stay in the published source row. */
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
function normalizeBill(value:unknown, dataset:Dataset, people:PersonJoinIndex,identityJoins:ReadonlyMap<number,string>):Omit<Bill,"facts"> {
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
    return joinSponsorWithIndex({peopleId,name:text(row.name),committee:Number(row.committee_sponsor)===1,nativeIds,officeholderId:null,joinReason:null},people);
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
      const identity={people_id:row.people_id,bio:{social:bio.social,links:bio.links},ballotpedia:row.ballotpedia,votesmart_id:row.votesmart_id};
      uniqueSourceSponsors.set(JSON.stringify(identity),identity);
    }
  }
  return JSON.parse(JSON.stringify([...uniqueSourceSponsors.values()])) as Record<string,unknown>[];
}
export function normalizeSession(dataset:Dataset,bodies:readonly string[],capturedAt:string,people:readonly HeldPerson[]=[],sessionSponsors?:readonly Record<string,unknown>[]):BillPart {
  const values=bodies.map(body=>JSON.parse(body) as unknown);
  const identityJoins=new Map(legiscanIdentityJoins(people,sessionSponsors??sessionSponsorEvidence(bodies)).map(row=>[row.legiscanPeopleId,row.personId]));
  const nativeJoins=personJoinIndex(people);
  const bills=values.map(value=>normalizeBill(value,dataset,nativeJoins,identityJoins));
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
