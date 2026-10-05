/**
 * **THE SCOUT'S MODEL LADDER — CHEAPEST SUITABLE CLASS FIRST, THE FRONTIER
 * ONLY FOR A RECORDED REASON.** (MW-031, MW-033, MW-035, 2026-09-25.)
 *
 * Offline: a fake transport scripted per model stands in for the provider and a
 * fake toolkit for the network. Nothing here reaches a model or a host.
 *
 *   L1  the loop's first request goes to Sonnet 5, with the cache breakpoints
 *       placed and a prefix long enough for Sonnet's minimum to cache
 *   L2  a Sonnet attempt that finishes is the whole Attempt: no escalation,
 *       no reservation asked for
 *   L3  each recorded reason escalates, carries the Sonnet attempt's evidence
 *       forward, and records the class, reason, evidence, per-attempt and
 *       combined cost; the hold is drawn by the frontier's spend and released
 *   L4  a transport failure that is not the model's (a 529) never escalates
 *   L5  an escalation the ceiling cannot cover is refused BEFORE any frontier
 *       request, by name, and recorded as part of the outcome; so are the
 *       wall-clock, unmeasured-spend and no-reservation refusals
 *   L6  the pre-warm warms the model the loop starts on, and is skipped by
 *       name when the prefix cannot be shown to clear that model's minimum
 *   L7  Opus stays the ceiling, Fable is refused, the auditor stays frontier
 */

import assert from "node:assert/strict";
import test from "node:test";

import { FleetSafetyController, FleetPreSendRefusal, scoutEscalationReservation } from "../lib/control-plane/fleet-safety.ts";
import { costSection } from "../lib/control-plane/pilot-cost-digest.ts";
import { minimumCacheablePrefixTokensFor, priceMeteredUsage, readMeteredUsage } from "../lib/control-plane/model-cost.ts";
import {
  MODEL_CEILING,
  MODEL_CLASSES,
  MODEL_ESCALATION_REASONS,
  MODEL_FOR_CLASS,
  DeterministicStepInvokedModel,
  UnrecordedEscalation,
  assertStepMayEscalate,
  assertStepMayInvokeModel,
  escalationTargetFor,
  modelCeilingViolation,
  type ModelEscalationReason,
} from "../lib/control-plane/scheduler/model-routing.ts";
import type { FreshnessObligation } from "../lib/control-plane/scheduler/obligation.ts";
import { scheduledFixture } from "./control-plane-fixtures.ts";
import { RESEARCH_BOUNDS, SCOUT_MODEL, type ScoutBound } from "../lib/control-plane/scheduler/research-policy.ts";
import type { InheritedEvidence, ScoutToolContext, ScoutToolkit } from "../lib/control-plane/scheduler/scout-contract.ts";
import {
  ModelTransportError,
  SCOUT_ESCALATION_EVIDENCE_MAX_CHARS,
  cacheTtlOrderProblems,
  scoutAttemptWorstCaseUsd,
  scoutExecutor,
  scoutLoopBase,
  scoutPrewarmPlan,
  type ContentBlock,
  type ModelRequest,
  type ModelResponse,
  type ModelTransport,
  type ScoutEscalationAdmission,
  type ScoutEscalationRequest,
} from "../lib/control-plane/scheduler/scout-executor.ts";
import { MIN_DISTINCT_RUNGS, type ScoutResult } from "../lib/control-plane/scheduler/scout-result.ts";
import { SCOUT_TOOL_SPECS } from "../lib/control-plane/scheduler/scout-tools.ts";
import { MODELS } from "../lib/models.ts";
import type { WorkOutcome } from "../lib/control-plane/scheduler/dispatch.ts";

const NOW = "2026-09-23T18:00:00.000Z"; // a Wednesday: outside the Saturday blackout the controller enforces
const NOW_MS = Date.parse(NOW);
const HAIKU = MODELS.haiku.model;
const SONNET = MODELS.sonnet.model;
const OPUS = MODELS.opus.model;

const OBLIGATION: FreshnessObligation = {
  id: "freshness:test:scout#ladder",
  recordClass: "meetings",
  subjectId: "ocd-division/country:us/state:az/place:test",
  routeId: "novel-route",
  active: true,
  readerImpactAt: null,
  observedChangeRateHours: null,
  lastWorkedAt: new Date(NOW_MS - 48 * 3_600_000).toISOString(),
};

