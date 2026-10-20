import { aggregatePricedSpend } from "../lib/control-plane/fleet-safety.ts";
import { fixtureRolePlaybook } from "./helpers/playbooks.ts";

import assert from "node:assert/strict";
import test from "node:test";

import { FleetSafetyController, FleetPreSendRefusal } from "../lib/control-plane/fleet-safety.ts";
import { minimumCacheablePrefixTokensFor } from "../lib/control-plane/model-cost.ts";
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
import { RESEARCH_BOUNDS, SCOUT_MODEL } from "../lib/control-plane/scheduler/research-policy.ts";
import type { ScoutToolkit } from "../lib/control-plane/scheduler/scout-contract.ts";
import {
  SCOUT_THINKING,
  cacheTtlOrderProblems,
  hunterExecutor,
  scoutLoopBase,
  type ContentBlock,
  type ModelRequest,
  type ModelResponse,
  type ModelTransport,
} from "../lib/control-plane/scheduler/scout-executor.ts";
import type { ScoutResult } from "../lib/control-plane/scheduler/scout-result.ts";
import { MODELS } from "../lib/models.ts";
import type { WorkOutcome } from "../lib/control-plane/scheduler/dispatch.ts";

const NOW = "2026-09-23T18:00:00.000Z"; // a Wednesday: outside the Saturday blackout the controller enforces
const NOW_MS = Date.parse(NOW);
const HAIKU = MODELS.haiku.model;
const SONNET = MODELS.sonnet.model;
const OPUS = MODELS.opus.model;

const OBLIGATION: FreshnessObligation = {
  id: "freshness:test:hunt#model",
  recordClass: "meetings",
  subjectId: "ocd-division/country:us/state:az/place:test",
  routeId: "novel-route",
  active: true,
  readerImpactAt: null,
  observedChangeRateHours: null,
  lastWorkedAt: new Date(NOW_MS - 48 * 3_600_000).toISOString(),
};

/** A toolkit whose fetch_public vaults one artifact per call. */
function fakeToolkit(): ScoutToolkit {
  const vaulted = new Set<string>();
  let toolCalls = 0;
  const spec = { name: "fetch_public", description: "fake", input_schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } };
  return {
    specs: [spec],
    get vaultedArtifactIds() {
      return vaulted;
    },
    get toolCalls() {
      return toolCalls;
    },
    reported: [],
    requestCount: 0,
    bytesFetched: 0,
    async call(name, input) {
      toolCalls += 1;
      const url = String((input as { url?: string }).url ?? "");
      const id = `art-${toolCalls}`;
      vaulted.add(id);
      return {
        ok: true,
        forModel: `[artifact ${id}] fetched ${url}`,
        artifacts: [{ artifactId: id, tier: "RAW", contentHash: `sha256-${id}`, byteLength: 10, contentType: "text/html", canonicalUrl: url, partial: false, recordedAt: NOW }],
        provenance: [{ artifactId: id, canonicalUrl: url, retrievedAt: NOW, permission: "ALLOWED", methodRouteId: "scout:fetch_public", httpStatus: 200 }],
        step: { tool: name, target: url, observed: "HTTP 200, 10 bytes", artifactIds: [id], ok: true },
        requestCount: 1,
        bytesFetched: 10,
      };
    },
  };
}

const toolUse = (id: string, name: string, input: unknown) => ({ type: "tool_use" as const, id, name, input });
const fetchOf = (id: string, url: string) => toolUse(id, "fetch_public", { url });
const finish = (id: string) => toolUse(id, "finish", { summary: "found the feed", unfilled: [] });

type Usage = ModelResponse["usage"];
const CHEAP_USAGE: Usage = { input_tokens: 100, output_tokens: 100, cache_read_input_tokens: 500, cache_creation_input_tokens: 0 };

/** The fake provider, scripted per model. A script entry that is an Error is thrown instead of answered. */
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
    const entry = script[turn - 1] ?? [{ type: "text" as const, text: "script complete" }];
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

