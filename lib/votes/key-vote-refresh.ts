import { createHash,randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { federalKeyVoteSelectionV1Snapshot } from "./key-vote-selection-v1.ts";
import { keyVoteSelectionInputHash,federalKeyVoteSourceHash,type FederalKeyVoteSourceProbe } from "./key-vote-source-hash.ts";
import { FEDERAL_KEY_VOTE_SCOPE,FEDERAL_VOTES_PARSER_VERSION,FEDERAL_VOTES_SOURCE_ID,federalKeyVotesCandidate,heldAcquisitions,
  type FederalKeyVotePositions,type FederalKeyVotesSnapshot,type OfficialAcquisition } from "./data-plane.ts";
import type { VotePosition } from "./types.ts";
import { confirmSourceHashUnchanged } from "../civic-data/source-hash.ts";
import { processRegisteredManualCandidate } from "../civic-data/promotion.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";
import { failedAcquisitionCandidate } from "../civic-data/candidate-builders.ts";
import { runtimeCivicReadCache,type CivicReadCache } from "../db/civic-read-cache.ts";
import { rawCaptureVault } from "../civic-data/raw-capture-remote.ts";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import { continueOfficialVoteDocument } from "../state-rollcalls/source-continuation.ts";
import { passDeadlineFromEnv } from "../ops/independent-runtime-pass.ts";
import { canonicalCivicDataHash } from "../civic-data/canonical-hash.ts";

const bridgeUrl="https://unitedstates.github.io/congress-legislators/legislators-current.json";
const namespace="source-probe-progress:v1",progressKey="federal-key-votes";
const digest=(value:Uint8Array|string)=>createHash("sha256").update(value).digest("hex");
function textOf(xml:string,...names:string[]):string|null {
  for(const name of names){const match=new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`,"i").exec(xml);if(match)return match[1].replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();}
  return null;
}
function tallyOf(xml:string,chamber:"house"|"senate"):string|null {
  if(chamber==="house"){const total=[...xml.matchAll(/<yea-total>(\d+)<\/yea-total>\s*<nay-total>(\d+)<\/nay-total>/gi)].at(-1);return total?`${total[1]}-${total[2]}`:null;}
  const yeas=textOf(xml,"yeas"),nays=textOf(xml,"nays");return yeas&&nays&&/^\d+$/.test(yeas)&&/^\d+$/.test(nays)?`${yeas}-${nays}`:null;
}
function positionOf(raw:string):VotePosition|null {
  const value=raw.trim().toLowerCase();
  if(["yea","aye","yes","guilty"].includes(value)) return "YES";
  if(["nay","no","not guilty"].includes(value)) return "NO";
  if(value==="present") return "PRESENT";
  if(["not voting","absent"].includes(value)) return "NOT_VOTING";
  return null;
}

/** The full reviewed selection is acquired before its held output is consulted. */
export async function refreshFederalKeyVotes(input:{readonly store:RoutineDataStore;readonly fetchImpl?:typeof fetch;
  readonly vault?:EvidenceStore;readonly cache?:CivicReadCache;readonly signal?:AbortSignal;readonly spacingMs?:number;readonly now?:()=>string}) {
  const now=input.now??(()=>new Date().toISOString()),snapshot=federalKeyVoteSelectionV1Snapshot(now());
  const selectionHash=keyVoteSelectionInputHash(snapshot),copies=(input.cache??runtimeCivicReadCache()).jobState();
  const saved=await copies.readCheckpoint<{passId:string;selectionHash:string}>(namespace,progressKey);
  const progress=saved?.passId&&saved.selectionHash===selectionHash?saved:{passId:randomUUID(),selectionHash};
  await copies.checkpoint(namespace,progressKey,progress);
  const vault=input.vault??rawCaptureVault(),fetcher=input.fetchImpl??fetch;
  const signal=()=>input.signal??AbortSignal.timeout(Math.max(1,Math.min(60_000,passDeadlineFromEnv()-Date.now())));
  const read=async(url:string,context:string,reuse:boolean)=>continueOfficialVoteDocument({sourceId:FEDERAL_VOTES_SOURCE_ID,
    parserVersion:FEDERAL_VOTES_PARSER_VERSION,context,url,vault,cache:input.cache,signal:signal(),now,reuse,read:async()=>{
      if(url!==bridgeUrl)await delay(input.spacingMs??350,undefined,{signal:signal()});
      const response=await fetcher(url,{headers:{"user-agent":"Meanwhile/1.0 (+https://www.meanwhile.chat)"},signal:signal()});
      if(response.status!==200)throw Error(`${url} -> HTTP ${response.status}`);
      return{requestedUrl:url,finalUrl:response.url||url,httpStatus:response.status,bytes:new Uint8Array(await response.arrayBuffer()),retrievedAt:now()};
    }});
  let bridge:Awaited<ReturnType<typeof read>>;
  try{bridge=await read(bridgeUrl,canonicalCivicDataHash(progress),false);}
  catch(error){
    if(input.signal?.aborted||Date.now()>=passDeadlineFromEnv())throw error;
    const at=now(),candidate=failedAcquisitionCandidate({sourceId:FEDERAL_VOTES_SOURCE_ID,recordClass:"FEDERAL_KEY_VOTE",scope:FEDERAL_KEY_VOTE_SCOPE,
      requestedUrl:"https://www.senate.gov/legislative/",attemptedAt:at,failureDetail:`Current federal identity bridge failed: ${error instanceof Error?error.message:String(error)}`,
      parserVersion:FEDERAL_VOTES_PARSER_VERSION});
    const outcome=await processRegisteredManualCandidate(input.store,"federal-key-votes",candidate,at);
    return{confirmation:null,publication:{candidate,outcome},counts:null,failures:[candidate.retrieval.failureDetail!]};
  }
  const identifierSourceHash=digest(bridge.bytes),context=canonicalCivicDataHash([progress,identifierSourceHash,bridge.finalUrl]);
  const urls=[...new Set(snapshot.entries.flatMap(entry=>[...entry.house,...entry.senate].flatMap(ref=>ref.url?[ref.url.endsWith(".htm")?`${ref.url.slice(0,-4)}.xml`:ref.url]:[])))];
  const documents=new Map<string,Awaited<ReturnType<typeof read>>>(),failures:string[]=[];
  for(const url of urls)try{documents.set(url,await read(url,context,true));}catch(error){
    signal().throwIfAborted();if(Date.now()>=passDeadlineFromEnv())throw error;
    failures.push(error instanceof Error?error.message:String(error));
  }
  const acquisitions:OfficialAcquisition[]=[...documents.values()].map(document=>({requestedUrl:document.requestedUrl,finalUrl:document.finalUrl,
    httpStatus:document.httpStatus,body:new TextDecoder("utf-8",{fatal:true}).decode(document.bytes),rawHash:digest(document.bytes),
    byteCount:document.bytes.byteLength,retrievedAt:document.retrievedAt}));
  const sourceProbe:FederalKeyVoteSourceProbe={formatVersion:1,selectionHash,identifierSourceHash,identifierSourceUrl:bridge.finalUrl,complete:!failures.length&&documents.size===urls.length};
  const rawHash=federalKeyVoteSourceHash(heldAcquisitions(acquisitions),sourceProbe),retrievedAt=[bridge.retrievedAt,...acquisitions.map(row=>row.retrievedAt!)].sort()[0];
  const head=await input.store.readSourceHead("FEDERAL_KEY_VOTE",FEDERAL_KEY_VOTE_SCOPE),first=acquisitions[0];
  const confirmation=head?.rawHashBasis==="SOURCE_CONTENT_V1"&&first?await confirmSourceHashUnchanged({store:input.store,sourceId:FEDERAL_VOTES_SOURCE_ID,
    recordClass:"FEDERAL_KEY_VOTE",scope:FEDERAL_KEY_VOTE_SCOPE,parserVersion:FEDERAL_VOTES_PARSER_VERSION,rawHash,complete:sourceProbe.complete,now:now(),
    retrieval:{requestedUrl:first.requestedUrl,finalUrl:first.finalUrl,httpStatus:200,rawHash,retrievedAt}}):null;
  if(confirmation){await copies.checkpoint(namespace,progressKey,null);return{confirmation,publication:null,counts:null,failures:[]};}
  const legislators=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bridge.bytes)) as {id:{bioguide:string;lis?:string}}[];
  const current=new Set(legislators.map(person=>person.id.bioguide)),lis=new Map(legislators.flatMap(person=>person.id.lis?[[person.id.lis,person.id.bioguide] as const]:[]));
  const byRef=new Map<string,Record<string,VotePosition>>();
  let refsSeen=0,houseSeen=0,houseCurrent=0,senateSeen=0,senateCurrent=0;
  for(const entry of snapshot.entries)for(const chamber of ["house","senate"] as const)for(const ref of entry[chamber]){
    refsSeen++;if(!ref.url){failures.push(`${entry.id}/${chamber}/${ref.rollNumber}: reviewed selection has no official URL`);continue;}
    const url=ref.url.endsWith(".htm")?`${ref.url.slice(0,-4)}.xml`:ref.url,document=documents.get(url);
    if(!document)continue;
    const xml=new TextDecoder("utf-8",{fatal:true}).decode(document.bytes),question=chamber==="house"?textOf(xml,"vote-question","vote-desc"):textOf(xml,"vote_question_text","vote_title","question"),tally=tallyOf(xml,chamber);
    if(!question||!tally){failures.push(`${entry.id}/${chamber}/${ref.rollNumber}: official question or tally did not parse`);continue;}
    const positions:Record<string,VotePosition>={};
    if(chamber==="house")for(const match of xml.matchAll(/<recorded-vote>\s*<legislator name-id="([^"]+)"[^>]*>[\s\S]*?<\/legislator>\s*<vote>([^<]+)<\/vote>\s*<\/recorded-vote>/g)){
      houseSeen++;if(!current.has(match[1]))continue;houseCurrent++;const position=positionOf(match[2]);if(position)positions[`congress:${match[1]}`]=position;
    }else for(const match of xml.matchAll(/<member>[\s\S]*?<vote_cast>([^<]+)<\/vote_cast>[\s\S]*?<lis_member_id>([^<]+)<\/lis_member_id>[\s\S]*?<\/member>/g)){
      senateSeen++;const id=lis.get(match[2]);if(!id)continue;senateCurrent++;const position=positionOf(match[1]);if(position)positions[`congress:${id}`]=position;
    }
    if(!Object.keys(positions).length){failures.push(`${entry.id}/${chamber}/${ref.rollNumber}: parsed zero current-member positions`);continue;}
    ref.question=question;ref.tally=tally;ref.verifiedAt=document.retrievedAt.slice(0,10);
    byRef.set(`${entry.id}|${chamber}|${ref.congress}-${ref.session}:${ref.rollNumber}`,positions);
  }
  const positions:FederalKeyVotePositions={formatVersion:1,fetchedAt:retrievedAt,note:"Official per-roll positions for sitting members, keyed by reviewed question/chamber/roll identity. Missing members remain unknown, never DID_NOT_VOTE.",positions:Object.fromEntries(byRef)};
  const refreshedSnapshot:FederalKeyVotesSnapshot={...snapshot,fetchedAt:retrievedAt};
  const candidate=federalKeyVotesCandidate({acquisitions,retrievedAt,snapshot:refreshedSnapshot,positions,sourceProbe:{...sourceProbe,complete:sourceProbe.complete&&!failures.length}});
  const outcome=await processRegisteredManualCandidate(input.store,"federal-key-votes",candidate,now());
  if(outcome.promoted||outcome.confirmed)await copies.checkpoint(namespace,progressKey,null);
  return{confirmation:null,publication:{candidate,outcome},counts:{refsSeen,acquired:byRef.size,houseSeen,houseCurrent,senateSeen,senateCurrent},failures};
}
