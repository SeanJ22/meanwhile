"use client";
import { useEffect,useState } from "react";
import type { SeatHolder } from "@/lib/officials/lookup";
import type { Bill } from "@/lib/sources/legiscan/bills";
import { LEGISCAN_ATTRIBUTION } from "@/lib/sources/legiscan/types";
import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";
import { CardGapContribution } from "@/components/ui/card-gap-context";

export function LegislatorBills({holder}:{holder:SeatHolder}) {
  const [read,setRead]=useState<{bills:Bill[];complete:boolean;checkedAt:string|null}|null>(null),[showAll,setShowAll]=useState(false);
  const state=holder.id.startsWith("congress:")?"US":holder.state??/^(?:plural:)?([a-z]{2})(?::|-)/i.exec(holder.id)?.[1]?.toUpperCase();
  const legislative=/senator|representative|assembly|delegate|legislator/i.test(holder.officeTitle);
  useEffect(()=>{
    if(!state||!legislative) return;
    const controller=new AbortController();
    fetch(`/api/bills?state=${state}&member=${encodeURIComponent(holder.id)}`,{signal:controller.signal}).then(async response=>{
      if(!response.ok) throw Error("Bill records unavailable");return response.json();
    }).then(setRead).catch(()=>{if(!controller.signal.aborted) setRead({bills:[],complete:false,checkedAt:null});});
    return ()=>controller.abort();
  },[holder.id,state,legislative]);
  if(!state||!legislative) return null;
  const bills=read?.bills.slice(0,showAll?undefined:20)??[];
  // A missing field never shows a placeholder: it joins the card's counted gap line once the read has answered.
  if(!read) return null;
  if(!read.bills.length) return <CardGapContribution id={`bills:${holder.id}`} label="sponsored bills"/>;
  return <section className="mt-4" data-legislator-bills>
    <h3 className="t-eyebrow text-muted">Sponsored bills</h3>
    <>
      <ul className="mt-2 space-y-3">{bills.map(bill=><li key={bill.id} data-bill-id={bill.id} className="t-detail">
        <a href={bill.sourceUrl} target="_blank" rel="noreferrer noopener" className="text-link">{bill.number} · {bill.title}</a>
        <p>{bill.statusLabel}{bill.statusDate?` · ${bill.statusDate}`:""} · {bill.sessionName}</p>
        <p>Sponsors: {bill.sponsors.map(row=>row.name).join(", ")}</p>
        <p>{bill.texts.map((row,index)=><span key={row.id}>{index>0?" · ":""}<a href={row.governmentUrl??row.url} target="_blank" rel="noreferrer noopener" className="text-link">{row.type}{row.date?` (${row.date})`:""}</a></span>)}</p>
      </li>)}</ul>
      <p className="t-caption text-muted">Showing {bills.length} of {read.bills.length} sponsored bills.</p>
      {read.bills.length>20&&<button type="button" className="t-detail text-link" onClick={()=>setShowAll(value=>!value)}>{showAll?"Show recent bills":"Show all bills"}</button>}
      {!read.complete&&<CardGapContribution id={`bills-incomplete:${holder.id}`} label="the rest of the sponsored bills"/>}
      <CardSourcesContribution id={`bills:${holder.id}`} sources={[
        {what:`Bill data licence: ${LEGISCAN_ATTRIBUTION.licence}`,provenance:{sourceUrl:LEGISCAN_ATTRIBUTION.licenceUrl,sourceOrg:"LegiScan",collectedAt:read.checkedAt??"",verifiedAt:null}},
        ...bills.flatMap(bill=>[
          {what:`${bill.number}: title, status, sponsors; published ${bill.facts.title.publishedAt}`,provenance:bill.facts.title},
          ...bill.texts.map(row=>({what:`${bill.number}: ${row.type}; published ${row.date??bill.facts.title.publishedAt}`,provenance:{...bill.facts[`text:${row.id}`],sourceUrl:row.governmentUrl??row.url,sourceOrg:row.governmentSourceOfficial?`${bill.state} Legislature`:"LegiScan",kind:row.governmentSourceOfficial?"OFFICIAL" as const:"REFERENCE" as const}})),
        ]),
      ]}/>
    </>
  </section>;
}
