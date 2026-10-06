import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { NextRequest } from "next/server";
import { createMemoryRepositories } from "@/lib/control-plane/repository/memory.ts";
import { ADMIN_CONFIG_ID, defaultAdminConfig } from "@/lib/control-plane/gateway/admin-config.ts";
import { readSetting, ALERTS_ON_SETTING, BRIEF_TIME_SETTING } from "@/lib/control-plane/settings.ts";
import { projectBrief, readerProblemRows, writeDailyBrief, easternBriefClock, type BriefReading } from "@/lib/control-plane/admin-view/brief.ts";
import { briefGet } from "@/lib/control-plane/admin-view/brief-route.ts";
import { buildQueue, type QueueInput } from "@/app/(admin)/_mw/admin-v6/queue.ts";
import type { DecisionOrderCard } from "@/lib/control-plane/decision-cards.ts";
import { fireDueOrders } from "@/lib/control-plane/gateway/scheduled-fire.ts";
import { actionInput } from "@/app/(admin)/_mw/admin-v6/contract.ts";
import { submit } from "@/lib/control-plane/gateway/gateway.ts";
const at="2026-10-06T13:00:00Z";
const card:DecisionOrderCard={id:"decision-one",need:"money",happening:"The approved budget is used.",recommends:"Choose whether to extend the hunt",cost:"$2",gets:"Two more records",order:{type:"runner.pause",subject:"us",input:{}},fields:[],schedulable:true,version:"one",raisedAt:at};
const empty:QueueInput={receipts:null,sends:null,hunts:null,stuck:null,fixes:null,doors:null,scheduled:null};
test("brief keeps updates labeled and requests a decision once; accepted cards join their child",()=>{
 const config={...defaultAdminConfig(at),decisionOrders:[card],updates:[{id:"expected",what:"A method is ready for testing",at,label:"EXPECTED" as const,before:null,after:null,evidenceHref:null,shownAt:null}]};
 const rows=buildQueue({...empty,decisions:[card],doors:[{name:"Town agendas",why:"The page moved; the team is finding it.",since:at}]});
 const brief=projectBrief(config,rows,at,["older orders"]);
 assert.equal(brief.updates[0].isWin,false);assert.match(brief.updates[0].label,/Expected/);assert.equal(brief.decisions.length,1);assert.equal(brief.alerts.length,1);assert.equal(brief.problems.length,2);assert.deepEqual(brief.unread,["older orders"]);
 assert.equal(readSetting(config,ALERTS_ON_SETTING,false),false);assert.equal(readSetting(config,BRIEF_TIME_SETTING,""),"");
 assert.equal(buildQueue({...empty,decisions:[{...card,resolution:{choice:"approve",reason:null,at,receiptId:"child-one"}}]}).length,0);
 const declined=buildQueue({...empty,decisions:[{...card,resolution:{choice:"decline",reason:"Stay within the budget",at,receiptId:null}}]});assert.equal(declined[0].filter,"done");assert.equal(declined[0].next,"Stay within the budget");
});
test("organic reader reports go to auditors; suspect and test submissions raise no owner alert",()=>{
 const base={id:"1",receivedAt:at,site:"live" as const,message:"The agenda link is broken",surface:"card",origin:"reader" as const,about:null,zip:null,recordId:null,suspectReason:null,hasReplyAddress:true};
 const rows=readerProblemRows({observedAt:at,sites:[{site:"live",kind:"READ",total:3,rows:[base,{...base,id:"2",origin:"automated test"},{...base,id:"3",suspectReason:"spam"}]}]});
 assert.equal(rows.length,1);assert.equal(rows[0].owner,"Auditors");assert.equal(rows[0].filter,"waiting");assert.equal(projectBrief(defaultAdminConfig(at),rows,at).alerts.length,0);assert.equal(JSON.stringify(rows).includes("hasReplyAddress"),false);
});
test("daily snapshots use Eastern days in winter and summer",()=>{
 assert.deepEqual(easternBriefClock("2026-01-06T04:30:00Z"),{day:"2026-01-05",time:"23:30"});assert.deepEqual(easternBriefClock("2026-07-06T04:30:00Z"),{day:"2026-07-06",time:"00:30"});
});
test("a daily brief is off until its time is set, survives restart and wins one concurrent save",async()=>{
 const repos=createMemoryRepositories();await repos.adminConfig.put(ADMIN_CONFIG_ID,defaultAdminConfig(at),at);let reads=0;
 const read=async():Promise<BriefReading>=>{reads++;return {fresh:projectBrief(defaultAdminConfig(at),[],at),latest:null,alertsOn:false};};
 assert.equal(await writeDailyBrief(repos,at,read),false);assert.equal(reads,0);
 const held=await repos.adminConfig.mustRead(ADMIN_CONFIG_ID);await repos.adminConfig.compareAndSet(ADMIN_CONFIG_ID,held.revision,{...held.value,settings:{[BRIEF_TIME_SETTING]:"09:00"}},at);
 assert.equal(await writeDailyBrief(repos,"2026-10-06T12:59:00Z",read),false);
 const outcomes=await Promise.all([writeDailyBrief(repos,at,read),writeDailyBrief(repos,at,read)]);assert.equal(outcomes.filter(Boolean).length,1);
 assert.equal(await writeDailyBrief(repos,at,read),false);const saved=await repos.adminConfig.mustRead(ADMIN_CONFIG_ID);assert.equal(saved.value.latestBrief?.day,"2026-10-06");assert.equal(readSetting(saved.value,BRIEF_TIME_SETTING,""),"09:00");assert.equal(saved.value.fleetSpendCeiling,held.value.fleetSpendCeiling);
});
test("the existing always-running scheduled-order path writes a due brief without a research round",async()=>{
 const repos=createMemoryRepositories();const deps={repos,now:()=>at,currentStateVersion:null,codeSha:null};
 assert.equal((await submit({type:"config.setSetting",subject:BRIEF_TIME_SETTING,input:{key:BRIEF_TIME_SETTING,value:"09:00"},stateVersion:null,idempotencyKey:"brief-time-one",caller:"OWNER_SESSION",actorRef:"owner"},deps)).ok,true);
 await fireDueOrders(deps,at);assert.equal((await repos.adminConfig.mustRead(ADMIN_CONFIG_ID)).value.latestBrief?.day,"2026-10-06");
 const first=(await repos.adminConfig.mustRead(ADMIN_CONFIG_ID)).value.latestBrief;await fireDueOrders(deps,at);assert.deepEqual((await repos.adminConfig.mustRead(ADMIN_CONFIG_ID)).value.latestBrief,first);
});
test("all brief readings reject the public host before any source read",async()=>{
 for(const which of ["brief","alerts","daily-brief","reader-problems"] as const){const response=await briefGet(new NextRequest(`https://meanwhile.vote/api/admin/v6/${which}`,{headers:{host:"meanwhile.vote"}}),which);assert.equal(response.status,404);}
});

