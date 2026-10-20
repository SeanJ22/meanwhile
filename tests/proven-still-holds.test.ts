import assert from "node:assert/strict";
import test from "node:test";

import { buildQueue } from "../app/(admin)/_mw/admin-v6/queue.ts";
import { updatesView } from "../lib/control-plane/admin-view/updates-read.ts";
import { v6FixesView } from "../lib/control-plane/admin-view/v6-fixes-read.ts";
import { recordAttemptsKeepingHistory } from "../lib/control-plane/fix-history.ts";
import { fixQueueView } from "../lib/control-plane/fix-queue.ts";
import { fixesInTesting, methodStandings, recheckProvenFixes } from "../lib/control-plane/fix-standing.ts";
import { ADMIN_CONFIG_ID, type AdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { updateRecords } from "../lib/control-plane/updates.ts";
import { memoryFixMap, type MethodAttempt } from "../lib/method/fix-map-record.ts";
import { methodStatistics } from "../lib/method/fix-map.ts";
import { proofFromStatistics, DEFAULT_FIX_PROOF_BAR } from "../lib/method/fix-status.ts";

const place = (i: number) => `ocd-division/country:us/state:${i % 2 ? "az" : "nm"}/county:c${i}`;
const attempt = (i: number, outcome: "SUCCEEDED" | "FAILED", at: string): MethodAttempt =>
  ({ kind: "ROUTE_RUN", attemptId: `${i}@${at}`, placeId: place(i), methodIds: ["m-1"], outcome, cause: outcome === "FAILED" ? "The page moved." : null, at });
const OLD = "2026-07-01T12:00:00.000Z";
const NOW = "2026-09-20T12:00:00.000Z";
const config = async (repos: ReturnType<typeof createMemoryRepositories>) => (await repos.adminConfig.mustRead(ADMIN_CONFIG_ID, { methodStandings: true, updates: true })).value as AdminConfig;

test("old successes cannot keep a Proven label green when today's results fail", async () => {
  const repos = createMemoryRepositories();
  const map = memoryFixMap();
  await recordAttemptsKeepingHistory(map, repos, Array.from({ length: 40 }, (_, i) => attempt(i, "SUCCEEDED", OLD)), () => "the agenda route");
  assert.equal(methodStandings(await config(repos))[0].status, "PROVEN");
  // Three new places fail now: 40 of 43 is still over the bar overall, but none of the recent tries work.
  await recordAttemptsKeepingHistory(map, repos, [40, 41, 42].map((i) => attempt(i, "FAILED", NOW)), () => "the agenda route");
  const c = await config(repos);
  const standing = methodStandings(c)[0];
  assert.equal(standing.status, "TESTING");
  const broke = updateRecords(c).filter((u) => u.id.includes(":broke:"));
  assert.equal(broke.length, 1);
  assert.match(broke[0].what, /no longer meets the proof bar on recent results\. It is back in testing: works in 40 places of 43 places tried\./);
  assert.equal(updatesView(broke, NOW).updates[0].label, "Proven, broke since Sep 20");
  const testing = v6FixesView(fixQueueView([]), [], NOW, { standings: fixesInTesting(c), bar: DEFAULT_FIX_PROOF_BAR }).testing!;
  const rows = buildQueue({ receipts: null, sends: null, hunts: null, stuck: null, doors: null, scheduled: null, fixes: { open: [], closed: [], returned: [], testing } });
  assert.deepEqual(rows.map((r) => [r.chip, r.tone, r.filter]), [["Proven, broke since Sep 20", "warn", "in-progress"]]);
});

test("the daily recheck re-measures Proven labels; one that still holds writes nothing", async () => {
  const repos = createMemoryRepositories();
  const map = memoryFixMap();
  await recordAttemptsKeepingHistory(map, repos, Array.from({ length: 6 }, (_, i) => attempt(i, "SUCCEEDED", OLD)), () => "the agenda route");
  const before = updateRecords(await config(repos)).length;
  assert.deepEqual(await recheckProvenFixes(map, repos, NOW), []);
  assert.equal(updateRecords(await config(repos)).length, before);
  // A recent failure recorded straight into the map (no attempt pass ran) is caught by the daily recheck.
  for (const i of [0, 1, 2]) await map.put({ methodId: "m-1", placeId: place(i), state: "FAILS", triedAt: NOW, attemptId: `x${i}`, cause: "moved", updatedAt: NOW });
  const told = await recheckProvenFixes(map, repos, NOW);
  assert.deepEqual(told.map((u) => u.kind), ["BROKE"]);
  assert.equal(fixesInTesting(await config(repos)).length, 1);
});

test("with no recent result, the whole map decides", () => {
  const rows = Array.from({ length: 6 }, (_, i) => ({ methodId: "m", placeId: place(i), state: "WORKS" as const, triedAt: OLD, attemptId: `${i}`, cause: null, updatedAt: OLD }));
  assert.equal(proofFromStatistics(methodStatistics(rows, new Date(Date.parse(NOW) - 30 * 86_400_000).toISOString())).status, "PROVEN");
});
