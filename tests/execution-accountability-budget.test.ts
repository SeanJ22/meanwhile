import assert from "node:assert/strict";
import test from "node:test";
import { AssignmentBudgetGate, armAssignmentBudget, assignmentMembership, type AssignmentBudgetSpec } from "../lib/control-plane/expansion/assignment-budget.ts";
import { ScopeBudgetGate, type BudgetScope } from "../lib/control-plane/expansion/membership.ts";
import { createLedger } from "../lib/control-plane/budget.ts";
import { decideHold } from "../lib/control-plane/expansion/spend-holds.ts";
import { providerBillingAttribution } from "../lib/control-plane/provider-billing-attribution.ts";
import { FleetSafetyController, FleetSafetyRefusal, pricedModelCharge } from "../lib/control-plane/fleet-safety.ts";
import { ORIGINAL_LIFETIME_HUNT } from "../lib/control-plane/scheduler/hunt-continuation.ts";
import type { CostEntry } from "../lib/control-plane/cost.ts";

const now = "2026-09-28T12:00:00.000Z";
const started = "2026-09-27T12:00:00.000Z";
const huntKey = ORIGINAL_LIFETIME_HUNT.key;
const chargesOf = (rows: readonly CostEntry[]) => rows.flatMap(row => pricedModelCharge(row, row.attemptId) ?? []);
const member = { id: "obligation", subjectId: "az:sierra-vista", assignments: [
  { assignmentKey: "rolling", ref: "old", relation: "REORDERED", at: started },
  { assignmentKey: huntKey, ref: ORIGINAL_LIFETIME_HUNT.receiptId, relation: "CREATED", at: started },
] };
const membership = assignmentMembership([member] as never);
const specs: AssignmentBudgetSpec[] = [
  { key: "rolling", kind: "DISPATCH", label: "Older rolling send", ref: "old", budgetUsd: 0, sentAt: started },
  { key: ORIGINAL_LIFETIME_HUNT.key, kind: "SCOPE", label: "85635", ref: ORIGINAL_LIFETIME_HUNT.receiptId,
    budgetUsd: ORIGINAL_LIFETIME_HUNT.budgetUsd, budgetStartedAt: ORIGINAL_LIFETIME_HUNT.budgetStartedAt, sentAt: now },
];

test("lifetime hunt admits shared work despite exhausted older rolling Send and area limits", () => {
  const gate = new AssignmentBudgetGate({ specs, membership, historical: new Map([
    ["rolling", { usd: 0, measured: 0, unmeasured: 0, bySubject: 0 }],
    [huntKey, { usd: 10, measured: 1, unmeasured: 0, bySubject: 0 }],
  ]), worstCaseUsd: 1, costsReadable: true, intentsReadable: true, historyReadAt: now });
  const decision = gate.admit(member.id);
  assert.equal(decision.admit, true);
  assert.equal(gate.state("rolling")?.heldUsd, 0);
  assert.equal(gate.state(huntKey)?.heldUsd, 1);
  const lines = gate.linesFor(member.id);
  assert.ok("lines" in lines);
  assert.deepEqual(lines.lines.map(line => line.key), [`send:${huntKey}@${ORIGINAL_LIFETIME_HUNT.budgetStartedAt}`]);

  const scope = (key: string, lifetime: boolean, budgetUsd: number): BudgetScope => ({ key, label: key, budgetUsd,
    lifetime, ...(lifetime ? { budgetStartedAt: started } : {}), resolved: true,
    members: new Set([member.subjectId]), states: ["AZ"], historicalUsd: lifetime ? 10 : 0 });
  const areas = new ScopeBudgetGate({ scopes: [scope("older", false, 0), {
    ...scope(huntKey, true, 50), budgetStartedAt: ORIGINAL_LIFETIME_HUNT.budgetStartedAt,
    receiptId: ORIGINAL_LIFETIME_HUNT.receiptId,
  }], worstCaseUsd: 1, historyReadAt: now });
  assert.equal(areas.admit(member.id, member.subjectId).admit, true);
  const areaLines = areas.linesFor(member.subjectId);
  assert.ok("lines" in areaLines);
  assert.deepEqual(areaLines.lines.map(line => line.key), [`area:${huntKey}@${ORIGINAL_LIFETIME_HUNT.budgetStartedAt}`]);
});

