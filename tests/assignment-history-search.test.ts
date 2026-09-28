import assert from "node:assert/strict";
import test from "node:test";
import { assignmentHistoryTerms } from "../lib/control-plane/admin-view/assignment-history.ts";

test("historical public identities and failure codes remain searchable beyond visible rows without leaking arbitrary worker text",()=>{
  const sources={workItems:[],attempts:[],routeTasks:[],artifacts:[{workItemId:"old-work",artifactId:"saved-page",attemptId:"capture",canonicalUrl:"https://city.example/meetings/2026?token=secret-query"}],
    workerResults:Array.from({length:75},(_,i)=>({id:`result-${i}`,attemptId:`attempt-${i}`,workItemId:i===74?"old-work":"other-work",
      result:{role:"PARSER",verdict:"EXTRACTED",recordClass:"OFFICIAL_ROSTER",subjectId:"city:one",warnings:[],records:[{id:`record-${i}`,subjectId:"city:one",
        fields:{name:i===74?"Avery Historical":"Other Person",office:"Council Member",meetingTitle:"September Library Hearing",
          email:"private@example.invalid",rawResponse:"secret-response",apiKey:"secret-key"}}]}}))};
  sources.workerResults[74].result.warnings.push({code:"AUTHORITY_IDENTITY_CONFLICT",detail:"secret-error"} as never);
  const terms=assignmentHistoryTerms(sources as unknown as Parameters<typeof assignmentHistoryTerms>[0],
    new Map([["retained-assignment",{workItemIds:new Set(["old-work"])}],["other-assignment",{workItemIds:new Set(["other-work"])}]]));
  const history=terms.get("retained-assignment")!;
  assert.ok(history.includes("Avery Historical"));
  assert.ok(history.includes("September Library Hearing"));
  assert.ok(history.includes("AUTHORITY_IDENTITY_CONFLICT"));
  assert.ok(history.includes("https://city.example/meetings/2026"));
  assert.ok(!history.includes("Other Person"));
  assert.ok(!terms.get("other-assignment")!.includes("Avery Historical"));
  assert.doesNotMatch(history.join(" "),/secret|private@example/);
  const retry=assignmentHistoryTerms({...sources,workerResults:[...sources.workerResults,sources.workerResults[74]]} as unknown as Parameters<typeof assignmentHistoryTerms>[0],
    new Map([["retained-assignment",{workItemIds:new Set(["old-work"])}]]));
  assert.deepEqual(retry.get("retained-assignment"),history);
});
