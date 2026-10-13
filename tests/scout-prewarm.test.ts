import { rolePlaybook } from "../lib/control-plane/playbooks.ts";
import { playbookRows } from "./helpers/playbooks.ts";
import { fixtureRolePlaybook } from "./helpers/playbooks.ts";
/**
 * The pre-warm request carries the Attempts' exact static prefix with
 * `max_tokens: 0`, the breakpoint on the system block and none on the
 * placeholder; the cycle sends it once, before the first admitted Scout, and
 * every admitted Scout waits for it; and the order the API enforces on cache
 * TTLs — a 1-hour marker never after a 5-minute one, across tools → system →
 * messages — is refused before a byte is sent, with the API's own message
 * recorded here.
 */

import { SOURCE_API_SPECS } from "../lib/control-plane/scheduler/scout-api.ts";
import { MODELS } from "../lib/models.ts";
import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { registerRouteTask, registerWorkItem } from "../lib/control-plane/repository/coordinator.ts";
import { createRouteTask } from "../lib/control-plane/route-task.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";
import type { DeclaredExecutor } from "../lib/control-plane/scheduler/dispatch.ts";
import { isScheduled, scheduleObligation, type FreshnessObligation, type ScheduledObligation } from "../lib/control-plane/scheduler/obligation.ts";
import { runCycle, type PrewarmOutcome } from "../lib/control-plane/scheduler/shadow-loop.ts";
import { RESEARCH_BOUNDS } from "../lib/control-plane/scheduler/research-policy.ts";
import { SCOUT_CACHE_POLICY } from "../lib/control-plane/scheduler/model-routing.ts";
import { MIN_DISTINCT_RUNGS } from "../lib/control-plane/scheduler/scout-result.ts";
import { readFileSync } from "node:fs";
import { SCOUT_TOOL_SPECS, SEARCH_TOOL_SPEC, buildScoutToolkit, scoutToolSpecsFor } from "../lib/control-plane/scheduler/scout-tools.ts";
import type { ScoutToolContext } from "../lib/control-plane/scheduler/scout-contract.ts";
import { minimumCacheablePrefixTokensFor } from "../lib/control-plane/model-cost.ts";
import {
  ModelTransportError,
  SCOUT_PREWARM_PLACEHOLDER,
  SCOUT_PREWARM_ROUTE_ID,
  SCOUT_THINKING,
  cacheTtlOrderProblems,
  scoutExecutor,
  scoutPrewarmPlan,
  scoutPrewarmRequest,
  scoutStaticPrefix,
  type ModelRequest,
  type ModelTransport,
} from "../lib/control-plane/scheduler/scout-executor.ts";

const NOW = "2026-09-06T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);

/** The API's answer to a 1h marker after a 5m one. */
const API_MESSAGE =
  "system.0.cache_control.ttl: a ttl='1h' cache_control block must not come after a ttl='5m' cache_control block. " +
  "Note that blocks are processed in the following order: `tools`, `system`, `messages`.";

