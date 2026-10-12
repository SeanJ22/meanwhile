import assert from "node:assert/strict";
import test from "node:test";
import { autonomousHarness, FIXTURE_NOW } from "./helpers/autonomous-fleet.ts";
import { runAutonomousCoordinator } from "../lib/control-plane/workers/coordinator.ts";
import { readAutonomousActivity, projectAutonomousActivity } from "../lib/control-plane/workers/activity.ts";
import { projectResearchProgression, readResearchProgression } from "../lib/control-plane/research-progression.ts";
import { emptyKnowledge, unknownApplicability } from "../lib/method/knowledge.ts";
import type { MethodCandidate } from "../lib/method/candidate.ts";
import type { ConclusionRecord } from "../lib/method/conclusions.ts";

const window = {windowId:"fixture-window",previousCompletedWindowId:null,since:FIXTURE_NOW,through:"2026-09-03T19:00:00.000Z",excludedUnclassifiedWorkItems:0,candidates:[],knowledge:emptyKnowledge(),conclusions:[]};

test("actual worker results are counted once; extraction and legacy PASS do not certify independent civic truth",async()=>{
  const h=await autonomousHarness();
  for (let stage = 0; stage < 3; stage++) {
    const run = await runAutonomousCoordinator(h.runtime,{maximum:1,concurrency:1});
    assert.equal(run.dispatches[0]?.outcome,"WORKED",run.dispatches[0]?.detail);
  }
  const activities=await readAutonomousActivity(h.repos,undefined,{observedAt:window.through});
  const result=projectResearchProgression({...window,activities});
  assert.equal(result.scope.obligations,1);
  assert.equal(result.milestones.discovered.newlyReached,1);
  assert.equal(result.milestones.acquired.newlyReached,1);
  assert.equal(result.milestones.extracted.newlyReached,1);
  assert.equal(result.milestones.verified.newlyReached,0);
  assert.equal(result.milestones.audited.newlyReached,0);
  assert.equal(result.milestones.promotionReady.newlyReached,0);
  assert.ok(result.bottlenecks.some(b=>b.code==="INDEPENDENT_VERIFICATION_MISSING"));
  assert.equal(result.promoted.count,null);
  assert.equal(result.readerVisible.count,null);
  assert.equal(result.activity.obligationsWorked,1);
  assert.equal(result.activity.completedResults.reduce((sum,row)=>sum+row.count,0),3);
  assert.ok(result.activity.newEvidenceArtifacts>0);
  const again=projectResearchProgression({...window,activities,since:window.through,through:"2026-09-03T20:00:00.000Z",previousCompletedWindowId:window.windowId});
  assert.equal(again.milestones.acquired.newlyReached,0);
  assert.equal(again.milestones.acquired.reachedByWindowEnd,1);
  assert.equal(again.activity.obligationsWorked,0);
  assert.equal(again.activity.newEvidenceArtifacts,0);
});

test("uncommitted output and later evidence never manufacture earlier-window progress",async()=>{
  const h=await autonomousHarness(); await runAutonomousCoordinator(h.runtime,{maximum:1,concurrency:1});
  const activity=(await readAutonomousActivity(h.repos,undefined,{observedAt:window.through}))[0];
  const record=activity.facts.workers[0];
  const broken=projectAutonomousActivity({...activity.facts,attempts:activity.facts.attempts.map(a=>a.id===record.attemptId?{...a,outcome:null,endedAt:null}:a)},{observedAt:window.through});
  const refused=projectResearchProgression({...window,activities:broken});
  assert.equal(refused.milestones.acquired.newlyReached,0);
  assert.ok(refused.evidenceGaps.some(g=>g.includes("WORKER_RESULT_UNPROVEN")));
  const detached=projectAutonomousActivity({...activity.facts,artifacts:activity.facts.artifacts.filter(a=>a.attemptId!==record.attemptId)},{observedAt:window.through});
  assert.equal(projectResearchProgression({...window,activities:detached}).milestones.acquired.newlyReached,0,"unattributed artifact claims are not acquisition progress");
  const earlier=projectResearchProgression({...window,through:new Date(Date.parse(record.endedAt)-1).toISOString(),activities:[activity]});
  assert.equal(earlier.milestones.acquired.newlyReached,0);
  const boundary=projectResearchProgression({...window,since:record.endedAt,activities:[activity]});
  assert.equal(boundary.milestones.acquired.newlyReached,0,"previous boundary is exclusive");
});

test("a real worker wall remains a reusable bottleneck with its obligation and history retained",async()=>{
  const h=await autonomousHarness({response:{transportError:"timeout"}});
  await runAutonomousCoordinator(h.runtime,{maximum:1,concurrency:1});
  const activities=await readAutonomousActivity(h.repos,undefined,{observedAt:window.through});
  const report=projectResearchProgression({...window,activities});
  assert.equal(report.milestones.acquired.newlyReached,0);
  const wall=report.bottlenecks.find(b=>b.code==="SOURCE_CURRENTLY_WALLED");
  assert.ok(wall);
  assert.equal(wall.affectedObligationCount,1);
  assert.equal(wall.drillDown[0].workItemId,h.item.id);
  assert.deepEqual(wall.states,["NH"]);
  assert.equal(wall.ageBasis,"AFFECTED_OBLIGATION_CREATION");
  assert.notEqual(activities[0].workItem.state,"VERIFIED_COMPLETE");
});

