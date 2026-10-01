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
  assert.match(RELIABILITY_SQL, /NOT IN ('PERMISSION_DENIED', 'PERMISSION_UNKNOWN')/, "an old robots-only refusal is a wall, not an outage, so it is not a failed attempt");
});