/** A toolkit whose fetch_public / read_permission vault one artifact per call; it enforces the Attempt's tool-call bound like the real one. */
function fakeToolkit(): ScoutToolkit {
  const vaulted = new Set<string>();
  let toolCalls = 0;
  const spec = (name: string) => ({ name, description: "fake", input_schema: { type: "object", properties: { url: { type: "string" }, rung: { type: "string" }, why: { type: "string" } }, required: ["url", "rung", "why"] } });
  return {
    specs: [spec("read_permission"), spec("fetch_public")],
    get vaultedArtifactIds() {
      return vaulted;
    },
    get toolCalls() {
      return toolCalls;
    },
    requestCount: 0,
    bytesFetched: 0,
    async call(name, input, rungLabel) {
      toolCalls += 1;
      const url = String((input as { url?: string }).url ?? "");
      const id = `art-${toolCalls}`;
      vaulted.add(id);
      return {
        ok: true,
        forModel: `[artifact ${id}] fetched ${url}`,
        artifacts: [{ artifactId: id, tier: "RAW", contentHash: `sha256-${id}`, byteLength: 10, contentType: "text/html", canonicalUrl: url, partial: false, recordedAt: NOW }],
        provenance: [{ artifactId: id, canonicalUrl: url, retrievedAt: NOW, permission: "ALLOWED", methodRouteId: name === "read_permission" ? "scout:read_permission" : "scout:fetch_public", httpStatus: 200 }],
        rung: { rung: rungLabel ?? "other:unlabelled", tool: name, target: url, observed: "HTTP 200, 10 bytes", artifactIds: [id], ok: true },
        requestCount: 1,
        bytesFetched: 10,
      };
    },
  };
}

const toolUse = (id: string, name: string, input: unknown) => ({ type: "tool_use" as const, id, name, input });
const fetchOf = (id: string, url: string) => toolUse(id, "fetch_public", { url, rung: "primary-site-navigation", why: "navigate" });
const text = (t: string) => ({ type: "text" as const, text: t });
const candidateFinish = (id: string, evidence: string, rungsWalked: readonly { index: number; note: string }[]) =>
  toolUse(id, "finish", {
    outcome: "ROUTE_CANDIDATE",
    rungsWalked,
    candidates: [
      {
        routeId: "a-gov-meetings-ics",
        title: "ics feed",
        url: "https://a.gov/meetings.ics",
        procedure: "GET",
        relevance: "linked from the meetings page",
        permission: "ALLOWED",
        permissionReading: "robots allows /",
        evidenceArtifactIds: [evidence],
        observedOn: NOW,
        recordClass: "meetings",
        deterministic: true,
        unverified: [],
      },
    ],
    findings: [],
    nextRungs: [],
    unverified: [],
    narrative: "found the feed",
  });

type Usage = ModelResponse["usage"];
const CHEAP_USAGE: Usage = { input_tokens: 100, output_tokens: 100, cache_read_input_tokens: 500, cache_creation_input_tokens: 0 };

/**
 * The fake provider, scripted PER MODEL: each model has its own turn list and
 * usage, so what the frontier answers cannot be confused with what Sonnet did.
 * A script entry that is an Error is thrown instead of answered.
 */
function perModelTransport(
  scripts: Readonly<Record<string, readonly (readonly ContentBlock[] | Error)[]>>,
  usageFor: (model: string, turn: number) => Usage = () => CHEAP_USAGE,
): ModelTransport & { readonly requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  const turnOf = new Map<string, number>();
  const t = (async (request: ModelRequest) => {
    requests.push(JSON.parse(JSON.stringify(request)) as ModelRequest);
    const script = scripts[request.model];
    if (script === undefined) throw new Error(`the fake provider has no script for ${request.model}`);
    const turn = (turnOf.get(request.model) ?? 0) + 1;
    turnOf.set(request.model, turn);
    const entry = script[turn - 1] ?? [text("script complete")];
    if (entry instanceof Error) throw entry;
    return {
      model: request.model,
      stop_reason: entry.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn",
      content: entry,
      usage: usageFor(request.model, turn),
    } satisfies ModelResponse;
  }) as ModelTransport & { requests: ModelRequest[] };
  Object.defineProperty(t, "requests", { value: requests });
  return t;
}

/** A reservation seam that records what it was asked and how the hold was used. */
function recordingReservation(admit = true) {
  const asked: ScoutEscalationRequest[] = [];
  const draws: number[] = [];
  let released = 0;
  const seam = (request: ScoutEscalationRequest): ScoutEscalationAdmission => {
    asked.push(request);
    if (!admit) return { admit: false, code: "CEILING", why: "test ceiling" };
    return { admit: true, reservedUsd: request.worstCaseUsd, draw: (usd) => draws.push(usd), release: () => (released += 1) };
  };
  return { seam, asked, draws, released: () => released };
}

async function runLadder(input: {
  readonly transport: ModelTransport;
  readonly bound?: Partial<ScoutBound>;
  readonly reserveEscalation?: (r: ScoutEscalationRequest) => ScoutEscalationAdmission;
  readonly model?: string;
  readonly inherited?: InheritedEvidence;
}): Promise<{ readonly outcome: WorkOutcome; readonly result: ScoutResult }> {
  const bound: ScoutBound = { ...RESEARCH_BOUNDS.perDispatch, ...(input.bound ?? {}) };
  const toolkit = fakeToolkit();
  const results: ScoutResult[] = [];
  const exec = scoutExecutor({
    transport: input.transport, refusedBeforeSending:error=>error instanceof FleetPreSendRefusal,
    ...(input.model !== undefined ? { model: input.model } : { model: SONNET }),
    ...(input.reserveEscalation !== undefined ? { reserveEscalation: input.reserveEscalation } : {}),
    toolkitFor: (_ctx: ScoutToolContext) => toolkit,
    contextFor: () => ({
      route: null,
      providerId: "test",
      reason: "test novelty",
      inherited: input.inherited ?? { artifactIds: [], summary: "none" },
      tools: { vault: async () => ({ stored: true, where: "x", why: "written" }), spaceOut: async () => undefined },
    }),
    now: () => NOW,
    bound,
    onResult: async (r) => {
      results.push(r);
    },
  });
  const outcome = await exec.run({
    obligation: scheduledFixture(OBLIGATION, NOW_MS),
    routeTaskId: "rt-ladder",
    workItemId: "wi-ladder",
    attemptId: "at-ladder",
    holder: "h",
    executor: "BOUNDED_MODEL_WORKER",
    bound: { maxAttempts: 1, maxWallMs: 0, maxCostUnits: 1 },
  } as never);
  assert.equal(results.length, 1, "the typed result was handed to onResult exactly once");
  return { outcome, result: results[0] };
}