test("the original lifetime allowance still refuses concurrent holds and counts retries", () => {
  const gate = new AssignmentBudgetGate({ specs, membership, historical: new Map([
    ["rolling", { usd: 0, measured: 0, unmeasured: 0, bySubject: 0 }],
    [huntKey, { usd: 49, measured: 4, unmeasured: 0, bySubject: 0 }],
  ]), worstCaseUsd: 1, costsReadable: true, intentsReadable: true, historyReadAt: now });
  const send = gate.linesFor(member.id);
  assert.ok("lines" in send);
  const lines = { sends: send.lines, areas: [] };
  const first = decideHold(createLedger({ hosts: [] }), { holdId: "attempt-1", jobId: "job-1", obligationId: member.id, lines, usd: 1, what: "first model call", now });
  assert.equal(first.result.admit, true);
  const second = decideHold(first.ledger, { holdId: "attempt-2", jobId: "job-2", obligationId: member.id, lines, usd: 1, what: "retry", now });
  assert.equal(second.result.admit, false);
});

test("a funded Send replaces an overlapping rolling budget, and two funded Sends each keep their own allowance", () => {
  const anotherKey = "zcta:2020/99999";
  const anotherMember = { ...member, assignments: [
    { assignmentKey: "rolling", ref: "old", relation: "REORDERED", at: started },
    { assignmentKey: anotherKey, ref: "another-receipt", relation: "CREATED", at: started },
  ] };
  const gate = new AssignmentBudgetGate({ specs: [specs[0], { key: anotherKey, kind: "SCOPE", label: "another",
    ref: "another-receipt", budgetUsd: 50, budgetStartedAt: started, sentAt: now }],
    membership: assignmentMembership([anotherMember] as never), historical: new Map([
      ["rolling", { usd: 0, measured: 0, unmeasured: 0, bySubject: 0 }],
      [anotherKey, { usd: 10, measured: 1, unmeasured: 0, bySubject: 0 }],
    ]), worstCaseUsd: 1, costsReadable: true, intentsReadable: true, historyReadAt: now });
  const sends = gate.linesFor(member.id);
  assert.ok("lines" in sends);
  assert.equal(sends.lines.length, 1, "the funded Send's own allowance replaces the rolling limit");
  const areas = new ScopeBudgetGate({ scopes: [
    { key: "older", label: "older", budgetUsd: 0, resolved: true, members: new Set([member.subjectId]),
      states: ["AZ"], historicalUsd: 0 },
    { key: anotherKey, label: "another", budgetUsd: 50, lifetime: true, budgetStartedAt: started,
      receiptId: "another-receipt", resolved: true, members: new Set([member.subjectId]),
      states: ["AZ"], historicalUsd: 10 },
  ], worstCaseUsd: 1, historyReadAt: now });
  const lines = areas.linesFor(member.subjectId);
  assert.ok("lines" in lines);
  assert.equal(lines.lines.length, 1);
  assert.equal(lines.lines[0].key, `area:${anotherKey}@${started}`);
  const twoFunded = new ScopeBudgetGate({ scopes: [
    { key: "first", label: "first", budgetUsd: 20, lifetime: true, budgetStartedAt: started, receiptId: "r1", resolved: true,
      members: new Set([member.subjectId]), states: ["AZ"], historicalUsd: 0 },
    { key: anotherKey, label: "another", budgetUsd: 50, lifetime: true, budgetStartedAt: started, receiptId: "r2", resolved: true,
      members: new Set([member.subjectId]), states: ["AZ"], historicalUsd: 10 },
  ], worstCaseUsd: 1, historyReadAt: now }).linesFor(member.subjectId);
  assert.ok("lines" in twoFunded);
  assert.equal(twoFunded.lines.length, 2, "each funded Send keeps its own allowance");
});

