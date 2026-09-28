import assert from "node:assert/strict";
import test from "node:test";
import { CHECKLIST_PLACE_DECISION_SQL, parseChecklistPlaceKey, readChecklistPlaceBinding,
  resolveChecklistPlaceBinding } from "../lib/control-plane/admin-view/checklist-place-binding.ts";
import type { Sql } from "../lib/control-plane/repository/pg-store.ts";

const place="az.zcta.85635";
const decision={key:"zcta:2020/85635",geography:{type:"zcta",geoid:"85635",version:"zcta:2020",
  label:"ZIP 85635 (Census ZCTA)",stateAbbr:"AZ"},priority:1,budgetUsd:50,
  budgetStartedAt:"2026-09-27T22:17:50.236Z",sourceWorkVersion:1,note:null,
  decidedAt:"2026-09-28T08:00:00.000Z",decidedBy:"saved-admin-session",
  receiptId:"expansion.scope.set:scope:85635:1yfuc2c:pgfomast",
  latestDecisionReceiptId:"expansion.scope.set:scope:85635:later-policy-edit",previous:{priority:2,budgetUsd:50}};

test("a strict saved lifetime-hunt decision binds UI place to its original instruction receipt",()=>{
  assert.deepEqual(parseChecklistPlaceKey(place),{state:"az",type:"zcta",geoid:"85635"});
  assert.deepEqual(resolveChecklistPlaceBinding(place,[decision]),{state:"BOUND",placeKey:place,
    scopeId:"zcta:2020/85635",instructionReceipt:decision.receiptId,
    decidedAt:decision.decidedAt,authority:"SAVED_LIFETIME_HUNT_DECISION"});
  assert.notEqual(resolveChecklistPlaceBinding(place,[decision]).state,"UNAVAILABLE");
});

test("bare state, unsaved place, rolling budget, mixed geography and duplicate decisions cannot bind",()=>{
  for(const input of ["az","all","AZ.zcta.85635","az.zcta.8563","az.zcta.85635.extra","az.zcta.abcde"])
    assert.equal(resolveChecklistPlaceBinding(input,[decision]).state,"UNAVAILABLE",input);
  assert.deepEqual(resolveChecklistPlaceBinding(place,[]),{state:"UNAVAILABLE",code:"DECISION_NOT_RECORDED"});
  assert.deepEqual(resolveChecklistPlaceBinding(place,[decision,decision]),{state:"UNAVAILABLE",code:"AMBIGUOUS_PLACE"});
  assert.deepEqual(resolveChecklistPlaceBinding(place,[{...decision,budgetStartedAt:undefined}]),
    {state:"UNAVAILABLE",code:"NOT_SAVED_LIFETIME_HUNT"});
  assert.deepEqual(resolveChecklistPlaceBinding(place,[{...decision,sourceWorkVersion:undefined}]),
    {state:"UNAVAILABLE",code:"NOT_SAVED_LIFETIME_HUNT"});
  assert.deepEqual(resolveChecklistPlaceBinding(place,[{...decision,receiptId:""}]),
    {state:"UNAVAILABLE",code:"NOT_SAVED_LIFETIME_HUNT"});
  assert.deepEqual(resolveChecklistPlaceBinding(place,[{...decision,geography:{...decision.geography,stateAbbr:"NJ"}}]),
    {state:"UNAVAILABLE",code:"DECISION_MALFORMED"});
  assert.deepEqual(resolveChecklistPlaceBinding(place,[{...decision,key:"county:2020/85635"}]),
    {state:"UNAVAILABLE",code:"DECISION_MALFORMED"});
});

test("one bounded policy-row query transfers only exact place matches; malformed source refuses",async()=>{
  const calls:{text:string;params:readonly unknown[]}[]=[];
  const sql={query:async(text:string,params:readonly unknown[])=>{
    calls.push({text,params});return [{format_version:"1",scopes_shape:"array",matches:[decision]}];
  }} as unknown as Sql;
  const read=await readChecklistPlaceBinding(sql,place);
  assert.equal(read.state,"BOUND");
  assert.equal(calls.length,1);
  assert.equal(calls[0]?.text,CHECKLIST_PLACE_DECISION_SQL);
  assert.deepEqual(calls[0]?.params,["az","85635","zcta"]);
  assert.match(CHECKLIST_PLACE_DECISION_SQL,/LIMIT 2/);
  assert.doesNotMatch(CHECKLIST_PLACE_DECISION_SQL,/cp_owner_snapshots/);
  const malformed={query:async()=>[{format_version:"1",scopes_shape:"object",matches:null}]} as unknown as Sql;
  assert.deepEqual(await readChecklistPlaceBinding(malformed,place),{state:"UNAVAILABLE",code:"DECISION_MALFORMED"});
});