const turnUsd = (model: string, usage: Usage): number => priceMeteredUsage(model, readMeteredUsage(usage), "5m").usd ?? Number.NaN;
const close = (a: number | null | undefined, b: number): boolean => a !== null && a !== undefined && Math.abs(a - b) < 1e-12;

test('a long Scout walks beyond the former turn, tool, token and wall limits until finished or the real budget refuses',async()=>{
 const actualNow=Date.now;let elapsed=actualNow();Date.now=()=>elapsed;
 try {
 const walks=Array.from({length:40},(_,i)=>[fetchOf('u'+i,`https://source${i}.gov/meetings`)]);
 const script=[...walks,[candidateFinish('done','art-40',walks.map((_,index)=>({index,note:'opened source'})))]];
 for(const ceiling of [100,0.75]) {
  const controller=new FleetSafetyController({now:NOW,costs:[],rollingCeilingUsd:ceiling,clock:()=>NOW_MS});
  const fake=perModelTransport({[HAIKU]:script},()=>{elapsed+=60_000;return {input_tokens:20_000,output_tokens:100};});
  const {outcome,result}=await runLadder({model:HAIKU,transport:controller.guardedModelTransport('anthropic',OBLIGATION.id,fake)});
  assert.ok(fake.requests.length>18,'long work passes the old model turn cap');
  assert.ok(result.usage.toolCalls>16,'long work passes the old tool cap');
  assert.ok((result.modelAttempts?.[0]?.turns??0) * 20_000>400_000,'long work passes the old cumulative token cap');
  if(ceiling===100){assert.equal(outcome.kind,'DISPOSED');assert.equal(fake.requests.length,41);assert.equal(result.refusal,null);}
  else {assert.equal(outcome.kind,'ABORTED');assert.ok(fake.requests.length<41);assert.match(result.refusal?.map(row=>row.detail).join(" ")??"",/CEILING|budget/i);
   assert.ok(controller.snapshot(NOW).deferred.some(row=>row.code==='ROLLING_24_HOUR_MODEL_SPEND_CEILING'));}
 }
 }finally{Date.now=actualNow;}
});

/* --------------------------------------------------------------------- L1 */

test("L1: acquisition starts with Haiku and omits unsupported effort and adaptive thinking", async () => {
  assert.equal(SCOUT_MODEL, HAIKU);
  assert.equal(scoutLoopBase().model, HAIKU);
  const transport = perModelTransport({ [HAIKU]: [[fetchOf("u1", "https://a.gov/meetings")], [candidateFinish("f", "art-1", [{ index: 0, note: "meetings page" }])]] });
  const { result } = await runLadder({ transport, model: HAIKU });
  assert.equal(transport.requests.length, 2);
  for (const request of transport.requests) {
    assert.equal(request.model, HAIKU);
    assert.equal(request.output_config, undefined);
    assert.equal(request.thinking, undefined);
    assert.deepEqual(request.tools.at(-1)?.cache_control, { type: "ephemeral" });
    assert.deepEqual(request.system[0].cache_control, { type: "ephemeral" });
    assert.deepEqual(request.cache_control, { type: "ephemeral" });
    assert.deepEqual(cacheTtlOrderProblems(request), []);
  }
  assert.equal(minimumCacheablePrefixTokensFor(HAIKU), 4096);
  const prewarm = scoutPrewarmPlan({ toolkitSpecs: SCOUT_TOOL_SPECS, bound: RESEARCH_BOUNDS.perDispatch, minRungs: MIN_DISTINCT_RUNGS });
  assert.equal(prewarm.kind, "SEND", "the full direct-API toolkit now clears Haiku's cache minimum");
  if (prewarm.kind === "SEND") assert.ok(prewarm.prefixTokensAtLeast >= minimumCacheablePrefixTokensFor(HAIKU)!);
  assert.equal(result.modelClass, "haiku");
  assert.equal(result.worker.model, HAIKU);
  assert.equal(result.escalatedFrom, null);
});

/* --------------------------------------------------------------------- L2 */

