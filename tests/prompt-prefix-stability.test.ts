/**
 * For every model call site, two requests built from the same inputs produce byte-identical prefix bytes up to the
 * last static breakpoint, and per-request values (attempt id, obligation id, the reader's question) never appear in
 * that prefix. The hash is over the JSON the transport would send, which is what the cache keys on.
 *
 *   Scout                tools + system            (`scoutStaticPrefix`)
 *   Adversarial audit    tools + system            (`model-audit.ts`)
 *   Grounded Ask         system + evidence block   (`synthesisRequestBody`)
 *   Ask interpret        system                    (unmarked: under the 512-token minimum)
 *   Ask classify         system                    (unmarked)
 *   Unsourced fallback   system                    (unmarked)
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { RESEARCH_BOUNDS } from "../lib/control-plane/scheduler/research-policy.ts";
import { scoutExecutor, scoutStaticPrefix, type ModelRequest, type ModelTransport } from "../lib/control-plane/scheduler/scout-executor.ts";
import { SCOUT_TOOL_SPECS } from "../lib/control-plane/scheduler/scout-tools.ts";
import { MIN_DISTINCT_RUNGS } from "../lib/control-plane/scheduler/scout-result.ts";
import type { ScoutToolContext, ScoutToolkit } from "../lib/control-plane/scheduler/scout-contract.ts";
import { auditReasoningContext, modelAuditReasoner } from "../lib/control-plane/workers/model-audit.ts";
import type { IndependentAuditContext, WorkerEvidence } from "../lib/control-plane/workers/types.ts";
import { contentHash } from "../lib/control-plane/ids.ts";
import { synthesisRequestBody } from "../lib/ask/synthesize.ts";
import type { EvidencePack } from "../lib/ask/evidence.ts";
import { interpretSystem, interpretQuestion } from "../lib/ask/interpret.ts";
import { classifierPrompt, classifyQuestion } from "../lib/routing/classifier.ts";
import { askUnsourced } from "../lib/routing/unsourced-fallback.ts";

const sha = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const NOW = "2026-09-06T12:00:00.000Z";

/* ------------------------------------------------------------------ Scout */

function scoutRequestFor(attemptId: string, obligationId: string): Promise<ModelRequest> {
  return new Promise((resolve) => {
    const capture: ModelTransport = async (request) => { resolve(request); throw new Error("captured"); };
    const toolkit: ScoutToolkit = { specs: SCOUT_TOOL_SPECS, vaultedArtifactIds: new Set(), requestCount: 0, bytesFetched: 0, toolCalls: 0, call: async () => { throw new Error("no tools"); } };
    const exec = scoutExecutor({
      transport: capture,
      toolkitFor: (_ctx: ScoutToolContext) => toolkit,
      contextFor: () => ({ route: null, providerId: "p", reason: "r", inherited: { artifactIds: [], summary: "s" }, tools: { vault: async () => ({ stored: true, where: "x", why: "w" }), spaceOut: async () => undefined } }),
      now: () => NOW,
    });
    void exec.run({
      obligation: { obligation: { id: obligationId, recordClass: "meetings", subjectId: "az:county:pima", routeId: null, active: true, readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: null }, nextDueAt: NOW, cadenceHours: 24, cadenceSource: "DEFAULT_NO_SIGNAL", basis: "b" },
      routeTaskId: "rt", workItemId: "wi", attemptId, executor: "BOUNDED_MODEL_WORKER", bound: { maxAttempts: 1, maxWallMs: 1000, maxCostUnits: 1 }, holder: "h",
    } as never);
  });
}

