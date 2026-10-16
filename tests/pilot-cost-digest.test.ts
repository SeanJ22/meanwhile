import assert from "node:assert/strict";
import test from "node:test";

import { costSection } from "../lib/control-plane/pilot-cost-digest.ts";
import type { CacheHitRate } from "../lib/control-plane/research-metrics.ts";

const measured: CacheHitRate = {
  role: "SCOUT", cacheRead: 40867, cacheWrite: 51568, uncachedInput: 44, hitRate: 40867 / (40867 + 51568 + 44),
  repeatedPrefixTurns: 6, repeatedPrefixMisses: 0, stationaryTurns: 0, attempts: 2, measuredRows: 2, predatingRows: 0, unreportedRows: 0,
  uncachedPerAttempt: { mean: 22, max: 22 }, batchShare: 0, savedUsd: (40867 / 1_000_000) * 5 * 0.9, aggregatePricedRows: 0,
  denominator: "cacheRead over cacheRead + cacheWrite + uncachedInput across 2 measured SCOUT ledger row(s) of 2 in the window; per-turn columns from Scout steps where recorded",
};
const predating: CacheHitRate = { ...measured, role: "ADVERSARIAL_AUDITOR", measuredRows: 0, predatingRows: 3, attempts: 3, hitRate: null, uncachedPerAttempt: null, batchShare: null, savedUsd: null };

test("PC-11: a record with ledger cache rows prints the rate with its three counts, uncached per Attempt, batch share, the dollar effect, and the pre-warm", () => {
  const { lines } = costSection({
    digest: ["      cost               0.4904 over 2 measured Attempt(s) of 2 dispatched", "      BOUNDED_MODEL_WORKER 2 · $0.4904"],
    research: {
      lanes: { model: { prewarm: { status: "WARMED", at: "2026-09-06T22:00:00.000Z", cacheCreationInputTokens: 4586, cacheReadInputTokens: 0, uncachedInputTokens: 77, usd: 0.0290, durationMs: 1200 } } },
      cacheThisCycle: [measured, predating],
      scouts: [{ cost: { usd: 0.1917 } }, { cost: { usd: 0.2987 } }],
    },
  });
  const text = lines.join("\n");
  assert.match(text, /- TOTAL — 0\.4904 over 2 measured Attempt\(s\)/);
  assert.match(text, /- BY ROLE — SCOUT 2 Attempt\(s\), \$0\.4904 measured/);
  assert.match(text, /- CACHE HIT RATE — SCOUT 44\.2% \(read 40867 · write 51568 · uncached 44; zero-read turns 0 of 6; stationary-breakpoint turns 0; .*2 measured SCOUT ledger row\(s\) of 2 in the window/);
  assert.match(text, /SCOUT uncached input per Attempt mean 22 · max 22 over 2 measured row\(s\) · batch share 0\.0% of requests · caching saved \$0\.1839/);
  assert.match(text, /- CACHE HIT RATE — ADVERSARIAL_AUDITOR NOT MEASURED — 3 ledger row\(s\), 3 predate the cache fields/);
  assert.match(text, /- PRE-WARM — the static prefix \(tools \+ system\) at 2026-09-06T22:00:00.000Z: wrote 4586 · read 0 · uncached 77 · \$0\.0290 in 1200ms/);
  assert.doesNotMatch(text, /0%.*predate/, "a lane with no measured row never prints a rate");
});

test("PC-11: an older record says why the cache lines are not there, and a cycle that admitted no Scout says nothing was warmed", () => {
  const old = costSection({ digest: [], research: { scouts: [] } }).lines.join("\n");
  assert.match(old, /CACHE HIT RATE — NOT MEASURED: the cycle did not record cache rows/);
  assert.match(old, /PRE-WARM — not recorded on this record/);
  const quiet = costSection({ digest: [], research: { cacheThisCycle: [], lanes: { model: { prewarm: null } }, scouts: [] } }).lines.join("\n");
  assert.match(quiet, /no model request left a cost-ledger row this cycle/);
  assert.match(quiet, /PRE-WARM — none: no Scout was admitted/);
  const failed = costSection({ digest: [], research: { cacheThisCycle: null, lanes: { model: { prewarm: { status: "FAILED", at: "2026-09-06T22:00:00.000Z", detail: "HTTP 529: overloaded", durationMs: 40 } } }, scouts: [] } }).lines.join("\n");
  assert.match(failed, /NOT MEASURED: the cost ledger could not be re-read/);
  assert.match(failed, /PRE-WARM — FAILED at 2026-09-06T22:00:00.000Z: HTTP 529: overloaded; the Attempts ran without it/);
  const pre = costSection({ digest: [], research: { scouts: [] } }).lines.join("\n");
  assert.doesNotMatch(pre, /\d+\.\d%/);
});
