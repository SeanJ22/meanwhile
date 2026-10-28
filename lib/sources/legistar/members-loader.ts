import { createHash } from "node:crypto";
import { canonicalJson } from "../../control-plane/repository/types.ts";
import type { BodySourceWiring } from "../../registry/source-wiring.ts";
import type { LegistarMembers } from "./members-model.ts";
import { legistarTenantDoors } from "../../doors/legistar-tenant.ts";
import { saveSourceReference } from "../../facts/source-copy.ts";
import type { FactDb, Query } from "../../facts/publish.ts";
import type { EvidenceStore } from "../../control-plane/evidence/store.ts";
import type { WorkInput, workList } from "../../core/work.ts";
import {memberArtifactPointer,type MemberArtifact} from "./members-cache.ts";
import { makeLegistarMembersReader, memberSourceUrl, legistarMemberRosters } from "./members.ts";
import { legistarMembersPackage } from "./members-publication.ts";
import { memberProbe, memberDay } from "./members-model.ts";

export interface MemberSource { readonly artifact:MemberArtifact; readonly copyId:number }
export interface MemberRecordWork {
  readonly $sourceFingerprint:string;
  readonly slug:string; readonly nativeId:number; readonly type:"body"|"member";
  readonly source:MemberSource;
  readonly body?:{ readonly id:string; readonly state:string|null; readonly parentId:string|null; readonly government?:string; readonly timeZone:string; readonly nativeId:number };
  readonly officeSources?:readonly MemberSource[];
  readonly bodySource?:MemberSource;
  readonly reason?:string;
}

/** A matching source fingerprint ends the pass without opening any held source bytes. */
export async function loadLegistarMemberTenant(input:{facts:FactDb&{query:Query};doors:Query;work:ReturnType<typeof workList>;
  vault:EvidenceStore;slug:string;now:string;signal?:AbortSignal;fetchImpl?:typeof fetch}) {
  const source=`legistar-members:${input.slug}`;
  const [prior]=await input.facts.query("SELECT sha256 FROM fact_store_load WHERE source=$1",[source]);
  const rows=await legistarTenantDoors(input.doors,input.slug);
  const days=[...new Set(rows.map(row=>memberDay(input.now,row.timeZone)))].sort().join(",");
  const raw=await makeLegistarMembersReader(input.vault,input.fetchImpl,prior?{signature:String(prior.sha256)}:null,days)(input.slug,input.signal);
  if ("unchanged" in raw) return {unchanged:true,records:0};
  return enqueueLegistarMemberRecords({...input,raw,rows});
}

export async function enqueueLegistarMemberRecords(input:{facts:FactDb&{query:Query};work:ReturnType<typeof workList>;vault:EvidenceStore;raw:LegistarMembers;rows:readonly BodySourceWiring[];now:string}) {
  const {raw,rows}=input,source=`legistar-members:${input.raw.slug}`;
  const prepared=legistarMembersPackage(raw,rows,input.now);
  const copies=new Map<string,MemberSource>();
  for(const {artifact} of raw.readings) {
    if(memberProbe(new URL(artifact.canonicalUrl)))continue;
    const copyId=await input.facts.transaction(query=>saveSourceReference(query,{artifactId:artifact.id,url:artifact.canonicalUrl,
      finalUrl:artifact.canonicalUrl,fetchedAt:artifact.retrievedAt,httpStatus:200,contentHash:artifact.contentHash}));
    copies.set(artifact.canonicalUrl,{artifact:memberArtifactPointer(artifact),copyId});
  }
  const rosters=new Map([...legistarMemberRosters(raw,prepared.bound,input.now)].map(roster=>[roster.bodyId,roster]));
  const recordsById=new Map(raw.offices.map(office=>[office.OfficeRecordId,office]));
  const bodyRecordsById=new Map(raw.bodies.map(body=>[body.BodyId,body]));
  const offices=[...copies.values()].filter(copy=>{const url=new URL(copy.artifact.canonicalUrl);return url.pathname.endsWith("/officerecords");});
  const owners=new Map(prepared.bound.map(row=>[Number(row.config.eventBodyId),row]));
  const offered:WorkInput[]=[];
  let records=0;
  const add=async(type:"body"|"member",nativeId:number,nativeBody:number)=>{
    const owner=owners.get(nativeBody),state=owner?.ocdId?.match(/\/state:([a-z]{2})/)?.[1]?.toUpperCase()??"US";
    const body=owner?{id:owner.bodyId,state:state==="US"?null:state,parentId:owner.ocdId,government:owner.config.governmentId,timeZone:owner.timeZone,nativeId:nativeBody}:undefined;
    const url=memberSourceUrl(raw,type==="body"?"bodies":"officerecords",type==="body"?"BodyId":"OfficeRecordId",nativeId);
    const roster=owner?rosters.get(owner.bodyId):undefined;
    const selected=type==="member"&&roster?.members.some(member=>member.id.endsWith(`:office:${nativeId}`));
    const fingerprint=createHash("sha256").update(canonicalJson([type,body??null,type==="body"?bodyRecordsById.get(nativeId):recordsById.get(nativeId),
      type==="body"?[memberDay(input.now,owner?.timeZone??"UTC"),roster?.members.map(member=>member.id).sort()??[]]:selected??false])).digest("hex");
    const value:MemberRecordWork={$sourceFingerprint:fingerprint,slug:raw.slug,type,nativeId,source:copies.get(url)!,body,
      officeSources:offices,
      ...(raw.bodies.some(row=>row.BodyId===nativeBody)?{bodySource:copies.get(memberSourceUrl(raw,"bodies","BodyId",nativeBody))}:{}),
      ...(!owner?{reason:"The source record has no unambiguous government binding"}:{}),
    };
    const route=new URL(url);route.search="";
    offered.push({kind:"check",subjectId:source,field:`${type}:${nativeId}`,placeId:owner?.ocdId??"ocd-division/country:us",state,url:route.href,value,
      sources:[`source_copy:${value.source.copyId}`],source:{source:"Legistar members"},priority:type==="member"?20:10});
    records++;
  };
  // Every returned record has one work row, including empty boards and vacant offices.
  for(const body of raw.bodies)await add("body",body.BodyId,body.BodyId);
  for(const office of raw.offices)await add("member",office.OfficeRecordId,office.OfficeRecordBodyId);
  for(let start=0;start<offered.length;start+=100)await input.work.addMany(offered.slice(start,start+100));
  await input.facts.query(`INSERT INTO fact_store_load(source,sha256,loaded_at) VALUES($1,$2,$3)
    ON CONFLICT(source) DO UPDATE SET sha256=EXCLUDED.sha256,loaded_at=EXCLUDED.loaded_at`,[source,raw.signature,input.now]);
  return {unchanged:false,records};
}
