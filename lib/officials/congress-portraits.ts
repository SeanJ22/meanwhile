import { acquireKnownRelease } from "../sources/known-release.ts";
import { readSourceApi } from "../control-plane/scheduler/scout-api.ts";
import { portraitHash, type PortraitCapture } from "../photos/evidence.ts";
import { storeVerifiedPortrait } from "../photos/store.ts";
import type { FederalDirectoryReadModel } from "./federal-directory-data-plane.ts";

/** Targeted existing Congress API enrichment, independent of roster availability. */
export async function congressPortraits(value: FederalDirectoryReadModel, now: string, signal?: AbortSignal): Promise<FederalDirectoryReadModel> {
  if (!process.env.CONGRESS_API_KEY) return value;
  const holders=value.roster.officeholders.map(row=>({...row}));
  const due=holders.filter(row=>!row.photo?.verification || Date.parse(now)-Date.parse(row.photo.verification.checkedAt)>=30*86400000).sort((a,b)=>a.id.localeCompare(b.id));
  const size=24,groups=Math.max(1,Math.ceil(due.length/size)),start=(Math.floor(Date.parse(now)/86400000)%groups)*size;
  for(const person of due.slice(start,start+size)) {
    if(signal?.aborted) break;
    try {
      const bioguide=person.id.slice(9),url=`https://api.congress.gov/v3/member/${bioguide}?format=json`;
      const page=await acquireKnownRelease({sourceId:"congress-member",releaseId:bioguide,url,parserVersion:"congress-member-portrait/1",maxBytes:1024*1024,checkAfterMs:7*86400000,signal:signal ?? AbortSignal.timeout(20000),
        fetchImpl:async()=>{const result=await readSourceApi("congress_api",{path:`member/${bioguide}`,params:{format:"json"}});return new Response(result.text,{status:result.status,headers:{"content-type":"application/json"}});},
        validate:bytes=>{const row=JSON.parse(new TextDecoder().decode(bytes)).member;if(row?.bioguideId!==bioguide)throw Error("CONGRESS_MEMBER_ID_MISMATCH");}});
      const text=new TextDecoder().decode(page.bytes),member=JSON.parse(text).member;
      if(typeof member.depiction?.imageUrl!=="string")continue;
      const capture:PortraitCapture={transport:"REACHABLE",partial:false,httpStatus:page.httpStatus,observedAt:page.checkedAt,
        evidence:{retrievedAt:page.retrievedAt,vaultKey:page.vaultKey,canonicalUrl:page.finalUrl,sourceId:"Congress.gov",contentHash:portraitHash(page.bytes),text}};
      person.photo=await storeVerifiedPortrait(person.personId ?? person.id,{subject:{personId:person.personId ?? person.id,name:person.name,nativeIds:person.nativeIds,profileUrls:[url]},imageUrl:member.depiction.imageUrl,captures:[capture]},now);
    } catch { /* An optional API/image failure leaves the accepted person and previous portrait in place. */ }
  }
  return {...value,roster:{...value.roster,officeholders:holders}};
}
