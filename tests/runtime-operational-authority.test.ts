import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  appendFreshnessCycleDigest,
  appendRoutineCivicDataSupervisorDigest,
  readLatestFreshnessCycleOutcome,
  routineCivicDataSupervisorOutcome,
} from "../lib/control-plane/freshness-cycle-outcome.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import type { FreshnessCycleOutcome } from "../lib/control-plane/owner-surface.ts";

const ROOT = process.cwd();
const T0 = "2026-09-08T12:00:00.000Z";

function outcome(cycleId: string, state: "SUCCEEDED" | "FAILED"): FreshnessCycleOutcome {
  return {
    kind: "FRESHNESS_CYCLE",
    state,
    cycleId,
    startedAt: T0,
    finishedAt: T0,
    testedSha: "a".repeat(40),
    host: "test-host",
    provider: "memory",
    durable: false,
    executor: "test",
    registry: { providers: [], registeredUnits: 1, workedUnits: 1, only: null },
    obligations: 1,
    occurrencesOpened: 1,
    debtInherited: 0,
    debtPersisted: 0,
    debtCleared: [],
    scheduled: 1,
    unscheduled: [],
    dueCount: 1,
    dispatched: 1,
    worked: ["obligation:test"],
    dispositions: [{ obligationId: "obligation:test", disposition: state === "SUCCEEDED" ? "DISCHARGED" : null, artifacts: 0 }],
    dispatchDetails: [{ obligationId: "obligation:test", attemptId: "attempt:test", outcome: state, disposition: null, detail: "source-scoped result" }],
    research: { lanes: { deterministic: { due: 1, dispatched: 1 }, model: { due: 0, dispatched: 0, deferred: 0 } } },
    deferred: 0,
    debts: 0,
    incidents: [],
    risk: { obligationsScheduled: 1, obligationsUnscheduled: 0, obligationsOverdue: 0, debtRows: 0, incidents: 0, activation: "SHADOW_NOT_ACTIVATED" },
    health: { green: state === "SUCCEEDED" },
    promotedToReaderTruth: false,
    failure: state === "FAILED" ? { code: "TEST_FAILURE", detail: "durable failure" } : null,
  };
}

test("standing and supervisor outcomes share owner history without conflating their authorities", async () => {
  const repos = createMemoryRepositories();
  await appendFreshnessCycleDigest(repos, { outcome: outcome("cycle:1", "SUCCEEDED"), lines: ["cycle one"] });
  await appendFreshnessCycleDigest(repos, { outcome: outcome("cycle:2", "FAILED"), lines: ["cycle two failed"] });
  await appendRoutineCivicDataSupervisorDigest(repos, {
    outcome: routineCivicDataSupervisorOutcome({
      cycleId: "routine-supervisor:1",
      startedAt: T0,
      finishedAt: T0,
      testedSha: null,
      host: "test-host",
      provider: repos.describe(),
      durable: repos.durable,
      attemptedTasks: 1,
      verifiedSourceSuccesses: 0,
      verifiedSourceFailures: 0,
      failures: [{ taskId: "fec-funding", code: "RECEIPT_COUNT_INVALID", detail: "child receipt missing" }],
    }),
    lines: ["routine supervisor failed without a source outcome"],
  });

  const latest = await readLatestFreshnessCycleOutcome(repos);
  assert.equal(latest?.outcome.cycleId, "cycle:2");
  assert.equal(latest?.digestId, (await repos.ownerDigests.read("owner-digest"))[1].digestId);
  assert.deepEqual(Object.keys(latest?.outcome ?? {}).sort(), ["cycleId", "incidents", "kind", "registry", "risk"]);
  const history = await repos.ownerDigests.read("owner-digest");
  assert.equal(history.length, 3);
  assert.equal(history[2].runtimeOutcome?.kind, "ROUTINE_CIVIC_DATA_SUPERVISOR");
});

