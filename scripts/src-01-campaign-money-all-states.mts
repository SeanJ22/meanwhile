/** SRC-01: read-only production exports and local, state-scoped campaign-money replay. */
import assert from "node:assert/strict";
import {readFile,writeFile,mkdir,access,rename,appendFile} from "node:fs/promises";
import {createReadStream,createWriteStream} from "node:fs";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {Readable,Transform} from "node:stream";
import {pipeline} from "node:stream/promises";
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";
import {createServer} from "node:http";
import {neon} from "@neondatabase/serverless";
import {CAMPAIGN_FINANCE_SOURCES,campaignMoneySourceResources,campaignFinanceNativeScope} from "../lib/funding/state-sources.ts";
import {readCampaignMoneyPeople,CAMPAIGN_PEOPLE_SQL,bindCampaignMoney,campaignMoneyIdentityMatches,campaignMoneyPeopleIndex,campaignPersonKey,campaignRecordYear,CAMPAIGN_MONEY_MISSING_REASONS,campaignMoneyStateDue} from "../lib/funding/state-people.ts";
import type {CampaignMoneyPerson} from "../lib/funding/state-people.ts";
import type {CampaignSourceRecord} from "../lib/funding/state-source-records.ts";
import type {Query} from "../lib/facts/publish.ts";
import {canonicalJson} from "../lib/control-plane/repository/types.ts";
import {temporaryPath} from "../lib/civic-data/temporary-path.ts";

