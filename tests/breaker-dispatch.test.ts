import test from "node:test";
import assert from "node:assert/strict";
import { FleetSafetyController } from "../lib/control-plane/fleet-safety.ts";
import { routeExecutor, type OpenOne } from "../lib/control-plane/scheduler/route-executor.ts";
import type { RouteDescriptor } from "../lib/control-plane/scheduler/registry.ts";
import { runPool } from "../lib/control-plane/scheduler/shadow-loop.ts";
import { providerConcurrency } from "../lib/control-plane/scheduler/provider-limits.ts";
import { memoryWebsitePacing } from "../lib/control-plane/website-pacing.ts";
import { sourceReliabilityKey } from "../lib/control-plane/scheduler/scout-reliability.ts";
import type { FreshnessObligation } from "../lib/control-plane/scheduler/obligation.ts";
import { scheduledFixture } from "./control-plane-fixtures.ts";

const NOW = "2026-10-13T19:00:00.000Z";
const NOW_MS = Date.parse(NOW);

const LEGISTAR = "https://webapi.legistar.com/v1/tucson";
const rows = Array.from({ length: 50 }, (_, i) => `${LEGISTAR}/events?page=${i}`);

/* The deterministic lane as runCycle runs it: each row taken under its provider's limit, then admitted or held by name. */
async function lane(fleet: FleetSafetyController, hostConcurrency: number) {
  let inFlight = 0, most = 0;
  const dispatched: string[] = [], held: string[] = [];
  await runPool(rows, rows.length, async url => {
    const admission = fleet.admitDispatch(url, url);
    if (!admission.admit) { held.push(url); return; }
    inFlight++; most = Math.max(most, inFlight);
    await new Promise(resolve => setTimeout(resolve, 2));
    inFlight--; dispatched.push(url);
  }, undefined, undefined, url => {
    const key = sourceReliabilityKey(url);
    return { key, limit: providerConcurrency(fleet.providerState(url), hostConcurrency) };
  });
  return { most, dispatched: dispatched.length, held: held.length };
}
const circuit = (eligibleAt: string) => ({ provider: sourceReliabilityKey(LEGISTAR), condition: "transport failed: The operation was aborted due to timeout",
  firstObservedAt: NOW, workDeferred: [], eligibleAt, failureClass: "TRANSIENT" as const });

test("a healthy provider's rows run in parallel up to the in-flight cap; half-open, one at a time; open, none are sent", async () => {
  const healthy = await lane(new FleetSafetyController({ now: NOW, charges: [], clock: () => NOW_MS }), 8);
  assert.equal(healthy.most, 8, "in parallel up to the Admin setting");
  assert.equal(healthy.dispatched, 50);

  let clock = NOW_MS;
  const reopened = new FleetSafetyController({ now: NOW, charges: [], clock: () => clock, circuits: [circuit(new Date(NOW_MS + 60_000).toISOString())] });
  const open = await lane(reopened, 8);
  assert.deepEqual([open.dispatched, open.held], [0, 50], "while the breaker is open nothing is dispatched; every row is held by name");
  assert.ok(reopened.snapshot(NOW).deferred.some(row => row.code === "PROVIDER_CIRCUIT_BROKEN"));
  clock = NOW_MS + 61_000;
  assert.equal(reopened.providerState(LEGISTAR), "HALF_OPEN");
  const probing = await lane(reopened, 8);
  assert.deepEqual([probing.most, probing.dispatched], [1, 50], "half-open: one request at a time");
});

/* Virtual time: each sleeper wakes in order of its wake time, and the clock moves to it. */
function simulatedTime(start: number) {
  let now = start, seq = 0, queued = false;
  const timers: { at: number; seq: number; wake: () => void }[] = [];
  const pump = () => {
    if (queued) return;
    queued = true;
    setImmediate(() => {
      queued = false;
      if (timers.length === 0) return;
      timers.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const next = timers.shift()!;
      now = Math.max(now, next.at);
      next.wake();
      pump();
    });
  };
  return { clock: () => now, sleep: (ms: number) => new Promise<void>(wake => { timers.push({ at: now + ms, seq: seq++, wake }); pump(); }) };
}