test("PC-7: the pre-warm request is the Attempts' static prefix with max_tokens 0, tool_choice auto, the breakpoint on the system block and none on the placeholder", () => {
  const input = { playbook: rolePlaybook(playbookRows, "SCOUT").text, model: MODELS.opus.model, effort: "medium" as const, toolkitSpecs: SCOUT_TOOL_SPECS, bound: RESEARCH_BOUNDS.perDispatch, minRungs: MIN_DISTINCT_RUNGS };
  const request = scoutPrewarmRequest(input);
  const prefix = scoutStaticPrefix(input);
  assert.equal(request.max_tokens, 0);
  assert.deepEqual(request.tool_choice, { type: "auto" }, "a forced tool_choice is refused with max_tokens 0 by the API");
  assert.deepEqual(request.output_config, { effort: "medium" }, "the same effort the Attempts send; a change would invalidate the cache");
  assert.deepEqual(request.thinking, SCOUT_THINKING, "the same thinking setting the Attempts send; it is rendered into the prompt too");
  assert.equal(JSON.stringify(request.tools), JSON.stringify(prefix.tools), "byte-identical tools");
  assert.equal(JSON.stringify(request.system), JSON.stringify(prefix.system), "byte-identical system");
  assert.deepEqual(request.system.at(-1)?.cache_control, { type: "ephemeral", ttl: "1h" }, "the breakpoint is on the system block");
  assert.deepEqual(request.tools.at(-1)?.cache_control, { type: "ephemeral", ttl: "1h" });
  const placeholder = request.messages[0].content as { type: string; text: string; cache_control?: unknown }[];
  assert.equal(placeholder.length, 1);
  assert.equal(placeholder[0].text, SCOUT_PREWARM_PLACEHOLDER);
  assert.equal(placeholder[0].cache_control, undefined, "never on the placeholder: the entry would be keyed to it");
  assert.equal((request as { cache_control?: unknown }).cache_control, undefined, "no top-level marker either, for the same reason");
  assert.equal(cacheTtlOrderProblems(request).length, 0);
  assert.equal(SCOUT_PREWARM_ROUTE_ID, "scout:prewarm");
});

