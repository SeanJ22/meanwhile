import { sourceFetch } from "../http.ts";
import { mkdtemp,writeFile,rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { openZipFile } from "../archive.ts";
import { sourceAcquisitionSleep } from "../acquisition-deadline.ts";
import { LEGISCAN_API,parseDatasetList,type Dataset } from "./bills.ts";
import { LEGISCAN_BULK_PARSER } from "./current-sessions.ts";
import { holdRawCapture,readRawCaptureText,type RawCaptureRef } from "../../civic-data/raw-capture-vault.ts";
import { netlifyEvidenceStoreFromEnv } from "../../control-plane/evidence/netlify-store.ts";
import type { EvidenceStore } from "../../control-plane/evidence/store.ts";
import { runtimeCivicReadCache,type CivicReadCache } from "../../db/civic-read-cache.ts";
import { SOURCE_CHECK_AFTER_ENV } from "../source-check-request.ts";

export interface BulkRequestOptions {key?:string;signal:AbortSignal;fetchImpl?:typeof fetch;now?:()=>string;vault?:EvidenceStore;cache?:CivicReadCache;}
export interface BulkCapture {body:string;requestedUrl:string;finalUrl:string;httpStatus:number;retrievedAt:string;rawHash:string;}
const hash=(body:string|Uint8Array)=>createHash("sha256").update(body).digest("hex");
interface SavedArchive {readonly context:string;readonly raw:RawCaptureRef;readonly responseHash:string;readonly retrieval:Omit<BulkCapture,"body"|"rawHash">;}
interface SavedBill {readonly context:string;readonly archiveHash:string;readonly name:string;readonly raw:RawCaptureRef;}
/** Credentials never enter durable URLs, response evidence or diagnostics. Only bulk operations are exposed. */
async function request(op:"getDatasetList"|"getDataset",params:Record<string,string>,options:BulkRequestOptions):Promise<BulkCapture> {
  const key=options.key??process.env.LEGISCAN_API_KEY;
  if(!key) throw Error("LEGISCAN_API_KEY is not configured");
  const url=new URL(LEGISCAN_API); url.search=new URLSearchParams({op,...params}).toString();
  const requestedUrl=new URL(url); requestedUrl.searchParams.delete("access_key"); url.searchParams.set("key",key);
  let response:Response;
  for(let attempt=0;;attempt++) {
    try {response=await sourceFetch(url.href,{signal:options.signal,redirect:"error"}, options.fetchImpl);}
    catch {throw Error(`LegiScan ${op} transport unavailable`);}
    if((response.status===429||response.status>=500)&&attempt<3) {
      const retry=response.headers.get("retry-after"), seconds=Number(retry);
      const delay=retry?Number.isFinite(seconds)?seconds*1000:Math.max(0,Date.parse(retry)-Date.now()):1000*2**attempt;
      await response.body?.cancel(); await sourceAcquisitionSleep(Number.isFinite(delay)?delay:1000*2**attempt,options.signal); continue;
    }
    if(!response.ok) {await response.body?.cancel(); throw Error(`LegiScan ${op} HTTP ${response.status}`);}
    break;
  }
  const body=await response.text(), parsed=JSON.parse(body) as {status?:string};
  if(parsed.status!=="OK") throw Error(`LegiScan ${op} returned an API error`);
  return {body,requestedUrl:requestedUrl.href,finalUrl:requestedUrl.href,httpStatus:response.status,retrievedAt:options.now?.()??new Date().toISOString(),rawHash:hash(body)};
}
export async function acquireDatasetList(options:BulkRequestOptions):Promise<{datasets:Dataset[];capture:BulkCapture}> {
  const acquired=await request("getDatasetList",{},options),datasets=parseDatasetList(JSON.parse(acquired.body));
  // Dataset access tokens only live long enough to download their archive.
  const body=JSON.stringify({status:"OK",datasetlist:datasets.map(({access_key:_access,...row})=>row)});
  return {datasets,capture:{...acquired,body,rawHash:hash(body)}};
}
export async function acquireDataset(dataset:Dataset,options:BulkRequestOptions):Promise<{capture:BulkCapture;bodies:string[];archiveHash:string}> {
  if(!dataset.access_key) throw Error("LEGISCAN_DATASET_ACCESS_KEY_REQUIRED");
  const {access_key:_access,...publicDataset}=dataset;
  const context=hash(JSON.stringify([LEGISCAN_BULK_PARSER,publicDataset]));
  const cache=(options.cache??runtimeCivicReadCache()).jobState(),vault=options.vault??netlifyEvidenceStoreFromEnv();
  const saved=vault?await cache.readCheckpoint<SavedArchive>("legiscan-bulk-archive",String(dataset.session_id)):null;
  const after=Date.parse(process.env[SOURCE_CHECK_AFTER_ENV]??"");
  let archive:Uint8Array|null=null,retrieval:Omit<BulkCapture,"body"|"rawHash">|null=null,responseHash:string|null=null;
  if(vault&&saved?.context===context&&(!Number.isFinite(after)||Date.parse(saved.retrieval.retrievedAt)>=after)){
    const held=await vault.get(saved.raw.vaultKey).catch(()=>null);
    if(held&&held.bytes.byteLength===saved.raw.byteLength&&hash(held.bytes)===saved.raw.rawHash){
      archive=held.bytes;retrieval=saved.retrieval;responseHash=saved.responseHash;
    }
  }
  if(!archive){
    const acquired=await request("getDataset",{id:String(dataset.session_id),access_key:dataset.access_key,format:"json"},options);
    const raw=(JSON.parse(acquired.body) as {dataset?:Dataset & {zip?:string;mime_type?:string}}).dataset;
    if(!raw||raw.session_id!==dataset.session_id||raw.state_id!==dataset.state_id||raw.dataset_hash!==dataset.dataset_hash||raw.dataset_date!==dataset.dataset_date||raw.mime_type!=="application/zip"||!raw.zip) throw Error("LEGISCAN_DATASET_METADATA_MISMATCH");
    archive=Buffer.from(raw.zip,"base64");responseHash=acquired.rawHash;
    const {body:_body,rawHash:_hash,...observed}=acquired;retrieval=observed;
    // Never save access tokens or the credential-bearing response wrapper. The exact ZIP is immutable.
    if(vault){const raw=await holdRawCapture(vault,"legiscan-bills",archive,"application/zip");
      await cache.checkpoint<SavedArchive>("legiscan-bulk-archive",String(dataset.session_id),{context,raw,responseHash,retrieval});}
  }
  const archiveHash=hash(archive);
  const root=await mkdtemp(join(tmpdir(),"meanwhile-legiscan-"));
  try {
    const path=join(root,"session.zip"); await writeFile(path,archive);
    const members=await openZipFile(path,{maxEntries:500_000,maxTotalBytes:2*1024*1024*1024});
    const bodies:string[]=[],names=new Set<string>();
    for(const member of members) if(/(?:^|\/)bills?\/[^/]+\.json$/i.test(member.name)) {
      options.signal.throwIfAborted();
      if(names.has(member.name))throw Error("LEGISCAN_ARCHIVE_DUPLICATE_MEMBER");names.add(member.name);
      const key=JSON.stringify([context,member.name]),completed=vault?await cache.readCheckpoint<SavedBill>("legiscan-bulk-bill",key):null;
      let body:string|null=null;
      if(vault&&completed?.context===context&&completed.archiveHash===archiveHash&&completed.name===member.name)
        body=await readRawCaptureText(vault,completed.raw).catch(()=>null);
      if(body===null){
        const chunks:Uint8Array[]=[];
        for await(const chunk of member.stream()){options.signal.throwIfAborted();chunks.push(chunk);}
        body=new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks));
        if(vault){const raw=await holdRawCapture(vault,"legiscan-bills",body,"application/json");
          await cache.checkpoint<SavedBill>("legiscan-bulk-bill",key,{context,archiveHash,name:member.name,raw});}
      }
      bodies.push(body);
    }
    if(!bodies.length) throw Error("LEGISCAN_ARCHIVE_BILLS_MISSING");
    // Raw members publish once in bounded parts; this parent capture binds their archive and exact bytes.
    const body=JSON.stringify({dataset:publicDataset,archiveHash,responseHash,memberHashes:bodies.map(hash)});
    return {capture:{...retrieval!,body,rawHash:hash(body)},bodies,archiveHash};
  } finally {await rm(root,{recursive:true,force:true});}
}
