import assert from "node:assert/strict";
import test from "node:test";
import { curatedDefinitionEntries, curatedMeasureMigrationInventory, runCuratedDefinitionMigrations, runCuratedMeetingMigrations, curatedMeetingEntries } from "../lib/translate/curated-migration.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { readTranslations } from "../lib/translate/publication.ts";
import { translationHash } from "../lib/translate/records.ts";
import type { ModelRequest, ModelResponse } from "../lib/control-plane/scheduler/scout-executor.ts";
import type { WorkerPublicationCapture } from "../lib/civic-data/worker-roster-publication.ts";
import type { TranslationAttempt } from "../lib/translate/standing.ts";
import { readCuratedBodyDefinitions } from "../lib/officials/curated-definition-reader.ts";
import { MINUTES_SUMMARIES } from "../lib/meetings/minutes-summaries.ts";
import { NOTICE_SUMMARIES } from "../lib/meetings/notice-summary.ts";
import { definitionsForBody } from "../lib/officials/body-definitions.ts";
import { installRegistryRuntimeFirstSeeds } from "./helpers/registry-runtime-first-seed.ts";
await installRegistryRuntimeFirstSeeds();
const now="2026-10-05T23:40:00Z", ocdId="ocd-division/country:us/state:az";
const response=(request:ModelRequest,input:unknown):ModelResponse=>({model:request.model,stop_reason:"tool_use",
 content:[{type:"tool_use",id:"fixture",name:request.tools[0].name,input}],usage:{input_tokens:10,output_tokens:10}});
test("curated definitions keep exact text/citations through two guarded calls, durable attempts, normal Slide and typed reader",async()=>{
 const entry=curatedDefinitionEntries("AZ").find(row=>row.key==="class:az:county")!;
 assert.ok(entry);assert.equal(entry.ocdId,ocdId);
 const source=`County authority\n${entry.preservedText.text}`;
 const primary:WorkerPublicationCapture={evidence:{artifactId:"original-source",acquiredByAttemptId:"fixture",canonicalUrl:entry.preservedText.origin.citation.url!,
  contentHash:`sha256-${translationHash(source)}`,text:source,retrievedAt:now,sourceId:"county-law",methodRouteId:"held-law"},observedAt:now,httpStatus:200,transport:"REACHABLE",partial:false};
 const sentences=entry.preservedText.text.split(/(?<=[.!?])\s+(?=[A-Z])/u).map(text=>({field:"text",text,quote:text}));
 const repos=createMemoryRepositories(),store=new MemoryRoutineDataStore(),attempts:TranslationAttempt[]=[];
 const supported=true;let calls=0,rewrite=false;
 const run=(capture=primary,at=now)=>runCuratedDefinitionMigrations({repos,store,now:at,divisions:[ocdId],entries:[entry],bindings:[{key:entry.key,label:"County authority",sourceUrl:primary.evidence.canonicalUrl}],captures:[capture],attempts,
  saveAttempt:async attempt=>{attempts.push(attempt);},transportFor:()=>async request=>{calls++;assert.ok(attempts.some(row=>row.status==="RUNNING"));
   if(request.tools[0].name==="write_text_translation"){
    assert.equal(JSON.parse(request.messages[0].content as string).curatedText,entry.preservedText.text);
    return response(request,{text:rewrite?"Changed text.":entry.preservedText.text,sentences});
   }
   return response(request,{checked:sentences.map(({field,text})=>({field,text,supported}))});
  }});
 const first=await run();assert.equal(first.outcomes[0]?.status,"PUBLISHED",JSON.stringify(first));assert.equal(calls,2);
 const held=(await readTranslations([ocdId],{store,now,bypassCache:true}))[0];
 assert.equal(held.kind,"BODY_CLASS");
 assert.equal(held.text,entry.preservedText.text);assert.deepEqual(held.curatedOrigin,entry.preservedText.origin);assert.notEqual(held.writerModel,held.checkerModel);
 assert.equal((await run()).outcomes[0]?.status,"REUSED");assert.equal(calls,2);
 const body={bodyId:`${ocdId}/county:pima#board_of_supervisors`,ocdId:`${ocdId}/county:pima`,divisionType:"county"};
 const before=definitionsForBody(body),after=await readCuratedBodyDefinitions(body,{store,now,bypassCache:true});
 assert.deepEqual(after,before,"reader preserves original displayed text and citation");
 const changedText=source+" Revision.";const changed={...primary,evidence:{...primary.evidence,text:changedText,contentHash:`sha256-${translationHash(changedText)}`}};
 rewrite=true;
 const refused=await run(changed,"2026-10-05T23:41:00Z");assert.equal(refused.outcomes[0]?.status,"HELD");assert.equal(refused.outcomes[0]?.usage.length,1,"rejected annotation cannot lose its charge");
 assert.deepEqual((await readTranslations([ocdId],{store,now,bypassCache:true}))[0],held,"rewrite never advances GOOD");
});
test("the migration inventory preserves every legacy reaction subject and unknown number without assigning it",()=>{
 const inventory=curatedMeasureMigrationInventory();
 assert.equal(inventory.length,15);assert.equal(inventory.flatMap(row=>row.preservedReactionIds).length,52);
 assert.equal(inventory.flatMap(row=>row.unknownNumberIds).length,52);
 assert.equal(new Set(inventory.flatMap(row=>row.preservedReactionIds)).size,52);
 assert.ok(inventory.every(row=>row.original.parts.every(part=>part.number===null)));
 assert.ok(curatedDefinitionEntries("MI").every(row=>row.ocdId.startsWith("ocd-division/country:us/state:mi")));
 assert.ok(curatedDefinitionEntries("PR").every(row=>row.ocdId.startsWith("ocd-division/country:us/territory:pr")));
});

