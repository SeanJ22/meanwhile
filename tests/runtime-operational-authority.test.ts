import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
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
  assert.equal(latest?.outcome.state, "FAILED");
  const history = await repos.ownerDigests.read("owner-digest");
  assert.equal(history.length, 3);
  assert.equal(history[2].runtimeOutcome?.kind, "ROUTINE_CIVIC_DATA_SUPERVISOR");
});

test("runtime writers and Admin no longer use tracked operational run paths", () => {
  const files = [
    "scripts/freshness-shadow.mts",
    "scripts/nightly-window.mts",
    "scripts/pilot-runner.mts",
    "scripts/publish-owner-snapshot.mts",
    "scripts/autonomy-evidence.mts",
    "lib/control-plane/scheduler/promotion-tail.ts",
  ];
  for (const file of files) {
    const source = readFileSync(join(ROOT, file), "utf8");
    assert.doesNotMatch(source, /data\/health\/(?:freshness-shadow|nightly-window)-runs/, file);
    assert.doesNotMatch(source, /\["data",\s*"control-plane",\s*"(?:freshness-shadow|staging)"\]/, file);
  }

  const freshness = readFileSync(join(ROOT, "scripts", "freshness-shadow.mts"), "utf8");
  assert.match(freshness, /join\("\.runtime", "ops", "runner-relaunch-proof\.json"\)/);
  assert.doesNotMatch(freshness, /join\("data", "ops", "runner-relaunch-proof\.json"\)/);
  /* The canonical append precedes the cycle's local record; since 2026-09-23 that record is written through writeCycleRecord. */
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
  /* The canonical reader impact reaches the order through `orderableDueRow` (2026-09-25), which reads the obligation's own readerImpactAt. */
  assert.match(executableFreshness, /orderableDueRow\(/);
  assert.match(
    readFileSync(join(ROOT, "lib", "control-plane", "research-metrics.ts"), "utf8"),
    /readerImpactAt: row\.obligation\.readerImpactAt/,
  );
  assert.match(
    executableFreshness,
    /compareModelRows:\s*compareScoutRows/,
    "the standing caller must carry its canonical reader-impact order into runCycle's actual Scout pool",
  );
  assert.match(executableFreshness, /compareReaderImpact/);
  const shadowLoop = readFileSync(join(ROOT, "lib", "control-plane", "scheduler", "shadow-loop.ts"), "utf8");
  assert.match(
    shadowLoop,
    /modelRows\.sort\(research\.compareModelRows\)/,
    "runCycle must apply the supplied order after model-lane classification and before admission",
  );
  const nightly = readFileSync(join(ROOT, "scripts", "nightly-window.mts"), "utf8");
  assert.ok(nightly.indexOf("repos.windowRuns.append") < nightly.indexOf("writeFileSync(diagnosticPath"));

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
  assert.match(publisher, /reader-questions\.json/);
  assert.match(publisher, /control-facts\.json/);
  assert.match(publisher, /SOFTWARE GOVERNANCE inputs/);

  const maptilerDiagnostic = readFileSync(join(ROOT, "scripts", "maptiler-usage.mts"), "utf8");
  assert.match(maptilerDiagnostic, /READ_ONLY_NON_AUTHORITATIVE/);
  assert.match(maptilerDiagnostic, /collectMapTilerUsage/);
  assert.doesNotMatch(
    maptilerDiagnostic,
    /node:fs|writeFile|appendFile|createWriteStream|ownerSnapshots|data[\\/]ops[\\/]maptiler-usage\.json|owner:publish/,
    "the optional diagnostic must not write or publish mutable runtime truth",
  );
  const ownerReadback = readFileSync(join(ROOT, "scripts", "owner-surface-readback.mts"), "utf8");
  assert.match(ownerReadback, /map\.readingState/);
  assert.match(ownerReadback, /map\.latestAttemptSays/);
  assert.match(ownerReadback, /map\.actors\?\.state/);

  const adminData = readFileSync(join(ROOT, "lib", "control-plane", "admin-data.ts"), "utf8");
  assert.match(adminData, /readMapTilerUsageDigests/);

  for (const workflow of readdirSync(join(ROOT, ".github", "workflows"))) {
    const source = readFileSync(join(ROOT, ".github", "workflows", workflow), "utf8");
    assert.doesNotMatch(source, /maptiler:usage|publish-owner-snapshot/, `${workflow} invokes runtime observation from Actions`);
  }
});

test("no executable tracked-health reporter can become a second operational authority", () => {
  const packageJson = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  const scripts = packageJson.scripts ?? {};

  assert.equal(scripts["pilot:health"], undefined, "the retired tracked-health command returned");
  assert.equal(
    existsSync(join(ROOT, "scripts", "pilot-health.mts")),
    false,
    "the retired tracked-health executable returned",
  );

  const executableCommands = Object.entries(scripts)
    .filter(([, command]) => /(?:^|\s)scripts\/[^\s]+\.(?:mjs|mts|ts|ps1)(?:\s|$)/.test(command))
    .map(([name, command]) => `${name}=${command}`)
    .join("\n");
  assert.doesNotMatch(
    executableCommands,
    /pilot-health\.mts|(?:^|\n)pilot:health=/,
    "tracked health must not be exposed as a live operational command under an alias",
  );

  const trackedHealthProjectionReaders = readdirSync(join(ROOT, "scripts"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:mjs|mts|ts)$/.test(entry.name))
    .filter((entry) => /\b(?:latestReaderRun|latestControlRun)\b/.test(readFileSync(join(ROOT, "scripts", entry.name), "utf8")))
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(
    trackedHealthProjectionReaders,
    [],
    "no standing script may project tracked software-run output as live operational health",
  );
});

test("production children are hidden behind the installed runtime and local proofs stay ignored", () => {
  const packageJson = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  const scripts = packageJson.scripts ?? {};
  const retiredDirectChildren = [
    "pilot:run",
    "routine:civic-data",
    "intake:tripwire",
    "freshness:shadow:pg",
    "owner:publish",
    "readiness:publish",
    "console:publish",
  ];
  for (const name of retiredDirectChildren) {
    assert.equal(scripts[name], undefined, `${name} exposes an undurable/direct production child`);
  }
  assert.match(
    scripts["maptiler:usage"] ?? "",
    /scripts\/maptiler-usage\.mts$/,
    "maptiler:usage may exist only as the guarded read-only terminal diagnostic",
  );
  assert.match(scripts["window:run"] ?? "", /^node scripts\/installed-runtime-command\.mjs window$/);

  const runner = readFileSync(join(ROOT, "scripts", "pilot-runner.mts"), "utf8");
  assert.doesNotMatch(runner, /pnpm pilot:run|pilot:run ·/, "the retired direct runner command returned in help or output");
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
  // The method-adoption gate is retired: a CURRENT release opens its clocks
  // only after its runtime contracts applied.
  assert.match(
    runner,
    /if \(first\.state === "CURRENT"\) \{\s*if \(!await applyRuntimeContracts\(RUNNING_CODE_SHA\)\) return 2;\s*runtimeAdmissionsHeld = false;\s*startStandingRuntimeClock\(\);/,
    "a CURRENT release can open its clocks before its runtime contracts applied",
  );
  assert.doesNotMatch(runner, /args:\s*\["scripts\/apply-owner-decisions\.mts"\]/);
  assert.doesNotMatch(runner, /scripts\/scout-candidates-rederive\.mts/);

  const freshness = readFileSync(join(ROOT, "scripts", "freshness-shadow.mts"), "utf8");
  assert.ok(
    freshness.indexOf("readMethodCandidateAuthorityStatus(repos)") < freshness.indexOf("proposeScoutCandidates({"),
    "a direct Postgres research cycle can write a candidate before checking adoption",
  );

  const readback = readFileSync(join(ROOT, "scripts", "method-candidate.mts"), "utf8");
  assert.match(readback, /repos\.methodCandidates\.read\(METHOD_CANDIDATE_STORE_ID\)/);
  assert.doesNotMatch(readback, /data[\\/]method[\\/]candidates\.json|readCandidateStore/);

});
