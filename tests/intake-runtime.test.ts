import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  collectIntakeRuntimeObservation,
  intakeRuntimeObservationCycleId,
  parseIntakeRuntimeObservation,
  projectIntakeRuntimeObservation,
} from "../lib/ops/intake-runtime.ts";
import type { Sql } from "../lib/control-plane/repository/pg-store.ts";
import {
  appendIntakeRuntimeObservationDigest,
  intakeRuntimeObservationOutcome,
} from "../lib/control-plane/freshness-cycle-outcome.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";

const observedAt = "2026-09-08T20:00:00.000Z";

function healthyRows() {
  return {
    reactionDays: [
      { day: "2026-09-05", total: 4, suspect: 0 },
      { day: "2026-09-06", total: 5, suspect: 0 },
      { day: "2026-09-07", total: 4, suspect: 0 },
    ],
    searchLogDays: [
      { day: "2026-09-05", total: 10 },
      { day: "2026-09-06", total: 11 },
      { day: "2026-09-07", total: 9 },
    ],
    searchLogCensus: [{ organic: 30, synthetic: 2, unknown: 1, author: 1, total: 34 }],
    limiterRowsRemaining: [{ count: 3 }],
    writeAlarms: [],
    writeAlarmsEver: [{ count: 2 }],
  };
}

test("a complete quiet production reading projects HEALTHY with exact denominators", () => {
  const result = projectIntakeRuntimeObservation(healthyRows(), observedAt, 2);
  assert.equal(result.outcome, "HEALTHY");
  assert.equal(result.searchLogCensus?.total, 34);
  assert.equal(result.searchLogCensus?.unaccounted, 0);
  assert.equal(result.limiterRowsPurged, 2);
  assert.equal(result.limiterRowsRemaining, 3);
  assert.equal(result.writeAlarmsInWindow, 0);
  assert.equal(result.writeAlarmsEver, 2);
});

test("a source-store anomaly is ATTENTION data, not an execution failure", () => {
  const rows = healthyRows();
  const result = projectIntakeRuntimeObservation({
    ...rows,
    reactionDays: [
      ...rows.reactionDays,
      { day: "2026-09-08", total: 80, suspect: 30 },
    ],
    writeAlarms: [{ store: "search_log", count: 1 }],
    writeAlarmsEver: [{ count: 3 }],
  }, observedAt, 0);
  assert.equal(result.outcome, "ATTENTION");
  assert.ok(result.flags.some((flag) => flag.kind === "VOLUME_SPIKE"));
  assert.ok(result.flags.some((flag) => flag.kind === "SUSPECT_SHARE"));
  assert.equal(result.writeAlarmsInWindow, 1);
});

test("an unreconciled response is UNREADABLE, never an empty healthy board", () => {
  const result = projectIntakeRuntimeObservation({
    ...healthyRows(),
    searchLogCensus: [{ organic: 10, synthetic: 10, unknown: 10, author: 10, total: 2 }],
  }, observedAt, 0);
  assert.equal(result.outcome, "UNREADABLE");
  assert.equal(result.searchLogCensus, null);
  assert.equal(result.writeAlarmsInWindow, null);
});

test("collector contains a database failure as an UNREADABLE runtime receipt", async () => {
  const sql: Sql = { query: async () => { throw new Error("offline"); } };
  const result = await collectIntakeRuntimeObservation({
    sql,
    observedAt,
    purgeExpired: async () => { throw new Error("must not matter"); },
  });
  assert.equal(result.outcome, "UNREADABLE");
  assert.match(result.detail, /no healthy verdict/i);
  assert.ok(parseIntakeRuntimeObservation(result));
});

test("receipt parser refuses a shallow object whose nested counts contradict the outcome", () => {
  const receipt = projectIntakeRuntimeObservation(healthyRows(), observedAt, 0);
  assert.ok(parseIntakeRuntimeObservation(receipt));
  assert.equal(
    parseIntakeRuntimeObservation({
      ...receipt,
      outcome: "HEALTHY",
      writeAlarmsInWindow: 5,
      writeAlarmsByStore: [{ store: "search_log", count: 1 }],
    }),
    null,
  );
  assert.equal(
    parseIntakeRuntimeObservation({ ...receipt, reactionDays: [{ day: "not-a-day", total: 1, suspect: 0 }] }),
    null,
  );
});

test("intake observations append idempotently", async () => {
  const repos = createMemoryRepositories();
  const observation = projectIntakeRuntimeObservation({
    ...healthyRows(),
    writeAlarms: [{ store: "search_log", count: 1 }],
    writeAlarmsEver: [{ count: 3 }],
  }, observedAt, 0);
  const outcome = intakeRuntimeObservationOutcome({
    startedAt: observedAt,
    finishedAt: "2026-09-08T20:01:00.000Z",
    testedSha: "a".repeat(40),
    host: "test-host",
    provider: repos.describe(),
    durable: true,
    observation,
  });
  assert.equal(outcome.cycleId, intakeRuntimeObservationCycleId("test-host", observedAt));
  const input = { outcome, lines: ["intake ATTENTION"] };
  await appendIntakeRuntimeObservationDigest(repos, input);
  await appendIntakeRuntimeObservationDigest(repos, input);
  assert.equal((await repos.ownerDigests.read("owner-digest")).length, 1, "an uncertain retry must not duplicate the observation");
});

test("malformed intake history is refused by the constructor", () => {
  const observation = projectIntakeRuntimeObservation(healthyRows(), observedAt, 0);
  assert.throws(
    () => intakeRuntimeObservationOutcome({
      startedAt: observedAt,
      finishedAt: "2026-09-08T19:59:59.000Z",
      testedSha: "a".repeat(40),
      host: "test-host",
      provider: "memory",
      durable: true,
      observation,
    }),
    /INTAKE_RUNTIME_OBSERVATION_OUTCOME_INVALID/,
  );
});

test("standing runtime persists intake receipts without Git, deploy, or software CI", () => {
  const runner = readFileSync("scripts/pilot-runner.mts", "utf8");
  const child = readFileSync("scripts/intake-tripwire.mts", "utf8");
  assert.match(runner, /new IndependentRuntimeLaneScheduler\([\s\S]*run:\s*runIntakeRuntime/);
  assert.match(runner, /appendIntakeRuntimeObservationDigest/);
  assert.ok(
    runner.indexOf("await appendIntakeRuntimeObservationDigest") < runner.indexOf("repos.runnerHeartbeat.compareAndSet"),
    "replaceable heartbeat projection must follow the append-only outcome",
  );
  assert.match(runner, /runnerHeartbeat\.compareAndSet/);
  assert.match(runner, /intakeRuntime: observation/);
  assert.match(child, /INTAKE_RUNTIME_RECEIPT=/);
  assert.doesNotMatch(child, /writeFile|docs\/intake-report|git\s+(?:add|commit|push)|push-main/);
});