test("Haiku then Sonnet then Opus records both justified escalations and all costs without repeating discovery", async () => {
  const transport = perModelTransport({
    [HAIKU]: [[fetchOf("h1", "https://a.gov/meetings")], [text("no result")]],
    [SONNET]: [[text("still no result")]],
    [OPUS]: [[candidateFinish("f", "art-1", [{ index: 0, note: "inherited meeting page" }])]],
  });
  const reservation = recordingReservation();
  const { result, outcome } = await runLadder({ model: HAIKU, transport, reserveEscalation: reservation.seam });
  assert.equal(outcome.kind, "DISPOSED");
  assert.deepEqual(result.modelAttempts?.map(a => a.model), [HAIKU, SONNET, OPUS]);
  assert.deepEqual(result.modelAttempts?.slice(1).map(a => a.escalation?.from), [HAIKU, SONNET]);
  assert.ok(result.modelAttempts?.slice(1).every(a => a.escalation?.at === NOW && a.escalation.reason && a.escalation.evidence));
  assert.equal(reservation.asked.length, 2);
  assert.equal(reservation.released(), 2);
  assert.deepEqual(result.candidates[0].evidenceArtifactIds, ["art-1"]);
  assert.ok(close(result.usd, result.modelAttempts!.reduce((n,a) => n + a.usd!,0)));
  assert.ok(close(outcome.cost?.usd, outcome.costByModel!.reduce((n,a) => n + a.usd!,0)));
});

test("L2: a Sonnet attempt that produces an accepted typed result is the whole Attempt — no escalation, no reservation, one attempt's cost", async () => {
  const reservation = recordingReservation();
  const transport = perModelTransport({
    [SONNET]: [[fetchOf("u1", "https://a.gov/meetings")], [candidateFinish("f", "art-1", [{ index: 0, note: "meetings page" }])]],
    [OPUS]: [[text("the frontier must never be asked")]],
  });
  const { outcome, result } = await runLadder({ transport, reserveEscalation: reservation.seam });
  assert.equal(outcome.kind, "DISPOSED");
  assert.equal(result.refusal, null);
  assert.equal(transport.requests.filter((r) => r.model === OPUS).length, 0, "the frontier was never called");
  assert.equal(reservation.asked.length, 0, "nothing was reserved: nothing escalated");
  assert.equal(result.modelClass, "sonnet");
  assert.equal(result.escalatedFrom, null);
  assert.equal(result.escalationReason, null);
  assert.equal(result.escalationEvidence, null);
  assert.equal(result.escalationRefused, null);
  assert.equal(result.modelAttempts?.length, 1);
  assert.deepEqual({ ...result.modelAttempts![0], usd: null }, { modelClass: "sonnet", model: SONNET, turns: 2, usd: null, accepted: true });
  assert.ok(close(result.modelAttempts![0].usd, 2 * turnUsd(SONNET, CHEAP_USAGE)), "the attempt is priced at Sonnet's rate");
  assert.ok(close(result.usd, result.modelAttempts![0].usd ?? Number.NaN));
  assert.doesNotMatch(outcome.detail, /ESCALATED/);
  assert.equal(outcome.costByModel, undefined, "one model ran: the Attempt's worker model is the whole charge, no split written");
});

/* --------------------------------------------------------------------- L3 */

interface ReasonCase {
  readonly reason: ModelEscalationReason;
  readonly bound?: Partial<ScoutBound>;
  readonly sonnet: readonly (readonly ContentBlock[] | Error)[];
  readonly opus: readonly (readonly ContentBlock[] | Error)[];
  /** What the escalation evidence line must say. */
  readonly evidence: RegExp;
  /** An artifact the Sonnet attempt vaulted that the frontier's finish cites — the carried-forward evidence. */
  readonly carried: string | null;
}

const FRONTIER_FIRST: Usage = { input_tokens: 2, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 5000 };
const FRONTIER_LATER: Usage = { input_tokens: 2, output_tokens: 80, cache_read_input_tokens: 5000, cache_creation_input_tokens: 300 };

const REASON_CASES: readonly ReasonCase[] = [
  {
    reason: "RESULT_REFUSED",
    bound: {},
    /* Sonnet cites an artifact no vault holds, and keeps doing so through the bound. */
    sonnet: [[fetchOf("u1", "https://a.gov/meetings")], [candidateFinish("f", "art-ghost", [{ index: 0, note: "x" }])]],
    opus: [[candidateFinish("f2", "art-1", [{ index: 0, note: "meetings page" }])]],
    evidence: /finish refused after 5 turn\(s\): .*SCOUT_CANDIDATE_WITHOUT_EVIDENCE/,
    carried: "art-1",
  },
  {
    reason: "NO_TYPED_RESULT",
    /* Sonnet talks and never calls a tool, through both reminders. */
    sonnet: [[text("I would look at the meetings page.")]],
    opus: [[fetchOf("o1", "https://a.gov/meetings")], [candidateFinish("f", "art-1", [{ index: 0, note: "meetings page" }])]],
    evidence: /3 turn\(s\) ended with no tool call and no finish, after 2 reminder\(s\) \(last stop_reason end_turn\)/,
    carried: null,
  },
  {
    reason: "CAPABILITY_ERROR",
    /* The provider refuses the Sonnet request as invalid for that model. */
    sonnet: [new ModelTransportError('HTTP 400: {"type":"invalid_request_error","message":"this model does not support the requested feature"}', 400)],
    opus: [[fetchOf("o1", "https://a.gov/meetings")], [candidateFinish("f", "art-1", [{ index: 0, note: "meetings page" }])]],
    evidence: /the provider refused the claude-sonnet-5-5 request as invalid \(HTTP 400\)/,
    carried: null,
  },
];

