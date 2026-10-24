import { mkdtemp,writeFile,rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { openZipFile } from "../archive.ts";
import { sourceAcquisitionSleep } from "../acquisition-deadline.ts";
import { LEGISCAN_API,parseDatasetList,type Dataset } from "./bills.ts";

export interface BulkRequestOptions {key?:string;signal:AbortSignal;fetchImpl?:typeof fetch;now?:()=>string;}
export interface BulkCapture {body:string;requestedUrl:string;finalUrl:string;httpStatus:number;retrievedAt:string;rawHash:string;}
const hash=(body:string|Uint8Array)=>createHash("sha256").update(body).digest("hex");
/** Credentials never enter durable URLs, response evidence or diagnostics. Only bulk operations are exposed. */
async function request(op:"getDatasetList"|"getDataset",params:Record<string,string>,options:BulkRequestOptions):Promise<BulkCapture> {
  const key=options.key??process.env.LEGISCAN_API_KEY;
  if(!key) throw Error("LEGISCAN_API_KEY is not configured");
  const url=new URL(LEGISCAN_API); url.search=new URLSearchParams({op,...params}).toString();
  const requestedUrl=new URL(url); requestedUrl.searchParams.delete("access_key"); url.searchParams.set("key",key);
  let response:Response;
  for(let attempt=0;;attempt++) {
    try {response=await (options.fetchImpl??fetch)(url,{signal:options.signal,redirect:"error"});}
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
  const acquired=await request("getDataset",{id:String(dataset.session_id),access_key:dataset.access_key,format:"json"},options);
  const raw=(JSON.parse(acquired.body) as {dataset?:Dataset & {zip?:string;mime_type?:string}}).dataset;
  if(!raw||raw.session_id!==dataset.session_id||raw.state_id!==dataset.state_id||raw.dataset_hash!==dataset.dataset_hash||raw.dataset_date!==dataset.dataset_date||raw.mime_type!=="application/zip"||!raw.zip) throw Error("LEGISCAN_DATASET_METADATA_MISMATCH");
  const archive=Buffer.from(raw.zip,"base64"),archiveHash=hash(archive);
  const root=await mkdtemp(join(tmpdir(),"meanwhile-legiscan-"));
  try {
    const path=join(root,"session.zip"); await writeFile(path,archive);
    const members=await openZipFile(path,{maxEntries:500_000,maxTotalBytes:2*1024*1024*1024});
    const bodies:string[]=[];
    for(const member of members) if(/(?:^|\/)bills?\/[^/]+\.json$/i.test(member.name)) {
      options.signal.throwIfAborted(); const chunks:Uint8Array[]=[];
      for await(const chunk of member.stream()) chunks.push(chunk);
      bodies.push(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks)));
    }
    if(!bodies.length) throw Error("LEGISCAN_ARCHIVE_BILLS_MISSING");
    // Exact bill-member bytes survive for source verification and parser replay.
    const body=JSON.stringify({dataset:{...dataset,access_key:undefined},archiveHash,bodies});
    return {capture:{...acquired,body,rawHash:hash(body)},bodies,archiveHash};
  } finally {await rm(root,{recursive:true,force:true});}
}
