import assert from "node:assert/strict";
import test from "node:test";

import {
  LATEST_CYCLE_VERSION_SQL,
  pgLatestCycleVersionReader,
  workerVersionReading,
  type LatestCycleVersionRead,
} from "../lib/control-plane/admin-view/worker-version-read.ts";
import type { Sql } from "../lib/control-plane/repository/pg-store.ts";
import { runtimeReleaseAdoptionHash } from "../lib/control-plane/readiness/checklist-running-release-witness.ts";
import type { RunnerHeartbeat } from "../lib/control-plane/owner-surface.ts";

const served = "a".repeat(40);
const old = "b".repeat(40);
const row = { digest_id: "digest-5", cycle_id: "cycle-5", started_at: "2026-09-28T12:00:00.000Z",
  finished_at: "2026-09-28T12:10:00.000Z", written_at: "2026-09-28T12:10:01.000Z",
  tested_sha: old, state: "FAILED" };
const readyIndex = { valid: true,
  indexdef: "CREATE INDEX cp_log_owner_digests_cycle_kind_position ON cp_log_owner_digests USING btree (log_key, ((record #>> '{runtimeOutcome,kind}'::text[])), position DESC)" };

test("latest cycle read has an indexed kind/position bound and narrows identity fields", () => {
  assert.match(LATEST_CYCLE_VERSION_SQL, /log_key = \$1 AND record #>> '\{runtimeOutcome,kind\}' = 'FRESHNESS_CYCLE'/);
  assert.match(LATEST_CYCLE_VERSION_SQL, /ORDER BY position DESC LIMIT 1/);
  assert.doesNotMatch(LATEST_CYCLE_VERSION_SQL, /SELECT \*/);
  assert.doesNotMatch(LATEST_CYCLE_VERSION_SQL, /\.list\(|readRecentWhere/);
});

test("missing or invalid index is unavailable and does not scan log history", async () => {
  for (const indexes of [[], [{ ...readyIndex, valid: false }]]) {
    let calls = 0;
    const sql = { async query() { calls++; return indexes; } } as Sql;
    const result = await pgLatestCycleVersionReader(sql).read();
    assert.equal(result.available, false);
    assert.equal(result.cycle, null);
    assert.equal(calls, 1);
  }
});

test("latest append-only cycle wins over a stale heartbeat; mismatch does not prove current pending update", async () => {
  const calls: readonly unknown[][] = [];
  const observed: unknown[][] = calls as unknown[][];
  const sql = { async query(text: string, params?: readonly unknown[]) {
    observed.push([text, params]);
    return /pg_index/.test(text) ? [readyIndex] : [row];
  } } as Sql;
  const latest = await pgLatestCycleVersionReader(sql).read();
  assert.equal(latest.cycle?.testedSha, old);
  assert.deepEqual(observed[1][1], ["owner-digest"]);
  const reading = workerVersionReading({ servedSha: served, latest, heartbeat: {
    testedSha: served, beatAt: "2026-09-28T11:00:00.000Z",
  } as never });
  assert.equal(reading.lastExecutedSha, old);
  assert.equal(reading.versionRelation, "DIFFERS_FROM_LAST_CYCLE");
  assert.equal(reading.updatePending, null);
  assert.equal(reading.adoptionObservedAt, null);
  assert.match(reading.nextAdoptionPath ?? "", /normal quiescent boundary/);
});

test("matching saved cycle describes last execution only, not a current process claim", () => {
  const latest: LatestCycleVersionRead = { available: true, reason: null, cycle: {
    digestId: "digest-6", cycleId: "cycle-6", startedAt: row.started_at,
    finishedAt: row.finished_at, writtenAt: row.written_at, testedSha: served, state: "SUCCEEDED",
  } };
  const result = workerVersionReading({ servedSha: served, latest, heartbeat: null });
  assert.equal(result.versionRelation, "MATCH_LAST_CYCLE");
  assert.equal(result.updatePending, null);
  assert.equal(result.adoptionObservedAt, null);
  assert.ok(result.missingParts.includes("CURRENT_PROCESS_ADOPTION_UNPROVED"));
});

test("an exact saved adoption observation is cited at its original time, never advanced by a copied heartbeat", () => {
  const latest: LatestCycleVersionRead = { available: true, reason: null, cycle: {
    digestId: "digest-6", cycleId: "cycle-6", startedAt: row.started_at,
    finishedAt: row.finished_at, writtenAt: row.written_at, testedSha: served, state: "SUCCEEDED",
  } };
  const fields = { formatVersion: 1 as const, phase: "acquisition-to-reader-repair/phase1" as const,
    requiredBaseSha: old, baseContained: true, observedAt: "2026-09-28T11:59:00.000Z",
    processIdentity: "runner:one", runningSha: served, servedSha: served, servedHow: "GET https://example.gov/api/build",
    inspectionCode: "RUNTIME_RELEASE_CURRENT" as const, integrityReceiptId: "integrity-1", integritySha: served,
    integrityObservedAt: "2026-09-28T11:58:00.000Z" };
  const proof = { ...fields, evidenceHash: runtimeReleaseAdoptionHash(fields) };
  const heartbeat = { beatAt: "2026-09-28T12:10:02.000Z", testedSha: served, runtimeRelease: proof } as unknown as RunnerHeartbeat;
  assert.equal(workerVersionReading({ servedSha: served, latest, heartbeat }).adoptionObservedAt, fields.observedAt);
  assert.equal(workerVersionReading({ servedSha: served, latest, heartbeat: {
    ...heartbeat, beatAt: "2026-09-28T11:59:30.000Z",
  } }).adoptionObservedAt, null);
  assert.equal(workerVersionReading({ servedSha: served, latest, heartbeat: {
    ...heartbeat, runtimeRelease: { ...proof, evidenceHash: "0".repeat(64) },
  } }).adoptionObservedAt, null);
});

test("malformed newest cycle and unread store fail closed instead of falling back to an older matching cycle", async () => {
  const malformed = { ...row, tested_sha: "not-a-sha" };
  const sql = { async query(text: string) { return /pg_index/.test(text) ? [readyIndex] : [malformed]; } } as Sql;
  const result = await pgLatestCycleVersionReader(sql).read();
  assert.equal(result.available, false);
  assert.equal(result.reason, "LATEST_CYCLE_IDENTITY_INVALID");
  assert.equal(workerVersionReading({ servedSha: served, latest: result, heartbeat: null }).versionRelation, "UNKNOWN");
  const failing = { async query(text: string) {
    if (/pg_index/.test(text)) return [readyIndex];
    throw new Error("STORE_UNREACHABLE");
  } } as Sql;
  await assert.rejects(pgLatestCycleVersionReader(failing).read(), /STORE_UNREACHABLE/);
});

test("no saved cycle and unknown served SHA stay unknown, never zero or current", async () => {
  const sql = { async query(text: string) { return /pg_index/.test(text) ? [readyIndex] : []; } } as Sql;
  const latest = await pgLatestCycleVersionReader(sql).read();
  assert.equal(latest.available, true);
  assert.equal(latest.reason, "NO_SAVED_CYCLE");
  const reading = workerVersionReading({ servedSha: null, latest, heartbeat: null });
  assert.equal(reading.versionRelation, "UNKNOWN");
  assert.equal(reading.updatePending, null);
  assert.ok(reading.missingParts.includes("SERVED_BUILD_SHA_UNKNOWN"));
});
