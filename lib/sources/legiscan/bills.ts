import type { Officeholder } from "../../officials/types.ts";
import { personIdentityKeys } from "../../officials/people-identity.ts";
import { FIPS_TO_STATE } from "../../ocd/fips.ts";
import type { Provenance } from "../types.ts";
import { isOfficialSource } from "../../civic-data/source-authority.ts";

export const LEGISCAN_BULK_CONTRACT = "legiscan-bulk";
export const LEGISCAN_BULK_SCOPE = "US:legiscan-datasets";
export const LEGISCAN_BULK_PARSER = "legiscan-bulk/2";
export const LEGISCAN_API = "https://api.legiscan.com/";
/** LegiScan state_id is its own identifier space, never Census FIPS. */
const LEGISCAN_STATES = "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY US".split(" ");
export interface Dataset {
  state_id: number; session_id: number; session_name: string; dataset_hash: string; dataset_date: string;
  access_key?: string;
}
export type HeldPerson = Pick<Officeholder,"id"|"personId"|"nativeIds">;
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
export interface BillSession {
  kind: "SESSION"; dataset: Dataset; state: string; capturedAt: string; bills: Bill[];
  counts: {rows:number;joined:number;unjoined:number;sponsorsJoined:number;sponsorsUnjoined:number};
}
export interface BillIndex { kind:"INDEX"; capturedAt:string; datasets:Dataset[]; }
export const billScope = (sessionId:number) => `legiscan-bills:session:${sessionId}`;
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
/** Exact identifiers only. Ambiguous or absent matches stay in the published source row. */
export function joinSponsor(sponsor:BillSponsor, people:readonly HeldPerson[]):BillSponsor {
  if(sponsor.committee) return {...sponsor,officeholderId:null,joinReason:"Committee sponsor"};
  const keys=new Set(Object.entries(sponsor.nativeIds).flatMap(([source,ids])=>ids.map(id=>`${source}:${id}`)));
  const matches=people.filter(person=>[...personIdentityKeys(person)].some(key=>keys.has(key)));
  const ids=[...new Set(matches.map(person=>person.id))];
  return {...sponsor,officeholderId:ids.length===1?ids[0]:null,joinReason:ids.length===1?null:ids.length?"Ambiguous source identifiers":"No held source identifier"};
}
function normalizeBill(value:unknown, dataset:Dataset, capturedAt:string, people:readonly HeldPerson[]=[]):Bill {
  const raw=object(object(value).bill), state=stateOfDataset(dataset);
  if(raw.state!==state||positive(raw.state_id)!==dataset.state_id||positive(raw.session_id)!==dataset.session_id) throw Error("LEGISCAN_BILL_SCOPE_MISMATCH");
  const billId=positive(raw.bill_id), sourceUrl=url(raw.url)!;
  if(!sourceUrl||new URL(sourceUrl).hostname!=="legiscan.com") throw Error("LEGISCAN_BILL_SOURCE_INVALID");
  const status=Number(raw.status);
  if(!Number.isSafeInteger(status)||status<0) throw Error("LEGISCAN_STATUS_INVALID");
  if(!Array.isArray(raw.sponsors)||!Array.isArray(raw.texts)) throw Error("LEGISCAN_BILL_ARRAY_REQUIRED");
  const sponsors=raw.sponsors.map(value=>{
    const row=object(value), peopleId=positive(row.people_id);
    const nativeIds:Record<string,string[]>={legiscan:[String(peopleId)]};
    for(const [field,source] of [["bioguide_id","congress"],["openstates_id","openstates"],["votesmart_id","votesmart"]]) {
      const id=row[field]; if((typeof id==="string"||typeof id==="number")&&String(id)!=="0"&&String(id)) nativeIds[source]=[String(id)];
    }
    return joinSponsor({peopleId,name:text(row.name),committee:Number(row.committee_sponsor)===1,nativeIds,officeholderId:null,joinReason:null},people);
  });
  const texts=raw.texts.map(value=>{
    const row=object(value), governmentUrl=url(row.state_link), link=url(row.url);
    if(!link) throw Error("LEGISCAN_TEXT_LINK_REQUIRED");
    return {id:positive(row.doc_id),date:date(row.date),type:text(row.type),url:link,governmentUrl,governmentSourceOfficial:Boolean(governmentUrl&&isOfficialSource(governmentUrl))};
  });
  const provenance=(publishedAt:string):Provenance & {publishedAt:string}=>({sourceUrl,sourceOrg:"LegiScan",kind:"REFERENCE",secondHand:true,collectedAt:capturedAt,verifiedAt:capturedAt,publishedAt});
  const statusDate=date(raw.status_date), governmentUrl=url(raw.state_link);
  const fips=Object.entries(FIPS_TO_STATE).find(([,row])=>row.postal===state)?.[0] ?? null;
  return {id:`legiscan:bill:${billId}`,billId,state,sessionId:dataset.session_id,sessionName:dataset.session_name,
    ocdId:state==="US"?"ocd-division/country:us":`ocd-division/country:us/state:${state.toLowerCase()}`,fips,
    number:text(raw.bill_number),title:text(raw.title),description:typeof raw.description==="string"?raw.description:"",
    status,statusLabel:["Not available","Introduced","Engrossed","Enrolled","Passed","Vetoed","Failed"][status] ?? `Status ${status}`,
    statusDate,sourceUrl,governmentUrl,governmentSourceOfficial:Boolean(governmentUrl&&isOfficialSource(governmentUrl)),sponsors,texts,
    facts:{id:provenance(dataset.dataset_date),number:provenance(dataset.dataset_date),session:provenance(dataset.dataset_date),jurisdiction:provenance(dataset.dataset_date),governmentLink:provenance(dataset.dataset_date),
      title:provenance(dataset.dataset_date),description:provenance(dataset.dataset_date),status:provenance(dataset.dataset_date),sponsors:provenance(dataset.dataset_date),
      ...Object.fromEntries(texts.map(row=>[`text:${row.id}`,{...provenance(row.date??dataset.dataset_date),sourceUrl:row.url}]))}};
}
export function normalizeSession(dataset:Dataset,bodies:readonly string[],capturedAt:string,people:readonly HeldPerson[]=[]):BillSession {
  const bills=bodies.map(body=>normalizeBill(JSON.parse(body),dataset,capturedAt,people));
  if(new Set(bills.map(row=>row.id)).size!==bills.length) throw Error("LEGISCAN_DUPLICATE_BILL");
  const joined=bills.filter(row=>row.sponsors.some(sponsor=>sponsor.officeholderId)).length;
  const sponsors=bills.flatMap(row=>row.sponsors);
  const {access_key:_access,...publicDataset}=dataset;
  return {kind:"SESSION",dataset:publicDataset,state:stateOfDataset(dataset),capturedAt,bills,
    counts:{rows:bills.length,joined,unjoined:bills.length-joined,sponsorsJoined:sponsors.filter(row=>row.officeholderId).length,sponsorsUnjoined:sponsors.filter(row=>!row.officeholderId).length}};
}
