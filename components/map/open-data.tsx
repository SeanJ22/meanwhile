"use client";
import { useEffect, useState, type ReactNode } from "react";
import type { OpenDataFact } from "@/lib/sources/open-data/model";
import { openDataFactIssue } from "@/lib/sources/open-data/model";
import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";
import { CardGapContribution } from "@/components/ui/card-gap-context";
import type { CardSource } from "@/lib/officials/card-sources";

/** The citations behind open-data records, in the card-source shape the shared footer renders. */
export function openDataSources(records:readonly OpenDataFact[],checkedAt:Readonly<Record<string,string>>={}):CardSource[] {
  return records.map(row=>({what:`${row.kind==="SOCRATA_DATASET"?`Dataset: ${row.title}`:`Inspections and compliance: ${row.title}`}${checkedAt[row.sourceId]?` · Last checked ${checkedAt[row.sourceId].slice(0,10)}`:""}`,
    provenance:{sourceUrl:row.sourceUrl,sourceOrg:row.sourceOrg,collectedAt:row.capturedAt,verifiedAt:null,kind:row.official?"OFFICIAL":"REFERENCE"}}));
}
export function OpenDataFacts({records,afterRecords,checkedAt={}}:{records:readonly OpenDataFact[];afterRecords?:ReactNode;checkedAt?:Readonly<Record<string,string>>}) {
  return <><ul className="space-y-3">{records.map(row=><li key={row.id} data-open-data-record={row.id}>
    <a className="text-link" href={row.sourceUrl} target="_blank" rel="noopener noreferrer">{row.title}</a>
    {row.kind==="SOCRATA_DATASET" ? row.description && <p className="t-detail text-voice">{row.description}</p> : <>
      <p className="t-detail text-voice">ZIP {row.zip}. {row.description}</p>
      <p className="t-detail text-voice">{String(row.fields.inspectionCount ?? "Not supplied")} {row.fields.inspectionCount==="1"?"inspection":"inspections"} in the past five years{row.fields.lastInspection ? ` · Last inspection ${String(row.fields.lastInspection).slice(0,10)}` : ""}.</p>
      <p className="t-detail text-voice">Quarters with noncompliance: {String(row.fields.quartersWithNoncompliance ?? "Not supplied")}.</p>
      {[["Air",row.fields.airCompliance],["Water",row.fields.waterCompliance],["Hazardous waste",row.fields.wasteCompliance],["Drinking water",row.fields.drinkingWaterCompliance]].filter(([,v])=>v).map(([label,value])=><p className="t-detail text-voice" key={String(label)}>{String(label)}: {String(value)}</p>)}
    </>}
    <p className="t-detail text-muted">{row.publishedAt?`Published ${row.publishedAt.slice(0,10)}`:"Publication date not supplied"}{row.updatedAt?` · Updated ${row.updatedAt.slice(0,10)}`:""}</p>
  </li>)}</ul>{afterRecords}<CardSourcesContribution id="open-data" sources={openDataSources(records,checkedAt)} /></>;
}
export function PlaceOpenData({divisionId,bodyId,zip}:{divisionId?:string|null;bodyId?:string|null;zip?:string|null}) {
  const key=JSON.stringify([divisionId,bodyId,zip]);
  const [state,setState]=useState<{key:string;records:readonly OpenDataFact[];unavailable:boolean;nextOffset:number|null;loadingMore:boolean;checkedAt:Record<string,string>}|null>(null);
  useEffect(()=>{
    let active=true;const controller=new AbortController(),params=new URLSearchParams();
    if(divisionId)params.set("division",divisionId);if(bodyId)params.set("body",bodyId);if(zip)params.set("zip",zip);
    if(!divisionId&&!zip)return;
    void fetch(`/api/open-data?${params}`,{signal:controller.signal}).then(async response=>{
      if(!response.ok)throw Error("Open data unavailable");
      const read=await response.json() as {records:OpenDataFact[];unavailable:string[];nextOffset:number|null;checkedAt:Record<string,string>};
      if(!Array.isArray(read.records)||read.records.some(openDataFactIssue))throw Error("Invalid open data");
      if(active)setState({key,records:read.records,unavailable:read.unavailable.length>0,nextOffset:read.nextOffset,loadingMore:false,checkedAt:read.checkedAt});
    }).catch(()=>{if(active)setState({key,records:[],unavailable:true,nextOffset:null,loadingMore:false,checkedAt:{}});});
    return()=>{active=false;controller.abort();};
  },[divisionId,bodyId,zip,key]);
  async function loadMore() {
    if(state?.key!==key || state.nextOffset===null || state.loadingMore)return;
    const params=new URLSearchParams({offset:String(state.nextOffset)});
    if(divisionId)params.set("division",divisionId);if(bodyId)params.set("body",bodyId);if(zip)params.set("zip",zip);
    setState(current=>current?.key===key?{...current,loadingMore:true}:current);
    try {
      const response=await fetch(`/api/open-data?${params}`);if(!response.ok)throw Error("Open data unavailable");
      const read=await response.json() as {records:OpenDataFact[];nextOffset:number|null};
      if(!Array.isArray(read.records)||read.records.some(openDataFactIssue))throw Error("Invalid open data");
      setState(current=>current?.key===key?{...current,records:[...new Map([...current.records,...read.records].map(row=>[row.id,row])).values()],nextOffset:read.nextOffset,loadingMore:false}:current);
    } catch {setState(current=>current?.key===key?{...current,unavailable:true,loadingMore:false}:current);}
  }
  if(!divisionId&&!zip)return null;
  if(state?.key!==key)return <p className="t-detail text-muted" role="status">Loading open data…</p>;
  return <section aria-label="Open data and regulated facilities" className="mt-3 space-y-2">
    <p className="t-structure text-local">Open data{zip?` and facilities near ZIP ${zip}`:""}</p>
    {state.unavailable&&<p className="t-detail text-muted">Couldn’t load all sources just now.</p>}
    {state.records.length?<OpenDataFacts records={state.records} checkedAt={state.checkedAt} afterRecords={state.nextOffset!==null&&<button type="button" className="text-link t-detail" disabled={state.loadingMore} onClick={()=>void loadMore()}>{state.loadingMore?"Loading…":"Show more"}</button>} />:<CardGapContribution id="open-data" label="open data for this place" />}
  </section>;
}
