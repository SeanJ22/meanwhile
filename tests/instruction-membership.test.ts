import assert from "node:assert/strict";
import test from "node:test";
import { exactInstructionMembership } from "../lib/control-plane/admin-view/instruction-membership.ts";
import { instructionReceiptKey } from "../lib/control-plane/scheduler/obligation.ts";
import type { AssignmentView } from "../lib/control-plane/assignment-view.ts";

const key="zcta:2020/85635", oldRef="old", nextRef="new";
const oldId=instructionReceiptKey(key,oldRef), nextId=instructionReceiptKey(key,nextRef);
const view={
  allRowsIndex:[
    {id:"old-work",assignmentKeys:[key],assignmentRefs:[{key,ref:oldRef,at:"2026-09-27T00:00:00Z"}],instructionStates:{[oldId]:"SUCCEEDED"}},
    {id:"shared-work",assignmentKeys:[key],assignmentRefs:[{key,ref:oldRef,at:"2026-09-27T00:00:00Z"},
      {key,ref:nextRef,at:"2026-09-28T00:00:00Z"}],instructionStates:{[oldId]:"UNKNOWN",[nextId]:"UNKNOWN"}},
  ],
  rows:[{id:"old-work",state:"SUCCEEDED",assignmentKeys:[key]},
    {id:"shared-work",state:"SUCCEEDED",assignmentKeys:[key]}],
  instructionCountsByReceipt:{[oldId]:{SUCCEEDED:1,UNKNOWN:1},[nextId]:{UNKNOWN:1}},
  bodyAttempts:[
    {workItemId:"old-work",assignmentKeys:[key],assignmentRefs:[{key,ref:oldRef}]},
    {workItemId:"shared-work",assignmentKeys:[key],assignmentRefs:[{key,ref:nextRef}]},
  ],
} as unknown as AssignmentView;

test("the active receipt excludes old completed work and old publication while retaining shared history",()=>{
  const current=exactInstructionMembership(view,key,nextRef);
  assert.deepEqual(current.index?.map(row=>row.id),["shared-work"]);
  assert.equal(current.index?.[0]?.state,"UNKNOWN");
  assert.deepEqual(current.rows.map(row=>[row.id,row.state]),[["shared-work","UNKNOWN"]]);
  assert.equal(current.counts?.UNKNOWN,1);
  assert.equal(current.counts?.SUCCEEDED,undefined);
  assert.deepEqual(current.bodyAttempts?.map(row=>row.workItemId),["shared-work"]);
  const old=exactInstructionMembership(view,key,oldRef);
  assert.deepEqual(old.index?.map(row=>row.id),["old-work","shared-work"]);
  assert.deepEqual(old.bodyAttempts?.map(row=>row.workItemId),["old-work"]);
});

test("older key-only snapshots cannot establish an exact receipt total or zero publications",()=>{
  const old={...view,allRowsIndex:[{id:"old-work",assignmentKeys:[key]}],instructionCountsByReceipt:undefined,
    bodyAttempts:[{workItemId:"old-work",assignmentKeys:[key]}]} as unknown as AssignmentView;
  const exact=exactInstructionMembership(old,key,nextRef);
  assert.equal(exact.index,null);
  assert.equal(exact.counts,null);
  assert.equal(exact.bodyAttempts,null);
  assert.deepEqual(exact.rows,[]);
});
