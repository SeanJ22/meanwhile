import { createHash } from "node:crypto";
import { holdRawCapture, type RawCaptureRef } from "../civic-data/raw-capture-vault.ts";
import { runtimeCivicReadCache, type CivicReadCache } from "../db/civic-read-cache.ts";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import { SOURCE_CHECK_AFTER_ENV } from "../sources/source-check-request.ts";

export interface OfficialVoteDocument {
  readonly requestedUrl:string;
  readonly finalUrl:string;
  readonly httpStatus:number;
  readonly bytes:Uint8Array;
  /** Original actual publisher observation; a resumed pass cannot replace it with its run date. */
  readonly retrievedAt:string;
}
interface SavedDocument extends Omit<OfficialVoteDocument,"bytes"> {
  readonly context:string;
  readonly raw:RawCaptureRef;
}

/** Save each completed immutable response independently, so a bounded pool cannot lose another worker's place. */
export async function continueOfficialVoteDocument(input:{
  readonly sourceId:string;readonly parserVersion:string;readonly context:string;readonly url:string;
  readonly vault:EvidenceStore;readonly signal:AbortSignal;readonly cache?:CivicReadCache;
  readonly now?:()=>string;readonly maxAgeMs?:number;
  /** A small publisher index is checked on every pass before its detail continuation is used. */
  readonly reuse?:boolean;
  /** Source families with an explicit successful no-content response may retain that exact response too. */
  readonly acceptedStatuses?:readonly number[];
  readonly read:()=>Promise<OfficialVoteDocument>;
}):Promise<OfficialVoteDocument>{
  input.signal.throwIfAborted();
  const now=input.now??(()=>new Date().toISOString()),cache=(input.cache??runtimeCivicReadCache()).jobState();
  const key=JSON.stringify([input.sourceId,input.parserVersion,input.url]);
  const saved=await cache.readCheckpoint<SavedDocument>("official-vote-source",key);
  const checkedAfter=Date.parse(process.env[SOURCE_CHECK_AFTER_ENV]??"");
  const acceptedStatuses=input.acceptedStatuses??[200];
  if(input.reuse!==false&&saved?.context===input.context&&saved.requestedUrl===input.url&&acceptedStatuses.includes(saved.httpStatus)&&
      Date.parse(saved.retrievedAt)>Date.parse(now())-(input.maxAgeMs??3_600_000)&&
      (!Number.isFinite(checkedAfter)||Date.parse(saved.retrievedAt)>=checkedAfter)){
    try{
      const held=await input.vault.get(saved.raw.vaultKey);
      if(held&&held.bytes.byteLength===saved.raw.byteLength&&createHash("sha256").update(held.bytes).digest("hex")===saved.raw.rawHash)
        return{requestedUrl:saved.requestedUrl,finalUrl:saved.finalUrl,httpStatus:saved.httpStatus,bytes:held.bytes,retrievedAt:saved.retrievedAt};
    }catch{ /* Missing/corrupt captures leave this input due; never advance the saved position. */ }
  }
  input.signal.throwIfAborted();
  const document=await input.read();
  if(document.requestedUrl!==input.url||!acceptedStatuses.includes(document.httpStatus)||
      !document.bytes.length&&document.httpStatus!==204||!Number.isFinite(Date.parse(document.retrievedAt)))
    throw Error("OFFICIAL_VOTE_COMPLETED_SOURCE_INVALID");
  const raw=await holdRawCapture(input.vault,input.sourceId,document.bytes,"application/octet-stream");
  await cache.checkpoint<SavedDocument>("official-vote-source",key,{context:input.context,raw,requestedUrl:document.requestedUrl,
    finalUrl:document.finalUrl,httpStatus:document.httpStatus,retrievedAt:document.retrievedAt},input.context);
  input.signal.throwIfAborted();
  return document;
}

export const oldestOfficialVoteObservation=(documents:readonly Pick<OfficialVoteDocument,"retrievedAt">[]):string=>{
  const oldest=documents.map(document=>document.retrievedAt).sort()[0];
  if(!oldest)throw Error("OFFICIAL_VOTE_SOURCE_OBSERVATION_MISSING");
  return oldest;
};
