/** A malformed facility never prevents independently verified facilities from publishing. */
import { createHash } from "node:crypto";
import type { RoutineCandidate } from "../../civic-data/types.ts";
import type { EvidenceStore } from "../../control-plane/evidence/store.ts";
import { echoSourceIdentity } from "./echo-identity.ts";
import { readOpenDataPartition } from "./artifacts.ts";
import type { OpenDataFact, OpenDataPartitionRef } from "./model.ts";
import type { OpenDataCapture } from "./publication.ts";
import { facilityCell, facilityPoint } from "./geography.ts";

export interface EchoMinimumGap {
  readonly id:string|null;
  readonly state:string;
  readonly fact:NonNullable<RoutineCandidate["excludedFacts"]>[number];
}
export interface EchoPartition {partition:string;rows:readonly OpenDataFact[];captures:readonly OpenDataCapture[]}
const text=(value:unknown)=>value===null||value===undefined?"":String(value).trim();
export function echoMinimumGap(raw:Record<string,unknown>):EchoMinimumGap|null {
  if(!Object.hasOwn(raw,"FAC_NAME")||!Object.hasOwn(raw,"REGISTRY_ID")||!Object.hasOwn(raw,"FAC_STATE"))throw Error("EPA exporter is missing required facility columns.");
  const identity=echoSourceIdentity(raw),title=text(raw.FAC_NAME),state=text(raw.FAC_STATE).toUpperCase()||"UNRESOLVED";
  if(identity&&title)return null;
  const id=identity?`epa-echo:${identity.key}`:null;
  const reason=!title?"Publisher FAC_NAME is blank.":"Publisher facility has no unambiguous FRS or EPA program identity.";
  return {id,state,fact:{key:id??`epa-echo:unresolved:${createHash("sha256").update(JSON.stringify(raw)).digest("hex")}`,
    code:"EPA_FACILITY_MINIMUM_MISSING",detail:`${state}: ${reason} Prior verified facts for this identity remain live; retry the source on its next scheduled run.`,record:{state,nativeId:id,sourceRow:raw}}};
}

/** Only rejected identities are retained, with their original capture rather than the incomplete new row. */
export async function retainEchoMinimumGaps(gaps:readonly EchoMinimumGap[],references:readonly OpenDataPartitionRef[],captures:readonly OpenDataCapture[],vault:EvidenceStore):Promise<Map<string,EchoPartition>> {
  const ids=new Set(gaps.flatMap(gap=>gap.id?[gap.id]:[])),retained=new Map<string,EchoPartition>();
  if(!ids.size)return retained;
  const primary=references.filter(reference=>!reference.id.startsWith("cell:"));
  for(let offset=0;offset<primary.length;offset+=4) {
    const batch=primary.slice(offset,offset+4);
    // Settle each bounded batch, then preserve reference order for facts and failures.
    const priors=await Promise.allSettled(batch.map(reference=>readOpenDataPartition("epa-echo",reference,vault)));
    for(let part=0;part<batch.length;part++) {
      const reference=batch[part],prior=priors[part];if(prior.status==="rejected")throw prior.reason;
      const rows=prior.value.records.filter(row=>ids.has(row.id));
      if(!rows.length)continue;
      const rowCaptures:OpenDataCapture[]=[];
      for(const row of rows) {
        const original=captures.find(capture=>capture.retrievedAt===row.capturedAt);
        if(!original)throw Error(`Prior EPA source capture is missing for retained identity ${row.id}.`);
        rowCaptures.push({...original,sourceRows:[row.sourceRow]});
      }
      retained.set(reference.id,{partition:reference.id,rows,captures:rowCaptures});
      for(let index=0;index<rows.length;index++) {
        const row=rows[index],point=facilityPoint(row);if(!point)continue;
        const partition=`${facilityCell(point.lat,point.lng)}:state:${row.state??"UNRESOLVED"}`,old=retained.get(partition);
        retained.set(partition,{partition,rows:[...old?.rows??[],row],captures:[...old?.captures??[],rowCaptures[index]]});
      }
    }
  }
  return retained;
}
export function mergeEchoRetainedPartition(partition:EchoPartition,retained:Map<string,EchoPartition>):EchoPartition {
  const old=retained.get(partition.partition);retained.delete(partition.partition);
  if(!old)return partition;
  return {...partition,rows:[...new Map([...old.rows,...partition.rows].map(row=>[row.id,row])).values()],captures:[...old.captures,...partition.captures]};
}
