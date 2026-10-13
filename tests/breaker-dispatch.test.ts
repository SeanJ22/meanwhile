import test from "node:test";
import assert from "node:assert/strict";
import { FleetSafetyController } from "../lib/control-plane/fleet-safety.ts";
import { routeExecutor, type OpenOne } from "../lib/control-plane/scheduler/route-executor.ts";
import type { RouteDescriptor } from "../lib/control-plane/scheduler/registry.ts";
import { runPool } from "../lib/control-plane/scheduler/shadow-loop.ts";
import type { FreshnessObligation } from "../lib/control-plane/scheduler/obligation.ts";
import { scheduledFixture } from "./control-plane-fixtures.ts";

const NOW = "2026-10-13T19:00:00.000Z";
const NOW_MS = Date.parse(NOW);

test("rows for one provider run one at a time, so the second waits for the first's outcome; other providers keep going", async () => {
  const rows = ["marginalia-1", "marginalia-2", "wikimedia-1", "marginalia-3", "plain"];
  const running = new Map<string, number>();
  const order: string[] = [];
  let maximum = 0;
  await runPool(rows, rows.length, async row => {
    const key = row.split("-")[0]!;
    running.set(key, (running.get(key) ?? 0) + 1);
    maximum = Math.max(maximum, running.get("marginalia") ?? 0);
    order.push(`start ${row}`);
    await new Promise(resolve => setTimeout(resolve, 5));
    order.push(`end ${row}`);
    running.set(key, running.get(key)! - 1);
  }, undefined, undefined, row => row === "plain" ? null : row.split("-")[0]!);
  assert.equal(maximum, 1, "never two requests to one provider at once");
  assert.ok(order.indexOf("end marginalia-1") < order.indexOf("start marginalia-2"));
  assert.ok(order.indexOf("start wikimedia-1") < order.indexOf("end marginalia-1"), "another provider is not held behind it");
  assert.equal(order.filter(line => line.startsWith("end")).length, rows.length);
});

test("while a provider's breaker is open its work is held by name and never becomes an attempt; once it closes, work goes again", () => {
  let clock = NOW_MS;
  const fleet = new FleetSafetyController({ now: NOW, charges: [], clock: () => clock, circuits: [{
    provider: "https://api.marginalia.nu", condition: "transport failed: The operation was aborted due to timeout",
    firstObservedAt: NOW, workDeferred: [], eligibleAt: new Date(NOW_MS + 10 * 60_000).toISOString(), failureClass: "TRANSIENT" }] });
  const held = fleet.admitDispatch("freshness:az:candidate#candidate-marginalia-index", "https://api.marginalia.nu/public/search/x");
  assert.equal(held.admit, false);
  assert.equal(!held.admit && held.code, "PROVIDER_CIRCUIT_BROKEN");
  assert.deepEqual(fleet.admitDispatch("freshness:az:candidate#candidate-wikipedia-api", "https://api.wikimedia.org/core/v1/wikipedia/en/search/page?q=x"), { admit: true });
  assert.deepEqual(fleet.admitDispatch("plain-work"), { admit: true });
  assert.ok(fleet.snapshot(NOW).deferred.some(row => row.code === "PROVIDER_CIRCUIT_BROKEN"));
  clock = NOW_MS + 11 * 60_000;
  assert.deepEqual(fleet.admitDispatch("freshness:az:candidate#candidate-marginalia-index", "https://api.marginalia.nu/public/search/x"), { admit: true });
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
