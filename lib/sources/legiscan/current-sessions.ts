import type { Dataset,BillIndex,BillSession } from "./bills.ts";
import type { PromotedProjection } from "../../civic-data/types.ts";

export const LEGISCAN_BULK_SCOPE="US:legiscan-datasets";
export const LEGISCAN_BULK_PARSER="legiscan-bulk/4";
export const LEGISCAN_SPONSOR_MATCH="legiscan-sponsors/2";
export const billScope=(sessionId:number)=>`legiscan-bills:session:${sessionId}`;

/** Current legislative years include regular and special sessions. IDs are not a chronology. */
export function currentLegiscanDatasets(datasets:readonly Dataset[],asOf=new Date().toISOString()):Dataset[] {
  const states=new Map<number,Dataset[]>(),year=new Date(asOf).getUTCFullYear();
  for(const row of datasets){const rows=states.get(row.state_id)??[];rows.push(row);states.set(row.state_id,rows);}
  return [...states.values()].flatMap(rows=>{
    rows.sort((a,b)=>b.session_id-a.session_id);
    const dated=rows.filter(row=>row.year_start!==undefined&&row.year_end!==undefined&&row.year_start<=year);
    const current=dated.filter(row=>row.year_end!>=year),lastYear=Math.max(...dated.map(row=>row.year_start!));
    const active=current.length?current:dated.filter(row=>row.year_start===lastYear);
    const special=(row:Dataset)=>row.special===1||/\b(?:special|extra(?:ordinary)?)\b/i.test(row.session_name)?1:0;
    return (active.length?active:[rows[0]]).sort((a,b)=>special(a)-special(b)||b.session_id-a.session_id);
  });
}

/** A verified catalog is not a completed fan-out. Derive continuation from the actual session pointers. */
export function legiscanContinuationPending(payload:unknown,session:(id:number)=>PromotedProjection|undefined,asOf?:string):boolean {
  const index=payload as Partial<BillIndex>|undefined;
  if(index?.kind!=="INDEX"||!Array.isArray(index.datasets)||!index.datasets.length||
    index.datasets.some(row=>row.year_start===undefined||row.year_end===undefined))return true;
  return currentLegiscanDatasets(index.datasets,asOf).some(dataset=>{
    const held=session(dataset.session_id),value=held?.payload as Partial<BillSession>|undefined;
    return held?.sourceId!=="legiscan-bills"||held.versionId!==held.lastKnownGoodVersionId||held.receipt?.decision!=="GOOD"||
      value?.kind!=="SESSION"||value.parserVersion!==LEGISCAN_BULK_PARSER||value.sponsorMatchVersion!==LEGISCAN_SPONSOR_MATCH||
      value.dataset?.dataset_hash!==dataset.dataset_hash||value.dataset?.dataset_date!==dataset.dataset_date;
  });
}
