import { fixtureRolePlaybook } from "./helpers/playbooks.ts";
/**
 * On Claude Opus 5.5 a thinking block is bound to the model that produced it
 * and to the conversation before it; replaying a block after an edit of the
 * system, the tools or an earlier message is HTTP 400 on newer accounts.
 * Offline, with a fake provider that answers with thinking blocks and a fake
 * toolkit; nothing here reaches a model or a host.
 *
 *   PT-1  across a whole job the conversation is append-only: each request
 *         extends the one before byte-for-byte, except a restart, which
 *         replays no earlier turn or thinking block; the payload stays bounded
 *   PT-3  every dropped block the provider reports is recorded on the result
 *   PT-4  the transport sends the thinking-binding beta header exactly when the
 *         body carries block_binding
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { FreshnessObligation } from "../lib/control-plane/scheduler/obligation.ts";
import { scheduledFixture } from "./control-plane-fixtures.ts";
import { RESEARCH_BOUNDS, type ScoutBound } from "../lib/control-plane/scheduler/research-policy.ts";
import type { ScoutToolkit } from "../lib/control-plane/scheduler/scout-contract.ts";
import {
  SCOUT_CARRIED_FORWARD_MARK,
  SCOUT_CONTEXT_TOOL_RESULT_BUDGET,
  SCOUT_THINKING,
  THINKING_BINDING_BETA,
  anthropicBetasFor,
  anthropicTransport,
  ModelTransportError,
  representationBytesIn,
  hunterExecutor,
  type ContentBlock,
  type InputTransformation,
  type ModelRequest,
  type ModelResponse,
  type ModelTransport,
} from "../lib/control-plane/scheduler/scout-executor.ts";
import type { ScoutResult } from "../lib/control-plane/scheduler/scout-result.ts";
import type { WorkOutcome } from "../lib/control-plane/scheduler/dispatch.ts";

const NOW = "2026-09-23T18:00:00.000Z";
const NOW_MS = Date.parse(NOW);
const HAIKU = "claude-haiku-5-5";
/** A fetch representation large enough that a few of them pass the context budget. */
const PAGE_BYTES = 45_000;

const OBLIGATION: FreshnessObligation = {
  id: "freshness:test:scout#preserved-thinking",
  recordClass: "meetings",
  subjectId: "ocd-division/country:us/state:az/place:test",
  routeId: "novel-route",
  active: true,
  readerImpactAt: null,
  observedChangeRateHours: null,
  lastWorkedAt: new Date(NOW_MS - 48 * 3_600_000).toISOString(),
};

/** Every fetch vaults one artifact and hands back a large representation, so the context bound is exercised. */
function bigPageToolkit(): ScoutToolkit {
  const vaulted = new Set<string>();
  let toolCalls = 0;
  const spec = (name: string) => ({ name, description: "fake", input_schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } });
  return {
    specs: [spec("fetch_public")],
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
        forModel: `[artifact ${id}] fetched ${url}\n` + String(toolCalls % 10).repeat(PAGE_BYTES),
        artifacts: [{ artifactId: id, tier: "RAW", contentHash: `sha256-${id}`, byteLength: PAGE_BYTES, contentType: "text/html", canonicalUrl: url, partial: false, recordedAt: NOW }],
        provenance: [{ artifactId: id, canonicalUrl: url, retrievedAt: NOW, permission: "ALLOWED", methodRouteId: `scout:${name}`, httpStatus: 200 }],
        step: { tool: name, target: url, observed: `HTTP 200, ${PAGE_BYTES} bytes`, artifactIds: [id], ok: true },
        requestCount: 1,
        bytesFetched: PAGE_BYTES,
      };
    },
  };
}

const thinking = (sig: string) => ({ type: "thinking" as const, thinking: "", signature: sig });
const toolUse = (id: string, name: string, input: unknown) => ({ type: "tool_use" as const, id, name, input });
const fetchOf = (id: string, url: string) => toolUse(id, "fetch_public", { url });
const finish = (id: string) => toolUse(id, "finish", { summary: "found the feed", unfilled: [] });

type Turn = readonly ContentBlock[];
type Script = Readonly<Record<string, readonly Turn[]>>;