for (const c of REASON_CASES) {
  test(`L3 ${c.reason}: the Sonnet attempt's recorded reason escalates to Opus 5.5 with its evidence carried forward, and the result records class, reason, evidence, per-attempt and combined cost`, async () => {
    const reservation = recordingReservation();
    const transport = perModelTransport({ [SONNET]: c.sonnet, [OPUS]: c.opus }, (model, turn) => (model === OPUS ? (turn === 1 ? FRONTIER_FIRST : FRONTIER_LATER) : CHEAP_USAGE));
    const { outcome, result } = await runLadder({ transport, bound: c.bound, reserveEscalation: reservation.seam });

    /* It escalated, once, for the observed reason, and the frontier produced the accepted result. */
    assert.equal(outcome.kind, "DISPOSED", `the escalated attempt finished: ${outcome.detail}`);
    assert.equal(result.refusal, null);
    assert.equal(result.outcome, "ROUTE_CANDIDATE");
    assert.equal(result.modelClass, "frontier");
    assert.equal(result.worker.model, OPUS);
    assert.equal(result.escalatedFrom, "sonnet");
    assert.equal(result.escalationReason, c.reason);
    assert.match(result.escalationEvidence ?? "", c.evidence);
    assert.ok((result.escalationEvidence ?? "").length <= SCOUT_ESCALATION_EVIDENCE_MAX_CHARS, "the evidence line is short");
    assert.equal(result.escalationRefused, null);
    assert.match(result.modelClassWhy ?? "", /deterministic routes/);
    assert.match(outcome.detail, new RegExp(`ESCALATED sonnet → frontier \\(${c.reason}\\)`));

    /* Sonnet first; every frontier request came after the reservation and names the escalation. */
    const firstOpus = transport.requests.findIndex((r) => r.model === OPUS);
    assert.ok(firstOpus > 0 || c.reason === "CAPABILITY_ERROR", "the cheaper model ran first");
    assert.equal(transport.requests[0].model, SONNET, "the Attempt opened on Sonnet");
    assert.equal(reservation.asked.length, 1, "the escalation was reserved exactly once, before it ran");
    const asked = reservation.asked[0];
    assert.deepEqual({ from: asked.from, to: asked.to, reason: asked.reason }, { from: { modelClass: "sonnet", model: SONNET }, to: { modelClass: "frontier", model: OPUS }, reason: c.reason });
    assert.ok(close(asked.worstCaseUsd, scoutAttemptWorstCaseUsd(OPUS, { ...RESEARCH_BOUNDS.perDispatch, ...(c.bound ?? {}) }) ?? Number.NaN), "the hold is the frontier attempt's worst case");
    const lastUser = JSON.stringify(transport.requests[firstOpus].messages.at(-1));
    assert.match(lastUser, /ESCALATED: this investigation moves from claude-sonnet-5-5 to claude-opus-5-5 because/);
    for (const r of transport.requests.slice(firstOpus)) {
      assert.equal(r.model, OPUS);
      assert.deepEqual(r.tools.at(-1)?.cache_control, { type: "ephemeral" }, "the frontier's requests keep the same breakpoints");
      assert.deepEqual(r.cache_control, { type: "ephemeral" });
    }
    if (c.carried !== null) {
      /* Carried forward, not restarted: the frontier's first request holds the Sonnet attempt's tool results, and its finish cites them. */
      assert.match(JSON.stringify(transport.requests[firstOpus].messages), new RegExp(`artifact ${c.carried}`));
      assert.deepEqual(result.candidates[0].evidenceArtifactIds, [c.carried]);
    }

    /* Per-attempt cost at each model's own rate, and the combined cost is their sum. */
    const attempts = result.modelAttempts ?? [];
    assert.deepEqual(attempts.map((a) => [a.modelClass, a.model, a.accepted]), [["sonnet", SONNET, false], ["frontier", OPUS, true]]);
    const sonnetTurns = transport.requests.filter((r) => r.model === SONNET).length - (c.reason === "CAPABILITY_ERROR" ? 1 : 0);
    const opusTurns = transport.requests.filter((r) => r.model === OPUS).length;
    assert.equal(attempts[0].turns, sonnetTurns);
    assert.equal(attempts[1].turns, opusTurns);
    assert.ok(close(attempts[0].usd, sonnetTurns * turnUsd(SONNET, CHEAP_USAGE)), "the Sonnet attempt priced at Sonnet's rate");
    const opusUsd = turnUsd(OPUS, FRONTIER_FIRST) + (opusTurns - 1) * turnUsd(OPUS, FRONTIER_LATER);
    assert.ok(close(attempts[1].usd, opusUsd), "the frontier attempt priced at Opus 5.5's rate");
    assert.ok(close(result.usd, (attempts[0].usd ?? Number.NaN) + (attempts[1].usd ?? Number.NaN)), "usd is the combined cost of both attempts");
    /* MW-031: the one charge goes to the ledger with each attempt's part, so cost-by-model attributes each to its own model. */
    const split = outcome.costByModel ?? [];
    assert.deepEqual(split.map((s) => [s.model, s.requestCount]), [[SONNET, transport.requests.filter(r => r.model === SONNET).length], [OPUS, opusTurns]], "rejected requests count as sent even when they produced no billable completion");
    assert.ok(close(split[0].usd, attempts[0].usd ?? 0) && close(split[1].usd, opusUsd), "each part at its own model's rate");
    assert.ok(close(split.reduce((n, s) => n + (s.usd ?? Number.NaN), 0), outcome.cost?.usd ?? Number.NaN), "the parts sum to the combined charge: nothing counted twice");
    assert.equal(split[1].cacheReadInputTokens, (opusTurns - 1) * (FRONTIER_LATER.cache_read_input_tokens ?? 0), "the frontier's part carries its own turns' tokens");
    assert.equal(split[0].cacheReadInputTokens, sonnetTurns * (CHEAP_USAGE.cache_read_input_tokens ?? 0));
    assert.ok(close(reservation.draws.reduce((n, d) => n + d, 0), opusUsd), "the frontier's spend was drawn from the hold, turn by turn");
    assert.equal(reservation.released(), 1, "the rest of the hold was released when the frontier attempt ended");
    assert.equal(result.cacheDefect, null, "the frontier's first turn re-writes the conversation by design; that is its own first turn, not a defect");
  });
}