test("runtime writers and Admin no longer use tracked operational run paths", () => {
  const files = [
    "scripts/freshness-shadow.mts",
    "scripts/pilot-runner.mts",
    "scripts/publish-owner-snapshot.mts",
    "lib/control-plane/scheduler/promotion-tail.ts",
  ];
  for (const file of files) {
    const source = readFileSync(join(ROOT, file), "utf8");
    assert.doesNotMatch(source, /data\/health\/(?:freshness-shadow|nightly-window)-runs/, file);
    assert.doesNotMatch(source, /\["data",\s*"control-plane",\s*"(?:freshness-shadow|staging)"\]/, file);
  }

  const freshness = readFileSync(join(ROOT, "scripts", "freshness-shadow.mts"), "utf8");
  assert.match(freshness, /join\("\.runtime", "ops", "runner-relaunch-proof\.json"\)/);
  assert.ok(freshness.indexOf("appendFreshnessCycleDigest(repos") < freshness.lastIndexOf("writeCycleRecord(runRecord)"));
  const executableFreshness = freshness
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/["'`]\s*,\s*["'`]/g, "/");
  assert.doesNotMatch(
    executableFreshness,
    /data[\\/]health[\\/](?:reader-suite-runs|reader-questions\.json)|openRedReaderQuestions|latestReaderRun/,
    "tracked software-suite evidence cannot change standing Scout ordering or runtime health",
  );
  assert.match(executableFreshness, /orderableDueRow\(/);
  assert.match(
    readFileSync(join(ROOT, "lib", "control-plane", "research-metrics.ts"), "utf8"),
    /readerImpactAt: row\.obligation\.readerImpactAt/,
  );

  const publisher = readFileSync(join(ROOT, "scripts", "publish-owner-snapshot.mts"), "utf8");
  assert.match(publisher, /readLatestFreshnessCycleOutcome\(publisherRepos\)/);
  assert.doesNotMatch(publisher, /latestFreshnessCycle|ownerDigests\.append/);
  assert.match(publisher, /collectMapTilerUsage\(\{ nowIso: NOW_ISO \}\)/);
  assert.match(publisher, /retainMapTilerLastKnownGood/);
  const maptilerAppend = publisher.indexOf("await appendMapTilerUsageCollectionDigest(");
  const ownerSnapshotPut = publisher.indexOf("await repos.ownerSnapshots.put(");
  const ownerSnapshotCas = publisher.indexOf("await repos.ownerSnapshots.compareAndSet(");
  assert.ok(maptilerAppend >= 0, "the standing publisher must persist every MapTiler attempt in canonical owner history");
  assert.ok(
    maptilerAppend < ownerSnapshotPut && maptilerAppend < ownerSnapshotCas,
    "append-only MapTiler attempt history must be durable before the replaceable current/LKG projection moves",
  );
  assert.doesNotMatch(
    publisher,
    /data[\\/]ops[\\/]maptiler-usage\.json|maptiler:usage|owner:publish/,
    "the canonical publisher must collect directly and can never fold a tracked/manual reading into Admin",
  );
  const executablePublisher = publisher
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/["'`]\s*,\s*["'`]/g, "/");
  assert.doesNotMatch(
    executablePublisher,
    /latestReaderRun|latestControlRun|data[\\/]health[\\/](?:reader-suite-runs|control-set-runs)|data[\\/]feedback[\\/]sweeps/,
    "the standing publisher cannot relabel tracked software-run or feedback-sweep output as live operational truth",
  );

  const adminData = readFileSync(join(ROOT, "lib", "control-plane", "admin-data.ts"), "utf8");
  assert.match(adminData, /readMapTilerUsageDigests/);

  for (const workflow of readdirSync(join(ROOT, ".github", "workflows"))) {
    const source = readFileSync(join(ROOT, ".github", "workflows", workflow), "utf8");
    assert.doesNotMatch(source, /maptiler:usage|publish-owner-snapshot/, `${workflow} invokes runtime observation from Actions`);
  }
});

test("production children are hidden behind the installed runtime and local proofs stay ignored", () => {
  const runner = readFileSync(join(ROOT, "scripts", "pilot-runner.mts"), "utf8");
  assert.match(runner, /standingChildEnvironment\("CONSOLE_PUBLISHER", process\.env, publisher\.name === "owner snapshot"\)/);
  assert.match(runner, /standingChildEnvironment\("INTAKE_RUNTIME"\)/);
  assert.match(runner, /"ROUTINE_SUPERVISOR"/);
});

test("the runner opens clocks without the retired method-adoption gate and invokes no tracked writer", () => {
  const runner = readFileSync(join(ROOT, "scripts", "pilot-runner.mts"), "utf8");
  const clock = runner.lastIndexOf("startStandingRuntimeClock();");
  assert.doesNotMatch(runner, /ensureMethodCandidateAuthorityAtStartup/);
  assert.ok(clock >= 0, "the standing runtime still opens its source clock");
  assert.match(runner, /const reopenStandingClock = standingRuntimeTimer !== null;[\s\S]*if \(reopenStandingClock\) startStandingRuntimeClock\(\);/);
  assert.match(
    runner,
    /if \(first\.state === "CURRENT"\) \{\s*if \(!await applyRuntimeContracts\(RUNNING_CODE_SHA\)\) return 2;\s*runtimeAdmissionsHeld = false;\s*startStandingRuntimeClock\(\);/,
    "a CURRENT release can open its clocks before its runtime contracts applied",
  );
  assert.doesNotMatch(runner, /args:\s*\["scripts\/apply-owner-decisions\.mts"\]/);
  assert.doesNotMatch(runner, /scripts\/scout-candidates-rederive\.mts/);

  const freshness = readFileSync(join(ROOT, "scripts", "freshness-shadow.mts"), "utf8");
  assert.doesNotMatch(freshness, /METHOD_CANDIDATE_AUTHORITY_NOT_ADOPTED|method-candidate-authority/,
    "the research cycle must not halt on a method-candidate adoption receipt");
});
