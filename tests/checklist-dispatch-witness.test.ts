import assert from "node:assert/strict";
import test from "node:test";
import type { AssignmentSources } from "../lib/control-plane/assignment-view.ts";
import type { ExpansionScopeDecision } from "../lib/control-plane/expansion/scopes.ts";
import { checklistDispatchWitness } from "../lib/control-plane/readiness/checklist-dispatch-witness.ts";
import { buildChecklistCensus } from "../lib/control-plane/readiness/checklist-census.ts";
import { evaluateChecklistSnapshot } from "../lib/control-plane/readiness/checklist-score.ts";

const markAt="2026-09-28T01:00:00Z", begin="2026-09-28T01:02:00Z", end="2026-09-28T01:03:00Z", now="2026-09-28T02:00:00Z";
const scope={key:"zcta:2020/85635",receiptId:"send-one",budgetStartedAt:markAt} as ExpansionScopeDecision;
function fixture(): AssignmentSources {
  return {nowIso:now,obligations:[{id:"obligation",subjectId:"body",assignments:[{assignmentKey:scope.key,ref:scope.receiptId,at:markAt}]}],
    occurrences:[{id:"occurrence",obligationId:"obligation",workItemId:"work",routeTaskId:"route",openedAt:markAt,dueAt:markAt}],
    workItems:[{id:"work",project:"freshness",subject:"body",routeTaskIds:["route"]}],
    attempts:[{id:"attempt",workItemId:"work",routeTaskId:"route",startedAt:begin,endedAt:end,outcome:"COMPLETED",artifactIds:["artifact"],
      worker:{role:"SCOUT"},policyVersion:"policy",capabilityGrant:{project:"freshness",role:"SCOUT",policyVersion:"policy",grantedAt:markAt}}],
    artifacts:[{artifactId:"artifact",workItemId:"work",routeTaskId:"route",attemptId:"attempt",contentHash:"a".repeat(64),
      canonicalUrl:"https://example.gov/roster",byteLength:100,partial:false,recordedAt:end}],
    workerResults:[],pipeline:[],routeTasks:[],debts:[],costs:[],scoutResults:[]
  } as unknown as AssignmentSources;
}
const run=(sources:AssignmentSources,decision=scope)=>{
  const census=buildChecklistCensus({scope:decision,sources,observedAt:now});
  return {...census,witnesses:checklistDispatchWitness({scope:decision,sources,instances:census.instances,observedAt:now})};
};
test("joined ordinary dispatch proves only its one operating gate, never publication or full coverage",()=>{
  const snapshot=run(fixture());
  assert.equal(snapshot.witnesses.length,1);
  const score=evaluateChecklistSnapshot(snapshot);
  assert.deepEqual(score.results.filter(row=>row.passed).map(row=>row.definitionIds),[["GATE-04"]]);
  assert.equal(score.complete,false);
  assert.equal(score.publicDelivery.passed,0);
});
test("a later same-key instruction cannot inherit prior dispatch",()=>{
  const sources=fixture();
  const newer={...scope,receiptId:"send-two",budgetStartedAt:"2026-09-28T01:30:00Z"};
  const changed={...sources,obligations:[{...sources.obligations[0],assignments:[...sources.obligations[0].assignments!,{assignmentKey:scope.key,ref:newer.receiptId,at:newer.budgetStartedAt,relation:"CREATED" as const}]}]};
  assert.equal(run(changed,newer).witnesses.length,0);
});
test("aborted, future, partial, mismatched and proof work never establishes normal durable completion",()=>{
  const s=fixture();
  const cases:AssignmentSources[]=[
    {...s,attempts:[{...s.attempts[0],outcome:"ABORTED"}]},
    {...s,attempts:[{...s.attempts[0],endedAt:"2026-09-29T00:00:00Z"}]},
    {...s,artifacts:[{...s.artifacts[0],partial:true}]},
    {...s,artifacts:[{...s.artifacts[0],attemptId:"different"}]},
    {...s,workItems:[{...s.workItems[0],project:"proof"}]},
    {...s,attempts:[{...s.attempts[0],routeTaskId:"wrong-route"}]},
  ];
  for(const sources of cases) assert.equal(run(sources).witnesses.length,0);
});