/* --------------------------------------------------------------------- L4 */

test("L4: a provider overload (HTTP 529) is not the model's failing and never escalates — a dearer model is not a retry", async () => {
  const reservation = recordingReservation();
  const transport = perModelTransport({ [SONNET]: [new ModelTransportError("HTTP 529: overloaded", 529)], [OPUS]: [[text("never")]] });
  const { outcome, result } = await runLadder({ transport, reserveEscalation: reservation.seam });
  assert.equal(outcome.kind, "ABORTED");
  assert.equal(transport.requests.filter((r) => r.model === OPUS).length, 0);
  assert.equal(reservation.asked.length, 0);
  assert.deepEqual(result.refusal?.map((i) => i.code), ["SCOUT_TRANSPORT_FAILED"]);
  assert.equal(result.escalationReason, null);
  assert.equal(result.escalatedFrom, null);
  assert.equal(result.modelClass, "sonnet");
});

/* --------------------------------------------------------------------- L5 */

const LOOPING_SONNET = { [SONNET]: [[text("thinking")]] as readonly (readonly ContentBlock[])[], [OPUS]: [[text("never")]] as readonly (readonly ContentBlock[])[] };

test("L5 CEILING: with the real FleetSafety controller, an escalation whose worst case the rolling ceiling cannot cover is refused before any frontier request, deferred by name, and recorded after the root cause", async () => {
  const controller = new FleetSafetyController({ now: NOW, costs: [], rollingCeilingUsd: 0.15, clock: () => NOW_MS });
  const fake = perModelTransport(LOOPING_SONNET);
  const guarded = controller.guardedModelTransport("anthropic", OBLIGATION.id, fake);
  const { outcome, result } = await runLadder({ transport: guarded, reserveEscalation: scoutEscalationReservation(controller) });
  assert.ok((scoutAttemptWorstCaseUsd(OPUS, RESEARCH_BOUNDS.perDispatch) ?? 0) > 0.15, "the frontier attempt's worst case is over this $0.15 ceiling");
  assert.equal(outcome.kind, "ABORTED");
  assert.equal(fake.requests.filter((r) => r.model === OPUS).length, 0, "no frontier request was sent");
  assert.equal(result.escalationReason, "NO_TYPED_RESULT", "the reason is recorded even though the escalation was refused");
  assert.equal(result.escalatedFrom, null);
  assert.equal(result.escalationRefused?.code, "CEILING");
  assert.equal(result.escalationRefused?.wouldEscalateTo, "frontier");
  assert.match(result.escalationRefused?.detail ?? "", /ROLLING_24_HOUR_MODEL_SPEND_CEILING/);
  assert.deepEqual(result.refusal?.map((i) => i.code), ["SCOUT_NO_FINISH", "SCOUT_ESCALATION_REFUSED"], "the root cause stays first; the refused escalation is part of the outcome");
  assert.match(outcome.detail, /SCOUT_ESCALATION_REFUSED/);
  const snapshot = controller.snapshot(NOW);
  assert.ok(snapshot.deferred.some((d) => d.code === "ROLLING_24_HOUR_MODEL_SPEND_CEILING" && d.work === OBLIGATION.id), "the controller deferred the escalation by name");
  assert.equal(result.modelAttempts?.length, 1);
});

test("L5 CEILING (positive control): under a ceiling that covers both attempts the real controller holds the escalation, and after it every cent of the hold is drawn or released", async () => {
  const controller = new FleetSafetyController({ now: NOW, costs: [], rollingCeilingUsd: 100, clock: () => NOW_MS });
  const fake = perModelTransport({ [SONNET]: [[text("thinking")]], [OPUS]: [[fetchOf("o1", "https://a.gov/meetings")], [candidateFinish("f", "art-1", [{ index: 0, note: "meetings" }])]] });
  const { outcome, result } = await runLadder({ transport: controller.guardedModelTransport("anthropic", OBLIGATION.id, fake), reserveEscalation: scoutEscalationReservation(controller) });
  assert.equal(outcome.kind, "DISPOSED");
  assert.equal(result.escalatedFrom, "sonnet");
  const spent = controller.snapshot(NOW).cycle.modelUsd ?? Number.NaN;
  assert.ok(close(spent, result.usd ?? Number.NaN), "the controller settled exactly the combined cost");
  const left = 100 - spent;
  assert.equal(controller.rollingCeilingReached(left - 0.000001).reached, false, "no hold outlived the escalation");
});

