import assert from "node:assert/strict";
import test from "node:test";
import { RELIABILITY_SQL, reliabilityView } from "../lib/control-plane/admin-view/v6-reliability-read.ts";

const row = (url: string, verdict: string, endedAt: string, blockerText: string[] = []) => ({ url, verdict, endedAt, blockerText });

test("sources are named by the dispatcher's own reducer and listed failing first, then recovered, then healthy", () => {
  const out = reliabilityView([
    row("https://ok.gov/a", "ACQUIRED", "2026-09-01T00:00:00.000Z"),
    row("https://bad.gov/a", "BLOCKED", "2026-09-01T00:00:00.000Z", ["timed out"]), row("https://bad.gov/b", "BLOCKED", "2026-09-01T01:00:00.000Z", ["timed out"]),
    row("https://flaky.gov/a", "BLOCKED", "2026-09-01T00:00:00.000Z"), row("https://flaky.gov/b", "ACQUIRED", "2026-09-01T02:00:00.000Z"),
  ]);
  assert.deepEqual(out.map((s) => [s.source, s.state, s.consecutiveFailures]), [["https://bad.gov", "failing", 2], ["https://flaky.gov", "recovering", 0], ["https://ok.gov", "healthy", 0]]);
  assert.equal(out[0].detail, "timed out");
  assert.ok(out[0].retryAt, "a failing source shows when it is tried again");
  assert.equal(out[2].retryAt, null);
});

test("one Legistar tenant is one source, not every government on the vendor", () => {
  const out = reliabilityView([row("https://webapi.legistar.com/v1/tucson/matters", "BLOCKED", "2026-09-01T00:00:00.000Z"), row("https://webapi.legistar.com/v1/mesa/matters", "ACQUIRED", "2026-09-01T00:00:00.000Z")]);
  assert.equal(out.length, 2);
});

test("the read is one bounded statement over completed plain-code reads that made a request", () => {
  assert.match(RELIABILITY_SQL, /cp_log_worker_results/);
  assert.match(RELIABILITY_SQL, /'ACQUIRER'/);
  assert.match(RELIABILITY_SQL, /COMPLETED/);
  assert.match(RELIABILITY_SQL, /blocker_codes/, "the blocker codes are projected so a robots-only refusal can be set aside by the reducer");
});

test("an old refusal recorded for robots.txt alone is not a failed attempt, but a real failure on the same source is", () => {
  const withCodes = (url: string, endedAt: string, blockerCodes: string[]) => ({ url, verdict: "BLOCKED", endedAt, blockerText: ["refused"], blockerCodes });
  const walled = reliabilityView([withCodes("https://walled.gov/a", "2026-09-01T00:00:00.000Z", ["PERMISSION_DENIED"]), withCodes("https://walled.gov/b", "2026-09-01T01:00:00.000Z", ["PERMISSION_UNKNOWN"])]);
  assert.deepEqual(walled, [], "a source whose only history is robots refusals is not listed as failing");
  const real = reliabilityView([withCodes("https://down.gov/a", "2026-09-01T00:00:00.000Z", ["PERMISSION_DENIED"]), withCodes("https://down.gov/b", "2026-09-01T01:00:00.000Z", ["TRANSPORT_FAILED"])]);
  assert.deepEqual(real.map((s) => [s.source, s.consecutiveFailures]), [["https://down.gov", 1]]);
});