test("unpriced usage preserves known hunt and service amounts", () => {
  const costs = [
    { attemptId: "one", source: "api.anthropic.com", recordedAt: now, assignmentKeys: ["hunt"], assignmentRefs: [{ key: "hunt", ref: "hunt-receipt" }], cost: { usd: 2 } },
    { attemptId: "two", source: "api.anthropic.com", recordedAt: now, assignmentKeys: ["hunt"], assignmentRefs: [{ key: "hunt", ref: "hunt-receipt" }], cost: { usd: null } },
    { attemptId: "three", source: "api.exa.ai", recordedAt: now, assignmentKeys: ["hunt"], assignmentRefs: [{ key: "hunt", ref: "hunt-receipt" }], cost: { usd: 0.25 } },
  ];
  const attribution = providerBillingAttribution({ now, costs: costs as never, attempts: [],
    scopes: [{ key: "hunt", receiptId: "hunt-receipt", geography: { label: "85635" }, budgetStartedAt: started, budgetUsd: 50 }] as never,
    holds: {}, readings: [] });
  const hunt = attribution.hunts![0];
  assert.equal(hunt.anthropicUsd, null);
  assert.equal(hunt.anthropicKnownUsd, 2);
  assert.equal(hunt.otherKnownUsd, 0.25);
  assert.equal(hunt.knownCombinedUsd, 2.25);
  assert.equal(hunt.unpriced, 1);
  assert.equal(hunt.availableUsd, null);
});

test("historical autonomous cost joins a hunt only through exact recorded subject membership", () => {
  const base = { attemptId: "legacy", source: "api.anthropic.com", recordedAt: now,
    cost: { usd: 1.5 }, assignmentKeys: [], jurisdiction: "az:original-member" };
  const scopes = [{ key: ORIGINAL_LIFETIME_HUNT.key, receiptId: ORIGINAL_LIFETIME_HUNT.receiptId,
    geography: { label: "85635" }, budgetStartedAt: ORIGINAL_LIFETIME_HUNT.budgetStartedAt, budgetUsd: 50 }] as never;
  const reading = providerBillingAttribution({ now, costs: [base] as never, attempts: [], scopes, holds: {}, readings: [],
    scopeMembers: new Map([[ORIGINAL_LIFETIME_HUNT.key, new Set(["az:original-member"])]]) });
  assert.equal(reading.hunts?.[0]?.anthropicKnownUsd, 1.5);
  const unlinked = providerBillingAttribution({ now, costs: [base] as never, attempts: [], scopes, holds: {}, readings: [] });
  assert.equal(unlinked.hunts?.[0]?.anthropicKnownUsd, 0);
});

test("a new same-key hunt cannot inherit the old receipt's charges or an unmarked budget admission", () => {
  const key=ORIGINAL_LIFETIME_HUNT.key;
  const nextReceipt="new-hunt-receipt";
  const cost={attemptId:"old",source:"api.anthropic.com",recordedAt:now,assignmentKeys:[key],
    assignmentRefs:[{key,ref:ORIGINAL_LIFETIME_HUNT.receiptId}],cost:{usd:2}};
  const nextScope={key,receiptId:nextReceipt,geography:{label:"85635"},budgetStartedAt:started,budgetUsd:50};
  const reading=providerBillingAttribution({now,costs:[cost] as never,attempts:[],scopes:[nextScope] as never,holds:{},readings:[]});
  assert.equal(reading.hunts?.[0]?.anthropicKnownUsd,0);
  const oldOnly=assignmentMembership([member] as never);
  const gate=new AssignmentBudgetGate({specs:[{key,kind:"SCOPE",label:"new hunt",ref:nextReceipt,budgetUsd:50,
    budgetStartedAt:started,sentAt:now}],membership:oldOnly,historical:new Map(),worstCaseUsd:1,
    costsReadable:true,intentsReadable:true,historyReadAt:now});
  assert.equal(gate.admit(member.id).admit,false);
  const newlyMarked={...member,assignments:[...member.assignments,
    {assignmentKey:key,ref:nextReceipt,relation:"REORDERED",at:started}]};
  const scoped=armAssignmentBudget({now,specs:[{key,kind:"SCOPE",label:"new hunt",ref:nextReceipt,
    budgetUsd:50,budgetStartedAt:started,sentAt:now}],membership:assignmentMembership([newlyMarked] as never),
    charges:chargesOf([{...cost,obligationId:member.id}] as never),worstCaseUsd:1,intentsReadable:true});
  assert.equal(scoped.state(key)?.spentUsd,0,"an exact old-receipt charge does not spend the new hunt");
  assert.equal(scoped.admit(member.id).admit,true);
});