test("reopening is interval-scoped, and promoted or reader-visible counts are never invented",async()=>{
  const h=await autonomousHarness();
  const activities=await readAutonomousActivity(h.repos,undefined,{observedAt:window.through});
  const at="2026-09-03T18:30:00.000Z";
  const changed=activities.map(a=>({...a,workItem:{...a.workItem,transitions:[...a.workItem.transitions,{from:"VERIFIED_COMPLETE" as const,to:"REOPENED" as const,at,by:"method-reopening",why:"New applicable method; prior proof preserved"}]}}));
  const report=projectResearchProgression({...window,activities:changed});
  assert.equal(report.reopened.length,1);
  assert.equal(report.reopened[0].at,at);
  assert.equal(report.promoted.count,null);
  assert.equal(report.readerVisible.count,null);
  assert.equal(projectResearchProgression({...window,activities:changed,since:at}).reopened.length,0);
  assert.throws(()=>projectResearchProgression({...window,activities:changed,through:"bad-clock"}),/CLOCK_INVALID/);
});

test("method admission, repeated inheritance, candidates and date-only reopening retain distinct meanings",()=>{
  const at="2026-09-03T18:20:00.000Z";
  const candidate:MethodCandidate={id:"fixture-candidate",attemptId:"fixture-attempt",submittedAt:at,observedMethodVersion:0,lifecycle:"ADMITTED",validation:null,rejection:null,
    proposal:{id:"fixture-route",title:"Recorded fixture avenue",tier:"A0",fields:["meeting"],note:"Fixture scope only",origin:"Test control",outcome:{jurisdiction:"NH",rows:2,outcome:"YIELDED",note:"Recorded fixture"}},
    admission:{at,admittedAs:"fixture-route",effect:"LEARNED",methodVersionAfter:1}};
  const applicability=unknownApplicability("Only a fixture observation is held");
  const knowledge={version:1,updatedOn:at,routes:[{id:"fixture-route",title:"Recorded fixture avenue",tier:"A0" as const,fields:["meeting"],applicability,outcomes:[],subBranches:[],origin:"Test control",learnedOn:at,learnedAtVersion:1}]};
  const conclusion:ConclusionRecord={id:"fixture-conclusion",kind:"BLOCKED",field:"meeting",jurisdiction:{state:"NH",governmentType:"town"},earnedAtVersion:0,earnedOn:"2026-09-02",status:"REOPENED",earnedBy:{routeIds:["fixture-old-route"],workItemId:"fixture-item"},why:"A recorded earlier route wall",reopenedBy:"fixture-route",reopenedOn:at};
  const exact=projectResearchProgression({...window,activities:[],candidates:[candidate],knowledge,conclusions:[conclusion]});
  assert.equal(exact.admittedMethods.length,1);
  assert.deepEqual(exact.admittedMethods[0].applicability,applicability);
  assert.equal(exact.reopenedConclusions[0].windowAttribution,"EXACT");
  const repeat=projectResearchProgression({...window,activities:[],candidates:[{...candidate,admission:{...candidate.admission!,effect:"ALREADY_KNOWN"}}],knowledge,conclusions:[{...conclusion,reopenedOn:"2026-09-03"}]});
  assert.equal(repeat.admittedMethods.length,0,"an already-known route is not newly learned");
  assert.deepEqual(repeat.candidateMethods,[candidate.id]);
  assert.equal(repeat.reopenedConclusions[0].windowAttribution,"DATE_ONLY_UNATTRIBUTABLE");
  assert.ok(repeat.evidenceGaps.includes("CONCLUSION_REOPENING_WINDOW_UNATTRIBUTABLE:fixture-conclusion"));
  const pending=projectResearchProgression({...window,activities:[],candidates:[{...candidate,lifecycle:"PROPOSED",admission:null}]});
  assert.equal(pending.admittedMethods.length,0,"a candidate never graduates through a reporting projection");
  assert.deepEqual(pending.candidateMethods,[candidate.id]);
});

test("completed research cycles use their own previous boundary without opening a promotion window",async()=>{
  const h=await autonomousHarness();
  await runAutonomousCoordinator(h.runtime,{maximum:1,concurrency:1});
  const scouts=await h.repos.scoutResults.readAll();
  const listItems=h.repos.workItems.list.bind(h.repos.workItems);
  let itemExports=0;
  h.repos.workItems.list=async()=>{itemExports++;return listItems();};
  h.repos.scoutResults.readAll=async()=>{throw new Error("the final Scout snapshot must not be exported twice");};
  const first=await readResearchProgression(h.repos,{...window,scouts,researchBoundary:{since:FIXTURE_NOW,previousCompletedWindowId:null}});
  assert.equal(itemExports,1,"progression reuses the same work-item snapshot in activity");
  assert.equal(first.windowKind,"RESEARCH_CYCLE");
  assert.equal(first.milestones.acquired.newlyReached,1);
  assert.equal((await h.repos.windowRuns.readAll()).length,0,"projection cannot invent a nightly window");
  const next=await readResearchProgression(h.repos,{...window,scouts,windowId:"next-research-window",through:"2026-09-03T20:00:00.000Z",researchBoundary:{since:first.through,previousCompletedWindowId:first.windowId}});
  assert.equal(itemExports,2,"each completed read gets one fresh work-item snapshot");
  assert.equal(next.previousCompletedWindowId,first.windowId);
  assert.equal(next.milestones.acquired.newlyReached,0);
  assert.equal(next.milestones.acquired.reachedByWindowEnd,1);
  h.repos.workItems.list=async()=>{throw new Error("fresh work-item snapshot unavailable");};
  await assert.rejects(readResearchProgression(h.repos,{...window,scouts}),/fresh work-item snapshot unavailable/,
    "snapshot failures propagate rather than manufacture zero progress");
});