/* Every Congress request through the runner's fetch gate, each answer taking `answerMs` of simulated time. */
async function congressHour(rowCount: number, answerMs: number, callers = 1) {
  const time = simulatedTime(NOW_MS);
  const pacing = memoryWebsitePacing();
  const fleets = Array.from({ length: callers }, () => new FleetSafetyController({ now: NOW, charges: [], clock: time.clock, sleep: time.sleep,
    websitePacing: pacing, hostConcurrency: () => 8 }));
  let inFlight = 0, most = 0;
  const sentAt: number[] = [];
  const fetchImpl = (async () => {
    inFlight++; most = Math.max(most, inFlight); sentAt.push(time.clock());
    await time.sleep(answerMs);
    inFlight--;
    return new Response("{\"bills\":[]}", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const opens = fleets.map((fleet, i) => fleet.guardedOpenOne("public-web", `congress-bills-${i}`, fetchImpl));
  const answers = await Promise.all(Array.from({ length: rowCount }, (_, i) =>
    opens[i % callers]!({ url: `https://api.congress.gov/v3/bill/119/hr/${i + 1}?format=json`, method: "GET", headers: {}, timeoutMs: 30_000 })));
  return { answers, most, sentAt };
}

test("6,000 Congress rows over a simulated hour send no more than its published 5,000 and never more than the in-flight cap at once", async () => {
  const { answers, most, sentAt } = await congressHour(6000, 4_000);
  assert.ok(answers.every(answer => answer.status === 200), "every row is answered, none refused by the source");
  const inHour = sentAt.filter(at => at < NOW_MS + 3_600_000).length;
  assert.ok(inHour <= 5000, `${inHour} sent in the hour`);
  assert.ok(inHour >= 4990, `paced through the whole hour, not stalled: ${inHour}`);
  assert.ok(sentAt.filter(at => at < NOW_MS + 300_000).length <= 5000 / 12 + 1, "the hour is not spent in its first minutes");
  assert.ok(most <= 8, `${most} in flight at once`);

  const slow = await congressHour(200, 20_000);
  assert.equal(slow.most, 8, "slow answers fill the in-flight cap and go no further");

  const shared = await congressHour(6000, 4_000, 3);
  assert.ok(shared.sentAt.filter(at => at < NOW_MS + 3_600_000).length <= 5000, "three callers sharing the store share one hour");
});

const obligation: FreshnessObligation = {
  id: "freshness:az:2026:candidate#candidate-wikipedia-api", recordClass: "CANDIDATE_ENRICHMENT", subjectId: "az:2026:candidate",
  routeId: "candidate-wikipedia-api", active: true, readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: null,
};
const search = (zeroRowsIsMiss: boolean): RouteDescriptor => ({
  routeId: "candidate-wikipedia-api", label: "Wikipedia search", executorClass: "DETERMINISTIC", executorReason: "test",
  open: { kind: "HTTP_GET", url: "https://api.wikimedia.org/core/v1/wikipedia/en/search/page?q=Sally+Ann+Gonzales&limit=5" },
  yieldContract: { describe: "a Wikimedia REST search response carrying a pages array", requireAll: ["pages"], rowsAt: "pages",
    ...(zeroRowsIsMiss ? { zeroRowsIsMiss: true as const } : {}) },
  citation: "test",
});
/* The 12-byte answer api.wikimedia.org gave 94 times on 13 Oct for candidates with no article. */
const emptySearch: OpenOne = async () => ({ status: 200, bytes: 12, contentType: "application/json", body: "{\"pages\":[]}", durationMs: 1, transportError: null });
const run = (route: RouteDescriptor) => routeExecutor({ routeFor: () => route, openOne: emptySearch, now: () => NOW })({
  obligation: scheduledFixture(obligation, NOW_MS), routeTaskId: "rt-search", workItemId: "wi-search", attemptId: "at-search",
} as Parameters<ReturnType<typeof routeExecutor>>[0]);

test("an empty search answer is a miss for that query, disposed as walked with no yield, not retried as a failure", async () => {
  const miss = await run(search(true));
  assert.equal(miss.kind, "DISPOSED");
  assert.equal(miss.disposition?.disposition, "WALKED_NO_YIELD");
  assert.equal(miss.disposition?.transport, "REACHABLE");
  assert.match(miss.disposition?.note ?? "", /not a fact about any government/);
  const list = await run(search(false));
  assert.equal(list.kind, "ABORTED", "a government's own empty list stays a failed extraction");
});
