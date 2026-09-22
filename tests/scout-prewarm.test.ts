/**
 * **THE PRE-WARM, THE TTL ORDER, AND THE ONE-PER-CYCLE HOOK.** (Prompt-caching
 * session, 2026-09-06. Acceptance rows PC-6 and PC-7.)
 *
 * The pre-warm request carries the Attempts' exact static prefix with
 * `max_tokens: 0`, the breakpoint on the system block and none on the
 * placeholder; the cycle sends it once, before the first admitted Scout, and
 * every admitted Scout waits for it; and the order the API enforces on cache
 * TTLs — a 1-hour marker never after a 5-minute one, across tools → system →
 * messages — is refused before a byte is sent, with the API's own message
 * from 2026-09-06 recorded here.
 */

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
import { SCOUT_TOOL_SPECS } from "../lib/control-plane/scheduler/scout-tools.ts";
import {
  SCOUT_PREWARM_PLACEHOLDER,
  SCOUT_PREWARM_ROUTE_ID,
  cacheTtlOrderProblems,
  scoutPrewarmRequest,
  scoutStaticPrefix,
  type ModelRequest,
} from "../lib/control-plane/scheduler/scout-executor.ts";

const NOW = "2026-09-06T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);

/** The API's answer to a 1h marker after a 5m one, measured 2026-09-06 (request req_011Cenvci1JKyvNv…). */
const API_MESSAGE =
  "system.0.cache_control.ttl: a ttl='1h' cache_control block must not come after a ttl='5m' cache_control block. " +
  "Note that blocks are processed in the following order: `tools`, `system`, `messages`.";

test("PC-7: the pre-warm request is the Attempts' static prefix with max_tokens 0, tool_choice auto, the breakpoint on the system block and none on the placeholder", () => {
  const input = { model: "claude-opus-5-5", effort: "medium" as const, toolkitSpecs: SCOUT_TOOL_SPECS, bound: RESEARCH_BOUNDS.perDispatch, minRungs: MIN_DISTINCT_RUNGS };
  const request = scoutPrewarmRequest(input);
  const prefix = scoutStaticPrefix(input);
  assert.equal(request.max_tokens, 0);
  assert.deepEqual(request.tool_choice, { type: "auto" }, "a forced tool_choice is refused with max_tokens 0 by the API");
  assert.deepEqual(request.output_config, { effort: "medium" }, "the same effort the Attempts send; a change would invalidate the cache");
  assert.equal(JSON.stringify(request.tools), JSON.stringify(prefix.tools), "byte-identical tools");
  assert.equal(JSON.stringify(request.system), JSON.stringify(prefix.system), "byte-identical system");
  assert.deepEqual(request.system.at(-1)?.cache_control, { type: "ephemeral" }, "the breakpoint is on the system block");
  assert.deepEqual(request.tools.at(-1)?.cache_control, { type: "ephemeral" });
  const placeholder = request.messages[0].content as { type: string; text: string; cache_control?: unknown }[];
  assert.equal(placeholder.length, 1);
  assert.equal(placeholder[0].text, SCOUT_PREWARM_PLACEHOLDER);
  assert.equal(placeholder[0].cache_control, undefined, "never on the placeholder: the entry would be keyed to it");
  assert.equal((request as { cache_control?: unknown }).cache_control, undefined, "no top-level marker either, for the same reason");
  assert.equal(cacheTtlOrderProblems(request).length, 0);
  assert.equal(SCOUT_PREWARM_ROUTE_ID, "scout:prewarm");
});

test("PC-6: the TTL decision is the measured 5 minutes, and a 1h marker after a 5m one is refused before sending with the API's own rule", () => {
  assert.equal(SCOUT_CACHE_POLICY.ttl, "5m");
  assert.match(SCOUT_CACHE_POLICY.ttl === "5m" ? String((SCOUT_CACHE_POLICY as { movingBreakpoint: string }).movingBreakpoint) : "", /TOP_LEVEL|LAST_BLOCK/);
  const input = { model: "claude-opus-5-5", effort: "medium" as const, toolkitSpecs: SCOUT_TOOL_SPECS, bound: RESEARCH_BOUNDS.perDispatch, minRungs: MIN_DISTINCT_RUNGS };
  const good = scoutPrewarmRequest(input);
  /* A 1h system marker with a 5m tool marker before it: exactly the planted request the API refused. */
  const planted: ModelRequest = { ...good, system: good.system.map((s) => ({ ...s, cache_control: { type: "ephemeral", ttl: "1h" } })) };
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
  const late: ModelRequest = { ...good, messages: [{ role: "user", content: [{ type: "text", text: "warmup", cache_control: { type: "ephemeral", ttl: "1h" } }] }] };
  assert.match(cacheTtlOrderProblems(late)[0], /messages\[0\]\.content\[0\]/);
  /* The provider's limit of four markers is refused by name. */
  const five: ModelRequest = { ...lawful, cache_control: { type: "ephemeral" }, messages: [{ role: "user", content: [{ type: "text", text: "a", cache_control: { type: "ephemeral" } }, { type: "text", text: "b", cache_control: { type: "ephemeral" } }] }] };
  assert.match(cacheTtlOrderProblems(five).join(" "), /5 cache_control markers exceed the provider's limit of 4/);
});

/* ------------------------------------------------ the one-per-cycle hook */

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
    workerFor: ({ holder }) => ({ role: "SCOUT", provider: "anthropic", version: "claude-opus-5-5", instance: holder }),
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
    reader: { contract: "READER", state: "NOT_READY", reason: "test" },
    truth: { contract: "TRUTH", state: "NOT_READY", reason: "test" },
    research: {
      decide: () => ({ kind: "BOUNDED_MODEL_WORKER", why: "test", disagreement: null }),
      admitScout: () => (input.admit ? { admit: true } : { admit: false, code: "CEILING", why: "test" }),
      modelExecutor: scout,
      maxConcurrentScouts: 2,
      scoutLeaseTtlMs: 60_000,
      scoutWallMs: 1000,
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