test("shared token charges are reported once but consume every exact beneficiary allowance",()=>{
  const scopes=[
    {key:"county:2020/04019",receiptId:"county-send",geography:{label:"Pima"},budgetStartedAt:started,budgetUsd:10},
    {key:"zcta:2020/85635",receiptId:"zip-send",geography:{label:"85635"},budgetStartedAt:started,budgetUsd:10},
  ];
  const assignmentRefs=scopes.map(scope=>({key:scope.key,ref:scope.receiptId}));
  const priced={attemptId:"shared",source:"api.anthropic.com",recordedAt:now,assignmentRefs,cost:{usd:5}};
  const holds={zip:{settled:null,usd:2,keys:[`send:${scopes[1]!.key}@${started}`]}};
  const read=(costs:unknown[])=>providerBillingAttribution({now,costs:costs as never,attempts:[],scopes:scopes as never,holds:holds as never,readings:[]});
  const first=read([priced]);
  assert.equal(first.hunts?.reduce((sum,hunt)=>sum+hunt.knownCombinedUsd,0),5,"combined report counts the request once");
  assert.deepEqual(first.hunts?.map(hunt=>hunt.budgetConsumedKnownUsd),[5,5]);
  assert.deepEqual(first.hunts?.map(hunt=>hunt.availableUsd),[5,3]);
  const unknown=read([priced,{...priced,attemptId:"shared-unpriced",cost:{usd:null}}]);
  assert.deepEqual(unknown.hunts?.map(hunt=>hunt.budgetUnpriced),[1,1]);
  assert.deepEqual(unknown.hunts?.map(hunt=>hunt.availableUsd),[null,null]);
  assert.equal(unknown.hunts?.reduce((sum,hunt)=>sum+hunt.knownCombinedUsd,0),5);
});

test("all work ignores blackout while every hunt obeys the Admin spend dial", () => {
  const blackout = "2026-09-27T02:00:00.000Z"; // Saturday 19:00 Arizona.
  const controller = new FleetSafetyController({ now: blackout, charges: chargesOf([{
    source: "api.anthropic.com", role: "SCOUT", recordedAt: "2026-09-27T01:00:00.000Z",
    cost: { usd: 105, inputTokens: 1, outputTokens: 1 },
  }] as never), rollingCeilingUsd: 105, clock: () => Date.parse(blackout),
  lifetimeHuntWork: work => work === member.id });
  assert.equal(controller.admitDispatch(member.id).admit, true);
  assert.deepEqual(controller.rollingCeilingReached(1, member.id).reached, true);
  assert.equal(controller.admitDispatch("outside").admit, true);
  const request = { model: "claude-haiku-4-5-20251001", max_tokens: 256,
    system: [{ type: "text", text: "test" }], tools: [], messages: [{ role: "user", content: "one" }] };
  assert.throws(() => controller.reserveModelRequest("anthropic", member.id, request as never),
    error => error instanceof FleetSafetyRefusal && error.code === "ROLLING_24_HOUR_MODEL_SPEND_CEILING");
  assert.throws(() => controller.reserveModelRequest("anthropic", "outside", request as never),
    error => error instanceof FleetSafetyRefusal && error.code === "ROLLING_24_HOUR_MODEL_SPEND_CEILING");
});