test("original minutes migrate only with the exact held sitting/body/document and normal source admission; changed notice revisions stay owed",async()=>{
 const row=MINUTES_SUMMARIES[0],county="ocd-division/country:us/state:az/county:pima",bodyId=`${county}#board_of_supervisors`;
 const text=`Board meeting summary\n${row.summary}`,hash=translationHash(text);
 const primary:WorkerPublicationCapture={evidence:{artifactId:"minutes-source",acquiredByAttemptId:"fixture",canonicalUrl:row.minutesUrl,
  contentHash:`sha256-${hash}`,text,retrievedAt:now,sourceId:row.sourceOrg,methodRouteId:"held-minutes"},observedAt:now,httpStatus:200,transport:"REACHABLE",partial:false};
 const linkingText=`<a href="${row.minutesUrl}">Board meeting summary</a>`;
 const linking:WorkerPublicationCapture={...primary,evidence:{...primary.evidence,artifactId:"official-link",canonicalUrl:"https://www.pima.gov/minutes",
  text:linkingText,contentHash:`sha256-${translationHash(linkingText)}`}};
 const meetings=[{id:row.meetingId,bodyId,ocdId:county}],documents=[{kind:"MINUTES" as const,meetingId:row.meetingId,bodyId,ocdId:county,url:row.minutesUrl,hash,label:"Board meeting summary"}];
 const entries=curatedMeetingEntries({meetings,documents});assert.equal(entries.length,1);assert.equal(entries[0].preservedText.text,row.summary);
 assert.equal(curatedMeetingEntries({meetings,documents:[{...documents[0],bodyId:"foreign"}]}).length,0);
 const notice=NOTICE_SUMMARIES[0];assert.ok(notice);
 assert.equal(curatedMeetingEntries({meetings:[{id:notice.meetingId,bodyId,ocdId:county}],documents:[{kind:"AGENDA",meetingId:notice.meetingId,bodyId,ocdId:county,url:notice.summarizesUrl,hash:"0".repeat(64),label:"Meeting"}]}).length,0);
 const repos=createMemoryRepositories(),store=new MemoryRoutineDataStore(),attempts:TranslationAttempt[]=[];
 const sentences=row.summary.split(/(?<=[.!?])\s+(?=[A-Z])/u).map(text=>({field:"text",text,quote:text}));
 const result=await runCuratedMeetingMigrations({repos,store,now,divisions:[county],meetings,documents,captures:[primary,linking],attempts,
  saveAttempt:async attempt=>{attempts.push(attempt);},transportFor:()=>async request=>response(request,request.tools[0].name==="write_text_translation"
   ? {text:row.summary,sentences} : {checked:sentences.map(({field,text})=>({field,text,supported:true}))})});
 assert.equal(result.outcomes[0]?.status,"PUBLISHED",JSON.stringify(result));
 const held=(await readTranslations([county],{store,now,bypassCache:true}))[0];
 assert.equal(held.kind,"MINUTES");assert.equal(held.text,row.summary);assert.equal(held.curatedOrigin?.citation.url,row.minutesUrl);
 assert.equal(held.curatedOrigin?.citation.readOn,row.readAt);assert.equal(held.meeting?.documentHash,hash);
});