const [mode,root,credentialPath]=process.argv.slice(2);
assert.ok(mode&&root,"Use --export DATA_DIRECTORY READONLY_DSN_FILE");
const hash=(value:string|Uint8Array)=>createHash("sha256").update(value).digest("hex");
const personIdentity=(person:Record<string,unknown>)=>({id:person.id,name:person.name,seat:person.seat,office:person.office});
const unorderedSources=(sources:Record<string,unknown>[],locationsOnly=false)=>sources.map(source=>canonicalJson(locationsOnly?{url:source.url,filingUrl:source.filingUrl,publisher:source.publisher,official:source.official}:source)).sort();
if(mode==="--export"){
  assert.ok(credentialPath,"Pass the existing readonly DSN file");
  const sql=neon((await readFile(credentialPath,"utf8")).trim());
  const query:Query=async(text,params=[])=>await sql.query(text,[...params]) as Record<string,unknown>[];
  const [actor]=await query("SELECT current_user AS actor,current_database() AS database");
  assert.equal(actor.actor,"readonly","Refuse a production connection that is not the existing readonly role");
  const summary=[];
  for(const source of CAMPAIGN_FINANCE_SOURCES){
    const state=source.state,directory=join(root,state);await mkdir(directory,{recursive:true});
    const people=await readCampaignMoneyPeople(query,state);
    const captures=await query("SELECT name,position::jsonb AS capture FROM pass_cursor WHERE name LIKE $1 ORDER BY name",[`campaign-money:capture:${state}:%`]);
    const [work]=await query("SELECT position::jsonb AS work FROM pass_cursor WHERE name=$1",[campaignFinanceNativeScope(state)]);
    const cycles=await query(`SELECT f.id,f.entity_id,f.field,f.value,f.provenance_kind,f.source_copy_id,f.checked_at,f.live_at,f.produced_by,
      s.url,s.final_url,s.fetched_at,s.http_status,s.sha256,s.blob_key,s.is_archive
      FROM fact f JOIN entity e ON e.id=f.entity_id LEFT JOIN source_copy s ON s.id=f.source_copy_id
      WHERE e.state=$1 AND e.kind='person' AND f.field LIKE 'campaign-cycle:%' AND f.status='live'
        AND f.value#>>'{person,name}'=e.name ORDER BY f.entity_id,f.field`,[state]);
    const blanks=await query(`SELECT b.entity_id,b.field,b.reason,b.detail FROM blank b JOIN entity e ON e.id=b.entity_id
      WHERE e.state=$1 AND b.field LIKE 'campaign-money:%' ORDER BY b.entity_id,b.field`,[state]);
    const data={state,exportedAt:new Date().toISOString(),actor:actor.actor,people,captures,work:work?.work??null,cycles,blanks};
    const text=JSON.stringify(data);await writeFile(join(directory,"production.json"),text);
    const record={state,publishedPeople:people.length,productionCycles:cycles.length,sourceCaptures:captures.length,personBoundProfiles:campaignMoneySourceResources(state).length,sha256:hash(text)};
    summary.push(record);console.log(JSON.stringify(record));
  }
  await writeFile(join(root,"production-exports.json"),JSON.stringify(summary,null,2)+"\n");
}else if(mode==="--aggregate"){
  const states:Record<string,unknown>[]=[],exports=JSON.parse(await readFile(join(root,"production-exports.json"),"utf8"));
  const totals=new Map<string,{personSeatTargets:number;reasonTargets:number;correctOwnReasons:number;people:Set<string>;stateCardTargets:number;apiReasons:number;personCards:number;correctPersonCards:number;cardPeople:Set<string>;heldMoneyCards:number;productionCycleFacts:number;productionCyclesWithSameAmounts:number}>();
  for(const source of CAMPAIGN_FINANCE_SOURCES){
    const exported=exports.find((row:{state:string})=>row.state===source.state),directory=join(root,source.state);
    let result;try{result=JSON.parse(await readFile(join(directory,"replay.json"),"utf8"));}catch{
      states.push({...exported,reasonPersistence:"PENDING",readerCards:"PENDING",failure:"No completed state replay"});continue;
    }
    if(result.sourceFailures.some((failure:{detail:string})=>failure.detail.includes("The filesystem destination must stay"))){
      states.push({...exported,financialSourceCoverage:"INVALID_REPLAY_ENVIRONMENT",reasonPersistence:"PENDING_CORRECTED_REPLAY",readerCards:"PENDING_CORRECTED_REPLAY",sourceFailures:result.sourceFailures});continue;
    }
    const runs=[];
    for(const run of result.runs){
      const checks=(await readFile(run.reasonChecksPath??join(directory,`${run.at.slice(0,10)}-own-reasons.jsonl`),"utf8")).trim().split("\n").filter(Boolean).map(row=>JSON.parse(row));
      const correct=new Map<string,boolean>();for(const check of checks)correct.set(check.id,(correct.get(check.id)??true)&&check.equal);
      const ownReasonCounts:Record<string,number>={};for(const check of checks)ownReasonCounts[check.sourceExpectedReason]=(ownReasonCounts[check.sourceExpectedReason]??0)+1;
      const firstAggregateReason=Object.keys(run.publishedReport.reasons)[0]??CAMPAIGN_MONEY_MISSING_REASONS.absent;
      const cards=JSON.parse(await readFile(run.cardInputs,"utf8")),readerIds=new Set<string>(cards.map((card:{person:{id:string}})=>card.person.id));
      const wrongIds=new Set<string>((run.personCardMismatches??[]).map((row:{id:string})=>row.id));
      let samePersonIdentity=run.productionCyclesWithSamePersonIdentity??(run.productionCycleFacts===0?0:null);
      let sameSourceBindingSet:number|null=run.productionCycleFacts===0?0:null,sameSourceLocationSet:number|null=run.productionCycleFacts===0?0:null;
      {
        try{const stem=run.at.includes("T12:00:")?run.at.slice(0,10):run.at.slice(0,16).replaceAll(":","-"),differences=JSON.parse(await readFile(join(directory,`${stem}-cycle-differences.json`),"utf8"));
          type Difference={before:{person:Record<string,unknown>;sources:Record<string,unknown>[]};after:{person:Record<string,unknown>;sources:Record<string,unknown>[]} | null};
          samePersonIdentity=run.productionCycleFacts-differences.filter((row:Difference)=>row.after===null||canonicalJson(personIdentity(row.before.person))!==canonicalJson(personIdentity(row.after.person))).length;
          sameSourceBindingSet=run.productionCycleFacts-differences.filter((row:Difference)=>row.after===null||canonicalJson(unorderedSources(row.before.sources))!==canonicalJson(unorderedSources(row.after.sources))).length;
          sameSourceLocationSet=run.productionCycleFacts-differences.filter((row:Difference)=>row.after===null||canonicalJson(unorderedSources(row.before.sources,true))!==canonicalJson(unorderedSources(row.after.sources,true))).length;
        }catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
      }
      const total=totals.get(run.at)??{personSeatTargets:0,reasonTargets:0,correctOwnReasons:0,people:new Set<string>(),stateCardTargets:0,apiReasons:0,personCards:0,correctPersonCards:0,cardPeople:new Set<string>(),heldMoneyCards:0,productionCycleFacts:0,productionCyclesWithSameAmounts:0};
      total.personSeatTargets+=run.targets;total.reasonTargets+=run.reasonTargets;total.correctOwnReasons+=run.correctOwnReasons;
      for(const [id,equal]of correct)if(equal)total.people.add(id);
      total.stateCardTargets+=run.stateCardConsumers;total.apiReasons+=run.apiReasons;total.personCards+=run.personCardsRendered??0;total.correctPersonCards+=run.personCardsWithOwnReason??0;
      if(run.personCardsRendered!==undefined)for(const id of readerIds)if(!wrongIds.has(id))total.cardPeople.add(id);
      total.heldMoneyCards+=run.heldMoneyCards;total.productionCycleFacts+=run.productionCycleFacts;total.productionCyclesWithSameAmounts+=run.productionCyclesWithSameAmounts;
      totals.set(run.at,total);
      runs.push({at:run.at,personSeatTargets:run.targets,uniquePeople:run.uniquePeople,personSeatReasons:run.reasonTargets,correctPersonSeatReasons:run.correctOwnReasons,
        uniquePeopleWithCorrectOwnReason:[...correct.values()].filter(Boolean).length,stateCardTargets:run.stateCardConsumers,
        ownReasonCounts,firstAggregateReason,targetsThatWouldReceiveAnotherReasonFromTheFirstAggregate:checks.filter(check=>check.sourceExpectedReason!==firstAggregateReason).length,
        missingMoneyApiTargets:run.apiReasons,missingMoneyPersonCards:run.personCardsRendered??null,personCardsShowingOwnReason:run.personCardsWithOwnReason??null,
        uniquePeopleWhoseStateCardShowsOwnReason:[...readerIds].filter(id=>!wrongIds.has(id)).length,heldMoneyCards:run.heldMoneyCards,
        productionCycleFacts:run.productionCycleFacts,productionCyclesWithSameAmounts:run.productionCyclesWithSameAmounts,
        productionCyclesWithSamePersonBinding:run.productionCyclesWithSamePersonBinding??null,productionCyclesWithSameSourceBinding:run.productionCyclesWithSameSourceBinding??null,
        productionCyclesWithSamePersonIdentity:samePersonIdentity,
        productionCyclesWithSameSourceBindingSet:sameSourceBindingSet,productionCyclesWithSameSourceLocationSet:sameSourceLocationSet,
        productionCyclesWithSameSourceLocation:run.productionCyclesWithSameSourceLocation??null,
        productionCycleDifferenceCounts:run.productionCycleDifferenceCounts??null,liveCycleAmountAndBindingSha256:run.liveCycleAmountAndBindingSha256??null,
        cycleAmountsAndBindingsStableSincePriorRun:run.cycleAmountsAndBindingsStableSincePriorRun??null,
        publicationDurationMs:run.publicationDurationMs??null,reasonAndApiDurationMs:run.reasonAndApiDurationMs??null,personCardDurationMs:run.personCardDurationMs??null,
        reasonChecksSha256:run.reasonChecksSha256,personCardTextSha256:run.personCardTextSha256??null,hourlyClockDue:run.hourlyClockDue,tomorrowDue:run.tomorrowDue,
        mismatches:run.mismatches,personCardMismatches:run.personCardMismatches??[]});
    }
    const hasTargets=runs.some(run=>run.personSeatTargets>0);
    const runtimePublicationFailures=result.runs.flatMap((run:{at:string;publishedReport:{reasons:Record<string,number>}})=>Object.entries(run.publishedReport.reasons).filter(([reason])=>!(Object.values(CAMPAIGN_MONEY_MISSING_REASONS) as string[]).includes(reason)).map(([detail,count])=>({at:run.at,detail,count})));
    const financialSourceCoverage=runtimePublicationFailures.length||result.sourceFailures.length?(result.runs[0]?.publishedReport.loaded>0?"PARTIAL_SOURCE_FAILURES":"SOURCE_FAILURES"):result.financialSourceCoverage==="SUPPORTED"?(result.runs[0]?.sourceRows===0?"NO_SOURCE_ROWS":result.runs[0]?.publishedReport.loaded===0?"NO_PERSON_BOUND_ROWS":"SUPPORTED"):result.financialSourceCoverage;
    const financialPublicationFailure=financialSourceCoverage==="NO_SOURCE_ROWS"?"The real publisher response contained no financial rows after declared resource parsing.":financialSourceCoverage==="NO_PERSON_BOUND_ROWS"?"No source row bound to a production person and seat under the verified filing rules.":null;
    states.push({state:source.state,financialSourceCoverage,financialPublicationFailure,reasonPersistence:!hasTargets?"NO_PUBLISHED_TARGETS":runs.every(run=>run.correctPersonSeatReasons===run.personSeatReasons&&run.mismatches.length===0)?"PASS":"FAIL",
      readerCards:!hasTargets?"NO_PUBLISHED_TARGETS":runs.every(run=>run.personCardsShowingOwnReason===run.missingMoneyPersonCards&&run.missingMoneyPersonCards!==null&&run.personCardMismatches.length===0)?"PASS":"PENDING_OR_FAILED",
      productionInputSha256:result.productionInputSha256,personBoundProfiles:result.personBoundProfiles,unsupportedReason:result.unsupportedReason,
      normalizedSourceRows:result.runs[0]?.sourceRows??0,personBoundPublishedRows:result.runs[0]?.publishedReport.loaded??0,productionSourceCaptures:result.productionSourceCaptures,matchedProductionCaptures:result.matchedProductionCaptures,
      actualSourceResponses:result.sourceRequests.length,sourceFailures:result.sourceFailures,runtimePublicationFailures,
      independentSourceAuditDurationMs:result.independentSourceAuditDurationMs??null,localPlannerStatistics:result.localPlannerStatistics??"No explicit ANALYZE in this earlier replay",runs});
  }
  const infrastructureAttempts:Record<string,unknown>[]=[];
  for(const [file,state]of [["CT/original-attempt-failure.json","CT"],["CT/replay-path-guard-failure.json","CT"],["HI/original-failed-attempt/failure.json","HI"],["unsupported-replay-relocation.json","AS"]]){
    try{const text=await readFile(join(root,file),"utf8"),saved=JSON.parse(text);infrastructureAttempts.push({state,record:file,sha256:hash(text),
      originalResult:saved.result??saved.failure??"INVALID_REPLAY_ENVIRONMENT",recoveredByCompletedReplay:states.some(result=>result.state===state&&result.reasonPersistence==="PASS"&&result.readerCards==="PASS"),
      notes:saved.notes??(saved.failure?[saved.failure.context]:[...new Set(saved.sourceFailures.map((failure:{detail:string})=>failure.detail))]),productionWrites:0});}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
  }
  const runtimeRegressions:Record<string,unknown>[]=[];
  try{const text=await readFile(join(root,"WA/missing-seat-failure/manifest.json"),"utf8"),failure=JSON.parse(text),current=states.find(state=>state.state==="WA");
    runtimeRegressions.push({state:"WA",failure:failure.failure,record:"WA/missing-seat-failure/manifest.json",sha256:hash(text),before:{dayOneOwnReasons:failure.dayOneOwnReasons,nextRunOwnReasons:failure.failingNextRunOwnReasons,apiAndStorageMismatches:failure.failingApiAndStorageMismatches,personCards:failure.failingPersonCards},
      fix:failure.fix,recoveredByInitialHourlyAndTomorrowReplay:current?.reasonPersistence==="PASS"&&current?.readerCards==="PASS"&&(current.runs as {at:string}[]).some(run=>run.at.includes("T13:00:"))});
  }catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
  const supportingEvidence:Record<string,unknown>[]=[];
  for(const [state,file,record]of [["CT","CT/source-failure-details.json","campaign-money-ct-schema.json"],["HI","HI/person-binding-update-explanation.json","campaign-money-hi-roster.json"],["KY","KY/financial-update-explanation.json","campaign-money-ky-updates.json"],["SC","SC/financial-update-explanation.json","campaign-money-sc-updates.json"],["WA","WA/money-amount-change-explanation.json","campaign-money-wa-updates.json"],["VT","VT/paging-failure.json","campaign-money-vt-paging.json"]]){
    try{const text=await readFile(join(root,file),"utf8"),evidence=JSON.parse(text);supportingEvidence.push({state,kind:evidence.kind,record:`docs/measurements/src-01/${record}`,sha256:hash(text)});}
    catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
  }
  const proof={step:"SRC-01",source:"campaign-money",productionWrites:0,coverage:{routineStates:CAMPAIGN_FINANCE_SOURCES.length,
    statesWithPersonBoundProfiles:CAMPAIGN_FINANCE_SOURCES.filter(source=>campaignMoneySourceResources(source.state).length).map(source=>source.state),
    statesWithoutPersonBoundProfiles:CAMPAIGN_FINANCE_SOURCES.filter(source=>!campaignMoneySourceResources(source.state).length).map(source=>source.state)},
    upstream:"Registered campaign-money coordinator scripts/state-campaign-finance.mts (scope campaign-money:hourly) → per-state campaignMoneyStateDue/campaignMoneyWork, exact readonly production published people/person-seat targets, and real publisher HTTP bytes.",
    downstream:"refreshCampaignMoneyState person/seat blank → actual /api/campaign-finance handler → StateCampaignSection → actual PersonCard/CardFooter; federal FundingBlock targets remain on the FEC path and are counted separately.",
    method:"One state per worker process. Production writes are impossible through the verified readonly export role. Monetary writes and source archives are local. Initial and tomorrow runs execute publication/API/card code; WA additionally executes the next-hour missing-seat cohort. Other jurisdictions check hourly admission without a third publication. Subsequent source reads reuse retained real responses rather than claiming future live observations. The exact production people result is materialized locally for repeated reader SQL, preserving fields/aliases. Use disk-backed DATA_DIR under TMPDIR outside the repository; the original /tmp tmpfs exhaustion and incomplete attempts are retained separately. replayedStates includes a completed zero-target GU visit; statesWithPublishedTargets counts production jurisdictions with people; ownReasonPassStates and readerCardPassStates exclude GU.",
    reproduction:["--export DATA_DIR READONLY_DSN_FILE","--enrich-cycles DATA_DIR READONLY_DSN_FILE","--replay-all DATA_DIR unsupported","--replay-all DATA_DIR supported","--aggregate DATA_DIR OUTPUT_JSON"],
    completedStates:states.filter(state=>["PASS","FAIL","NO_PUBLISHED_TARGETS"].includes(String(state.reasonPersistence))).length,
    replayedStates:states.filter(state=>["PASS","FAIL","NO_PUBLISHED_TARGETS"].includes(String(state.reasonPersistence))).length,
    statesWithPublishedTargets:exports.filter((state:{publishedPeople:number})=>state.publishedPeople>0).length,
    ownReasonPassStates:states.filter(state=>state.reasonPersistence==="PASS").length,readerCardPassStates:states.filter(state=>state.readerCards==="PASS").length,infrastructureAttempts,runtimeRegressions,supportingEvidence,
    invalidReplayEnvironmentStates:states.filter(state=>state.financialSourceCoverage==="INVALID_REPLAY_ENVIRONMENT").map(state=>state.state),
    failedFinancialSourceStates:states.filter(state=>["PARTIAL_SOURCE_FAILURES","SOURCE_FAILURES","NO_SOURCE_ROWS","NO_PERSON_BOUND_ROWS"].includes(String(state.financialSourceCoverage))).map(state=>({state:state.state,financialSourceCoverage:state.financialSourceCoverage,personBoundPublishedRows:state.personBoundPublishedRows,sourceFailures:state.sourceFailures,runtimePublicationFailures:state.runtimePublicationFailures,reason:state.financialPublicationFailure})),
    unsupportedFinancialSourceStates:states.filter(state=>state.financialSourceCoverage==="UNSUPPORTED").map(state=>({state:state.state,reason:state.unsupportedReason})),
    failedReasonStates:states.filter(state=>state.reasonPersistence==="FAIL").map(state=>state.state),
    noPublishedTargetStates:states.filter(state=>state.reasonPersistence==="NO_PUBLISHED_TARGETS").map(state=>state.state),
    incompleteReaderStates:states.filter(state=>state.readerCards!=="PASS"&&state.readerCards!=="NO_PUBLISHED_TARGETS").map(state=>state.state),
    totals:[...totals].sort(([left],[right])=>left.localeCompare(right)).map(([at,total])=>({at,personSeatTargets:total.personSeatTargets,personSeatReasons:total.reasonTargets,correctPersonSeatReasons:total.correctOwnReasons,
      uniquePeopleWithCorrectOwnReason:total.people.size,stateCardTargets:total.stateCardTargets,missingMoneyApiTargets:total.apiReasons,missingMoneyPersonCards:total.personCards,
      personCardsShowingOwnReason:total.correctPersonCards,uniquePeopleWhoseStateCardShowsOwnReason:total.cardPeople.size,heldMoneyCards:total.heldMoneyCards,
      productionCycleFacts:total.productionCycleFacts,productionCyclesWithSameAmounts:total.productionCyclesWithSameAmounts})),states};
  const output=credentialPath??"docs/measurements/src-01/campaign-money-all-states.json";await writeFile(output,JSON.stringify(proof,null,2)+"\n");
  console.log(JSON.stringify({output,completedStates:proof.completedStates,failedReasonStates:proof.failedReasonStates,noPublishedTargetStates:proof.noPublishedTargetStates,incompleteCardStates:proof.incompleteReaderStates}));
}else if(mode==="--enrich-cycles"){
  assert.ok(credentialPath,"Pass the existing readonly DSN file");
  const sql=neon((await readFile(credentialPath,"utf8")).trim());
  const [actor]=await sql.query("SELECT current_user AS actor");assert.equal(actor.actor,"readonly");
  const summary=JSON.parse(await readFile(join(root,"production-exports.json"),"utf8"));
  for(const item of summary.filter((item:{productionCycles:number})=>item.productionCycles>0)){
    const path=join(root,item.state,"production.json"),data=JSON.parse(await readFile(path,"utf8"));
    data.personAliases=await sql.query("SELECT x.entity_id,x.scheme,x.value FROM entity_external_id x JOIN entity e ON e.id=x.entity_id WHERE e.state=$1 AND e.kind='person' AND x.scheme=$2",[item.state,`campaign-person:${item.state}`]);
    data.cyclePlaces=await sql.query(`SELECT DISTINCT ep.entity_id,ep.place_id,p.kind,p.name FROM entity_place ep JOIN entity p ON p.id=ep.place_id
      WHERE ep.entity_id IN (SELECT DISTINCT f.entity_id FROM fact f JOIN entity e ON e.id=f.entity_id WHERE e.state=$1 AND e.kind='person' AND f.field LIKE 'campaign-cycle:%' AND f.status='live')`,[item.state]);
    const text=JSON.stringify(data);await writeFile(path,text);item.sha256=hash(text);
    console.log(JSON.stringify({state:item.state,personAliases:data.personAliases.length,cyclePlaces:data.cyclePlaces.length}));
  }
  await writeFile(join(root,"production-exports.json"),JSON.stringify(summary,null,2)+"\n");
}else if(mode==="--replay-all"){
  const ordered=[...CAMPAIGN_FINANCE_SOURCES.filter(source=>!campaignMoneySourceResources(source.state).length),...CAMPAIGN_FINANCE_SOURCES.filter(source=>campaignMoneySourceResources(source.state).length)]
    .filter(source=>credentialPath!=="unsupported"||!campaignMoneySourceResources(source.state).length)
    .filter(source=>credentialPath!=="supported"||campaignMoneySourceResources(source.state).length);
  for(const source of ordered){
    const output=join(root,source.state,"replay.json");
    let status:number|null=0,exitSignal:NodeJS.Signals|null=null,phase="publication-and-api";
    try{const saved=JSON.parse(await readFile(output,"utf8"));assert.ok(saved.runs?.length>=2,"A completed state replay needs initial and tomorrow publication runs");console.log(JSON.stringify({state:source.state,status:"RETAINED_COMPLETED_REPLAY"}));}
    catch{
      try{await access(output);await rename(output,`${output}.incomplete-${Date.now()}`);}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
      const log=await import("node:fs/promises").then(fs=>fs.open(join(root,source.state,"replay.log"),"w"));
      const child=spawn(process.execPath,["--use-env-proxy","--experimental-strip-types","--import","./scripts/register-test-loader.mjs",fileURLToPath(import.meta.url),"--replay-state",root,source.state],{stdio:["ignore",log.fd,log.fd]});
      status=await new Promise<number|null>((resolve,reject)=>{child.once("error",reject);child.once("exit",(code,signal)=>{exitSignal=signal;resolve(code);});});await log.close();
    }
    if(status===0){
      const saved=JSON.parse(await readFile(output,"utf8"));
      if(saved.runs.some((run:Record<string,unknown>)=>run.personCardsRendered===undefined)){
        phase="reader-cards";
        const log=await import("node:fs/promises").then(fs=>fs.open(join(root,source.state,"cards.log"),"w"));
        const child=spawn(process.execPath,["--experimental-strip-types","--import","./scripts/register-test-loader.mjs",fileURLToPath(import.meta.url),"--cards-state",root,source.state],{stdio:["ignore",log.fd,log.fd]});
        status=await new Promise<number|null>((resolve,reject)=>{child.once("error",reject);child.once("exit",(code,signal)=>{exitSignal=signal;resolve(code);});});await log.close();
      }
    }
    const attempt={state:source.state,status:status===0?"COMPLETED":"REPLAY_FAILED",phase,exitCode:status,signal:exitSignal,recordedAt:new Date().toISOString()};
    await appendFile(join(root,source.state,"attempt-exits.jsonl"),JSON.stringify(attempt)+"\n");console.log(JSON.stringify(attempt));
  }
}else if(mode==="--cards-state"){
  const state=credentialPath;assert.ok(state,"Pass one state");
  const {build}=await import("esbuild"),{launchGuarded}=await import("./browser.mts");
  const directory=join(root,state),evidence=JSON.parse(await readFile(join(directory,"replay.json"),"utf8"));
  const built=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {PersonCard} from './components/ui/person-card.tsx';import {StateCampaignSection} from './components/funding/state-campaign-section.tsx';fetch('/inputs.json').then(response=>response.json()).then(rows=>createRoot(document.getElementById('root')).render(rows.map(({person,read,key})=><div key={key} data-replay-target={key}><PersonCard title={person.name} identity={<div>{person.name} · {person.office}</div>} contact={null} sections={{money:<StateCampaignSection divisionId={person.division} personId={person.id} data={read}/>}} sectionIds={['money']} defaultOpenSections={['money']} sources={[]} subject={{type:'CANDIDATE',id:person.id}}/></div>)));`,resolveDir:process.cwd(),sourcefile:"src01-all-state-money-card.tsx",loader:"tsx"},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",define:{"process.env.NODE_ENV":'"production"'},logLevel:"silent"});
  let currentBatch:Record<string,unknown>[]=[];
  const server=createServer((request,response)=>{
    if(request.url==="/reader.js")return response.writeHead(200,{"content-type":"application/javascript"}).end(built.outputFiles[0].text);
    if(request.url==="/inputs.json")return response.writeHead(200,{"content-type":"application/json"}).end(JSON.stringify(currentBatch));
    return response.writeHead(200,{"content-type":"text/html"}).end('<!doctype html><div id="root"></div><script src="/reader.js"></script>');
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));const address=server.address();assert.ok(address&&typeof address!=="string");
  const browser=await launchGuarded({label:`src01-campaign-money-${state.toLowerCase()}`,blockWrites:true});
  try{
    const page=await browser.page({viewport:{width:1000,height:700}});
    for(const run of evidence.runs){
      const cardStarted=performance.now();
      const cards=JSON.parse(await readFile(run.cardInputs,"utf8")),mismatches:Record<string,unknown>[]=[],digest=createHash("sha256");let rendered=0;
      for(let start=0;start<cards.length;start+=100){
        currentBatch=cards.slice(start,start+100).map((row:Record<string,unknown>,offset:number)=>({...row,key:String(start+offset)}));
        await page.goto(`http://127.0.0.1:${address.port}/?batch=${start}`);
        await page.waitForFunction(count=>document.querySelectorAll('[data-replay-target] [data-card-gap]').length===count,currentBatch.length);
        const text=await page.locator('[data-replay-target]').evaluateAll(elements=>elements.map(element=>({key:element.getAttribute('data-replay-target'),text:element.textContent??""})));
        for(const row of text){const card=cards[Number(row.key)],equal=row.text.includes(card.expectedReason);digest.update(JSON.stringify(row));if(equal)rendered++;else mismatches.push({id:card.person.id,seat:card.person.seat,sourceExpectedReason:card.expectedReason,readerText:row.text});}
      }
      run.personCardsRendered=cards.length;run.personCardsWithOwnReason=rendered;run.personCardTextSha256=digest.digest("hex");run.personCardMismatches=mismatches;
      run.personCardDurationMs=Math.round(performance.now()-cardStarted);
      console.log(JSON.stringify({state,at:run.at,cards:cards.length,correct:rendered,mismatches:mismatches.length}));
    }
    evidence.readerPath="Readonly production people → source bytes → refreshCampaignMoneyState → person/seat blank → actual /api/campaign-finance handler → StateCampaignSection → PersonCard/CardFooter";
    evidence.browser="System Chromium is explicitly substituted for pinned build 1234; actual person-card components, local replay transport, no site stylesheet.";
    await writeFile(join(directory,"replay.json"),JSON.stringify(evidence,null,2)+"\n");
  }finally{await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
}else if(mode==="--replay-state"){
  const state=credentialPath;assert.ok(state&&CAMPAIGN_FINANCE_SOURCES.some(source=>source.state===state),"Pass one covered state");
  temporaryPath(join(root,state));
  const {campaignDb}=await import("../tests/helpers/campaign-money-db.ts");
  const {DurableEvidenceStore}=await import("../lib/control-plane/evidence/durable-store.ts");
  const {refreshCampaignMoneyState}=await import("../lib/funding/state-publication.ts");
  const {campaignFinanceResources}=await import("../lib/funding/state-resource-index.ts");
  const {acquireCampaignFinanceResource}=await import("../lib/funding/state-acquisition.ts");
  const {isSourceAcquisitionFailure}=await import("../lib/civic-data/source-acquisition-error.ts");
  const {installFactReader}=await import("../lib/facts/db.ts");
  const {GET}=await import("../app/api/campaign-finance/route.ts");
  const {officeIdentity}=await import("../lib/officials/office-identity.ts");
  const directory=join(root,state),rawDirectory=join(directory,"http");await mkdir(rawDirectory,{recursive:true});
  const inputText=await readFile(join(directory,"production.json"),"utf8"),input=JSON.parse(inputText);
  const people=input.people as CampaignMoneyPerson[],profiles=campaignMoneySourceResources(state),db=await campaignDb();
  const vault=new DurableEvidenceStore(join(directory,"vault"),{remote:null}),acquisitionDirectory=join(directory,"downloads");
  let at="2026-10-23T12:00:00.000Z",network=true;
  const rawRequests:Record<string,unknown>[]=[];
  const requestKey=(url:string,init:RequestInit={})=>{
    const body=init.body?JSON.parse(String(init.body)):null;
    if(body&&typeof body==="object")for(const profile of profiles)if(profile.throughDateParameter)delete body[profile.throughDateParameter];
    return hash(JSON.stringify([url,init.method??"GET",body]));
  };
  const sourceFetch:typeof fetch=async(url,init={})=>{
    const target=String(url);assert.ok(!new URL(target).hostname.includes("sam.gov"),"This replay makes no SAM calls");
    const key=requestKey(target,init),metadataPath=join(rawDirectory,`${key}.json`),bodyPath=join(rawDirectory,`${key}.body`);
    let saved:Record<string,unknown>|null=null;
    try{saved=JSON.parse(await readFile(metadataPath,"utf8"));await access(bodyPath);}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
    let attempt=0;
    if(saved&&network&&(Number(saved.status)===429||Number(saved.status)>=500)){
      attempt=Number(saved.attempt??0)+1;
      await rename(metadataPath,join(rawDirectory,`${key}.attempt-${attempt}.json`));
      await rename(bodyPath,join(rawDirectory,`${key}.attempt-${attempt}.body`));saved=null;
    }
    if(!saved){
      if(!network)throw new Error(`No retained source response for ${target}`);
      const response=await fetch(url,{...init,signal:AbortSignal.any([...(init.signal?[init.signal]:[]),AbortSignal.timeout(90_000)])});
      const digest=createHash("sha256");let byteLength=0;
      if(response.body)await pipeline(Readable.fromWeb(response.body as never),new Transform({transform(chunk,_encoding,done){digest.update(chunk);byteLength+=chunk.length;done(null,chunk);}}),createWriteStream(bodyPath));
      else await writeFile(bodyPath,"");
      saved={url:target,status:response.status,headers:Object.fromEntries(response.headers),sha256:digest.digest("hex"),byteLength,capturedAt:new Date().toISOString(),attempt};
      await writeFile(metadataPath,JSON.stringify(saved));
    }
    rawRequests.push({url:target,status:saved.status,sha256:saved.sha256,byteLength:saved.byteLength,capturedAt:saved.capturedAt});
    const headers=new Headers(saved.headers as Record<string,string>);
    if(!network&&(new Headers(init.headers).has("if-none-match")||new Headers(init.headers).has("if-modified-since")))return new Response(null,{status:304,headers});
    return new Response(Readable.toWeb(createReadStream(bodyPath)) as ReadableStream,{status:Number(saved.status),headers});
  };
  const localQuery:Query=(text,params=[])=>{
    const materialized="SELECT id,name,seat,office,division,incumbent,source_url,aliases FROM replay_people";
    if(text===CAMPAIGN_PEOPLE_SQL)return db.query(materialized);
    return db.query(text.replaceAll(CAMPAIGN_PEOPLE_SQL,materialized+" WHERE $1::text IS NOT NULL AND $2::text IS NOT NULL")
      .replaceAll(CAMPAIGN_PEOPLE_SQL.replaceAll("$1","$5"),materialized+" WHERE $5::text IS NOT NULL AND $2::text IS NOT NULL"),params)
      .catch(error=>{console.error("Local replay query failed:",error.message);throw error;});
  };
  let localTransactions=0;
  const local={query:localQuery,transaction:async<T,>(work:Parameters<typeof db.transaction<T>>[0]):Promise<T>=>{
    const value=await db.transaction(work);
    // PGlite has no production PostgreSQL autovacuum worker to update a growing replay's planner statistics.
    if(++localTransactions%20===0)for(const table of ["fact","entity","entity_external_id"])await db.query(`ANALYZE ${table}`);
    return value;
  }};
  const purge=async()=>({purged:true});
  const baseOptions={state,query:localQuery,facts:local,vault,directory:acquisitionDirectory,now:()=>at,fetch:sourceFetch,purge};
  const expected=new Map<string,string>(),sourceFailures:{resource:string;reason:string;detail:string}[]=[];
  const index=campaignMoneyPeopleIndex(people);
  const failedSource=(resource:string,error:unknown)=>{
    const reason=isSourceAcquisitionFailure(error)&&error.code==="PUBLISHER_DOCUMENT_INVALID"?CAMPAIGN_MONEY_MISSING_REASONS.invalid:CAMPAIGN_MONEY_MISSING_REASONS.unavailable;
    sourceFailures.push({resource,reason,detail:error instanceof Error?error.message:String(error)});
    for(const person of people){const key=campaignPersonKey(state,person);if(!expected.has(key))expected.set(key,reason);}
  };
  let normalizedSourceRows=0;
  function sourceReason(row:CampaignSourceRecord):string{
    const year=campaignRecordYear(row);
    return year===null?CAMPAIGN_MONEY_MISSING_REASONS.period:year<2020?CAMPAIGN_MONEY_MISSING_REASONS.old:
      !row.cycle?CAMPAIGN_MONEY_MISSING_REASONS.cycle:row.filingState!=="FILED"?CAMPAIGN_MONEY_MISSING_REASONS.unfiled:
      !row.filerName||!row.candidateName||!row.office?CAMPAIGN_MONEY_MISSING_REASONS.identity:CAMPAIGN_MONEY_MISSING_REASONS.unmatched;
  }
  const publicStatePeople=people.filter(person=>!["us_senator","us_representative","president"].includes(officeIdentity(person.office)??""));
  const runs:Record<string,unknown>[]=[];
  let priorCycleSnapshot:string|null=null;
  const cycleProjection=(value:Record<string,unknown>)=>({person:value.person,
    totals:(value.totals as Record<string,unknown>[]).map(total=>({label:total.label,amount:total.amount})).sort((left,right)=>String(left.label).localeCompare(String(right.label))),
    sources:(value.sources as Record<string,unknown>[]).map(source=>({url:source.url,filingUrl:source.filingUrl,publisher:source.publisher,official:source.official,rawHash:source.rawHash,vaultKey:source.vaultKey}))});
  try{
    await db.query("CREATE TABLE replay_people(id text,name text,seat text,office text,division text,incumbent boolean,source_url text,aliases jsonb)");
    for(let start=0;start<people.length;start+=500){const batch=people.slice(start,start+500);await db.query(`INSERT INTO replay_people SELECT * FROM jsonb_to_recordset($1::jsonb) AS r(id text,name text,seat text,office text,division text,incumbent boolean,source_url text,aliases jsonb)`,[JSON.stringify(batch.map(person=>({...person,source_url:person.sourceUrl,aliases:person.aliases??[]})))]);}
    await db.query("CREATE INDEX ON replay_people(id)");
    await db.query(`INSERT INTO entity(id,kind,name,state) SELECT DISTINCT ON(id) id,'person',name,$1 FROM replay_people ORDER BY id`,[state]);
    const divisions=[...new Set(people.map(person=>person.division))];
    await db.query("INSERT INTO entity(id,kind,name,state) SELECT id,'place',id,$2 FROM unnest($1::text[]) id ON CONFLICT DO NOTHING",[divisions,state]);
    await db.query("INSERT INTO entity_place(entity_id,place_id) SELECT DISTINCT id,division FROM replay_people ON CONFLICT DO NOTHING");
    for(const cycle of input.cycles)await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'person',$2,$3) ON CONFLICT DO NOTHING",[cycle.entity_id,cycle.value.person.name,state]);
    for(const place of input.cyclePlaces??[]){
      await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",[place.place_id,place.kind,place.name,state]);
      await db.query("INSERT INTO entity_place(entity_id,place_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[place.entity_id,place.place_id]);
    }
    for(const alias of input.personAliases??[])await db.query("INSERT INTO entity_external_id(entity_id,scheme,value) SELECT $1,$2,$3 WHERE EXISTS(SELECT 1 FROM entity WHERE id=$1) ON CONFLICT DO NOTHING",[alias.entity_id,alias.scheme,alias.value]);
    for(const cycle of input.cycles){
      const [copy]=await db.query(`INSERT INTO source_copy(url,final_url,fetched_at,http_status,sha256,blob_key,is_archive) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(blob_key) DO UPDATE SET blob_key=EXCLUDED.blob_key RETURNING id`,[cycle.url,cycle.final_url,cycle.fetched_at,cycle.http_status,cycle.sha256,cycle.blob_key,cycle.is_archive]);
      await db.query(`INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,live_at,produced_by) VALUES($1,$2,$3,'production held cycle','live',$4,$5,'',$6,$7,$8)`,[cycle.entity_id,cycle.field,JSON.stringify(cycle.value),cycle.provenance_kind,copy.id,cycle.checked_at,cycle.live_at,cycle.produced_by]);
    }
    const auditStarted=performance.now();
    if(!profiles.length)for(const person of people)expected.set(campaignPersonKey(state,person),CAMPAIGN_MONEY_MISSING_REASONS.unsupported);
    else for await(const resource of campaignFinanceResources(state,{vault,profiles,signal:new AbortController().signal,fetch:sourceFetch,onFailure:async(id,_url,error)=>failedSource(id,error)})){
      try{
        for await(const page of acquireCampaignFinanceResource(state,resource,{vault,directory:acquisitionDirectory,signal:new AbortController().signal,fetch:sourceFetch,now:()=>at,releaseEveryMs:resource.kind==="SOCRATA"?3600000:86400000,selectRecord:row=>{
          normalizedSourceRows++;if(!bindCampaignMoney(row,index)){const matches=campaignMoneyIdentityMatches(row,index);if(matches.length===1)expected.set(campaignPersonKey(state,matches[0]),sourceReason(row));}return null;
        }}))void page;
      }catch(error){failedSource(resource.id,error);}
    }
    const independentSourceAuditDurationMs=Math.round(performance.now()-auditStarted);
    network=false;
    installFactReader(localQuery);
    for(const clock of state==="WA"?["2026-10-23T12:00:00.000Z","2026-10-23T13:00:00.000Z","2026-10-24T12:00:00.000Z"]:["2026-10-23T12:00:00.000Z","2026-10-24T12:00:00.000Z"]){
      at=clock;const publicationStarted=performance.now(),result=await refreshCampaignMoneyState(baseOptions),publicationDurationMs=Math.round(performance.now()-publicationStarted),readerStarted=performance.now();
      console.log(JSON.stringify({state,at:clock,phase:"publication-finished",publicationDurationMs,publishedReport:result.report.records[0]}));
      const blanks=await localQuery("SELECT entity_id,field,detail FROM blank WHERE field LIKE 'campaign-money:%'");
      const byTarget=new Map(blanks.map(blank=>[`${blank.entity_id}\0${String(blank.field).slice("campaign-money:".length)}`,String(blank.detail)]));
      const mismatches:Record<string,unknown>[]=[],checks:Record<string,unknown>[]=[],cards:Record<string,unknown>[]=[];
      for(const person of people){
        const actual=byTarget.get(`${person.id}\0${person.seat}`);if(actual===undefined)continue;
        const wanted=expected.get(campaignPersonKey(state,person))??CAMPAIGN_MONEY_MISSING_REASONS.absent;
        const check={id:person.id,seat:person.seat,sourceExpectedReason:wanted,persistedReason:actual,equal:actual===wanted};checks.push(check);if(!check.equal)mismatches.push(check);
      }
      let apiReasons=0,heldMoneyCards=0;
      for(const person of publicStatePeople){
        const response=await GET(new Request(`http://replay.local/api/campaign-finance?${new URLSearchParams({division:person.division,person:person.id})}`));
        if(response.status!==200){mismatches.push({stage:"public-api",id:person.id,seat:person.seat,division:person.division,status:response.status,detail:await response.text()});continue;}
        const read=await response.json();
        if(read.records.length){heldMoneyCards++;continue;}
        const wanted=expected.get(campaignPersonKey(state,person))??CAMPAIGN_MONEY_MISSING_REASONS.absent;
        const equal=read.missingReason===wanted;
        if(!equal)mismatches.push({stage:"public-api",id:person.id,seat:person.seat,sourceExpectedReason:wanted,readerReason:read.missingReason});
        else apiReasons++;
        cards.push({person,read,expectedReason:wanted});
      }
      const runStem=clock.includes("T12:00:")?clock.slice(0,10):clock.slice(0,16).replaceAll(":","-"),checksText=checks.map(check=>JSON.stringify(check)).join("\n")+"\n",cardsPath=join(directory,`${runStem}-cards.json`),reasonChecksPath=join(directory,`${runStem}-own-reasons.jsonl`);
      await writeFile(reasonChecksPath,checksText);await writeFile(cardsPath,JSON.stringify(cards));
      const liveCycles=await localQuery("SELECT entity_id,field,value FROM fact WHERE field LIKE 'campaign-cycle:%' AND status='live' ORDER BY entity_id,field");
      const cycleDifferences:Record<string,unknown>[]=[];let preserved=0,samePerson=0,samePersonIdentity=0,sameSource=0,sameSourceLocation=0;
      const locations=(sources:ReturnType<typeof cycleProjection>["sources"])=>sources.map(source=>({url:source.url,filingUrl:source.filingUrl,publisher:source.publisher,official:source.official}));
      for(const old of input.cycles){
        const current=liveCycles.find(current=>current.entity_id===old.entity_id&&current.field===old.field),before=cycleProjection(old.value),after=current?cycleProjection(current.value as Record<string,unknown>):null;
        const amountsEqual=after!==null&&canonicalJson(before.totals)===canonicalJson(after.totals),personEqual=after!==null&&canonicalJson(before.person)===canonicalJson(after.person),sourceEqual=after!==null&&canonicalJson(before.sources)===canonicalJson(after.sources);
        const sourceLocationEqual=after!==null&&canonicalJson(locations(before.sources))===canonicalJson(locations(after.sources));
        if(amountsEqual)preserved++;if(personEqual)samePerson++;if(after!==null&&canonicalJson(personIdentity(before.person as Record<string,unknown>))===canonicalJson(personIdentity(after.person as Record<string,unknown>)))samePersonIdentity++;if(sourceEqual)sameSource++;if(sourceLocationEqual)sameSourceLocation++;
        if(!amountsEqual||!personEqual||!sourceEqual)cycleDifferences.push({entity:old.entity_id,field:old.field,amountsEqual,personEqual,sourceEqual,sourceLocationEqual,before,after});
      }
      await writeFile(join(directory,`${runStem}-cycle-differences.json`),JSON.stringify(cycleDifferences,null,2)+"\n");
      const cycleSnapshot=canonicalJson(liveCycles.map(cycle=>({entity:cycle.entity_id,field:cycle.field,...cycleProjection(cycle.value as Record<string,unknown>)})));
      runs.push({at:clock,targets:people.length,uniquePeople:new Set(people.map(person=>person.id)).size,reasonTargets:checks.length,correctOwnReasons:checks.filter(check=>check.equal).length,
        stateCardConsumers:publicStatePeople.length,apiReasons,heldMoneyCards,reasonChecksSha256:hash(checksText),reasonChecksPath,cardInputs:cardsPath,sourceRows:normalizedSourceRows,
        publishedReport:result.report.records[0],productionCycleFacts:input.cycles.length,productionCyclesWithSameAmounts:preserved,mismatches,
        productionCyclesWithSamePersonBinding:samePerson,productionCyclesWithSamePersonIdentity:samePersonIdentity,productionCyclesWithSameSourceBinding:sameSource,productionCyclesWithSameSourceLocation:sameSourceLocation,
        productionCycleDifferenceCounts:{amounts:cycleDifferences.filter(row=>!row.amountsEqual).length,personBindings:cycleDifferences.filter(row=>!row.personEqual).length,sourceBindings:cycleDifferences.filter(row=>!row.sourceEqual).length},
        liveCycleAmountAndBindingSha256:hash(cycleSnapshot),cycleAmountsAndBindingsStableSincePriorRun:priorCycleSnapshot===null?null:cycleSnapshot===priorCycleSnapshot,
        publicationDurationMs,reasonAndApiDurationMs:Math.round(performance.now()-readerStarted),
        hourlyClockDue:campaignMoneyStateDue({startedAt:clock},new Date(Date.parse(clock)+3600000).toISOString()),tomorrowDue:campaignMoneyStateDue({startedAt:clock},new Date(Date.parse(clock)+86400000).toISOString())});
      priorCycleSnapshot=cycleSnapshot;
      console.log(JSON.stringify({state,at:clock,reasons:checks.length,correct:checks.filter(check=>check.equal).length,apiReasons,mismatches:mismatches.length}));
    }
    const uniqueRequests=[...new Map(rawRequests.map(request=>[`${request.url}:${request.sha256}`,request])).values()];
    const matchedProductionCaptures=input.captures.filter((saved:{capture:{url:string;rawHash:string}})=>uniqueRequests.some(request=>request.url===saved.capture.url&&request.sha256===saved.capture.rawHash)).length;
    const runtimePublicationFailures=runs.flatMap(run=>Object.entries((run.publishedReport as {reasons:Record<string,number>}).reasons).filter(([reason])=>!(Object.values(CAMPAIGN_MONEY_MISSING_REASONS) as string[]).includes(reason)).map(([detail,count])=>({at:run.at,detail,count})));
    const evidence={state,kind:"production-readonly-people-and-real-source-bytes-local-publication-replay",productionWrites:0,productionInputSha256:hash(inputText),
      financialSourceCoverage:!profiles.length?"UNSUPPORTED":sourceFailures.length||runtimePublicationFailures.length?(Number((runs[0]?.publishedReport as {loaded:number}|undefined)?.loaded??0)>0?"PARTIAL_SOURCE_FAILURES":"SOURCE_FAILURES"):normalizedSourceRows===0?"NO_SOURCE_ROWS":Number((runs[0]?.publishedReport as {loaded:number}|undefined)?.loaded??0)===0?"NO_PERSON_BOUND_ROWS":"SUPPORTED",personBoundProfiles:profiles.map(profile=>profile.id),
      unsupportedReason:profiles.length?null:CAMPAIGN_MONEY_MISSING_REASONS.unsupported,sourceFailures,runtimePublicationFailures,productionSourceCaptures:input.captures.length,matchedProductionCaptures,
      independentSourceAuditDurationMs,localPlannerStatistics:"ANALYZE every20 committed publication transactions; PGlite has no production PostgreSQL autovacuum worker",
      sourceRequests:uniqueRequests,scope:"All production published person/seat targets in this state; actual publisher bytes; all writes are local. Future runs reuse retained responses under a controlled clock. Published people are materialized from the exact production reader result, one state per process.",runs};
    await writeFile(join(directory,"replay.json"),JSON.stringify(evidence,null,2)+"\n");
  }finally{installFactReader(undefined);await db.pg.close();}
}else throw new Error(`Unknown replay mode ${mode}`);
