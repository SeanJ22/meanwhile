import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { appendFreshnessCycleDetails, summarizeFreshnessIncidents, visitFreshnessCycleDetails } from "../lib/control-plane/freshness-cycle-details.ts";
import { readLatestFreshnessCycleOutcome, appendFreshnessCycleDigest } from "../lib/control-plane/freshness-cycle-outcome.ts";
import { ownerIncidentCount, type FreshnessCycleOutcome } from "../lib/control-plane/owner-surface.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { DiskRows } from "../lib/control-plane/scheduler/disk-rows.ts";
import { writeStreamedJsonSync } from "../lib/control-plane/scheduler/streamed-json.ts";

const cycle = { cycleId: "cycle:stream", finishedAt: "2026-10-20T01:00:00.000Z", testedSha: null };

test("country report rows append and replay in pages without reading ahead of an unfinished append", async () => {
  const repos = createMemoryRepositories();
  const append = repos.ownerDigests.append.bind(repos.ownerDigests);
  let produced = 0, committed = 0, pages = 0;
  repos.ownerDigests.append = async (...args) => {
    const rows = args[2].freshnessDetails!.rows;
    assert.ok(rows.length <= 32);
    assert.equal(produced - committed, rows.length);
    await Promise.resolve();
    const result = await append(...args);
    committed += rows.length; pages++;
    return result;
  };
  const rows = new DiskRows(function* () { for (let i = 0; i < 10_003; i++) { produced++; yield { id: i }; } });
  const ref = await appendFreshnessCycleDetails(repos, cycle, "dispatches", rows);
  assert.equal(ref.rows, produced);
  assert.equal(ref.pages, pages);
  let visited = 0;
  await visitFreshnessCycleDetails<{ id: number }>(repos, ref, row => { assert.equal(row.id, visited++); });
  assert.equal(visited, 10_003);
  repos.ownerDigests.readRecent = async () => [];
  await assert.rejects(visitFreshnessCycleDetails(repos, ref, () => {}), /could not be read/);
});

test("local diagnostic JSON streams nested disk views with normal JSON field semantics", () => {
  const directory = mkdtempSync(join(tmpdir(), "rh01-report-")), path = join(directory, "cycle.json");
  try {
    const rows = new DiskRows(function* () { for (let i = 0; i < 20_000; i++) yield { i, omitted: undefined }; });
    writeStreamedJsonSync(path, { rows, nested: { values: rows.map(row => row.i) }, absent: undefined, nil: null });
    const result = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(result.rows.length, 20_000);
    assert.deepEqual(result.rows[19_999], { i: 19_999 });
    assert.equal(result.nested.values[19_999], 19_999);
    assert.equal("absent" in result, false);
    assert.equal(result.nil, null);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("incident summary preserves exact counts, oldest age and next retry without carrying target rows", async () => {
  const incidents = new DiskRows(function* () {
    for (let i = 0; i < 10_000; i++) yield {
      cause: i % 2 ? "UPSTREAM_ERROR" : "NEVER_DISPATCHED", target: `place:${i}`,
      obligationsAffected: 2, oldestHours: i, nextRetryAt: i % 2 ? "2026-10-21T01:00:00Z" : "2026-10-20T01:00:00Z",
    };
  });
  const summary = summarizeFreshnessIncidents(incidents);
  assert.equal(summary.length, 2);
  assert.equal(ownerIncidentCount(summary), 10_000);
  assert.equal(summary.reduce((n, row) => n + row.obligationsAffected, 0), 20_000);
  assert.equal(summary[1].oldestHours, 9_999);
  const repos = createMemoryRepositories();
  const ref = await appendFreshnessCycleDetails(repos, cycle, "incidents", incidents);
  await appendFreshnessCycleDigest(repos, {
    lines: ["Cycle report"],
    outcome: {
      kind: "FRESHNESS_CYCLE", state: "SUCCEEDED", ...cycle, startedAt: cycle.finishedAt,
      host: "test", provider: "memory", durable: false, executor: "test", registry: null,
      obligations: 20_000, occurrencesOpened: 0, debtInherited: 20_000, debtPersisted: 20_000, debtCleared: 0,
      scheduled: 20_000, unscheduled: [], dueCount: 0, dispatched: 0, worked: [], dispositions: [], dispatchDetails: [],
      research: null, deferred: 0, debts: 20_000, incidents: ref, incidentSummary: summary,
      risk: { incidents: 10_000, debtRows: 20_000 }, health: null, promotedToReaderTruth: false, failure: null,
    } satisfies FreshnessCycleOutcome,
  });
  const latest = await readLatestFreshnessCycleOutcome(repos);
  assert.deepEqual(latest?.outcome.incidents, summary);
  assert.equal(ownerIncidentCount(latest!.outcome.incidents), 10_000);
});