test("PC-3 Scout: tools + system are byte-identical across Attempts and carry no Attempt id, obligation id or timestamp; the brief follows them", async () => {
  const a = await scoutRequestFor("at-aaaaaaaa", "freshness:meetings:az:county:pima#one");
  const b = await scoutRequestFor("at-bbbbbbbb", "freshness:meetings:az:county:pima#two");
  const prefixA = { tools: a.tools, system: a.system };
  const prefixB = { tools: b.tools, system: b.system };
  assert.equal(sha(prefixA), sha(prefixB), "the static prefix hash is identical across Attempts");
  const built = scoutStaticPrefix({ toolkitSpecs: SCOUT_TOOL_SPECS, bound: RESEARCH_BOUNDS.perDispatch, minRungs: MIN_DISTINCT_RUNGS });
  assert.equal(sha(prefixA), sha({ tools: built.tools, system: built.system }), "the executor sends exactly what scoutStaticPrefix builds — the pre-warm's bytes");
  const text = JSON.stringify(prefixA);
  for (const volatile of ["at-aaaaaaaa", "#one", NOW, "2026-09", "warmup"]) assert.ok(!text.includes(volatile), `${volatile} must not appear before the static breakpoint`);
  assert.match(JSON.stringify(a.messages[0]), /#one/, "the obligation lives in the brief, after the static prefix");
  assert.equal(a.tools.at(-1)?.cache_control?.type, "ephemeral");
  assert.equal(a.system.at(-1)?.cache_control?.type, "ephemeral");
});

/* ------------------------------------------------------------------ audit */

const evidence = (artifactId: string, text: string): WorkerEvidence => ({ artifactId, text, contentHash: contentHash(text), acquiredByAttemptId: "acquired", canonicalUrl: "https://avondaleaz.api.civicclerk.com/v1/Events", retrievedAt: NOW, sourceId: "avondale", methodRouteId: "events" });
const auditContext = (feed: string): IndependentAuditContext => ({
  subjectId: "az:city:city-of-avondale",
  contract: { recordClass: "CIVICCLERK_EVENTS", schemaVersion: 1, subjectId: "az:city:city-of-avondale", sourceBodyId: null, sourceBodyName: null, publisherSlug: "avondaleaz", requiredFields: ["id", "eventName"], completenessScope: "Captured scalar fields only", expectedSourceDate: null },
  publisherSurfaces: ["https://avondaleaz.api.civicclerk.com/"], methodVersion: 72,
  routes: [{ routeId: "events", canonicalUrl: "https://avondaleaz.api.civicclerk.com/v1/Events", applicable: true, status: "HELD", artifactIds: ["feed"], reason: "Captured municipal feed" }],
  evidence: [evidence("feed", feed)],
  startedFrom: ["CANONICAL_SUBJECT_IDENTITY", "PUBLISHER_SOURCE_UNIVERSE", "METHOD_REGISTRY", "EVIDENCE_VAULT"], scope: "CAPTURED_ARTIFACT",
});

test("PC-3 adversarial audit: tools + system are identical across audits and carry nothing per request; the evidence is the user message", async () => {
  const requests: ModelRequest[] = [];
  const transport: ModelTransport = async (request) => {
    requests.push(request);
    return { model: request.model, stop_reason: "tool_use", content: [{ type: "tool_use", id: "c", name: "record_audit", input: { verdict: "SURVIVED", challenges: [] } }], usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
  };
  const reasoner = modelAuditReasoner(createMemoryRepositories(), transport, () => NOW, { ceilingUsd: 1 });
  await reasoner.review(auditContext(JSON.stringify({ value: [{ id: 1, eventName: "A" }] })), "attempt-1");
  await reasoner.review(auditContext(JSON.stringify({ value: [{ id: 2, eventName: "B" }] })), "attempt-2");
  assert.equal(requests.length, 2);
  assert.equal(sha({ tools: requests[0].tools, system: requests[0].system }), sha({ tools: requests[1].tools, system: requests[1].system }));
  assert.notEqual(sha(requests[0].messages), sha(requests[1].messages), "the evidence differs per audit and sits after the prefix");
  const prefix = JSON.stringify({ tools: requests[0].tools, system: requests[0].system });
  assert.ok(!prefix.includes("attempt-1") && !prefix.includes(NOW) && !prefix.includes("eventName\":\"A"));
  assert.equal(auditReasoningContext(auditContext("{}")), auditReasoningContext(auditContext("{}")), "the evidence body is canonical JSON: identical inputs, identical bytes");
});

/* ----------------------------------------------------------- Grounded Ask */

function pack(question: string, today = "2026-09-06"): EvidencePack {
  return {
    question,
    intent: "UPCOMING_AGENDA",
    temporal: { kind: "NEXT" },
    subject: { kind: "BODY", id: "vail", name: "Vail Unified District" },
    records: Array.from({ length: 3 }, (_, i) => ({ kind: "AGENDA_ITEM" as const, id: `m1#${i}`, bodyId: "vail", text: `Item ${i}. Consideration of the capital improvement schedule.`, occurredAt: "2026-09-09T02:00:00.000Z", sourceUrl: `https://example.gov/agenda-${i}.pdf`, sourceOrg: "Vail Unified District", retrievedAt: "2026-08-31T00:00:00.000Z" })) as EvidencePack["records"],
    gaps: [{ whose: "OURS", statement: "We have not recorded the minutes for that sitting." }],
    denominators: { agendasRead: 9, meetingsInScope: 3 },
    today,
  };
}

test("PC-3 Grounded Ask: system + evidence block are identical for two questions about one subject, and the question and the date sit after both breakpoints", () => {
  const a = synthesisRequestBody(pack("what is on the agenda"), { model: "claude-opus-5", cached: true, effort: "medium" }) as { system: unknown; messages: { content: { type: string; text: string; cache_control?: unknown }[] }[] };
  const b = synthesisRequestBody(pack("when do they meet next"), { model: "claude-opus-5", cached: true, effort: "medium" }) as typeof a;
  const prefix = (r: typeof a) => ({ system: r.system, evidence: r.messages[0].content[0] });
  assert.equal(sha(prefix(a)), sha(prefix(b)), "system + evidence bytes are identical across questions");
  const text = JSON.stringify(prefix(a));
  assert.ok(!text.includes("what is on the agenda"), "the question is after the evidence breakpoint");
  assert.ok(!text.includes("2026-09-06"), "the date is after the last breakpoint (the first user message's question block)");
  assert.equal(a.messages[0].content[0].cache_control !== undefined, true, "the evidence block is a breakpoint");
  assert.ok(Array.isArray(a.system) && (a.system as { cache_control?: unknown }[]).at(-1)?.cache_control !== undefined, "the system prefix is a breakpoint");
  assert.equal(a.messages[0].content[1].text, "Today is 2026-09-06.", "the date rides with the question, as its own block after the evidence breakpoint");
  assert.match(a.messages[0].content.at(-1)!.text, /what is on the agenda/, "the question is the last block");
  /* A different day changes only the question block. */
  const c = synthesisRequestBody(pack("what is on the agenda", "2026-09-07"), { model: "claude-opus-5", cached: true, effort: "medium" }) as typeof a;
  assert.equal(sha(prefix(a)), sha(prefix(c)));
});

/* --------------------------------------------------- the unmarked Ask rungs */

async function captureBody(run: (fetchImpl: typeof fetch) => Promise<unknown>): Promise<Record<string, unknown>> {
  let body: Record<string, unknown> | null = null;
  const fetchImpl: typeof fetch = async (_url, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ topic: "NONE", intent: "CIVICS", entityMentions: [], normalizedMentions: [], temporal: { kind: "NONE" }, referent: null }) }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  await run(fetchImpl);
  assert.ok(body, "the call reached the transport");
  return body!;
}