async function runHunt(input: { readonly transport: ModelTransport; readonly model?: string }): Promise<{ readonly outcome: WorkOutcome; readonly result: ScoutResult }> {
  const toolkit = fakeToolkit();
  const results: ScoutResult[] = [];
  const exec = hunterExecutor({ role: "HUNTER", playbookFor: fixtureRolePlaybook,
    transport: input.transport, refusedBeforeSending: error => error instanceof FleetPreSendRefusal,
    model: input.model ?? SONNET,
    toolkitFor: () => toolkit,
    contextFor: async () => ({ brief: "Place: test", reason: "test hunt", blanks: 1, handed: { artifactIds: [] },
      tools: { vault: async () => ({ stored: true, where: "x", why: "written" }), spaceOut: async () => undefined } }),
    now: () => NOW,
    bound: RESEARCH_BOUNDS.perDispatch,
    onResult: async (r) => {
      results.push(r);
    },
  });
  const outcome = await exec.run({
    obligation: scheduledFixture(OBLIGATION, NOW_MS),
    routeTaskId: "rt-hunt",
    workItemId: "wi-hunt",
    attemptId: "at-hunt",
    holder: "h",
    executor: "BOUNDED_MODEL_WORKER",
    bound: { maxAttempts: 1, maxWallMs: 0, maxCostUnits: 1 },
  } as never);
  assert.equal(results.length, 1, "the typed result was handed to onResult exactly once");
  return { outcome, result: results[0]! };
}

test("a long hunt walks beyond the former turn, tool, token and wall limits until finished or the real budget refuses", async () => {
  const actualNow = Date.now; let elapsed = actualNow(); Date.now = () => elapsed;
  try {
    const walks = Array.from({ length: 40 }, (_, i) => [fetchOf("u" + i, `https://source${i}.gov/meetings`)]);
    const script = [...walks, [finish("done")]];
    for (const ceiling of [100, 0.075]) {
      const controller = new FleetSafetyController({ now: NOW, spend: aggregatePricedSpend([], new Date(Date.parse(NOW) - 24 * 3_600_000).toISOString(), NOW), rollingCeilingUsd: ceiling, clock: () => NOW_MS });
      const fake = perModelTransport({ [HAIKU]: script }, () => { elapsed += 60_000; return { input_tokens: 20_000, output_tokens: 100 }; });
      const { outcome, result } = await runHunt({ model: HAIKU, transport: controller.guardedModelTransport("anthropic", OBLIGATION.id, fake) });
      assert.ok(fake.requests.length > 18, "long work passes the old model turn cap");
      assert.ok(result.usage.toolCalls > 16, "long work passes the old tool cap");
      assert.ok(result.usage.turns * 20_000 > 400_000, "long work passes the old cumulative token cap");
      if (ceiling === 100) {
        assert.equal(outcome.kind, "DISPOSED");
        assert.equal(fake.requests.length, 41);
        assert.equal(result.refusal, null);
      } else {
        assert.equal(outcome.kind, "ABORTED");
        assert.ok(fake.requests.length < 41);
        assert.match(result.refusal?.map(row => row.detail).join(" ") ?? "", /CEILING|budget/i);
        assert.ok(controller.snapshot(NOW).deferred.some(row => row.code === "ROLLING_24_HOUR_MODEL_SPEND_CEILING"));
      }
    }
  } finally { Date.now = actualNow; }
});

test("L1: a hunt starts with Haiku, with adaptive thinking and the hunter's effort", async () => {
  assert.equal(SCOUT_MODEL, HAIKU);
  assert.equal(scoutLoopBase().model, HAIKU);
  const transport = perModelTransport({ [HAIKU]: [[fetchOf("u1", "https://a.gov/meetings")], [finish("f")]] });
  const { result } = await runHunt({ transport, model: HAIKU });
  assert.equal(transport.requests.length, 2);
  for (const request of transport.requests) {
    assert.equal(request.model, HAIKU);
    assert.deepEqual(request.output_config, { effort: "medium" });
    assert.deepEqual(request.thinking, SCOUT_THINKING);
    assert.deepEqual(request.tools.at(-1)?.cache_control, { type: "ephemeral", ttl: "1h" });
    assert.deepEqual(request.system[0].cache_control, { type: "ephemeral", ttl: "1h" });
    assert.deepEqual(request.cache_control, { type: "ephemeral" });
    assert.deepEqual(cacheTtlOrderProblems(request), []);
  }
  assert.equal(minimumCacheablePrefixTokensFor(HAIKU), 512);
  assert.equal(result.modelClass, "haiku");
  assert.equal(result.worker.model, HAIKU);
});

test("L7: Opus 5.5 remains the maximum, a Fable is refused, and cheaper-first audit escalation needs a reason", () => {
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
});