/** The fake provider, scripted per model; each answer carries the drops `dropsFor` names. */
function fakeProvider(scripts: Script, dropsFor: (model: string, turn: number) => readonly InputTransformation[] = () => []) {
  const requests: ModelRequest[] = [];
  const turnOf = new Map<string, number>();
  const transport: ModelTransport = async (request) => {
    requests.push(JSON.parse(JSON.stringify(request)) as ModelRequest);
    const script = scripts[request.model];
    if (script === undefined) throw new Error(`no script for ${request.model}`);
    const turn = (turnOf.get(request.model) ?? 0) + 1;
    turnOf.set(request.model, turn);
    const content = script[Math.min(turn - 1, script.length - 1)];
    return {
      model: request.model,
      stop_reason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn",
      content,
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 2000, cache_creation_input_tokens: 100 },
      input_transformations: dropsFor(request.model, turn),
    } satisfies ModelResponse;
  };
  return { transport, requests };
}

async function runScout(transport: ModelTransport, bound: Partial<ScoutBound> = {}): Promise<{ readonly outcome: WorkOutcome; readonly result: ScoutResult }> {
  const results: ScoutResult[] = [];
  const b: ScoutBound = { ...RESEARCH_BOUNDS.perDispatch, ...bound };
  const toolkit = bigPageToolkit();
  const exec = hunterExecutor({ role: "HUNTER", playbookFor: fixtureRolePlaybook,
    transport,
    bound: b,
    toolkitFor: () => toolkit,
    contextFor: async () => ({
      brief: "Place: test",
      reason: "test hunt",
      blanks: 1,
      handed: { artifactIds: [] },
      tools: { vault: async () => ({ stored: true, where: "x", why: "written" }), spaceOut: async () => undefined },
    }),
    now: () => NOW,
    onResult: async (r) => {
      results.push(r);
    },
  });
  const outcome = await exec.run({
    obligation: scheduledFixture(OBLIGATION, NOW_MS),
    routeTaskId: "rt-pt",
    workItemId: "wi-pt",
    attemptId: "at-pt",
    holder: "h",
    executor: "BOUNDED_MODEL_WORKER",
    bound: { maxAttempts: 1, maxWallMs: 0, maxCostUnits: 1 },
  } as never);
  assert.equal(results.length, 1);
  return { outcome, result: results[0]! };
}

const json = (v: unknown): string => JSON.stringify(v);
const isRestart = (messages: ModelRequest["messages"]): boolean =>
  messages.length === 1 && json(messages[0]).includes(SCOUT_CARRIED_FORWARD_MARK);


test("PT-1: the conversation is append-only — each request extends the one before byte-for-byte, except a restart, which replays no earlier turn or thinking block — and the payload stays bounded", async () => {
  const sonnet: Turn[] = Array.from({ length: 15 }, (_, i) => i + 1).map((k) => [thinking(`sig-s${k}`), fetchOf(`u${k}`, `https://page-${k}.gov/`)]);
  sonnet.push([thinking("sig-s16"), finish("f")]);
  const provider = fakeProvider({ [HAIKU]: sonnet });
  const { outcome, result } = await runScout(provider.transport);
  assert.equal(outcome.kind, "DISPOSED", outcome.detail);
  const { requests } = provider;
  assert.equal(requests.length, 16);

  let restarts = 0;
  for (let i = 1; i < requests.length; i += 1) {
    const before = requests[i - 1].messages;
    const after = requests[i].messages;
    if (isRestart(after)) {
      restarts += 1;
      assert.doesNotMatch(json(after), /"type":"thinking"|sig-s/, `request ${i + 1} restarts: no thinking block of the old transcript is replayed`);
      assert.ok(after.every((m) => m.role === "user"), "a restart replays no earlier assistant turn");
      continue;
    }
    assert.equal(json(after.slice(0, before.length)), json(before), `request ${i + 1} extends request ${i} byte-for-byte: nothing already sent was edited`);
  }
  assert.ok(restarts >= 2, "capped page results exercise repeated restarts at the context budget");
  assert.equal(result.contextRestarts, restarts);

  for (const request of requests) {
    assert.deepEqual(request.thinking, SCOUT_THINKING, "every turn states adaptive thinking with drop_block");
    assert.ok(representationBytesIn(request.messages) <= SCOUT_CONTEXT_TOOL_RESULT_BUDGET + PAGE_BYTES + 200, "the payload bound still holds: the budget plus the newest page");
  }
  /* The model's own thinking blocks go back unchanged within a conversation. */
  assert.ok(json(requests[2].messages).includes('"signature":"sig-s2"'), "a thinking block is echoed verbatim on the next turns");
  assert.deepEqual(result.inputTransformations, []);
});

