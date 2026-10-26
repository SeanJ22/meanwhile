import test from "node:test";
import assert from "node:assert/strict";
import { refreshFederalKeyVotes } from "../lib/votes/key-vote-refresh.ts";
import { keyVoteSelectionInputHash,federalKeyVoteSourceHash } from "../lib/votes/key-vote-source-hash.ts";
import { federalKeyVoteSelectionV1Snapshot } from "../lib/votes/key-vote-selection-v1.ts";
import { heldAcquisitions } from "../lib/votes/data-plane.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { CivicReadCache } from "../lib/db/civic-read-cache.ts";

const firstAt="2026-10-20T12:00:00.000Z",later="2026-10-20T12:30:00.000Z";
const bridge=JSON.stringify([{id:{bioguide:"A000001",lis:"S001"}}]);
const house='<rollcall-vote><vote-question>On Passage</vote-question><yea-total>1</yea-total><nay-total>0</nay-total><recorded-vote><legislator name-id="A000001">Member</legislator><vote>Yea</vote></recorded-vote></rollcall-vote>';
const senate='<roll_call_vote><vote_question_text>On Passage</vote_question_text><yeas>1</yeas><nays>0</nays><member><vote_cast>Yea</vote_cast><lis_member_id>S001</lis_member_id></member></roll_call_vote>';
function memoryCache(){const data=new Map<string,string>();return new CivicReadCache({read:async key=>data.get(key)??null,write:async(key,value)=>{data.set(key,value);}});}
const response=(url:string)=>new Response(url.includes("unitedstates.github.io")?bridge:url.includes("clerk.house.gov")?house:senate);

test("reviewed key votes confirm equal source bytes before held payload/history reads while reacquiring every current source",async()=>{
  const store=new MemoryRoutineDataStore(),vault=new MemoryEvidenceStore(),cache=memoryCache(),requests=new Map<string,number>();
  const fetchImpl:typeof fetch=async input=>{const url=String(input);requests.set(url,(requests.get(url)??0)+1);return response(url);};
  const first=await refreshFederalKeyVotes({store,vault,cache,fetchImpl,spacingMs:0,now:()=>firstAt});
  assert.ok(first.publication?.outcome.promoted,first.publication?.outcome.candidate.failureDetail??"key votes did not promote");
  const candidate=first.publication.candidate;
  assert.equal(candidate.retrieval.rawHashBasis,"SOURCE_CONTENT_V1");
  assert.equal(candidate.retrieval.complete,true);
  store.readPromotion=async()=>{throw Error("unchanged key-vote payload read");};
  store.readCandidate=async()=>{throw Error("unchanged key-vote candidate read");};
  store.readCandidateProof=async()=>{throw Error("unchanged key-vote proof/history read");};
  const second=await refreshFederalKeyVotes({store,vault,cache,fetchImpl,spacingMs:0,now:()=>later});
  assert.equal(second.publication,null);assert.equal(second.confirmation?.head.versionId,candidate.id);
  assert.equal(second.confirmation?.at,later);
  assert.ok([...requests.values()].every(count=>count===2),"a completed pass does not replay its last source observations on the next due run");
});

test("reviewed selection and current identity content participate in the source hash; read dates and acquisition order do not",()=>{
  const selection=federalKeyVoteSelectionV1Snapshot(firstAt),selectionHash=keyVoteSelectionInputHash(selection);
  const checked=structuredClone(selection);checked.fetchedAt=later;
  for(const entry of checked.entries)for(const ref of [...entry.house,...entry.senate]){ref.question="Newly checked wording";ref.tally="1-0";ref.verifiedAt=later.slice(0,10);}
  assert.equal(keyVoteSelectionInputHash(checked),selectionHash);
  checked.entries[0].explainer+=" Source correction.";
  assert.notEqual(keyVoteSelectionInputHash(checked),selectionHash);
  const sources=heldAcquisitions([{requestedUrl:"https://clerk.house.gov/evs/2026/roll001.xml",finalUrl:"https://clerk.house.gov/evs/2026/roll001.xml",httpStatus:200,body:house}]);
  const probe={formatVersion:1 as const,selectionHash,identifierSourceHash:"a".repeat(64),identifierSourceUrl:"https://unitedstates.github.io/congress-legislators/legislators-current.json",complete:true};
  assert.notEqual(federalKeyVoteSourceHash(sources,probe),federalKeyVoteSourceHash(sources,{...probe,identifierSourceHash:"b".repeat(64)}));
  assert.equal(federalKeyVoteSourceHash(sources,probe),federalKeyVoteSourceHash([...sources].reverse().map(source=>({...source,retrievedAt:later})),probe));
});

test("key-vote deadline continuation reuses only completed exact documents and keeps their original check time",async()=>{
  const store=new MemoryRoutineDataStore(),vault=new MemoryEvidenceStore(),cache=memoryCache(),controller=new AbortController();
  const requests=new Map<string,number>();let official=0,firstUrl="",cutoff=true;
  const fetchImpl:typeof fetch=async input=>{
    const url=String(input);requests.set(url,(requests.get(url)??0)+1);
    if(!url.includes("unitedstates.github.io")){
      firstUrl||=url;official++;
      if(cutoff&&official===2){controller.abort(Error("controlled deadline"));throw Error("controlled deadline");}
    }
    return response(url);
  };
  await assert.rejects(refreshFederalKeyVotes({store,vault,cache,fetchImpl,spacingMs:0,signal:controller.signal,now:()=>firstAt}),/controlled deadline/);
  cutoff=false;
  const resumed=await refreshFederalKeyVotes({store,vault,cache,fetchImpl,spacingMs:0,now:()=>later});
  assert.ok(resumed.publication?.outcome.promoted);
  assert.equal(requests.get(firstUrl),1,"a completed source before cutoff is not fetched again while resuming the pass");
  assert.equal(requests.get("https://unitedstates.github.io/congress-legislators/legislators-current.json"),2,"the identity bridge is independently checked each pass");
  assert.equal(resumed.publication.candidate.retrieval.retrievedAt,firstAt,"the resumed prefix is never restamped as newly acquired");
});