test("the Settings control can clear the brief time to turn snapshots off",()=>{
 assert.equal(actionInput("setting-set",{target:BRIEF_TIME_SETTING,scopeKey:"us",amount:"",option:null,words:"",selected:[],payload:{control:"text"}}).value,"");
});
test("an older tick finishing after midnight cannot replace the newer day's brief",async()=>{
 const repos=createMemoryRepositories();const oldAt="2026-10-06T03:59:00Z",newAt="2026-10-06T04:01:00Z";
 await repos.adminConfig.put(ADMIN_CONFIG_ID,{...defaultAdminConfig(oldAt),settings:{[BRIEF_TIME_SETTING]:"00:00"}},oldAt);
 let finish!:()=>void,started!:()=>void;const waiting=new Promise<void>(r=>finish=r),reading=new Promise<void>(r=>started=r);
 const read=async(_repos:unknown,clock:string):Promise<BriefReading>=>{if(clock===oldAt){started();await waiting;}return {fresh:projectBrief(defaultAdminConfig(clock),[],clock),latest:null,alertsOn:false};};
 const older=writeDailyBrief(repos,oldAt,read);await reading;
 assert.equal(await writeDailyBrief(repos,newAt,read),true);finish();
 assert.equal(await older,false,"the stale older day must not save over the new day");assert.equal((await repos.adminConfig.mustRead(ADMIN_CONFIG_ID)).value.latestBrief?.day,"2026-10-06");
});

test("the installed plain-Node timer loads and writes a configured brief without app loaders",()=>{
 const code=`const {createMemoryRepositories}=await import("./lib/control-plane/repository/memory.ts");
 const {ADMIN_CONFIG_ID,defaultAdminConfig}=await import("./lib/control-plane/gateway/admin-config.ts");
 const {fireDueOrders}=await import("./lib/control-plane/gateway/scheduled-fire.ts");
 const repos=createMemoryRepositories(),at="2026-10-06T13:00:00Z";
 await repos.adminConfig.put(ADMIN_CONFIG_ID,{...defaultAdminConfig(at),settings:{"brief.time":"09:00"}},at);
 await fireDueOrders({repos,now:()=>at,currentStateVersion:null,codeSha:null},at);
 if((await repos.adminConfig.mustRead(ADMIN_CONFIG_ID)).value.latestBrief?.day!=="2026-10-06")throw new Error("No brief was written");`;
 const result=spawnSync(process.execPath,["--experimental-strip-types","--input-type=module","-e",code],{cwd:process.cwd(),env:{...process.env,DATABASE_URL:"",FEEDBACK_DATABASE_URL:"",WTP_CONTROL_PLANE_DATABASE_URL:"",WTP_ASSET_STORE:""},encoding:"utf8",timeout:15_000});
 assert.equal(result.status,0,result.stderr);
});