test("PC-7 search on (2026-09-25): the pre-warm warms the prefix the Attempts actually send — the search tool included, the same thinking and effort — and the runner feeds one switch to both", async () => {
  /* The Attempts' tool list, from the real builder, with the owner's paid-search switch on. */
  const row = scheduleObligation(obligation("search-on"), NOW_MS);
  assert.ok(isScheduled(row));
  const searchSeam = async () => ({ hits: [], requestCount: 0, bytesFetched: 0, providersUsed: [], errors: [] });
  const ctx = {
    obligation: row, route: null, providerId: "t", attemptId: "at", workItemId: "wi", routeTaskId: "rt", holder: "h",
    vault: async () => ({ stored: true, where: "x", why: "w" }), spaceOut: async () => undefined, bound: RESEARCH_BOUNDS.perDispatch,
    now: () => NOW, inherited: { artifactIds: [], summary: "" }, openOne: async () => { throw new Error("no network in this test"); },
  } as unknown as ScoutToolContext;
  const kit = buildScoutToolkit({ ...ctx, search: searchSeam as never });
  assert.deepEqual(kit.specs.map((s) => s.name), scoutToolSpecsFor(true).map((s) => s.name), "search on: the Attempts offer the search tool");
  assert.equal(JSON.stringify(kit.specs), JSON.stringify(scoutToolSpecsFor(true)), "the toolkit and the pre-warm read one answer");
  assert.equal(JSON.stringify(buildScoutToolkit(ctx).specs), JSON.stringify(scoutToolSpecsFor(false)));

  /* The loop's own first request over that toolkit, captured (no provider is reached). */
  const captured: ModelRequest[] = [];
  const capture: ModelTransport = async (request) => {
    captured.push(request);
    throw new ModelTransportError("captured", null);
  };
  await scoutExecutor({ playbookFor: fixtureRolePlaybook,
    transport: capture,
    toolkitFor: () => kit,
    contextFor: () => ({ route: null, providerId: "p", reason: "r", inherited: { artifactIds: [], summary: "s" }, tools: { vault: async () => ({ stored: true, where: "x", why: "w" }), spaceOut: async () => undefined } }),
    now: () => NOW,
  }).run({ obligation: row, routeTaskId: "rt", workItemId: "wi", attemptId: "at", holder: "h", executor: "BOUNDED_MODEL_WORKER", bound: { maxAttempts: 1, maxWallMs: 1000, maxCostUnits: 1 } } as never);
  assert.equal(captured.length, 1);
  const first = captured[0];

  const actualPlan = scoutPrewarmPlan({ playbook: rolePlaybook(playbookRows, "SCOUT").text, toolkitSpecs: scoutToolSpecsFor(true), bound: RESEARCH_BOUNDS.perDispatch, minRungs: MIN_DISTINCT_RUNGS });
  assert.equal(actualPlan.kind, "SEND", "the expanded held-evidence and manual tools now clear Haiku's cache minimum");
  assert.ok(actualPlan.kind === "SEND");
  assert.ok(actualPlan.prefixTokensAtLeast >= actualPlan.minimumCacheablePrefixTokens);
  const plan = actualPlan;
  assert.equal(plan.request.model, first.model, "the model the loop starts on");
  assert.equal(JSON.stringify(plan.request.tools), JSON.stringify(first.tools), "byte-identical tools — search included");
  assert.equal(JSON.stringify(plan.request.system), JSON.stringify(first.system), "byte-identical system");
  assert.deepEqual(plan.request.thinking, first.thinking, "the same thinking setting: it is rendered into the prompt");
  assert.deepEqual(plan.request.thinking, SCOUT_THINKING, "every tier takes adaptive thinking");
  assert.deepEqual(plan.request.output_config, first.output_config, "the same effort");
  /* The per-model minimum check still decides: Sonnet 5's is 1,024 (Opus 5.5's recorded 512). */
  assert.equal(plan.minimumCacheablePrefixTokens, minimumCacheablePrefixTokensFor(first.model));
  assert.equal(minimumCacheablePrefixTokensFor("claude-sonnet-5"), 1024);
  assert.equal(minimumCacheablePrefixTokensFor("claude-sonnet-5-5"), 512);
  assert.equal(minimumCacheablePrefixTokensFor(MODELS.opus.model), 512);
  /* Negative control: the list without search is a different prefix. */
  const without = scoutPrewarmPlan({ playbook: rolePlaybook(playbookRows, "SCOUT").text, toolkitSpecs: SCOUT_TOOL_SPECS, bound: RESEARCH_BOUNDS.perDispatch, minRungs: MIN_DISTINCT_RUNGS });
  assert.notEqual(without.kind === "SEND" ? JSON.stringify(without.request.tools) : "", JSON.stringify(first.tools));

  /* The runner: the pre-warm's list and the Scout's toolkit follow the same `scoutSearch` switch. */
  const runner = readFileSync(new URL("../scripts/freshness-shadow.mts", import.meta.url), "utf8");
  assert.match(runner, /scoutPrewarmPlan\(\{ playbook: playbook.text, toolkitSpecs: scoutToolSpecsFor\(scoutSearch !== null\),/, "the pre-warm warms the list the switch gives the Attempts");
  assert.match(runner, /search: \(lifetimeHuntWork\(scheduled\.obligation\.id\) \? scoutSearchLifetime : scoutSearch\) \?\? undefined/, "funded hunts use their matching search budget");
  assert.match(runner, /const scoutSearchLifetime = searchBudget === null \|\| !hasLifetimeHunt \? null : makeScoutSearch\(/, "the lifetime route preserves the same owner-controlled search switch");
  const child = readFileSync(new URL("../lib/control-plane/workers/scout-worker.ts", import.meta.url), "utf8");
  assert.match(child, /buildScoutToolkit\(\{ \.\.\.ctx, \.\.\.tools, sourceApi: \{ env: process\.env \} \}\)/, "the child offers search and every configured source API through the shared toolkit");
  assert.doesNotMatch(runner, /toolkitSpecs: SCOUT_TOOL_SPECS/, "no pre-warm from the list without search");
});

test("PC-6: the TTL decision is the measured 5 minutes, and a 1h marker after a 5m one is refused before sending with the API's own rule", () => {
  assert.equal(SCOUT_CACHE_POLICY.ttl, "5m");
  assert.match(SCOUT_CACHE_POLICY.ttl === "5m" ? String((SCOUT_CACHE_POLICY as { movingBreakpoint: string }).movingBreakpoint) : "", /TOP_LEVEL|LAST_BLOCK/);
  const input = { playbook: rolePlaybook(playbookRows, "SCOUT").text, model: MODELS.opus.model, effort: "medium" as const, toolkitSpecs: SCOUT_TOOL_SPECS, bound: RESEARCH_BOUNDS.perDispatch, minRungs: MIN_DISTINCT_RUNGS };
  const good = scoutPrewarmRequest(input);
  /* A 1h system marker with a 5m tool marker before it: exactly the planted request the API refused. */
  const planted: ModelRequest = { ...good, tools: good.tools.map(t => t.cache_control ? { ...t, cache_control: { type: "ephemeral" } } : t), system: good.system.map((s) => ({ ...s, cache_control: { type: "ephemeral", ttl: "1h" } })) };
  const problems = cacheTtlOrderProblems(planted);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /system\[0\]: a ttl='1h' cache_control block must not come after the ttl='5m' block at tools\[\d+\]/);
  assert.match(API_MESSAGE, /must not come after a ttl='5m' cache_control block/, "the rule this validator restates, in the API's words");
  /* The lawful 1h shape: every 1h marker before every 5m marker. */
  const lawful: ModelRequest = {
    ...good,
    tools: good.tools.map((t, i) => (i === good.tools.length - 1 ? { ...t, cache_control: { type: "ephemeral", ttl: "1h" } } : t)),
    system: good.system.map((s) => ({ ...s, cache_control: { type: "ephemeral", ttl: "1h" } })),
    messages: [{ role: "user", content: [{ type: "text", text: "warmup", cache_control: { type: "ephemeral" } }] }],
  };
  assert.deepEqual(cacheTtlOrderProblems(lawful), []);
  /* A 1h marker in the messages after a 5m system marker is refused too. */
  const late: ModelRequest = { ...good, system: good.system.map(s => ({ ...s, cache_control: { type: "ephemeral" } })), messages: [{ role: "user", content: [{ type: "text", text: "warmup", cache_control: { type: "ephemeral", ttl: "1h" } }] }] };
  assert.match(cacheTtlOrderProblems(late)[0], /messages\[0\]\.content\[0\]/);
  /* The provider's limit of four markers is refused by name. */
  const five: ModelRequest = { ...lawful, cache_control: { type: "ephemeral" }, messages: [{ role: "user", content: [{ type: "text", text: "a", cache_control: { type: "ephemeral" } }, { type: "text", text: "b", cache_control: { type: "ephemeral" } }] }] };
  assert.match(cacheTtlOrderProblems(five).join(" "), /5 cache_control markers exceed the provider's limit of 4/);
});


function obligation(id: string): FreshnessObligation {
  return { id, recordClass: "meetings", subjectId: `ocd-division/country:us/state:az/place:${id}`, routeId: id, active: true, readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: new Date(NOW_MS - 48 * 3_600_000).toISOString() };
}

async function cycleWith(input: { readonly rows: number; readonly admit: boolean; readonly prewarm: () => Promise<PrewarmOutcome> }) {
  const repos = createMemoryRepositories();
  const obligations = Array.from({ length: input.rows }, (_, i) => obligation(`row-${i + 1}`));
  const taskFor = new Map<string, string>();
  for (const o of obligations) {
    const item = createWorkItem({ project: "freshness", subject: o.subjectId, obligation: "refresh:meetings", why: "test", now: NOW });
    const task = createRouteTask({ workItemId: item.id, routeId: o.routeId ?? "none", routeLabel: "t", target: "example.invalid", inherited: false, now: NOW });
    await registerWorkItem(repos, item, NOW);
    await registerRouteTask(repos, task, NOW);
    taskFor.set(o.id, task.id);
  }
  const started: { id: string; at: number }[] = [];
  let warmedAt: number | null = null;
  const prewarm = async (): Promise<PrewarmOutcome> => {
    const outcome = await input.prewarm();
    warmedAt = Date.now();
    return outcome;
  };
  const scout: DeclaredExecutor = {
    lane: "BOUNDED_MODEL_WORKER",
    workerFor: ({ holder }) => ({ role: "SCOUT", provider: "anthropic", version: MODELS.opus.model, instance: holder }),
    run: async ({ obligation: row }) => {
      started.push({ id: row.obligation.id, at: Date.now() });
      return { ranAs: "BOUNDED_MODEL_WORKER", kind: "ABORTED", detail: "test scout", endedAt: NOW, artifacts: [] } as never;
    },
  };
  const deterministic: DeclaredExecutor = { lane: "DETERMINISTIC", workerFor: ({ holder }) => ({ role: "ACQUIRER", provider: "we-the-people", version: "t", instance: holder }), run: async () => ({ ranAs: "DETERMINISTIC", kind: "ABORTED", detail: "never" }) as never };
  const scheduledRows = obligations.map((o) => { const row = scheduleObligation(o, NOW_MS); if (!isScheduled(row)) throw new Error("fixture"); return row as ScheduledObligation; });
  const cycle = await runCycle({
    repos,
    obligations: scheduledRows.map((r) => r.obligation),
    debts: [],
    routeTaskFor: (id: string) => taskFor.get(id) ?? null,
    maturity: () => "UNGRADUATED",
    executor: deterministic,
    holder: "t",
    now: NOW,
    leaseTtlMs: 60_000,
    research: {
      decide: () => ({ kind: "BOUNDED_MODEL_WORKER", why: "test", disagreement: null }),
      admitScout: () => (input.admit ? { admit: true } : { admit: false, code: "CEILING", why: "test" }),
      modelExecutor: scout,
      workerCapacity: 2,
      scoutLeaseTtlMs: 60_000,
      prewarm,
    },
  } as never);
  return { cycle, started, warmedAt: warmedAt as number | null };
}

test("PC-7: the cycle pre-warms ONCE, before the first admitted Scout, and both concurrent Scouts start after the entry exists", async () => {
  let calls = 0;
  const { cycle, started, warmedAt } = await cycleWith({
    rows: 2,
    admit: true,
    prewarm: async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 30));
      return { status: "WARMED", at: NOW, cacheCreationInputTokens: 4586, cacheReadInputTokens: 0, uncachedInputTokens: 77, usd: 0.0287, durationMs: 30 };
    },
  });
  assert.equal(calls, 1, "one pre-warm per cycle, however many Scouts");
  assert.equal(started.length, 2);
  assert.ok(warmedAt !== null);
  for (const s of started) assert.ok(s.at >= (warmedAt as number), `${s.id} started after the pre-warm resolved`);
  assert.equal(cycle.lanes?.model.dispatched, 2);
  assert.deepEqual(cycle.lanes?.model.prewarm, { status: "WARMED", at: NOW, cacheCreationInputTokens: 4586, cacheReadInputTokens: 0, uncachedInputTokens: 77, usd: 0.0287, durationMs: 30 });
});

test("PC-7: no admitted Scout, no pre-warm; and a failed pre-warm is recorded while the Attempts still run", async () => {
  let calls = 0;
  const none = await cycleWith({ rows: 2, admit: false, prewarm: async () => { calls += 1; return { status: "WARMED", at: NOW, cacheCreationInputTokens: 1, cacheReadInputTokens: 0, uncachedInputTokens: 1, usd: 0, durationMs: 1 }; } });
  assert.equal(calls, 0, "a cycle that dispatches nothing warms nothing");
  assert.equal(none.cycle.lanes?.model.prewarm, null);
  const failed = await cycleWith({ rows: 1, admit: true, prewarm: async () => { throw new Error("HTTP 529: overloaded"); } });
  assert.equal(failed.started.length, 1, "the Attempt ran without the warm entry");
  assert.equal(failed.cycle.lanes?.model.prewarm?.status, "FAILED");
  assert.match((failed.cycle.lanes?.model.prewarm as { detail?: string })?.detail ?? "", /529/);
});
