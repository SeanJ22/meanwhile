import {withFactConfirmations} from "../../facts/confirmation.ts";
import {withBatchedReaderInvalidation} from "../../reader/cache.ts";
import { retireAbsent, savedCopyFreshnessRefusal, type DoorOutcome } from "../../core/door.ts";
import { ensureEntity, resolvePerson, learnDoorChannel } from "../../facts/entities.ts";
import { nameKey } from "../../facts/roster-facts.ts";
import { legistarMemberCapture } from "./members-cache.ts";
import { exactLine } from "../../facts/check.ts";
import { publishLoaded, type Clocks, type FactDb, type Query } from "../../facts/publish.ts";
import type { ReaderCachePurger } from "../../reader/cache.ts";
import type { EvidenceStore } from "../../control-plane/evidence/store.ts";
import type { MemberRecordWork, MemberSource } from "./members-loader.ts";
import { currentMemberOffice, memberDay, memberName, termDate, type MemberOffice } from "./members-model.ts";

/** Bounded, process-local parsed pages; rows hold pointers and the vault holds the only saved bytes. */
export function legistarMemberPublisher(input:{facts:FactDb&{query:Query};vault:EvidenceStore;clocks:Clocks;purge?:ReaderCachePurger}) {
  const pages=new Map<string,{bytes:number;promise:ReturnType<typeof legistarMemberCapture>}>();
  let bytes=0;
  const capture=(ref:MemberSource)=>{
    const key=`${ref.artifact.id}:${ref.artifact.canonicalUrl}:${ref.artifact.retrievedAt}`;
    let page=pages.get(key);
    if(!page){
      page={bytes:ref.artifact.byteLength,promise:legistarMemberCapture(input.vault,ref.artifact)};
      pages.set(key,page);bytes+=page.bytes;
      while(bytes>8*1024**2&&pages.size>1){const key=pages.keys().next().value!;bytes-=pages.get(key)!.bytes;pages.delete(key);}
      void page.promise.catch(()=>{if(pages.get(key)===page){pages.delete(key);bytes-=page!.bytes;}});
    }
    return page.promise;
  };
  const parsed=new WeakMap<object,readonly Record<string,unknown>[]>();
  const recordsFor=(page:Awaited<ReturnType<typeof capture>>)=>{let rows=parsed.get(page);if(!rows){rows=JSON.parse(page.evidence.text);parsed.set(page,rows!);}return rows!;};
  const publishOne=async(value:MemberRecordWork,now:string,purge?:ReaderCachePurger):Promise<{published:number;retired:number;refused?:string}>=>{
    if(value.selector)return {published:0,retired:0};
    if(value.reason||!value.body)return {published:0,retired:0,refused:value.reason??"Government binding missing"};
    const body=value.body,source=`legistar-members:${value.slug}`,saved=await capture(value.source);
    const stale=savedCopyFreshnessRefusal(new Date(saved.observedAt),input.clocks.windowHours("officeholder"),new Date(now));
    if(stale)return {published:0,retired:0,refused:stale};
    const records=recordsFor(saved);
    const record=records.find(row=>row[value.type==="body"?"BodyId":"OfficeRecordId"]===value.nativeId);
    if(!record)return {published:0,retired:0,refused:"The saved response does not contain this record"};
    const day=memberDay(now,body.timeZone),seats=new Map<number,MemberOffice>(),selectors=new Set(body.nativeIds??[body.nativeId]);
    for(const ref of value.officeSources??[]) {
      const officePage=await capture(ref);
      for(const office of recordsFor(officePage) as unknown as MemberOffice[]) {
        if(!selectors.has(office.OfficeRecordBodyId)||!memberName(office)||!currentMemberOffice(office,day))continue;
        const held=seats.get(office.OfficeRecordPersonId);
        if(!held||(office.OfficeRecordStartDate??"")>(held.OfficeRecordStartDate??"")||office.OfficeRecordStartDate===held.OfficeRecordStartDate&&office.OfficeRecordId>held.OfficeRecordId)seats.set(office.OfficeRecordPersonId,office);
      }
    }
    if(value.type==="body" && !seats.size && !(await input.facts.query("SELECT 1 FROM entity WHERE id=$1",[body.id])).length)return {published:0,retired:0};
    if(value.type==="member" && seats.get(Number(record.OfficeRecordPersonId))?.OfficeRecordId!==value.nativeId)return {published:0,retired:0};
    const bodyRecord=value.type==="body"&&!body.label?record:value.bodySource?recordsFor(await capture(value.bodySource)).find(row=>row.BodyId===body.nativeId):null;
    const bodyId=await ensureEntity(input.facts.query,{id:body.id,kind:"body",name:typeof bodyRecord?.BodyName==="string"?bodyRecord.BodyName.trim():body.id,state:body.state,parentId:body.parentId,government:body.government});
    if(value.type==="body"&&body.label) {
      // The body is held first, so the label folds into it as an alias rather than becoming a second body.
      const folded=await ensureEntity(input.facts.query,{id:body.label.id,kind:"body",name:body.label.name,state:body.state,parentId:body.parentId,government:body.government});
      return folded===bodyId?{published:0,retired:0}:{published:0,retired:0,refused:"The calendar label resolved to a different body"};
    }
    await learnDoorChannel(input.facts.query,bodyId,`https://webapi.legistar.com/v1/${value.slug}/officerecords`);
    let published=0,refused:string|undefined;
    const publish=async(subjectId:string,field:string,claim:unknown,key:string,form:"text"|"date"|"membership"="text")=>{
      const raw=record[key],line=typeof raw==="string"?exactLine(saved.evidence.text,key,raw):null;
      const outcome:DoorOutcome=await publishLoaded(input.facts,{subjectId,field,fieldKind:"officeholder",value:claim,valueText:typeof claim==="string"?claim:memberName(record as unknown as MemberOffice)??"",
        provenance:"OFFICIAL",quote:typeof raw==="string"?raw:JSON.stringify(record),capture:saved,
        copy:{id:value.source.copyId,finalUrl:saved.evidence.canonicalUrl,fetchedAt:new Date(saved.observedAt),text:saved.evidence.text,isArchive:false},
        savedField:{idField:value.type==="body"?"BodyId":"OfficeRecordId",id:value.nativeId,key,form},producedBy:source,costUsd:0},
      // The value as the response writes it, between the quotes after the key.
      line?{quote:line,valueText:line.slice(line.indexOf(":")+1).trim().replace(/^"|"$/g,"")}:null,input.clocks,new Date(now),{purge});
      if("refused"in outcome)refused=outcome.refused;
      else if(outcome.decision==="PUBLISH")published++;
    };
    if(value.type==="member") {
      const office=record as unknown as MemberOffice,name=memberName(office);
      if(!name||seats.get(office.OfficeRecordPersonId)?.OfficeRecordId!==office.OfficeRecordId)return {published:0,retired:0};
      const places=(await input.facts.query("SELECT place_id,boundary_year,placement_basis FROM entity_place WHERE entity_id=$1",[bodyId]))
        .map(row=>({placeId:String(row.place_id),boundaryYear:Number(row.boundary_year),basis:row.placement_basis as "SERVICE_AREA"|"HOST_COUNTY"}));
      const personId=await resolvePerson(input.facts,{name,state:body.state,places,placeId:places.length?null:body.parentId,
        externalIds:[[ `legistar:${value.slug}`,String(office.OfficeRecordPersonId)],[`roster-name:${bodyId}`,nameKey(name)],
          ["roster-member",`legistar:${value.slug}:person:${office.OfficeRecordPersonId}:office:${office.OfficeRecordId}`]]});
      const title=office.OfficeRecordTitle?.trim()||office.OfficeRecordMemberType?.trim()||"";
      await publish(bodyId,`member:${personId}`,{name,office:title||null},"OfficeRecordFullName","membership");
      await publish(personId,"name",name,"OfficeRecordFullName");
      if(title)await publish(personId,`office:${bodyId}`,title,office.OfficeRecordTitle?.trim()?"OfficeRecordTitle":"OfficeRecordMemberType");
      if(office.OfficeRecordStartDate)await publish(personId,`term_start:${bodyId}`,termDate(office.OfficeRecordStartDate),"OfficeRecordStartDate","date");
      if(office.OfficeRecordEndDate)await publish(personId,`term_end:${bodyId}`,termDate(office.OfficeRecordEndDate),"OfficeRecordEndDate","date");
      return {published,retired:0,...(refused?{refused}:{})};
    }
    // A name appears only for a body with a current, named member.
    if(seats.size)await publish(bodyId,"name",String(record.BodyName).trim(),"BodyName");
    let retired=0;
    if(value.officeSources?.length){
      const readAt=new Date((await capture(value.officeSources[0])).observedAt);
      if(!savedCopyFreshnessRefusal(readAt,input.clocks.windowHours("officeholder"),new Date(now))) {
        const shown=await input.facts.query("SELECT entity_id FROM entity_external_id WHERE scheme=$1 AND value=ANY($2::text[])",[`legistar:${value.slug}`,[...seats.keys()].map(String)]);
        retired=await retireAbsent(input.facts,{subjectId:bodyId,fieldPrefix:"member:",sourceUrl:`https://webapi.legistar.com/v1/${value.slug}/officerecords?`,
          stillShown:shown.map(row=>`member:${row.entity_id}`),at:readAt,purge});
      }
    }
    return {published,retired,...(refused?{refused}:{})};
  };
  return (value:MemberRecordWork,now:string)=>withBatchedReaderInvalidation(purge=>
    withFactConfirmations(input.facts,()=>publishOne(value,now,purge),purge),input.purge);
}