test("PC-3 Ask interpret: the ZIP's context is the marked prefix, identical for the same ZIP; the date and surface follow it; the question and the conversation are messages", async () => {
  const context = { inventory: [{ name: "Vail Unified District", divisionType: "school_district" }], today: "2026-09-06", approximateLocation: "Vail, Arizona", surface: "MAP" as const };
  const a = await captureBody((f) => interpretQuestion("what is on the agenda", context, { fetchImpl: f, apiKey: "sk-test" }));
  const b = await captureBody((f) => interpretQuestion("who is on the board", { ...context, priorTurns: [{ question: "did the council vote on the pothole budget", resolvedSubject: null }] }, { fetchImpl: f, apiKey: "sk-test" }));
  const blocks = (body: Record<string, unknown>) => body.system as { type: string; text: string; cache_control?: unknown }[];
  assert.equal(sha(a.system), sha(b.system));
  assert.deepEqual(blocks(a).map((block) => block.text), [interpretSystem(context).stable, interpretSystem(context).volatile]);
  assert.ok(!JSON.stringify(a.system).includes("what is on the agenda"), "the question is not in the system prompt");
  assert.ok(!JSON.stringify(b.system).includes("pothole budget"), "the prior turn is not in the system prompt");
  assert.match(JSON.stringify(b.messages), /pothole budget/, "the conversation rides as messages");
  assert.ok(blocks(a)[0].cache_control !== undefined, "the ZIP's context is the breakpoint (it caches once it is over the model's minimum: 4,096 tokens on Haiku 4.5)");
  assert.equal(blocks(a)[1].cache_control, undefined, "the volatile block is after it");
  /* The date is after the breakpoint: a new day never invalidates the ZIP's cached context. */
  assert.ok(!blocks(a)[0].text.includes("2026-09-06") && !blocks(a)[0].text.includes("Vail, Arizona"), "no per-day or per-reader value in the cached block");
  assert.match(blocks(a)[1].text, /Today is 2026-09-06\./);
  const nextDay = await captureBody((f) => interpretQuestion("what is on the agenda", { ...context, today: "2026-09-07" }, { fetchImpl: f, apiKey: "sk-test" }));
  assert.equal(sha(blocks(a)[0]), sha(blocks(nextDay)[0]), "a new day changes only the volatile block");
});

test("PC-3 Ask classify and the unsourced fallback: the system prompt is static and the question is the message (both unmarked, under the minimum)", async () => {
  const previous = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "sk-test";
  try {
    const a = await captureBody((f) => classifyQuestion(`who fixes potholes ${Date.now()}`, { fetchImpl: f }));
    const b = await captureBody((f) => classifyQuestion(`who plows my street ${Date.now()}`, { fetchImpl: f }));
    assert.equal(a.system, classifierPrompt());
    assert.equal(sha(a.system), sha(b.system));
    assert.ok(!String(a.system).includes("potholes"));
    const c = await captureBody((f) => askUnsourced("how does a bill become law", { fetchImpl: f }));
    const d = await captureBody((f) => askUnsourced("what is a mill levy", { fetchImpl: f }));
    assert.equal(sha(c.system), sha(d.system));
    assert.ok(!String(c.system).includes("mill levy"));
  } finally {
    if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previous;
  }
});