test("transport carries provider capacity and Retry-After from an unsent retry", async () => {
  const limits: unknown[] = [];
  let calls = 0;
  const transport = anthropicTransport("test-key-not-real", (async () => {
    calls++;
    return new Response("rate limited", { status: 429, headers: {
      "retry-after": "1200", "anthropic-ratelimit-requests-limit": "120",
      "anthropic-ratelimit-input-tokens-limit": "80000", "anthropic-ratelimit-output-tokens-limit": "16000",
    } });
  }) as typeof fetch, "https://example.invalid/v1/messages", { onRateLimits: value => limits.push(value) });
  await assert.rejects(() => transport({ model: HAIKU, max_tokens: 1, system: [], tools: [],
    messages: [{ role: "user", content: "fixture" }] }), (error: unknown) =>
      error instanceof ModelTransportError && error.status === 429 && error.retryAfterMs === 1_200_000);
  assert.equal(calls, 1);
  assert.deepEqual(limits, [{ requestsPerMinute: 120, inputTokensPerMinute: 80000,
    outputTokensPerMinute: 16000, retryAfterMs: 1_200_000,
    remaining: { requests: null, inputTokens: null, outputTokens: null,
      requestsResetAt: null, inputResetAt: null, outputResetAt: null } }]);
});


test("PT-3: a prefix-binding drop — our history changed under a block — is recorded on the result", async () => {
  const provider = fakeProvider(
    { [HAIKU]: [[thinking("s1"), fetchOf("u1", "https://a.gov/meetings")], [thinking("s2"), finish("f")]] },
    (_model, turn) => (turn === 2 ? [{ type: "thinking_dropped", path: "messages.1.content.0", reason: "prefix_binding_mismatch" }] : []),
  );
  const { outcome, result } = await runScout(provider.transport);
  assert.equal(outcome.kind, "DISPOSED");
  assert.deepEqual(result.inputTransformations, [{ turn: 2, model: HAIKU, type: "thinking_dropped", path: "messages.1.content.0", reason: "prefix_binding_mismatch" }]);
});


test("PT-4: the transport sends the thinking-binding beta header exactly when the body carries block_binding — a request without it sends none", async () => {
  const seen: { headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fakeFetch = (async (_url: string, init: RequestInit) => {
    seen.push({ headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    return new Response(JSON.stringify({ model: HAIKU, stop_reason: "end_turn", content: [], usage: {}, input_transformations: [] }), { status: 200 });
  }) as typeof fetch;
  const transport = anthropicTransport("test-key-not-real", fakeFetch, "https://example.invalid/v1/messages");
  const base: ModelRequest = { model: HAIKU, max_tokens: 1, system: [{ type: "text", text: "s" }], tools: [], messages: [{ role: "user", content: "x" }] };

  await transport({ ...base, thinking: SCOUT_THINKING });
  assert.equal(seen[0].headers["anthropic-beta"], THINKING_BINDING_BETA, "block_binding without this header is HTTP 400");
  assert.equal(THINKING_BINDING_BETA, "thinking-binding-controls-2026-08-01");
  assert.deepEqual(seen[0].body.thinking, { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } });
  assert.equal(seen[0].headers["anthropic-version"], "2023-06-01");

  await transport(base);
  assert.deepEqual(seen[1].body.cache_control, { type: "ephemeral" }, "every transport call has a cache breakpoint");
  assert.equal(seen[1].headers["anthropic-beta"], undefined, "no field, no beta header");
  assert.deepEqual(anthropicBetasFor(base), []);
  assert.deepEqual(anthropicBetasFor({ ...base, thinking: { type: "adaptive" } }), [], "adaptive alone needs no beta");
});
