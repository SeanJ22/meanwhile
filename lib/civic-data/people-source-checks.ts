import { createHash } from "node:crypto";
import { canonicalCivicDataJson } from "./changes.ts";
import { sourceContentAddress } from "./source-hash.ts";
import { readPublishedSourceChecks } from "./source-checks.ts";
import { readerQuery } from "./promoted-reader-query.ts";
import type { RoutineDataStore, SourceHead } from "./store.ts";
import type { RoutineRecordClass } from "./types.ts";
import type { StatePeopleAcquisition, StatePeopleCapture } from "./state-people-publication.ts";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const logicalAddress = (url: string): string => {
  const member = /^https:\/\/raw\.githubusercontent\.com\/openstates\/people\/[a-f0-9]{40}\/(data\/.+)$/.exec(url)?.[1];
  if(member)return `openstates:${member}`;
  try{return sourceContentAddress(url);}catch{return url;}
};
const pageAddress = (page: {readonly finalUrl:string;readonly extractedFrom?:{readonly requestedUrl:string;readonly member:string}}): string =>
  page.extractedFrom && /^https:\/\/codeload\.github\.com\/openstates\/people\/zip\/[a-f0-9]{40}$/.test(page.extractedFrom.requestedUrl)
    ? `openstates:${page.extractedFrom.member}` : logicalAddress(page.finalUrl);
const pageKey = (address:string,rawHash:string) => `people-page:${sha(canonicalCivicDataJson([address,rawHash]))}`;

function mapSourceRows<T>(value:T,visit:(row:Record<string,unknown>)=>Record<string,unknown>):T {
  const seen = new WeakMap<object,unknown>();
  const map = (value:unknown):unknown => {
    if (!value || typeof value !== "object") return value;
    if (seen.has(value)) return seen.get(value);
    if (Array.isArray(value)) { const result:unknown[]=[];seen.set(value,result);for(const child of value)result.push(map(child));return result; }
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return value;
    const result:Record<string,unknown>={};seen.set(value,result);
    for(const [key,child] of Object.entries(value))result[key]=map(child);
    const visited=visit(result);seen.set(value,visited);return visited;
  };
  return map(value) as T;
}

/** A field's source-body binding comes from its own original capture, never another page at the same address. */
export function bindPeopleSourceHashes<T>(value:T,captures:readonly StatePeopleCapture[]):T {
  const hashes = new Map<string,Set<string>>();
  for(const page of captures) {
    const key=canonicalCivicDataJson([pageAddress(page),Date.parse(page.retrievedAt)]),set=hashes.get(key)??new Set<string>();
    set.add(page.capture.rawHash);hashes.set(key,set);
  }
  return mapSourceRows(value,row=>{
    if(typeof row.sourceUrl!=="string"||typeof row.collectedAt!=="string")return row;
    const evidenceUrl=typeof row.evidenceSourceUrl==="string"?row.evidenceSourceUrl:row.sourceUrl;
    const matches=hashes.get(canonicalCivicDataJson([logicalAddress(evidenceUrl),Date.parse(row.collectedAt)]));
    return matches?.size===1 ? {...row,rawHash:[...matches][0]} : row;
  });
}

/** Checks stay on the exact currently published parent; an independently retained field keeps its earlier date. */
export async function recordPeopleSourceChecks(input: {
  readonly store:RoutineDataStore;readonly head:SourceHead;
  readonly pages:readonly (Pick<StatePeopleAcquisition,"requestedUrl"|"finalUrl"|"retrievedAt"|"sourceCheck"|"extractedFrom"> & {
    readonly body?:string;readonly capture?:{readonly rawHash:string};readonly httpStatus?:number;
  })[];
}):Promise<void> {
  if(!input.store.recordSourceCheck||!input.head.rawHash)return;
  for(let offset=0;offset<input.pages.length;offset+=8)await Promise.all(input.pages.slice(offset,offset+8).map(async page=>{
    const rawHash=typeof page.body==="string"?sha(page.body):page.capture?.rawHash;
    if(!rawHash||page.httpStatus!==undefined&&(page.httpStatus<200||page.httpStatus>=300))return;
    const revision=page.extractedFrom?/^https:\/\/codeload\.github\.com\/openstates\/people\/zip\/([a-f0-9]{40})$/.exec(page.extractedFrom.requestedUrl)?.[1]:undefined;
    const aliases=revision&&page.extractedFrom?[`https://raw.githubusercontent.com/openstates/people/${revision}/${page.extractedFrom.member}`]:[];
    await input.store.recordSourceCheck!({sourceId:input.head.sourceId,recordClass:input.head.recordClass,scope:input.head.scope,
      pointerVersionId:input.head.versionId,sourceHash:input.head.rawHash!,rawHash,sourceKey:pageKey(pageAddress(page),rawHash),
      parserVersion:input.head.parserVersion,checkedAt:page.sourceCheck?.checkedAt??page.retrievedAt,
      sourceUrls:[...new Set([page.requestedUrl,page.finalUrl,...aliases])],jurisdictionIds:[input.head.scope.split(":")[0]]});
  }));
}

/** Reader source dates use only checks of the same URL/member and exact body hash. */
export async function withPeopleSourceChecks<T>(value:T,recordClass:RoutineRecordClass,scope:string,
  injected?:object):Promise<T> {
  const keys=new Set<string>();
  mapSourceRows(value,row=>{
    if(typeof row.sourceUrl==="string"&&typeof row.rawHash==="string"&&/^[a-f0-9]{64}$/.test(row.rawHash))
      keys.add(pageKey(logicalAddress(typeof row.evidenceSourceUrl==="string"?row.evidenceSourceUrl:row.sourceUrl),row.rawHash));
    return row;
  });
  if(!keys.size)return value;
  const store=injected as Partial<Pick<RoutineDataStore,"readSourceChecks">>|undefined;
  const query=injected?null:readerQuery();
  const rows=await (store?.readSourceChecks?store.readSourceChecks(recordClass,scope,[...keys]):query
    ? readPublishedSourceChecks(async(text,params)=>(await query([{text,params}]))[0]??[],recordClass,scope,[...keys]):Promise.resolve([])).catch(()=>[]);
  const checks=new Map(rows.map(row=>[row.sourceKey,row]));
  return mapSourceRows(value,row=>{
    if(typeof row.sourceUrl!=="string"||typeof row.rawHash!=="string")return row;
    const check=checks.get(pageKey(logicalAddress(typeof row.evidenceSourceUrl==="string"?row.evidenceSourceUrl:row.sourceUrl),row.rawHash));
    if(!check||check.rawHash!==row.rawHash)return row;
    const prior=typeof row.verifiedAt==="string"?row.verifiedAt:typeof row.checkedAt==="string"?row.checkedAt:typeof row.collectedAt==="string"?row.collectedAt:"";
    return Date.parse(check.checkedAt)>Date.parse(prior)?{...row,...("verifiedAt" in row?{verifiedAt:check.checkedAt}:{checkedAt:check.checkedAt})}:row;
  });
}
