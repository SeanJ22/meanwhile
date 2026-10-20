import test from "node:test";
import {exaModelRequest,EXA_AGENT_MODEL} from "../lib/hunt/exa-transport.ts";
import assert from "node:assert/strict";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { createRouteTask } from "../lib/control-plane/route-task.ts";
import { DurableSpendHolds, type BudgetLine } from "../lib/control-plane/expansion/spend-holds.ts";
import { FleetSafetyController, aggregatePricedSpend, pricedModelCharge } from "../lib/control-plane/fleet-safety.ts";
import { ModelProviderQueue } from "../lib/control-plane/scheduler/model-lane.ts";
import { backgroundBatchTransport } from "../lib/control-plane/model-batch.ts";
import { paidWorkGuards, type PaidWorkGuardDeps } from "../lib/control-plane/workers/paid-work-guards.ts";
import type { AssignmentBudgetGate } from "../lib/control-plane/expansion/assignment-budget.ts";
import type { ModelRequest, ModelResponse } from "../lib/control-plane/scheduler/scout-executor.ts";
import type { CostEntry } from "../lib/control-plane/cost.ts";
import { MODELS } from "../lib/models.ts";
import type { InProcessSpendHoldStore } from "../lib/control-plane/expansion/spend-holds.ts";

test("Exa uses Admin focus and the existing Send, area, Fleet and paid-pause guards", async () => {
  /**
   * The paid-work guards live in one module that the research round builds from the controllers it arms, so a
   * standing lease-worker lane builds the same ones. Each refusal is checked on the real holds, Fleet controller and
   * provider queue, with a fake model that counts what it was asked to send.
   */
  /** The holds table's rows (schema v24), live or not yet deleted: the memory store's view of `cp_spend_holds`. */
  const heldRows = (r: { readonly spendHolds?: unknown }) => (r.spendHolds as InProcessSpendHoldStore).rows();

  const NOW = "2026-10-05T18:00:00.000Z";
  const line = (key: string, budgetUsd: number, historicalUsd = 0): BudgetLine => ({ key, label: key, budgetUsd, historicalUsd, historyReadAt: NOW });

  async function harness(options: {
    exa?: (r:ModelRequest)=>Promise<ModelResponse>; sends?: ReturnType<AssignmentBudgetGate["linesFor"]>;
    areas?: { lines: readonly BudgetLine[] } | { refusal: { code: string; why: string } };
    modelHold?: string | null; costs?: readonly CostEntry[]; ceilingUsd?: number; modelLaneEnabled?: boolean;
    focused?:boolean; workerTask?: Record<string, unknown>; batch?: PaidWorkGuardDeps["batch"];
  } = {}) {
    const repos = createMemoryRepositories();
    const routeTask = createRouteTask({ workItemId: "wi-1", routeId: "autonomous:scout:x", routeLabel: "Discover", target: "https://x.example.gov/", inherited: false, now: NOW });
    const task = options.workerTask ? { ...routeTask, workerTask: options.workerTask as never } : routeTask;
    await repos.workItems.put("wi-1",{id:"wi-1",subject:"ocd-division/country:us/state:nh/county:x",autonomousPlan:{ownerInstructions:[]}} as never,NOW);
    await repos.routeTasks.put(task.id, task, NOW);
    await repos.occurrences.put("occ-1", { id: "occ-1", obligationId: "ob-1", sequence: 1, dueAt: NOW, workItemId: "wi-1", routeTaskId: task.id,
      openedAt: NOW, closedAt: null, disposition: null, unresolvedReason: null } as never, NOW);
    if(options.focused!==false)await repos.obligations.put("ob-1",{id:"ob-1",subjectId:"ocd-division/country:us/state:nh/county:x",recordClass:"hunt-packet",assignments:[{assignmentKey:"dispatch:admin-order",ref:"admin-order",relation:"CREATED",at:NOW}]} as never,NOW);
    const sent: ModelRequest[] = [];
    const messages = async (r: ModelRequest): Promise<ModelResponse> => {
      sent.push(r);
      return { id: `msg-${sent.length}`, model: r.model, role: "assistant", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn",
        usage: { input_tokens: 100, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } as unknown as unknown as ModelResponse;
    };
    const conditions: string[] = [];
    const spendHolds = new DurableSpendHolds({ budget: repos.budget, table: repos.spendHolds, now: () => NOW, sleep: async () => undefined });
    const fleetSafety = new FleetSafetyController({ now: NOW, spend:aggregatePricedSpend((options.costs ?? []).flatMap(row => pricedModelCharge(row, row.attemptId) ?? []),"2000-01-01T00:00:00Z",NOW), modelHold: options.modelHold ?? null,
      rollingCeilingUsd: options.ceilingUsd ?? 50, clock: () => Date.parse(NOW) });
    const deps: PaidWorkGuardDeps = { batchEnv: { WTP_BACKGROUND_WORKER_BATCH: options.batch ? "1" : "0" }, repos, now: () => NOW, armedAt: NOW, fleetSafety, providerQueue: new ModelProviderQueue(), spendHolds,
      assignmentBudget: { linesFor: () => options.sends ?? { lines: [] } } as unknown as AssignmentBudgetGate,
      expansionBudget: { gate: { linesFor: () => options.areas ?? { lines: [] } } } as never,
      messages, exaResearch:options.exa, batch: options.batch ?? backgroundBatchTransport({ apiKey: "" }), modelLaneEnabled: options.modelLaneEnabled ?? true,
      ceilingUsd: () => options.ceilingUsd ?? 50, onCondition: sentence => { conditions.push(sentence); } };
    const guards = paidWorkGuards(deps);
    const ledger = async () => ({ spendHolds: heldRows(repos) });
    return { guards, sent, conditions, task, ledger, repos, jurisdiction: { subjectId: "ocd-division/country:us/state:nh/county:x", state: "NH" } };
  }


  let calls=0;
  const exa=async():Promise<ModelResponse>=>{calls++;return {model:EXA_AGENT_MODEL,stop_reason:'completed',content:[],usage:{input_tokens:0,output_tokens:0},exaResearch:{costUsd:0.5,runId:'controlled',findings:[],summary:'',status:'completed',error:null,requestCount:2,bytesFetched:100}} as unknown as ModelResponse;};
  const exaRequest=exaModelRequest({packet:{governmentId:'ocd-division/country:us/state:nh/county:x',label:'Example',blanks:[]} as never,instructions:'',deadlineMs:Date.now()+1000});
  for(const options of [{sends:{lines:[line('send',0.49)]}},{areas:{lines:[line('area',0.49)]}},{ceilingUsd:0.49},{modelHold:'Admin paused paid research'}]){
   const before=calls,h=await harness({...options,exa} as never);
   await assert.rejects(h.guards.workerTransportFor(h.jurisdiction,h.task.id)(exaRequest));assert.equal(calls,before);assert.equal(h.sent.length,0);
  }
  const h=await harness({exa,sends:{lines:[line('send',2)]},areas:{lines:[line('area',2)]}});
  await h.guards.workerTransportFor(h.jurisdiction,h.task.id)(exaRequest);
  assert.equal(calls,1);assert.equal(h.sent.length,0,'Exa never enters the Anthropic queue or batch endpoint');
  const rows=heldRows(h.repos);assert.equal(Object.values(rows)[0].settled?.usd,0.5);
  console.log('Exa uses the existing Send, area, rolling-dollar and paid-pause guards; each refusal sends zero requests; admitted run settles its measured $0.50');

  const unfocused=await harness({exa,focused:false});
  await assert.rejects(unfocused.guards.workerTransportFor(unfocused.jurisdiction,unfocused.task.id)(exaRequest),/Admin order/);
  assert.equal(calls,1,'unfocused background work cannot spend Fleet money');
  console.log('Only an Admin-bound place or a place with an existing Send/area budget can send paid hunt requests');

});
