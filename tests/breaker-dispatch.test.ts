import test from "node:test";
import assert from "node:assert/strict";
import { FleetSafetyController } from "../lib/control-plane/fleet-safety.ts";
import { routeExecutor, type OpenOne } from "../lib/control-plane/scheduler/route-executor.ts";
import type { RouteDescriptor } from "../lib/control-plane/scheduler/registry.ts";
import { runPool } from "../lib/control-plane/scheduler/shadow-loop.ts";
import { providerConcurrency } from "../lib/control-plane/scheduler/provider-limits.ts";
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
    return { key, limit: providerConcurrency(key, fleet.providerState(url), hostConcurrency) };
  });
  return { most, dispatched: dispatched.length, held: held.length };
}
const circuit = (eligibleAt: string) => ({ provider: sourceReliabilityKey(LEGISTAR), condition: "transport failed: The operation was aborted due to timeout",
  firstObservedAt: NOW, workDeferred: [], eligibleAt, failureClass: "TRANSIENT" as const });

test("a healthy provider's rows run in parallel up to its limit; half-open, one at a time; open, none are sent", async () => {
  const healthy = await lane(new FleetSafetyController({ now: NOW, charges: [], clock: () => NOW_MS }), 8);
  assert.equal(healthy.most, 8, "in parallel up to the Admin setting for a host that publishes no limit");
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

  assert.equal(providerConcurrency("https://api.congress.gov", "CLOSED", 8), 83, "Congress.gov's published 5,000 an hour");
  assert.equal(providerConcurrency("https://api.congress.gov", "HALF_OPEN", 8), 1);
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
