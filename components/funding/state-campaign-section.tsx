"use client";

import { useEffect, useRef, useState } from "react";
import { CardGapContribution } from "@/components/ui/card-gap-context";
import { CardSourcesContribution } from "@/components/ui/card-sources-contribution";
import { campaignFinanceRecordSources } from "@/lib/funding/state-view";
import { smallDonorSentence } from "@/lib/funding/small-donors";
import type { CampaignFinancePlaceRead } from "@/lib/funding/state-reader";
import { ReactionControl } from "@/components/reactions/reaction-control";
import type { ReactionViewContext } from "@/lib/reactions/client";

const money=new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2});
interface Props {divisionId:string;personId?:string;data?:CampaignFinancePlaceRead;bare?:boolean;context?:ReactionViewContext|null}
async function load(division:string,personId:string|undefined,cursor?:string|null){
  const response=await fetch(`/api/campaign-finance?${new URLSearchParams({division,...(personId?{person:personId}:{}),...(cursor?{cursor}:{})})}`);
  if(!response.ok)throw new Error("Campaign records unavailable");
  const value=await response.json() as CampaignFinancePlaceRead;
  if(value.division!==division || !["HELD","NOT_HELD","UNAVAILABLE"].includes(value.status) || !Array.isArray(value.records) || !(value.nextCursor===null || typeof value.nextCursor==="string"))throw new Error("Campaign records unavailable");
  return value;
}
export function StateCampaignSection(props:Props){
  return <CampaignSection key={`${props.divisionId}:${props.personId??"place"}`} {...props}/>;
}
function CampaignSection({divisionId,personId,data,bare=false,context=null}:Props){
  const [read,setRead]=useState<CampaignFinancePlaceRead|null>(null),[loading,setLoading]=useState(false),[failed,setFailed]=useState(false);
  const request=useRef(0);
  useEffect(()=>{
    const current=++request.current;
    if(!data)void load(divisionId,personId).then(value=>{if(request.current===current)setRead(value);}).catch(()=>{if(request.current===current)setFailed(true);});
    return ()=>{request.current=current+1;};
  },[divisionId,personId,data]);
  const value=read??data;
  async function next(){
    if(!value?.nextCursor || loading)return;
    const current=++request.current;setLoading(true);setFailed(false);
    try{const page=await load(divisionId,personId,value.nextCursor);if(request.current===current)setRead(page);}
    catch{if(request.current===current)setFailed(true);}
    finally{if(request.current===current)setLoading(false);}
  }
  if(!value?.records.length)return <CardGapContribution id={`campaign-finance:${divisionId}:${personId??"place"}`} label="campaign money"/>;
  return <section aria-label="Campaign money" className="space-y-3">
    {!bare&&<h4 className="t-detail font-medium text-paper">Campaign money</h4>}
    {value.records.map(row=>{
      const small=smallDonorSentence(row.individualLarge??null,row.individualSmall??null);
      return <div key={row.id} data-campaign-record={row.id} className="space-y-2">
        <p className="t-body text-paper">{row.person.name} · {row.cycle} cycle</p>
        <p className="t-detail text-voice">{row.committees?.map(committee=>`${committee.name}${committee.office?` · ${committee.office}`:""}`).join("; ")??row.committee}</p>
        <dl>{row.totals.map(total=><div key={total.label} className="flex justify-between gap-4 t-detail"><dt>{total.label}</dt><dd>{money.format(total.amount)}</dd></div>)}</dl>
        {small?<p className="t-detail text-voice">{small}</p>:<CardGapContribution id={`small-donors:${row.id}`} label="small-donor share"/>}
        {!!row.donors?.length&&<dl>{row.donors.filter(donor=>donor.kind==="COMMITTEE_OR_ORGANIZATION" || donor.kind==="INDIVIDUAL"&&donor.amount>200).map((donor,index)=><div key={`${donor.filedName}:${index}`} className="flex justify-between gap-4 t-detail"><dt>{donor.filedName}</dt><dd>{money.format(donor.amount)}</dd></div>)}</dl>}
        {!row.donors?.length&&<CardGapContribution id={`campaign-contributors:${row.id}`} label="campaign contributors"/>}
      </div>;
    })}
    <ReactionControl targetType="FUNDING_TOTAL_REACTION" targetId={personId??value.records[0].person.id} prompt="How do you feel about how this campaign is funded?" context={context}/>
    {value.nextCursor&&<button type="button" disabled={loading} onClick={()=>void next()} className="t-caption text-link">{loading?"Loading campaign totals…":failed?"Try loading more totals again":"More campaign totals"}</button>}
    <CardSourcesContribution id={`campaign-finance:${divisionId}:${personId??"place"}`} sources={value.records.flatMap(campaignFinanceRecordSources)}/>
  </section>;
}