test("L5 FleetSafety.holdModelBudget: the hold counts against the rolling ceiling until drawn or released, and refuses over it", () => {
  const controller = new FleetSafetyController({ now: NOW, costs: [], rollingCeilingUsd: 10, clock: () => NOW_MS });
  const hold = controller.holdModelBudget("w", 8);
  assert.equal(controller.rollingCeilingReached(2.5).reached, true, "the $8 hold is counted");
  /* A draw moves $3 out of the hold (the per-request guard counts that $3 as settled spend in a real run). */
  hold.draw(3);
  assert.equal(controller.rollingCeilingReached(5.1).reached, true, "$5 is still held");
  assert.equal(controller.rollingCeilingReached(4.9).reached, false);
  hold.draw(99);
  assert.equal(controller.rollingCeilingReached(9.9).reached, false, "a draw never takes more than the hold holds");
  hold.release();
  assert.equal(controller.rollingCeilingReached(9.9).reached, false, "released: nothing held");
  assert.throws(() => controller.holdModelBudget("w2", 10.5), /ROLLING_24_HOUR_MODEL_SPEND_CEILING/);
});

test("L5 UNMEASURED_SPEND / NOT_RESERVED: each refusal is named, recorded, and sends no frontier request", async () => {
  /* UNMEASURED_SPEND: a Sonnet attempt that reported no usage cannot be combined with anything. */
  const unmeasured = perModelTransport(LOOPING_SONNET, () => ({}));
  const u = await runLadder({ transport: unmeasured, reserveEscalation: recordingReservation().seam });
  assert.equal(u.result.escalationRefused?.code, "UNMEASURED_SPEND");
  assert.equal(u.result.modelAttempts?.[0].usd, null);
  assert.equal(unmeasured.requests.filter((r) => r.model === OPUS).length, 0);

  /* NOT_RESERVED: no seam, no escalation — fail closed. */
  const bare = perModelTransport(LOOPING_SONNET);
  const n = await runLadder({ transport: bare });
  assert.equal(n.result.escalationRefused?.code, "NOT_RESERVED");
  assert.equal(n.result.escalationReason, "NO_TYPED_RESULT");
  assert.equal(bare.requests.filter((r) => r.model === OPUS).length, 0);
  assert.deepEqual(n.result.refusal?.map((i) => i.code), ["SCOUT_NO_FINISH", "SCOUT_ESCALATION_REFUSED"]);

  /* And a refusing seam is honoured as given. */
  const refusing = recordingReservation(false);
  const r = await runLadder({ transport: perModelTransport(LOOPING_SONNET), reserveEscalation: refusing.seam });
  assert.equal(r.result.escalationRefused?.code, "CEILING");
  assert.equal(refusing.asked.length, 1);
});

/* --------------------------------------------------------------------- L6 */

