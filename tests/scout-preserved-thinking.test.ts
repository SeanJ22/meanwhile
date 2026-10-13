import { fixtureRolePlaybook } from "./helpers/playbooks.ts";
/**
 * On Claude Opus 5.5 a thinking block is bound to the model that produced it
 * and to the conversation before it; replaying a block after an edit of the
 * system, the tools or an earlier message is HTTP 400 on newer accounts.
 * Offline, with a fake provider that answers with thinking blocks and a fake
 * toolkit; nothing here reaches a model or a host.
 *
 *   PT-1  across a whole Attempt the conversation is append-only: each request
 *         extends the one before byte-for-byte, except a restart, which
 *         replays no earlier turn or thinking block; the payload stays bounded
 *   PT-2  the escalation appends to the same conversation: Sonnet's reply,
 *         thinking blocks included, reaches Opus 5.5 unchanged, and both models
 *         state drop_block
 *   PT-3  every dropped block the provider reports is recorded on the result;
 *         a prefix-binding drop is named on the outcome, a model-binding one is not
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
  scoutExecutor,
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
const SONNET = "claude-sonnet-5-5";
const OPUS = "claude-opus-5-5";
/** A fetch representation under fetch_public's 64,000-byte budget; three of them pass the 100 KB context budget. */
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
        forModel: `[artifact ${id}] fetched ${url}\n` + String(toolCalls % 10).repeat(PAGE_BYTES),
        artifacts: [{ artifactId: id, tier: "RAW", contentHash: `sha256-${id}`, byteLength: PAGE_BYTES, contentType: "text/html", canonicalUrl: url, partial: false, recordedAt: NOW }],
        provenance: [{ artifactId: id, canonicalUrl: url, retrievedAt: NOW, permission: "ALLOWED", methodRouteId: `scout:${name}`, httpStatus: 200 }],
        rung: { rung: rungLabel ?? "other:unlabelled", tool: name, target: url, observed: `HTTP 200, ${PAGE_BYTES} bytes`, artifactIds: [id], ok: true },
        requestCount: 1,
        bytesFetched: PAGE_BYTES,
      };
    },
  };
}

