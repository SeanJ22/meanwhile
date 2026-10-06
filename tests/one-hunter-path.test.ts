/**
 * CH-23 part 4: behind WTP_ONE_HUNTER_PATH the round's registry-lane Scout (`scoutFor`) walks no planned paid row.
 * The round opens the row's occurrence before the first coordinator wave, and the coordinator runs its Scout through
 * its plan. With the switch off the old path runs as before.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import type { FreshnessObligation } from "../lib/control-plane/scheduler/obligation.ts";
import type { DeclaredExecutor, ExecutorDecision } from "../lib/control-plane/scheduler/dispatch.ts";
import { buildRegistry } from "../lib/control-plane/scheduler/registry.ts";
import { campaignFinanceProvider } from "../lib/control-plane/scheduler/providers/campaign-finance.ts";
import { runCycle } from "../lib/control-plane/scheduler/shadow-loop.ts";
import { skipWords } from "../lib/control-plane/scheduler/lane-reading.ts";
import { HUNTER_PATH, hunterPathRefusal } from "../lib/control-plane/workers/route-plan.ts";

const ROOT = join(import.meta.dirname, "..");
const T = "2026-10-06T19:30:00.000Z";
const ON = { WTP_ONE_HUNTER_PATH: "1" } as unknown as NodeJS.ProcessEnv, OFF = {} as NodeJS.ProcessEnv;
const routePlan = buildRegistry([campaignFinanceProvider()], { root: ROOT, nowIso: T, planEveryPaidRoute: true })
  .units.find(u => u.obligation.autonomousPlan)!.obligation.autonomousPlan!;

test("the research lane leaves a planned paid row to the coordinator only while the switch is on", () => {
  assert.equal(hunterPathRefusal(routePlan, ON)?.code, HUNTER_PATH);
  assert.equal(hunterPathRefusal(routePlan, OFF), null, "switched off, the round's Scout walks it as before");
  assert.equal(hunterPathRefusal({ ...routePlan, capability: "officials/offices" }, ON)?.code, HUNTER_PATH, "a Send's plan too");
  assert.equal(hunterPathRefusal({ ...routePlan, capability: "officials/offices" }, OFF), null);
  assert.equal(hunterPathRefusal(undefined, ON), null, "a row with no plan has no coordinator work to go to");
  assert.equal(skipWords(HUNTER_PATH), "it runs as hunter work through its plan");
});

async function roundWith(env: NodeJS.ProcessEnv) {
  let walks = 0;
  const scout: DeclaredExecutor = { lane: "BOUNDED_MODEL_WORKER",
    run: async () => { walks += 1; return { ranAs: "BOUNDED_MODEL_WORKER", kind: "ABORTED", detail: "test Scout" }; } };
  const decision: ExecutorDecision = { kind: "BOUNDED_MODEL_WORKER", why: "paid route", disagreement: null };
  const row: FreshnessObligation = { id: "campaign-finance:x", recordClass: "campaign-finance", subjectId: "x", routeId: "r",
    active: true, readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: null, autonomousPlan: routePlan };
  const cycle = await runCycle({
    repos: createMemoryRepositories(), obligations: [row], debts: [], routeTaskFor: id => `rt-${id}`,
    maturity: () => "UNGRADUATED",
    executor: { lane: "DETERMINISTIC", run: async () => ({ ranAs: "DETERMINISTIC", kind: "ABORTED", detail: "none" }) },
    holder: "test", now: T, leaseTtlMs: 1000, requireOpenOccurrence: true,
    reader: { contract: "READER", state: "NOT_READY", reason: "test" }, truth: { contract: "TRUTH", state: "NOT_READY", reason: "test" },
    research: { decide: () => decision, admitScout: r => hunterPathRefusal(r.obligation.autonomousPlan, env) ?? { admit: true },
      modelExecutor: scout, workerCapacity: 2, scoutLeaseTtlMs: 1000 },
  });
  return { cycle, walks };
}

test("switched on, the round's registry-lane Scout never starts for a planned row; switched off, it does", async () => {
  const on = await roundWith(ON);
  assert.equal(on.cycle.lanes?.model.dispatched, 0, "no registry-lane Scout is dispatched");
  assert.equal(on.cycle.lanes?.model.deferredBy[HUNTER_PATH], 1, "the row is counted as hunter work, by name");
  assert.ok(on.cycle.deferred.some(d => d.why.startsWith(`${HUNTER_PATH}: it runs as hunter work`)));
  assert.equal(on.walks, 0);
  const off = await roundWith(OFF);
  assert.equal(off.cycle.lanes?.model.dispatched, 1, "the old path is kept behind the switch");
});

test("the round opens planned rows before the first coordinator wave, and admission hands them over before any paid gate", () => {
  const round = readFileSync(join(ROOT, "scripts/freshness-shadow.mts"), "utf8");
  const block = round.indexOf("if (oneHunterPath() && laneClosure === null && !canary) {");
  assert.ok(block > 0, "the opening block exists");
  assert.ok(block < round.indexOf("const earlyOriginal = "), "opened before the early worker wave plans");
  assert.match(round.slice(block, block + 900), /if \(parseMeetingsDiscoveryId\(row\.obligation\.id\) !== null\) continue;[\s\S]*?openOccurrenceInStep\(\{ \.\.\.scheduled, nextDueAt: row\.nextDueAt \}\) === true\) opened \+= 1;/,
    "a meetings-discovery row waits for the free walk's record");
  const admit = round.indexOf("admitScout: (row) => {");
  const handover = round.indexOf("const hunterPath = hunterPathRefusal(row.obligation.autonomousPlan);", admit);
  assert.ok(handover > admit, "admission checks the one hunter path");
  assert.ok(handover < round.indexOf("if (paidWorkerCapacity() === 0)", admit), "before any paid gate: no hold is taken for work the coordinator runs");
  assert.match(round.slice(handover, handover + 900), /paidDiscoveryHold\(row\.obligation\.id, freeWalks\)[\s\S]*?openOccurrenceInStep\(row\)/,
    "the free walk's finding still holds the paid walk (MW-028); otherwise the occurrence is opened for the coordinator");
});
