import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir,open,rename,rm } from "node:fs/promises";
import { dirname } from "node:path";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import { temporaryPath } from "../civic-data/temporary-path.ts";

export class CampaignHeldSourceUnavailable extends Error {
  constructor(){super("The exact held campaign source is not available for this local repair.");this.name="CampaignHeldSourceUnavailable";}
}
export const campaignHeldSourceUnavailable=(error:unknown):boolean=>error instanceof CampaignHeldSourceUnavailable;
const digest=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");

/** Replay the existing immutable chunk chain into a bounded local file; no publisher is contacted. */
export async function restoreCampaignSource(vault:EvidenceStore,input:{
  readonly archiveId:string;readonly rawHash:string;readonly byteLength:number;readonly sourceUrl:string;readonly path:string;readonly signal:AbortSignal;
}):Promise<void>{
  await mkdir(temporaryPath(dirname(input.path)),{recursive:true});
  const temporary=`${input.path}.restore`,file=await open(temporaryPath(temporary),"w");
  let key:string|null=input.archiveId,end=input.byteLength;
  const seen=new Set<string>();
  try{
    while(key){
      input.signal.throwIfAborted();
      if(seen.has(key))throw new CampaignHeldSourceUnavailable();seen.add(key);
      const saved=await vault.get(key);
      if(!saved||saved.meta.contentHash!==`sha256-${digest(saved.bytes)}`)throw new CampaignHeldSourceUnavailable();
      const link=JSON.parse(new TextDecoder().decode(saved.bytes)) as {sourceUrl:string;offset:number;byteLength:number;vaultKey:string|null;previous:string|null};
      if(link.sourceUrl!==input.sourceUrl||!Number.isSafeInteger(link.offset)||link.offset<0||!Number.isSafeInteger(link.byteLength)||link.byteLength<0||
        link.offset+link.byteLength!==end)throw new CampaignHeldSourceUnavailable();
      if(link.byteLength){
        if(!link.vaultKey)throw new CampaignHeldSourceUnavailable();
        const chunk=await vault.get(link.vaultKey);
        if(!chunk||chunk.bytes.byteLength!==link.byteLength||chunk.meta.contentHash!==`sha256-${digest(chunk.bytes)}`)throw new CampaignHeldSourceUnavailable();
        await file.write(chunk.bytes,0,chunk.bytes.byteLength,link.offset);
      }
      end=link.offset;key=link.previous;
    }
    if(end!==0)throw new CampaignHeldSourceUnavailable();
  }catch(error){await file.close();await rm(temporaryPath(temporary),{force:true});throw error;}
  await file.close();
  const hash=createHash("sha256");let bytes=0;
  for await(const chunk of createReadStream(temporary)){input.signal.throwIfAborted();hash.update(chunk);bytes+=(chunk as Uint8Array).byteLength;}
  if(bytes!==input.byteLength||hash.digest("hex")!==input.rawHash){await rm(temporaryPath(temporary),{force:true});throw new CampaignHeldSourceUnavailable();}
  await rename(temporaryPath(temporary),temporaryPath(input.path));
}