test("L6: the pre-warm warms the model the loop STARTS on — byte-identical to the loop's first request — and is skipped by name when the prefix cannot be shown to cache", async () => {
  const plan = scoutPrewarmPlan({ model: SONNET, toolkitSpecs: SCOUT_TOOL_SPECS, bound: RESEARCH_BOUNDS.perDispatch, minRungs: MIN_DISTINCT_RUNGS });
  assert.equal(plan.kind, "SEND");
  if (plan.kind !== "SEND") return;
  assert.equal(plan.model, SONNET);
  assert.equal(plan.request.model, SONNET);
  assert.equal(plan.request.max_tokens, 0);
  assert.equal(plan.minimumCacheablePrefixTokens, 512);
  assert.ok(plan.prefixTokensAtLeast >= 512);

  /* The loop's own first request, captured, over the same toolkit specs. */
  const captured: ModelRequest[] = [];
  const capture: ModelTransport = async (request) => {
    captured.push(request);
    throw new ModelTransportError("captured", null);
  };
  const exec = scoutExecutor({
    transport: capture,
    model: SONNET,
    toolkitFor: () => ({ specs: SCOUT_TOOL_SPECS, vaultedArtifactIds: new Set(), requestCount: 0, bytesFetched: 0, toolCalls: 0, call: async () => { throw new Error("no tools"); } }),
    contextFor: () => ({ route: null, providerId: "p", reason: "r", inherited: { artifactIds: [], summary: "s" }, tools: { vault: async () => ({ stored: true, where: "x", why: "w" }), spaceOut: async () => undefined } }),
    now: () => NOW,
  });
  await exec.run({ obligation: scheduledFixture(OBLIGATION, NOW_MS), routeTaskId: "rt", workItemId: "wi", attemptId: "at", holder: "h", executor: "BOUNDED_MODEL_WORKER", bound: { maxAttempts: 1, maxWallMs: 1000, maxCostUnits: 1 } } as never);
  assert.equal(captured.length, 1, "a null-status transport failure is not a capability error: one request, no escalation");
  assert.equal(captured[0].model, plan.request.model, "the pre-warm and the loop start on the same model");
  assert.equal(JSON.stringify(captured[0].tools), JSON.stringify(plan.request.tools), "byte-identical tools");
  assert.equal(JSON.stringify(captured[0].system), JSON.stringify(plan.request.system), "byte-identical system");
  assert.deepEqual(captured[0].output_config, plan.request.output_config, "the same effort, so the warmed entry is the one read");

  /* A small toolkit does not clear Haiku's 4,096-token minimum, so no paid call is made. */
  const haiku = scoutPrewarmPlan({ toolkitSpecs: [], bound: RESEARCH_BOUNDS.perDispatch, minRungs: MIN_DISTINCT_RUNGS, model: HAIKU });
  assert.equal(haiku.kind, "SKIP");
  assert.equal(haiku.kind === "SKIP" ? haiku.code : null, "BELOW_CACHE_MINIMUM");
  assert.match(haiku.kind === "SKIP" ? haiku.detail : "", /4096-token cacheable minimum/);
  /* Opus 5.5's 512-token minimum is cleared even with no research tools: the executor's own tools and system suffice. */
  const bareOpus = scoutPrewarmPlan({ toolkitSpecs: [], bound: RESEARCH_BOUNDS.perDispatch, minRungs: 1, model: OPUS });
  assert.equal(bareOpus.kind, "SEND");
  const unknown = scoutPrewarmPlan({ toolkitSpecs: SCOUT_TOOL_SPECS, bound: RESEARCH_BOUNDS.perDispatch, minRungs: MIN_DISTINCT_RUNGS, model: "claude-unrated-9" });
  assert.equal(unknown.kind === "SKIP" ? unknown.code : null, "CACHE_MINIMUM_UNKNOWN");

  /* A skipped pre-warm is named on the cycle's cost digest, never shown as a warm one. */
  const skipped = costSection({ digest: [], research: { cacheThisCycle: [], scouts: [], lanes: { model: { prewarm: { status: "SKIPPED", at: NOW, model: "claude-haiku-4-5", code: "BELOW_CACHE_MINIMUM", detail: "under 4096", durationMs: 0 } } } } }).lines.join("\n");
  assert.match(skipped, /PRE-WARM — SKIPPED at 2026-09-23T18:00:00\.000Z for claude-haiku-4-5 \(BELOW_CACHE_MINIMUM\): under 4096/);
  assert.doesNotMatch(skipped, /wrote/);
});

/* --------------------------------------------------------------------- L7 */

test("L7: Opus 5.5 remains the maximum, a Fable is refused, and cheaper-first audit escalation needs a reason", async () => {
  const up = escalationTargetFor("scout-research-loop", "sonnet");
  assert.equal(up?.model, MODEL_CEILING);
  assert.equal(MODEL_CEILING, OPUS);
  const escalated = assertStepMayEscalate("scout-research-loop", "RESULT_REFUSED", "sonnet");
  assert.deepEqual({ model: escalated.model, modelClass: escalated.modelClass, escalatedFrom: escalated.escalatedFrom }, { model: OPUS, modelClass: "frontier", escalatedFrom: "sonnet" });
  for (const cls of MODEL_CLASSES) {
    assert.doesNotMatch(MODEL_FOR_CLASS[cls], /fable/i);
    assert.equal(modelCeilingViolation(MODEL_FOR_CLASS[cls]), null);
  }
  assert.match(String(modelCeilingViolation("claude-fable-5-1")), /fable/i);

  assert.equal(assertStepMayInvokeModel("adversarial-audit").model, HAIKU);
  assert.equal(escalationTargetFor("adversarial-audit")?.modelClass, "sonnet");
  assert.equal(assertStepMayEscalate("adversarial-audit", "RESULT_REFUSED").model, SONNET);
  assert.throws(() => assertStepMayEscalate("scout-research-loop", "IT_FELT_HARD" as ModelEscalationReason), UnrecordedEscalation, "an unrecorded reason never escalates");
  assert.throws(() => assertStepMayEscalate("page-to-representation", "RESULT_REFUSED"), DeterministicStepInvokedModel);
  assert.deepEqual([...MODEL_ESCALATION_REASONS], ["BOUND_EXHAUSTED_WITHOUT_RESULT", "RESULT_REFUSED", "NO_TYPED_RESULT", "CAPABILITY_ERROR", "PROVIDER_UNAVAILABLE"]);

  /* A loop injected at the frontier is already at the top: it never escalates, whatever it shows. */
  const reservation = recordingReservation();
  const transport = perModelTransport({ [OPUS]: [[text("thinking")]] });
  const { result } = await runLadder({ transport, model: OPUS, reserveEscalation: reservation.seam });
  assert.equal(reservation.asked.length, 0);
  assert.equal(result.modelClass, "frontier");
  assert.equal(result.escalationReason, null);
  assert.ok(transport.requests.every((r) => r.model === OPUS));
});