const thinking = (sig: string) => ({ type: "thinking" as const, thinking: "", signature: sig });
const toolUse = (id: string, name: string, input: unknown) => ({ type: "tool_use" as const, id, name, input });
const fetchOf = (id: string, url: string) => toolUse(id, "fetch_public", { url, rung: "primary-site-navigation", why: "navigate" });
const finishCiting = (id: string, evidence: string, rungs: number) =>
  toolUse(id, "finish", {
    outcome: "ROUTE_CANDIDATE",
    rungsWalked: Array.from({ length: rungs }, (_, index) => ({ index, note: `page ${index}` })),
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
  const exec = scoutExecutor({ playbookFor: fixtureRolePlaybook,
    model: SONNET, // This suite specifically verifies Sonnet → Opus preserved thinking.
    transport,
    bound: b,
    toolkitFor: () => toolkit,
    contextFor: () => ({
      route: null,
      providerId: "test",
      reason: "test novelty",
      inherited: { artifactIds: [], summary: "none" },
      tools: { vault: async () => ({ stored: true, where: "x", why: "written" }), spaceOut: async () => undefined },
    }),
    reserveEscalation: (r) => ({ admit: true, reservedUsd: r.worstCaseUsd, draw: () => undefined, release: () => undefined }),
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
  return { outcome, result: results[0] };
}

const json = (v: unknown): string => JSON.stringify(v);
const isRestart = (messages: ModelRequest["messages"]): boolean =>
  messages.length === 1 && json(messages[0]).includes(SCOUT_CARRIED_FORWARD_MARK);


test("PT-1: the conversation is append-only — each request extends the one before byte-for-byte, except a restart, which replays no earlier turn or thinking block — and the payload stays bounded", async () => {
  const sonnet: Turn[] = [1, 2, 3, 4, 5].map((k) => [thinking(`sig-s${k}`), fetchOf(`u${k}`, `https://a.gov/page-${k}`)]);
  sonnet.push([thinking("sig-s6"), finishCiting("f", "art-5", 5)]);
  const provider = fakeProvider({ [SONNET]: sonnet });
  const { outcome, result } = await runScout(provider.transport);
  assert.equal(outcome.kind, "DISPOSED", outcome.detail);
  const { requests } = provider;
  assert.equal(requests.length, 6);

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
  assert.equal(restarts, 2, "three 45 KB pages pass the 100 KB budget twice in five fetches");
  assert.equal(result.contextRestarts, restarts);

  for (const request of requests) {
    assert.deepEqual(request.thinking, SCOUT_THINKING, "every turn states adaptive thinking with drop_block");
    assert.ok(representationBytesIn(request.messages) <= SCOUT_CONTEXT_TOOL_RESULT_BUDGET + PAGE_BYTES + 200, "the payload bound still holds: the budget plus the newest page");
  }
  /* The model's own thinking blocks go back unchanged within a conversation. */
  assert.ok(json(requests[2].messages).includes('"signature":"sig-s2"'), "a thinking block is echoed verbatim on the next turns");
  /* The accepted finish cites the page the restarted conversation carried. */
  assert.deepEqual(result.candidates[0]?.evidenceArtifactIds, ["art-5"]);
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
  await assert.rejects(() => transport({ model: SONNET, max_tokens: 1, system: [], tools: [],
    messages: [{ role: "user", content: "fixture" }] }), (error: unknown) =>
      error instanceof ModelTransportError && error.status === 429 && error.retryAfterMs === 1_200_000);
  assert.equal(calls, 1);
  assert.deepEqual(limits, [{ requestsPerMinute: 120, inputTokensPerMinute: 80000,
    outputTokensPerMinute: 16000, retryAfterMs: 1_200_000,
    remaining: { requests: null, inputTokens: null, outputTokens: null,
      requestsResetAt: null, inputResetAt: null, outputResetAt: null } }]);
});


test("PT-2: the escalation appends to the same conversation — Sonnet's reply, thinking blocks included, reaches Opus 5.5 unchanged — and both models state drop_block", async () => {
  const sonnetReply: Turn = [thinking("sig-sonnet"), { type: "text", text: "I would look at the meetings page." }];
  const provider = fakeProvider(
    {
      [SONNET]: [sonnetReply],
      [OPUS]: [[thinking("sig-o1"), fetchOf("o1", "https://a.gov/meetings")], [thinking("sig-o2"), finishCiting("f", "art-1", 1)]],
    },
    (model, turn) => (model === OPUS && turn === 1 ? [{ type: "thinking_dropped", path: "messages.1.content.0", reason: "model_binding_mismatch" }] : []),
  );
  const { outcome, result } = await runScout(provider.transport);
  assert.equal(outcome.kind, "DISPOSED", outcome.detail);
  assert.equal(result.escalatedFrom, "sonnet");
  assert.equal(result.escalationReason, "NO_TYPED_RESULT");

  const lastSonnet = provider.requests.filter((r) => r.model === SONNET).at(-1)!;
  const firstOpus = provider.requests.find((r) => r.model === OPUS)!;
  const n = lastSonnet.messages.length;
  assert.equal(json(firstOpus.messages.slice(0, n)), json(lastSonnet.messages), "the frontier's first request begins with everything Sonnet was sent, unchanged");
  assert.equal(json(firstOpus.messages[n]), json({ role: "assistant", content: sonnetReply }), "then Sonnet's reply, its thinking block unchanged — never stripped");
  assert.match(json(firstOpus.messages.at(-1)), /ESCALATED: this investigation moves from claude-sonnet-5-5 to claude-opus-5-5/);
  assert.equal(firstOpus.messages.length, n + 2, "only appended: the reply and the escalation notice");
  assert.equal(json(firstOpus.system), json(lastSonnet.system), "the same system: the prefix the Sonnet blocks are bound to");
  assert.equal(json(firstOpus.tools), json(lastSonnet.tools), "the same tools");
  for (const request of provider.requests) assert.deepEqual(request.thinking, SCOUT_THINKING, `${request.model} states drop_block`);

  /* A model-binding drop after the switch is recorded, and is not our defect. */
  assert.deepEqual(result.inputTransformations, [{ turn: 4, model: OPUS, type: "thinking_dropped", path: "messages.1.content.0", reason: "model_binding_mismatch" }]);
  assert.doesNotMatch(outcome.detail, /THINKING DROPPED/);
});


test("PT-3: a prefix-binding drop — our history changed under a block — is recorded on the result and named on the outcome", async () => {
  const provider = fakeProvider(
    { [SONNET]: [[thinking("s1"), fetchOf("u1", "https://a.gov/meetings")], [thinking("s2"), finishCiting("f", "art-1", 1)]] },
    (_model, turn) => (turn === 2 ? [{ type: "thinking_dropped", path: "messages.1.content.0", reason: "prefix_binding_mismatch" }] : []),
  );
  const { outcome, result } = await runScout(provider.transport);
  assert.equal(outcome.kind, "DISPOSED");
  assert.deepEqual(result.inputTransformations, [{ turn: 2, model: SONNET, type: "thinking_dropped", path: "messages.1.content.0", reason: "prefix_binding_mismatch" }]);
  assert.match(outcome.detail, /THINKING DROPPED \(prefix_binding_mismatch: our history changed under a block\) on turn\(s\) 2/);
});


test("PT-4: the transport sends the thinking-binding beta header exactly when the body carries block_binding — a request without it sends none", async () => {
  const seen: { headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fakeFetch = (async (_url: string, init: RequestInit) => {
    seen.push({ headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    return new Response(JSON.stringify({ model: SONNET, stop_reason: "end_turn", content: [], usage: {}, input_transformations: [] }), { status: 200 });
  }) as typeof fetch;
  const transport = anthropicTransport("test-key-not-real", fakeFetch, "https://example.invalid/v1/messages");
  const base: ModelRequest = { model: SONNET, max_tokens: 1, system: [{ type: "text", text: "s" }], tools: [], messages: [{ role: "user", content: "x" }] };

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
