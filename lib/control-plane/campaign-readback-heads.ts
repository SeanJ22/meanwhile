import { readerQuery } from "../civic-data/promoted-reader-query.ts";
import { CivicReadCache, runtimeCivicReadCache } from "../db/civic-read-cache.ts";
import { SERVED_READER_MAX_AGE_MS, type ServedReaderReadback } from "./served-reader.ts";

type Query = (text: string,params: readonly unknown[]) => Promise<readonly Record<string,unknown>[]>;
interface Head { readonly state:string; readonly version:string; readonly fingerprint:string; readonly valid:boolean }
interface Held { readonly version:string; readonly fingerprint:string; readonly witnesses:number }
const NAMESPACE="owner-campaign-readback-heads:v1";

/** Immutable source fingerprints and pointer identity only; campaign documents stay in their source vault. */
export const CAMPAIGN_READBACK_HEADS_SQL = `SELECT w.state,p.current_version_id AS version,
  coalesce(p.payload_fingerprint,p.payload->>'$civicPayloadPart',c.normalized_hash) AS fingerprint,
  (p.current_version_id=p.last_known_good_version_id AND c.id=p.current_version_id
    AND c.source_id=p.source_id AND c.record_class=p.record_class AND c.scope=p.scope
    AND c.state='PROMOTED' AND c.acquisition_succeeded AND c.promoted_version_id=c.id AND c.last_known_good_version_id=c.id
    AND p.validation_receipt=c.validation_receipt AND p.validation_receipt->>'decision'='GOOD'
    AND p.validation_receipt->>'candidateId'=c.id AND c.normalized_hash ~ '^[a-f0-9]{64}$') IS TRUE AS valid
  FROM unnest($1::text[]) w(state) LEFT JOIN civic_data_promotions p
    ON p.key='CURATED_READER_RECORD:US-'||w.state||':candidate-campaign-sites-derived'
  LEFT JOIN civic_data_candidates c ON c.id=p.current_version_id ORDER BY w.state`;

export interface CampaignReadbackPlan {
  carried(state:string): ServedReaderReadback|null;
  record(state:string,read:ServedReaderReadback): void;
  finish(): Promise<void>;
}

/** Unchanged empty sources need no payload read; a confirmed public witness keeps its real observation time. */
export async function planCampaignReadbacks(states:readonly string[],now:string,previous:ServedReaderReadback|null,
  deps:{readonly query?:Query;readonly cache?:CivicReadCache}={}):Promise<CampaignReadbackPlan>{
  const batch=deps.query?null:readerQuery();
  const query=deps.query??(async(text,params)=>{if(!batch)throw new Error("CAMPAIGN_READBACK_HEADS_UNAVAILABLE");return (await batch([{text,params}]))[0];});
  const cache=deps.cache??runtimeCivicReadCache().jobState();
  const headsOf=async(wanted:readonly string[])=>new Map((await query(CAMPAIGN_READBACK_HEADS_SQL,[wanted])).map(row=>[String(row.state),row as unknown as Head]));
  const heads=await headsOf(states);
  if(heads.size!==new Set(states).size)throw new Error("CAMPAIGN_READBACK_HEADS_INCOMPLETE");
  const held=new Map(await Promise.all(states.map(async state=>[state,await cache.readCheckpoint<Held>(NAMESPACE,state)] as const)));
  const pending=new Map<string,Held>();
  return {
    carried(state){
      const head=heads.get(state);
      if(!head?.version)return {checkedAt:now,witnesses:[],errors:[]};
      const saved=held.get(state);
      if(!head.valid||!saved||saved.version!==head.version||saved.fingerprint!==head.fingerprint)return null;
      if(saved.witnesses===0)return {checkedAt:now,witnesses:[],errors:[]};
      const witnesses=(previous?.witnesses??[]).filter(row=>row.versionId===head.version);
      if(witnesses.length!==saved.witnesses||witnesses.some(row=>row.state!=="CONFIRMED"||
        !Number.isFinite(Date.parse(row.checkedAt))||Date.parse(now)<Date.parse(row.checkedAt)||Date.parse(now)-Date.parse(row.checkedAt)>SERVED_READER_MAX_AGE_MS))return null;
      return {checkedAt:now,witnesses,errors:[]};
    },
    record(state,read){
      const head=heads.get(state);
      if(!head?.valid||!head.fingerprint||read.errors.length||read.witnesses.some(row=>row.versionId!==head.version))return;
      const saved=held.get(state);
      if(saved?.version===head.version&&saved.fingerprint===head.fingerprint&&saved.witnesses===read.witnesses.length)return;
      pending.set(state,{version:head.version,fingerprint:head.fingerprint,witnesses:read.witnesses.length});
    },
    async finish(){
      const empty=[...pending].filter(([,saved])=>saved.witnesses===0).map(([state])=>state);
      const after=empty.length?await headsOf(empty):new Map<string,Head>();
      for(const [state,saved]of pending){
        if(saved.witnesses===0){const head=after.get(state);if(!head?.valid||head.version!==saved.version||head.fingerprint!==saved.fingerprint)continue;}
        await cache.checkpoint(NAMESPACE,state,saved,saved.fingerprint);
      }
    },
  };
}
