"use client";
import { useEffect, useRef, useState } from "react";
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
export function OpenDataFacts({records,checkedAt={}}:{records:readonly OpenDataFact[];checkedAt?:Readonly<Record<string,string>>}) {
  return <><ul className="space-y-3">{records.map(row=><li key={row.id} data-open-data-record={row.id}>
    <a className="text-link" href={row.sourceUrl} target="_blank" rel="noopener noreferrer">{row.title}</a>
    {row.kind==="SOCRATA_DATASET" ? row.description && <p className="t-detail text-voice">{row.description}</p> : <>
      <p className="t-detail text-voice">ZIP {row.zip}. {row.description}</p>
      <p className="t-detail text-voice">{String(row.fields.inspectionCount ?? "Not supplied")} {row.fields.inspectionCount==="1"?"inspection":"inspections"} in the past five years{row.fields.lastInspection ? ` · Last inspection ${String(row.fields.lastInspection).slice(0,10)}` : ""}.</p>
      <p className="t-detail text-voice">Quarters with noncompliance: {String(row.fields.quartersWithNoncompliance ?? "Not supplied")}.</p>
      {[["Air",row.fields.airCompliance],["Water",row.fields.waterCompliance],["Hazardous waste",row.fields.wasteCompliance],["Drinking water",row.fields.drinkingWaterCompliance]].filter(([,v])=>v).map(([label,value])=><p className="t-detail text-voice" key={String(label)}>{String(label)}: {String(value)}</p>)}
    </>}
    <p className="t-detail text-muted">{row.publishedAt?`Published ${row.publishedAt.slice(0,10)}`:"Publication date not supplied"}{row.updatedAt?` · Updated ${row.updatedAt.slice(0,10)}`:""}</p>
  </li>)}</ul><CardSourcesContribution id="open-data" sources={openDataSources(records,checkedAt)} /></>;
}
type OpenDataPage={records:OpenDataFact[];unavailable:string[];notHeld:string[];nextCursor:string|null;checkedAt:Record<string,string>};
async function openDataPage(response:Response):Promise<OpenDataPage> {
  if(!response.ok)throw Error("Open data unavailable");
  const read=await response.json() as OpenDataPage;
  if(!Array.isArray(read.records)||read.records.some(openDataFactIssue)||!Array.isArray(read.unavailable)||!Array.isArray(read.notHeld)||
    !(read.nextCursor===null||typeof read.nextCursor==="string"&&read.nextCursor.length>0)||!read.checkedAt||typeof read.checkedAt!=="object")throw Error("Invalid open data");
  return read;
}
export function PlaceOpenData({divisionId,bodyId,zip}:{divisionId?:string|null;bodyId?:string|null;zip?:string|null}) {
  const key=JSON.stringify([divisionId,bodyId,zip]);
  const request=useRef<AbortController|null>(null);
  const [state,setState]=useState<{key:string;records:readonly OpenDataFact[];unavailable:boolean;nextCursor:string|null;loadingMore:boolean;checkedAt:Record<string,string>}|null>(null);
  useEffect(()=>{
    const controller=new AbortController(),params=new URLSearchParams();request.current=controller;
    if(divisionId)params.set("division",divisionId);if(bodyId)params.set("body",bodyId);if(zip)params.set("zip",zip);
    if(!divisionId&&!zip)return;
    void fetch(`/api/open-data?${params}`,{signal:controller.signal}).then(openDataPage).then(read=>{
      if(!controller.signal.aborted)setState({key,records:read.records,unavailable:read.unavailable.length>0,nextCursor:read.nextCursor,loadingMore:false,checkedAt:read.checkedAt});
    }).catch(()=>{if(!controller.signal.aborted)setState({key,records:[],unavailable:true,nextCursor:null,loadingMore:false,checkedAt:{}});});
    return()=>{controller.abort();if(request.current===controller)request.current=null;};
  },[divisionId,bodyId,zip,key]);
  async function loadMore() {
    const controller=request.current;
    if(state?.key!==key || state.nextCursor===null || state.loadingMore||!controller||controller.signal.aborted)return;
    const params=new URLSearchParams({cursor:state.nextCursor});
    if(divisionId)params.set("division",divisionId);if(bodyId)params.set("body",bodyId);if(zip)params.set("zip",zip);
    setState(current=>current?.key===key?{...current,loadingMore:true}:current);
    try {
      let response=await fetch(`/api/open-data?${params}`,{signal:controller.signal});
      const reset=response.status===409;
      if(reset){
        if(controller.signal.aborted)return;
        setState(current=>current?.key===key?{...current,records:[],checkedAt:{},unavailable:false,nextCursor:null,loadingMore:true}:current);
        params.delete("cursor");response=await fetch(`/api/open-data?${params}`,{signal:controller.signal});
      }
      const read=await openDataPage(response);
      if(controller.signal.aborted)return;
      setState(current=>current?.key===key?{...current,records:reset?read.records:[...new Map([...current.records,...read.records].map(row=>[row.id,row])).values()],
        checkedAt:reset?read.checkedAt:{...current.checkedAt,...read.checkedAt},unavailable:(reset?false:current.unavailable)||read.unavailable.length>0,nextCursor:read.nextCursor,loadingMore:false}:current);
    } catch {if(!controller.signal.aborted)setState(current=>current?.key===key?{...current,unavailable:true,loadingMore:false}:current);}
  }
  if(!divisionId&&!zip)return null;
  if(state?.key!==key)return <p className="t-detail text-muted" role="status">Loading open data…</p>;
  return <section aria-label="Open data and regulated facilities" className="mt-3 space-y-2">
    <p className="t-structure text-local">Open data{zip?` and facilities near ZIP ${zip}`:""}</p>
    {state.unavailable&&<p className="t-detail text-muted">Couldn’t load all sources just now.</p>}
    {state.records.length?<OpenDataFacts records={state.records} checkedAt={state.checkedAt} />:state.loadingMore?<p className="t-detail text-muted" role="status">Loading open data…</p>:state.nextCursor===null&&<CardGapContribution id="open-data" label="open data for this place" />}
    {state.nextCursor!==null&&<button type="button" className="text-link t-detail" disabled={state.loadingMore} onClick={()=>void loadMore()}>{state.loadingMore?"Loading…":"Show more"}</button>}
  </section>;
}
