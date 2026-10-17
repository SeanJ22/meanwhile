import { PLURAL_STATES } from "../lib/sources/plural/targets.ts";
import { REGISTRY_STATES } from "../lib/civic-data/state-scopes.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { childCrash } from "../lib/ops/fatal-line.ts";
import { runInNewContext } from "node:vm";
import { transpileModule, ScriptTarget, ModuleKind } from "typescript";

import { failedAcquisitionCandidate, fecFundingCandidate } from "../lib/civic-data/candidate-builders.ts";
import { processRegisteredRoutineCandidate, processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";
import { AUTOMATIC_REFRESH_TASKS, automaticRefreshContract } from "../lib/civic-data/automatic-refresh.ts";
import { WORKER_PUBLICATION_TASK_IDS } from "../lib/civic-data/worker-reader-contracts.ts";
import {
  ROUTINE_CLOCK_MAX_REQUESTS_PER_TASK,
  ROUTINE_CLOCK_READ_CONCURRENCY,
  ROUTINE_DATA_ADMISSION_MS,
  ROUTINE_FAILURE_DOMAIN_FRONTIER_PER_PASS,
  ROUTINE_SOURCE_TASKS,
  readRoutineTaskClocks,
  routineFailureDomainCount,
  routineFrontierPassBound,
  SITTING_WINDOW_LANE_SLOTS_PER_PASS,
  routineSupervisorCycleId,
  routineUnreceiptedSupervisorAttemptHistory,
  routineTaskDue,
  routineTaskFromContract,
  routineTaskSelection,
  routinePreSpawnDeferral,
  routineSerialLane,
  routineFailureDomainFrontier,
  routineAdmissionClock,
  ROUTINE_SERIAL_LANE_LAUNCH_MS,
} from "../lib/civic-data/runner.ts";
import { ROUTINE_SOURCE_CONTRACTS } from "../lib/civic-data/contracts.ts";
import { PEOPLE_SOURCE_CONTRACTS } from "../lib/civic-data/people-source-contracts.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "../lib/civic-data/manual-contracts.ts";
import { REGISTRATION_TARGETS } from "../lib/registration/publication.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { VALIDATION_CHECKS, type RoutineCandidate } from "../lib/civic-data/types.ts";
import { SOURCE_AUTHORITIES, authorityFor } from "../lib/civic-data/source-authority.ts";
import {
  ROUTINE_DURABLE_RECEIPT_MAX_REQUESTS,
  classifyRoutineChildOutcome,
  durableRoutineRunnerReceiptIssue,
  parseRoutineRunnerReceipt,
  printSourceRunnerReceipt,
  routineSupervisorOuterEvidence,
  successfulRoutineRunnerReceiptIssue,
  type DurableReceiptStore,
} from "../lib/civic-data/runner-receipt.ts";
import {
  appendRoutineCivicDataSupervisorDigest,
  routineCivicDataSupervisorOutcome,
  routineSupervisorCycleIsolationIssue,
} from "../lib/control-plane/freshness-cycle-outcome.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { HUNT_SOURCE_PROGRESS_LOG_KEY, OWNER_SURFACE_FORMAT_VERSION, assertAggregateOnly } from "../lib/control-plane/owner-surface.ts";
import { routineProcessSlots, workerMemoryHost } from "../lib/control-plane/workers/worker-slots.ts";
import { ROUTINE_SUPERVISOR_HISTORY_FIELDS } from "../lib/civic-data/supervisor-history.ts";
import { projectRecord } from "../lib/control-plane/repository/types.ts";

test("a pre-spawn memory deadline leaves source work queued without a missing-receipt failure or a rewritten progress row", async t => {
  const source = readFileSync("scripts/routine-civic-data-runner.mts", "utf8");
  const progressStart = source.indexOf("let sourceProgressRepos");
  const progressEnd = source.indexOf("\n}\n", progressStart) + 3;
  const start = source.indexOf("async function settlePendingRunResult(");
  const end = source.indexOf("\n// Reader delivery", start);
  const repos = createMemoryRepositories();
  const failures: unknown[] = [];
  const lines: string[] = [];
  const context = {
    laneLastEndedMs: new Map(), unsettledSourceRuns: new Set<string>(),
    startedSourceChildren: new Set(), attempted: 1,
    supervisorFailures: failures,
    console: { log: (line: string) => lines.push(line), error: (line: string) => lines.push(line) },
    safeFailure: (message: string) => message,
    boundedExecutionFailure: () => ({ taskId: "deferred", code: "CHILD_SPAWN_FAILED", detail: "WORKER_MEMORY_DEADLINE: work remains owed" }),
    parseRoutineRunnerReceipt, classifyRoutineChildOutcome, routinePreSpawnDeferral,
    controlPlaneUrlFromEnv: () => "postgres://memory", createPgRepositories: async () => repos,
    RUN_STARTED_AT: "2026-10-13T12:00:00.000Z", SUPERVISOR_CYCLE_ID: "publish-now-supervisor:host:2026-10-13T12:00:00.000Z",
    RUNNING_CODE_SHA: "a".repeat(40), HUNT_SOURCE_PROGRESS_LOG_KEY, OWNER_SURFACE_FORMAT_VERSION, assertAggregateOnly, Date,
  };
  const { recordHuntSourceProgress, settle } = runInNewContext(transpileModule(source.slice(progressStart, progressEnd) + source.slice(start, end), {
    compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.CommonJS },
  }).outputText + "\n({ recordHuntSourceProgress, settle: settlePendingRunResult });", context) as {
    recordHuntSourceProgress: (task: unknown, stage: string, detail: string) => Promise<void>;
    settle: (pending: unknown, run: unknown) => Promise<void>;
  };
  for (const kind of ["SINGLE", "MEETING_PARTITION"]) {
    const id = `worker-publication:ballot-navigation:${kind}`;
    const task = { id, sourceId: "source", scope: "US", acquisitionFailureDomain: id, contract: {},
      ownerInvocation: { publicationPending: true, requestedAt: context.RUN_STARTED_AT, instructions: ["section3-publication"] } };
    context.attempted = 1; lines.length = 0; context.unsettledSourceRuns.add(id);
    await recordHuntSourceProgress(task, "QUEUED", "Admitted to the existing source worker pool.");
    await settle({ id, kind, task }, {
      id, termination: "SPAWN_FAILED", status: null, signal: null,
      stdout: "", stderr: "", errorMessage: "WORKER_MEMORY_DEADLINE: memory wait deferred; work remains owed",
    });
    const progress = (await repos.ownerDigests.read(HUNT_SOURCE_PROGRESS_LOG_KEY))
      .filter(row => row.huntSourceProgress?.taskId === id).map(row => row.huntSourceProgress?.stage);
    t.diagnostic(JSON.stringify({ supervisorFailures: failures.length, progress, lines, attempted: context.attempted }));
    assert.equal(failures.length, 0);
    assert.deepEqual(progress, ["QUEUED"]);
    assert.equal(context.attempted, 0);
    assert.equal(lines.some(line => line.includes("RECEIPT_COUNT_INVALID")), false);
    assert.ok(lines.some(line => line.startsWith(`RCD_DEFER ${id}: WORKER_MEMORY_DEADLINE`)));
  }
});

test("only an unstarted empty-output memory deadline or spent pass budget is an unsent deferral", () => {
  const run = { id: "held", termination: "SPAWN_FAILED" as const, status: null, signal: null,
    stdout: "", stderr: "", errorMessage: "WORKER_MEMORY_DEADLINE: work remains owed" };
  assert.equal(routinePreSpawnDeferral(run, false), run.errorMessage);
  const budget = { ...run, errorMessage: "PASS_TIME_BUDGET: this pass's time is spent" };
  assert.equal(routinePreSpawnDeferral(budget, false), budget.errorMessage, "a pass out of time leaves the rest owed for the next pass");
  assert.equal(routinePreSpawnDeferral(run, true), null, "a child that started retains process/receipt failure semantics");
  for (const changed of [
    { ...run, termination: "EXITED" as const }, { ...run, termination: "TIMED_OUT" as const },
    { ...run, stdout: "RCD_RECEIPT={}" }, { ...run, stderr: "child emitted output" },
    { ...run, status: 0 }, { ...run, signal: "SIGTERM" as const },
    { ...run, errorMessage: "HTTP status 429" }, { ...run, errorMessage: "child mentioned WORKER_MEMORY_DEADLINE: later" },
  ]) assert.equal(routinePreSpawnDeferral(changed, false), null);
});

const HEAP_OOM_STDERR = [
  "<--- Last few GCs --->", "[4123:0x6a1c000]  1201833 ms: Mark-Compact 3401.2 (3445.9) -> 3398.7 (3446.1) MB",
  "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory",
  "----- Native stack trace -----", " 1: 0xb8a3c1 node::OOMErrorHandler(char const*, v8::OOMDetails const&) [node]",
].join("\n");

test("a source child killed by a heap abort is a crash; timeouts, receipts and ordinary exits are not", () => {
  const run = { id: "people-wikidata-people-ca", termination: "SPAWN_FAILED" as const, status: null, signal: "SIGABRT" as const,
    stdout: "", stderr: HEAP_OOM_STDERR, errorMessage: "Command failed" };
  assert.equal(childCrash(run), "SIGABRT — FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory");
  assert.match(childCrash({ ...run, termination: "EXITED", status: 134, signal: null })!, /^exit 134 — FATAL ERROR: Reached heap limit/);
  assert.match(childCrash({ ...run, stderr: "" })!, /^SIGABRT — no fatal line$/);
  for (const notCrash of [
    { ...run, termination: "TIMED_OUT" as const, signal: "SIGTERM" as const },
    { ...run, termination: "OUTPUT_LIMIT_EXCEEDED" as const },
    { ...run, stdout: "RCD_RECEIPT={}" },
    { ...run, termination: "EXITED" as const, status: 2, signal: null, stderr: "Error: HTTP status 503" },
    { ...run, termination: "EXITED" as const, status: 0, signal: null, stderr: "" },
  ]) assert.equal(childCrash(notCrash), null);
});

test("a crashed source child is logged by name, leaves its work owed and does not fail the pass", async () => {
  const source = readFileSync("scripts/routine-civic-data-runner.mts", "utf8");
  const progressStart = source.indexOf("let sourceProgressRepos");
  const progressEnd = source.indexOf("\n}\n", progressStart) + 3;
  const start = source.indexOf("async function settlePendingRunResult(");
  const end = source.indexOf("\n// Reader delivery", start);
  const repos = createMemoryRepositories();
  const failures: unknown[] = [];
  const lines: string[] = [];
  const doorOutcomes: unknown[][] = [];
  const crashedTasks: { taskId: string; detail: string }[] = [];
  const id = "people-wikidata-people-ca";
  const context = {
    laneLastEndedMs: new Map(), unsettledSourceRuns: new Set([id]), startedSourceChildren: new Set([id]), attempted: 1,
    supervisorFailures: failures, crashedTasks,
    console: { log: (line: string) => lines.push(line), error: (line: string) => lines.push(line) },
    safeFailure: (message: string) => message, routinePreSpawnDeferral, childCrash,
    recordTaskDoorOutcome: async (...args: unknown[]) => { doorOutcomes.push(args); },
    controlPlaneUrlFromEnv: () => "postgres://memory", createPgRepositories: async () => repos,
    RUN_STARTED_AT: "2026-10-14T13:00:00.000Z", SUPERVISOR_CYCLE_ID: "routine-civic-data-supervisor:host:2026-10-14T13:00:00.000Z",
    RUNNING_CODE_SHA: "a".repeat(40), HUNT_SOURCE_PROGRESS_LOG_KEY, OWNER_SURFACE_FORMAT_VERSION, assertAggregateOnly, Date,
  };
  const { settle } = runInNewContext(transpileModule(source.slice(progressStart, progressEnd) + source.slice(start, end), {
    compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.CommonJS },
  }).outputText + "\n({ settle: settlePendingRunResult });", context) as { settle: (pending: unknown, run: unknown) => Promise<void> };
  const task = { id, sourceId: "wikidata-people", scope: "US-CA", acquisitionFailureDomain: "routine-source:wikidata-people:ca", contract: {},
    ownerInvocation: { requestedAt: context.RUN_STARTED_AT, instructions: ["send-ca"] } };
  await settle({ id, kind: "SINGLE", task, command: ["scripts/national-people-refresh.mts", "--promote", "--state=ca", "--source=wikidata-people"] },
    { id, termination: "SPAWN_FAILED", status: null, signal: "SIGABRT", stdout: "", stderr: HEAP_OOM_STDERR, errorMessage: "Command failed" });
  assert.equal(failures.length, 0, "no supervisor failure, so the pass exits 0");
  assert.match(source, /if \(supervisorFailures\.length > 0\) process\.exitCode = 2;/);
  assert.equal(context.attempted, 1, "the crash is this task's attempt");
  assert.deepEqual(lines, [`RCD_CHILD_CRASHED ${id} (national-people-refresh.mts): SIGABRT — FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory`]);
  assert.deepEqual(JSON.parse(JSON.stringify(crashedTasks)), [{ taskId: id,
    detail: "(national-people-refresh.mts): SIGABRT — FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory" }]);
  assert.deepEqual(doorOutcomes, [[id, "FAILURE"]]);
  const progress = (await repos.ownerDigests.read(HUNT_SOURCE_PROGRESS_LOG_KEY)).map(row => row.huntSourceProgress);
  assert.equal(progress.length, 1);
  assert.equal(progress[0]!.stage, "FAILED");
  assert.match(progress[0]!.detail, /crashed \(SIGABRT — FATAL ERROR: Reached heap limit/);
});

test("a crashed task is a successful cycle's recorded attempt, and its next offer waits its retry clock", () => {
  const task = ROUTINE_SOURCE_TASKS.find(({ id }) => id === "people-wikidata-people-ca")!;
  const finishedAt = "2026-10-14T13:38:00.000Z";
  const outcome = routineCivicDataSupervisorOutcome({
    cycleId: `routine-civic-data-supervisor:host:2026-10-14T13:00:00.000Z`, startedAt: "2026-10-14T13:00:00.000Z", finishedAt,
    testedSha: "a".repeat(40), host: "host", provider: "postgres", durable: true,
    attemptedTasks: 1, verifiedSourceSuccesses: 0, verifiedSourceFailures: 0, failures: [], taskReceipts: [],
    crashedTasks: [{ taskId: task.id, detail: "(national-people-refresh.mts): SIGABRT — FATAL ERROR: Reached heap limit" }],
  });
  assert.equal(outcome.state, "SUCCEEDED");
  assert.throws(() => routineCivicDataSupervisorOutcome({ ...outcome, failures: [], taskReceipts: [], attemptedTasks: 2 }),
    /ROUTINE_SUPERVISOR_SUCCESS_RECEIPT_INCOMPLETE/, "an attempt with neither a receipt nor a recorded crash is still refused");
  const stored = projectRecord({ digestId: "d1", runtimeOutcome: outcome }, ROUTINE_SUPERVISOR_HISTORY_FIELDS);
  const history = routineUnreceiptedSupervisorAttemptHistory([stored], new Set([task.id]));
  assert.deepEqual(history.issues, []);
  assert.equal(history.attempts.get(task.id), finishedAt);
  const lastSuccess = { lastAttemptedAt: "2026-10-13T09:00:00.000Z", lastSucceededAt: "2026-10-13T09:00:00.000Z",
    lastSucceededObservedAt: "2026-10-13T09:00:00.000Z" };
  const at = (iso: string) => Date.parse(iso);
  const clock = (iso: string) => routineAdmissionClock(lastSuccess, history.attempts.get(task.id), at(iso));
  assert.equal(routineTaskDue(task, lastSuccess, at("2026-10-14T13:43:00.000Z")), true, "without the record the next pass would run it again");
  assert.equal(routineTaskDue(task, clock("2026-10-14T13:43:00.000Z"), at("2026-10-14T13:43:00.000Z")), false);
  assert.equal(routineTaskDue(task, clock("2026-10-14T14:38:00.000Z"), at("2026-10-14T14:38:00.000Z")), true, "offered again after its hour");
});

test("source refreshes are admitted daily without a Send and retry failed sources hourly", () => {
  const now = Date.parse("2026-09-30T12:00:00Z");
  for (const task of AUTOMATIC_REFRESH_TASKS) {
    assert.equal(task.ownerInvocation, undefined);
    assert.equal(automaticRefreshContract(task.id), task.id);
    assert.equal(routineTaskSelection([`--only=${task.id}`], [...ROUTINE_SOURCE_TASKS, ...AUTOMATIC_REFRESH_TASKS]).ok, true);
    assert.equal(routineTaskDue(task, undefined, now), true);
    const checked = "2026-09-29T12:00:00Z";
    assert.equal(routineTaskDue(task, { lastAttemptedAt: checked, lastSucceededAt: checked, lastSucceededObservedAt: checked }, now - 1), false);
    assert.equal(routineTaskDue(task, { lastAttemptedAt: checked, lastSucceededAt: checked, lastSucceededObservedAt: checked }, now), true);
    const failed = "2026-09-30T11:00:00Z";
    assert.equal(routineTaskDue(task, { lastAttemptedAt: failed }, now - 1), false);
    assert.equal(routineTaskDue(task, { lastAttemptedAt: failed }, now), true);
  }
});
import {
  ROUTINE_CHILD_CONCURRENCY,
  ROUTINE_CHILD_TIMEOUT_MS,
  ROUTINE_SAME_DOMAIN_CHILD_GAP_MS,
  ROUTINE_RUNNER_COORDINATION_AND_PERSISTENCE_BUDGET_MS,
  ROUTINE_RUNNER_OUTER_GRACE_MS,
  largestFailureDomainCardinality,
  routineChildPassWorstCaseMs,
  routineRunnerBoundedWorkMs,
  routineRunnerOuterTimeoutCompatible,
  routineRunnerOuterTimeoutMs,
  runBoundedChildPass,
  type BoundedChildResult,
} from "../lib/civic-data/bounded-child-pass.ts";
import { repairRoutineReaderProjectionReadback } from "../lib/civic-data/reader-verification.ts";
import {
  ROUTINE_READER_CHILD_CONCURRENCY,
  ROUTINE_READER_MEETING_TIMEOUT_MS,
  ROUTINE_READER_SINGLE_TIMEOUT_MS,
  reconcileRoutineReaderRepairDomain,
  routineReaderRepairDomains,
  selectedReaderRepairContracts,
} from "../lib/civic-data/reader-repair-protocol.ts";
import {
  STANDING_NEON_REQUEST_DEADLINE_MS,
  neonRequestDeadlineFetch,
} from "../lib/ops/neon-request-deadline.ts";
import {
  MEETING_PARTITION_CONTRACTS,
  observableRoutineContracts,
} from "../lib/civic-data/meeting-partitions.ts";
import {
  IndependentRuntimeLaneScheduler,
  runIndependentRuntimePass,
} from "../lib/ops/independent-runtime-pass.ts";
import { runBoundedWorkPool } from "../lib/ops/bounded-work-pool.ts";

const T0 = "2026-09-08T12:00:00.000Z";

test("ordinary registered doors reject authority-transfer markers without changing LKG", async () => {
  const store = new MemoryRoutineDataStore();
  const good = sourceGoodCandidate();
  const seeded = await processRegisteredRoutineCandidate(store, "fec-funding", good, T0);
  assert.ok(seeded.promoted);
  const before = await store.readPromotion(good.recordClass, good.scope);
  for (const marker of [null, {kind: "RETIRED_TRANSFER", contractId: "fec-funding"}]) {
    await assert.rejects(processRegisteredRoutineCandidate(store, "fec-funding", {...good, bootstrapImport: marker} as unknown as RoutineCandidate, T0), /TRUSTED_LKG_ADMISSION_RETIRED/);
    assert.deepEqual(await store.readPromotion(good.recordClass, good.scope), before);
  }
  const manual = MANUAL_PRODUCTION_SOURCE_CONTRACTS.find((contract) => contract.id === "ballot-navigation")!;
  const manualStore = new MemoryRoutineDataStore();
  const marked = {
    ...good, sourceId: manual.sourceId, recordClass: manual.recordClass, scope: manual.scope,
    normalization: {...good.normalization, parserVersion: manual.parserNormalizerVersion},
    bootstrapImport: {kind: "RETIRED_TRANSFER", contractId: manual.id},
  } as unknown as RoutineCandidate;
  await assert.rejects(processRegisteredManualCandidate(manualStore, "ballot-navigation", marked, T0), /TRUSTED_LKG_ADMISSION_RETIRED/);
  assert.equal(await manualStore.readPromotion(manual.recordClass, manual.scope), null);
});

test("the standing parent durably accounts for a routine child killed outside source attribution", () => {
  const cycleId = routineSupervisorCycleId("standing-host", T0);
  assert.equal(cycleId, `routine-civic-data-supervisor:standing-host:${T0}`);
  assert.throws(() => routineSupervisorCycleId("standing-host", "not-an-instant"), /STARTED_AT_INVALID/);

  const evidence = routineSupervisorOuterEvidence({
    output: [
      "RCD_PASS launching 3 isolated command(s) through a bounded pool; concurrency=1",
      "postgres://user:secret@example.invalid/private",
      "RCD_TASK fec-funding: GOOD (PROMOTED)",
      "RCD_TASK meetings:ical:body:scope: SOURCE_HELD_LKG (SOURCE_BLOCKED)",
    ].join("\n"),
    termination: "TIMED_OUT",
    exitStatus: null,
  });
  assert.deepEqual({
    attemptedTasks: evidence.attemptedTasks,
    verifiedSourceSuccesses: evidence.verifiedSourceSuccesses,
    verifiedSourceFailures: evidence.verifiedSourceFailures,
    code: evidence.code,
  }, {
    attemptedTasks: 3,
    verifiedSourceSuccesses: 1,
    verifiedSourceFailures: 1,
    code: "ROUTINE_CHILD_TIMED_OUT",
  });
  assert.doesNotMatch(evidence.detail, /user|secret|example\.invalid|postgres/i);
  assert.match(evidence.detail, /No source candidate, pointer, or LKG disposition was inferred/);

  const pilot = readFileSync("scripts/pilot-runner.mts", "utf8");
  assert.match(pilot, /persistOuterRoutineChildFailure\(cycleId, startedAt, run/);



  assert.match(pilot, /readRecentWhere\(DIGEST_LOG_KEY, \["digestId"\], cycleId, 20,\s*\{ runtimeOutcome: \["kind"\] \}, startedAt\)/);
  assert.match(pilot, /appendRoutineCivicDataSupervisorDigest/);
});

function sourceGoodCandidate(receipts = 10) {
  return fecFundingCandidate({
    snapshot: {
      formatVersion: 1,
      fetchedAt: T0,
      cycle: 2026,
      matchReport: { rosterMatched: 1, rosterTotal: 1, ballotMatched: 0, ballotTotal: 0 },
      candidates: [{
        dataClass: "FEC_COMMITTEE",
        fecCandidateId: "H6AZ01001",
        name: "Source-aware test candidate",
        state: "AZ",
        office: "H",
        district: "01",
        targetKeys: ["congress:test"],
        matchRoutes: ["bioguide-bridge"],
        principalCommitteeId: "C00999999",
        cycle: 2026,
        totals: {
          receipts,
          disbursements: 1,
          cashOnHand: receipts - 1,
          individualItemized: receipts,
          individualUnitemized: 0,
          smallDonorShare: 0,
          coverageEndDate: "2026-06-30",
        },
        topContributions: [],
        provenance: {
          sourceUrl: "https://api.open.fec.gov/v1/",
          sourceOrg: "Federal Election Commission",
          collectedAt: T0,
          verifiedAt: T0,
        },
      }],
      absences: [],
    },
    rawBodies: [`official FEC response bytes: receipts=${receipts}`],
    finalUrl: "https://api.open.fec.gov/v1/candidates/search/",
    retrievedAt: T0,
    excludedFacts: [],
  });
}

test("installed doors' partitions are standing tasks once: the runner never adds them beside the routine tasks that already hold them", () => {
  const ids = ROUTINE_SOURCE_TASKS.map((task) => task.id);
  assert.ok(ids.filter((id) => id.startsWith("meetings:")).length > 50, "the fixture doors are installed");
  assert.equal(new Set(ids).size, ids.length);
  const runner = readFileSync(new URL("../scripts/routine-civic-data-runner.mts", import.meta.url), "utf8");
  const standing = runner.slice(runner.indexOf("const STANDING_SOURCE_TASKS"), runner.indexOf("], process.argv.slice(2));"));
  assert.match(standing, /\.\.\.ROUTINE_SOURCE_TASKS\.filter\(\(task\) => task\.id !== MEETING_DOORS_CONTRACT_ID\)/);
  assert.doesNotMatch(standing, /MEETING_PARTITION_CONTRACTS/, "a second copy of the partitions makes every pass refuse its duplicate tasks");
});

test("the standing portfolio invokes data-plane scripts only", () => {
  const nonMeetingTasks = ROUTINE_SOURCE_TASKS.filter((task) => task.recordClass !== "MEETING");
  assert.deepEqual(nonMeetingTasks.map((task) => task.id), [
    "fec-funding",
    "nh-members",
    "az-state-legislators",
    "nj-state-legislators",
    ...PLURAL_STATES.map(state => `openstates-people-${state}`),
    ...PLURAL_STATES.map(state => `openstates-votes-${state}`),
    ...PLURAL_STATES.map(state => `legiscan-votes-${state}`),
    "nh-state-rollcalls",
    "nj-state-rollcalls",
    "census-acs-population",
    "census-geography-overlaps",
    "pima-legistar-outcomes",
    "mesa-legistar-minutes-outcomes",
    "dotgov",
    // One registration per FIPS state, DC and territory, each its own data-plane script invocation.
    ...REGISTRATION_TARGETS.map(({ contractId }) => contractId),
    "meeting-body-crosswalk-derived",
    "meeting-doors",
    "meeting-source-wiring",
    ...REGISTRY_STATES.map(state => `candidate-campaign-sites-derived:${state}`),
    "usaspending",
    "federal-audit-clearinghouse",
    "sam-gov-entities",
    "openfema",
    "legiscan-bulk",
    "google-civic-voterinfo",
    ...PEOPLE_SOURCE_CONTRACTS.map(contract => contract.id),
    "socrata-discovery",
    "epa-echo",
    "congress-api", "govinfo", "regulations-gov", "federal-register", "senate-lda",
  ]);
  assert.deepEqual(nonMeetingTasks.map((task) => task.id), ROUTINE_SOURCE_CONTRACTS.map((contract) => contract.id));
  assert.deepEqual(
    ROUTINE_SOURCE_TASKS.filter((task) => task.recordClass === "MEETING").map((task) => task.id),
    MEETING_PARTITION_CONTRACTS.map((contract) => contract.id),
  );
  assert.deepEqual(ROUTINE_SOURCE_TASKS.map((task) => task.contract), observableRoutineContracts());
  assert.ok(
    ROUTINE_SOURCE_TASKS.every((task) => task.acquisitionFailureDomain.length > 0),
    "every routine child declares its real acquisition failure domain",
  );
  const newburyIcal = ROUTINE_SOURCE_TASKS.find((task) =>
    task.id.includes("meetings:ical:") && task.id.includes("newbury_town"),
  );
  const newburySchedule = ROUTINE_SOURCE_TASKS.find((task) =>
    task.id.includes("meetings:schedulepage:") && task.id.includes("newbury_town"),
  );
  const wilmotIcal = ROUTINE_SOURCE_TASKS.find((task) =>
    task.id.includes("meetings:ical:") && task.id.includes("wilmot_town"),
  );
  assert.ok(newburyIcal && newburySchedule && wilmotIcal);
  assert.equal(
    newburyIcal.acquisitionFailureDomain,
    newburySchedule.acquisitionFailureDomain,
    "different adapters sharing one publisher host share its bounded lane",
  );
  assert.notEqual(
    newburyIcal.acquisitionFailureDomain,
    wilmotIcal.acquisitionFailureDomain,
    "the generic iCal adapter does not serialize unrelated publisher hosts",
  );
  const commands = ROUTINE_SOURCE_TASKS.flatMap((task) => task.command).join(" ");
  assert.doesNotMatch(commands, /(?:^|\s)(?:git|gh|next|netlify|playwright)(?:\s|$)|\.github|browser|deploy|(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?(?:test|build)|tests[\\/]/i);
  assert.equal(new Set(ROUTINE_SOURCE_TASKS.map((task) => `${task.recordClass}:${task.scope}`)).size, ROUTINE_SOURCE_TASKS.length);
  const implementation = [
    "scripts/routine-civic-data-runner.mts",
    ...ROUTINE_SOURCE_TASKS.map((task) => task.command[0]),
  ].map((path) => readFileSync(path, "utf8")).join("\n");
  const executableImplementation = implementation
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(implementation, /test\.meanwhileusa\.com/);
  assert.doesNotMatch(executableImplementation, /spawnSync\([^)]*(?:git|gh|next|netlify|browser)/i);
  assert.doesNotMatch(executableImplementation, /office-opening-spell|tests[\\/][^\s"'`]+\.test\.[cm]?[jt]s|spawnSync\([^)]*(?:pnpm|npm|yarn|bun)[^)]*(?:test|build)|--test/i);
});

test("one canonical registry owns every supported authority and refuses arbitrary gov hosts", () => {
  const supportingResearchAuthorities = [
    "census-bulk-products",
    "az-legislature",
    "nj-legislature",
    "legiscan",
    "legiscan-bills",
    "plural-openstates",
    "meetings-history",
    "door-outcomes",
  ];
  const expectedAuthorities = new Set([
    ...observableRoutineContracts().map((contract) => contract.sourceId),
    ...MANUAL_PRODUCTION_SOURCE_CONTRACTS.map((contract) => contract.sourceId),
    ...supportingResearchAuthorities,
  ]);
  assert.deepEqual(Object.keys(SOURCE_AUTHORITIES).sort(), [...expectedAuthorities].sort());
  for (const [id, source] of Object.entries(SOURCE_AUTHORITIES)) {
    assert.equal(source.id, id);
    assert.ok(source.publisher);
    if (source.routePrefixes.length === 0) {
      assert.ok(
        ("manualReceiptPromotion" in source && source.manualReceiptPromotion) ||
          ("derivedPromotion" in source && source.derivedPromotion && source.derivedPromotion.inputKinds.length > 0),
        `${id} needs an explicit receipt or derived-input policy when it has no globally trusted route`,
      );
    }
    assert.ok(source.jurisdictions.length && source.recordClasses.length && source.competentFacts !== undefined);
    assert.ok(source.expectedIdentifierKeys.length && source.expectedTemporalFields.length);
    assert.ok(source.horizonSemantics && source.parserVersion && source.freshnessExpectation);
  }
  const arbitrary = authorityFor("az-legislature", "STATE_ROLL_CALL", "https://example.gov/roll/1");
  assert.equal(arbitrary.ok, false);
  if (!arbitrary.ok) assert.equal(arbitrary.code, "FINAL_ROUTE_NOT_REGISTERED");
  const intermediary = authorityFor("legiscan", "STATE_ROLL_CALL", "https://api.legiscan.com/?op=getRollCall&id=1");
  // Bill datasets are their own source and are not competent for roll calls.
  const billIntermediary = authorityFor("legiscan-bills", "STATE_ROLL_CALL", "https://api.legiscan.com/?op=getRollCall&id=1");
  assert.equal(billIntermediary.ok, false);
  if (!billIntermediary.ok) assert.equal(billIntermediary.code, "SOURCE_NOT_COMPETENT_FOR_RECORD_CLASS");
  assert.equal(intermediary.ok, true);
  assert.equal(SOURCE_AUTHORITIES.legiscan.routineAutoPromotion, true);
  assert.ok(SOURCE_AUTHORITIES.legiscan.competentFacts.includes("exact native member positions"));
});

test("routine release output labels the seven-zero constant as structural, never observed", () => {
  assert.deepEqual(ZERO_RELEASE_EVENTS, {
    testSitePromotions: 0,
    gitDataCommits: 0,
    pullRequests: 0,
    githubActionsRuns: 0,
    netlifyDeploys: 0,
    nextBuilds: 0,
    fullSiteBrowserWalks: 0,
  });
  for (const path of [
    "scripts/fetch-fec.mts",
    "scripts/nh-gencourt-members.mts",
    "scripts/acs-population-promote.mts",
    "scripts/ingest.ts",
    "scripts/fetch-dotgov.mts",
    "scripts/routine-civic-data-runner.mts",
  ]) {
    const source = readFileSync(path, "utf8");
    if (source.includes('import { printSourceRunnerReceipt }')) {
      assert.match(readFileSync("lib/civic-data/runner-receipt.ts", "utf8"), /structuralReleaseContract:\s*ZERO_RELEASE_EVENTS/);
      assert.match(source, /printSourceRunnerReceipt\([^;]+\);/, `${path} must emit the shared structural receipt`);
    } else assert.match(source, /structuralReleaseContract:\s*ZERO_RELEASE_EVENTS/, `${path} must label the constant as structural`);
    assert.doesNotMatch(source, /\breleaseEvents:\s*ZERO_RELEASE_EVENTS/, `${path} must not report a constant as observed release events`);
  }

});

test("cadence and retry are source-local", () => {
  const [fec, nh, census] = ROUTINE_SOURCE_TASKS;
  const now = Date.parse("2026-09-07T12:00:00.000Z");
  const oneHour = 60 * 60 * 1_000;
  assert.equal(routineTaskDue(fec, undefined, now), true);
  assert.equal(routineTaskDue(fec, { lastAttemptedAt: new Date(now - oneHour).toISOString() }, now), false);
  assert.equal(routineTaskDue(fec, { lastAttemptedAt: new Date(now - 7 * oneHour).toISOString() }, now), true);
  assert.equal(routineTaskDue(fec, {
    lastAttemptedAt: new Date(now - oneHour).toISOString(),
    lastSucceededAt: new Date(now - 8 * 24 * oneHour).toISOString(),
  }, now), false, "a failed due refresh waits for the FEC-specific retry interval");
  assert.equal(routineTaskDue(fec, {
    lastAttemptedAt: new Date(now - 7 * oneHour).toISOString(),
    lastSucceededAt: new Date(now - 8 * 24 * oneHour).toISOString(),
  }, now), true, "the failed source becomes due when its own retry interval elapses");
  assert.equal(routineTaskDue(nh, { lastAttemptedAt: new Date(now - 2 * oneHour).toISOString(), lastSucceededAt: new Date(now - 2 * oneHour).toISOString(), lastSucceededObservedAt: new Date(now - 2 * oneHour).toISOString() }, now), false);
  assert.equal(routineTaskDue(census, { lastAttemptedAt: new Date(now - 31 * 24 * oneHour).toISOString(), lastSucceededAt: new Date(now - 31 * 24 * oneHour).toISOString(), lastSucceededObservedAt: new Date(now - 31 * 24 * oneHour).toISOString() }, now), true);
  assert.equal(routineTaskDue(fec, { lastAttemptedAt: new Date(now + oneHour).toISOString() }, now), true, "a future attempt cannot suppress a due source");
  assert.equal(routineTaskDue(fec, { lastAttemptedAt: new Date(now - oneHour).toISOString(), lastSucceededAt: new Date(now + oneHour).toISOString(), lastSucceededObservedAt: new Date(now + oneHour).toISOString() }, now), true, "a future success cannot suppress a due source");
  const observed = new Date(now - 7 * oneHour).toISOString();
  assert.equal(routineTaskDue(fec, { lastAttemptedAt: observed, lastSucceededAt: "2025-01-01T00:00:00Z", lastSucceededObservedAt: observed }, now), false,
    "a verified unchanged release uses its successful observation for cadence, even when its evidence is old");
});

test("one unresolved child cannot suppress sibling launch or classification", async () => {
  const launched: string[] = [];
  let releaseTimedOut!: () => void;
  const timedOut = new Promise<void>((resolve) => { releaseTimedOut = resolve; });
  const goodReceipt = {
    source: "unaffected-source",
    candidateId: "unaffected-candidate",
    acquisitionSucceeded: true,
    state: "PROMOTED" as const,
    decision: "GOOD" as const,
    promotedVersion: "unaffected-candidate",
    lastKnownGoodVersion: "unaffected-candidate",
    structuralReleaseContract: ZERO_RELEASE_EVENTS,
  };
  const result = (
    id: string,
    over: Partial<BoundedChildResult>,
  ): BoundedChildResult => ({
    id,
    status: 0,
    signal: null,
    stdout: "",
    stderr: "",
    termination: "EXITED",
    errorMessage: null,
    ...over,
  });

  const pass = runBoundedChildPass([
    { id: "hung-source", executable: "ignored", args: [] },
    { id: "unaffected-source", executable: "ignored", args: [] },
  ], {
    cwd: process.cwd(),
    env: process.env,
    timeoutMs: 1,
    maxBufferBytes: 1,
  }, async (command) => {
    launched.push(command.id);
    if (command.id === "hung-source") {
      await timedOut;
      return result(command.id, {
        status: null,
        signal: "SIGTERM",
        termination: "TIMED_OUT",
        errorMessage: "bounded timeout",
      });
    }
    return result(command.id, {
      stdout: `RCD_RECEIPT=${JSON.stringify(goodReceipt)}\n`,
    });
  });

  await Promise.resolve();
  assert.deepEqual(launched, ["hung-source", "unaffected-source"], "all siblings launch before the first child settles");
  releaseTimedOut();
  const results = await pass;
  assert.equal(results[0]?.termination, "TIMED_OUT");
  const unaffected = parseRoutineRunnerReceipt(results[1]?.stdout ?? "");
  assert.equal(unaffected.ok, true);
  assert.equal(classifyRoutineChildOutcome({
    parsed: unaffected,
    durableIssue: null,
    exitStatus: results[1]?.status ?? null,
    childDiagnostic: null,
  }).kind, "VERIFIED_SOURCE_SUCCESS", "the sibling remains independently classifiable after another timeout");
});

test("a launcher exception is contained as one result after every sibling starts", async () => {
  const launched: string[] = [];
  const results = await runBoundedChildPass([
    { id: "throws", executable: "ignored", args: [] },
    { id: "still-runs", executable: "ignored", args: [] },
  ], {
    cwd: process.cwd(),
    env: process.env,
  }, async (command) => {
    launched.push(command.id);
    if (command.id === "throws") throw new Error("launcher defect");
    return {
      id: command.id,
      status: 0,
      signal: null,
      stdout: "done",
      stderr: "",
      termination: "EXITED",
      errorMessage: null,
    };
  });

  assert.deepEqual(launched, ["throws", "still-runs"]);
  assert.deepEqual(results.map((result) => result.termination), ["SPAWN_FAILED", "EXITED"]);
  assert.equal(results[0]?.errorMessage, "launcher defect");
  assert.equal(results[1]?.stdout, "done");
});

test("source progress is persisted before acquisition and an unavailable progress store holds only that command", async () => {
  const events: string[] = [];
  const results = await runBoundedChildPass([
    { id: "unobservable", executable: "ignored", args: [] },
    { id: "visible", executable: "ignored", args: [] },
  ], { cwd: process.cwd(), env: { NODE_ENV: "test" }, concurrency: 1,
    onStarting: async command => {
      events.push(`progress:${command.id}`);
      if (command.id === "unobservable") throw new Error("activity store unavailable");
    },
    onSettled: async result => { events.push(`settled:${result.id}`); },
  }, async command => {
    events.push(`acquire:${command.id}`);
    return { id: command.id, status: 0, signal: null, stdout: "", stderr: "", termination: "EXITED", errorMessage: null };
  });
  assert.deepEqual(events, ["progress:unobservable", "settled:unobservable", "progress:visible", "acquire:visible", "settled:visible"]);
  assert.equal(results[0]!.termination, "SPAWN_FAILED");
  assert.equal(results[1]!.termination, "EXITED");
});

test("the source pass queues all ready commands and memory admits four measured process trees", async () => {
  const commands = Array.from({ length: 7 }, (_, index) => ({
    id: `national-place:${index}`, executable: "ignored", args: [] as string[],
  }));
  const mib = 1024 * 1024;
  const memory = routineProcessSlots({ availableBytes: () => (4 * 999 + 768) * mib,
    peakBytes: () => 999 * mib });
  const releases = new Map<string, () => void>();
  const launched: string[] = [];
  let active = 0, peakActive = 0;
  let firstWaveStarted!: () => void;
  const firstWave = new Promise<void>(resolve => { firstWaveStarted = resolve; });
  let finishFirstWave!: () => void;
  const finish = new Promise<void>(resolve => { finishFirstWave = resolve; });
  const pass = runBoundedChildPass(commands, { cwd: process.cwd(), env: process.env,
    concurrency: Math.max(1, commands.length),
    onStarting: async command => { releases.set(command.id, await memory.acquire(command.id)); },
    onSettled: result => { releases.get(result.id)?.(); releases.delete(result.id); },
  }, async command => {
    launched.push(command.id);
    peakActive = Math.max(peakActive, ++active);
    if (launched.length === 4) firstWaveStarted();
    try {
      await finish;
      return { id: command.id, status: 0, signal: null, stdout: "", stderr: "", termination: "EXITED", errorMessage: null };
    } finally { active--; }
  });
  await firstWave;
  assert.deepEqual(launched, commands.slice(0, 4).map(command => command.id));
  assert.equal(peakActive, 4, "measured RSS reservations retain the 768 MiB margin");
  finishFirstWave();
  const results = await pass;
  assert.deepEqual(launched, commands.map(command => command.id), "settlement wakes the queued commands without a four-job pass cap");
  assert.equal(peakActive, 4);
  assert.equal(releases.size, 0);
  assert.ok(results.every(result => result.termination === "EXITED"));
});

test("the fixed pool caps host load and drains queued siblings after timeout and launcher failure", async () => {
  const commands = Array.from({ length: 7 }, (_, index) => ({
    id: `source-${index}`,
    executable: "ignored",
    args: [] as string[],
  }));
  const launched: string[] = [];
  const settled: string[] = [];
  const settledOutput = new Map<string, string>();
  let active = 0;
  let peakActive = 0;
  let releaseHung!: () => void;
  const hung = new Promise<void>((resolve) => { releaseHung = resolve; });
  let allLaunched!: () => void;
  const everySiblingLaunched = new Promise<void>((resolve) => { allLaunched = resolve; });

  const pass = runBoundedChildPass(commands, {
    cwd: process.cwd(),
    env: process.env,
    concurrency: 2,
    onSettled: (result) => {
      settled.push(result.id);
      settledOutput.set(result.id, result.stdout);
      if (result.id === "source-3") throw new Error("classification defect");
    },
    discardOutputAfterSettlement: true,
  }, async (command) => {
    launched.push(command.id);
    active += 1;
    peakActive = Math.max(peakActive, active);
    if (launched.length === commands.length) allLaunched();
    try {
      if (command.id === "source-0") {
        await hung;
        return {
          id: command.id,
          status: null,
          signal: "SIGTERM",
          stdout: "",
          stderr: "bounded timeout",
          termination: "TIMED_OUT",
          errorMessage: "bounded timeout",
        };
      }
      if (command.id === "source-2") throw new Error("launcher defect");
      return {
        id: command.id,
        status: 0,
        signal: null,
        stdout: `classified ${command.id}`,
        stderr: "",
        termination: "EXITED",
        errorMessage: null,
      };
    } finally {
      active -= 1;
    }
  });

  assert.deepEqual(launched, ["source-0", "source-1"], "only the configured first wave starts while one child is hung");
  await everySiblingLaunched;
  assert.deepEqual(launched, commands.map((command) => command.id), "queued siblings continue after both normal and thrown results");
  assert.equal(peakActive, 2, "the pool never exceeds its host cap");
  releaseHung();
  const results = await pass;
  assert.deepEqual(results.map((result) => result.id), commands.map((command) => command.id), "results preserve registry order");
  assert.equal(results[0]?.termination, "TIMED_OUT");
  assert.equal(results[2]?.termination, "SPAWN_FAILED");
  assert.equal(settledOutput.get("source-6"), "classified source-6", "a queued unaffected sibling is classified before output disposal");
  assert.equal(results[3]?.settlementErrorMessage, "classification defect");
  assert.equal(settled.length, commands.length, "one classification defect cannot suppress later settlement callbacks");
  assert.ok(results.every((result) => result.stdout === "" && result.stderr === ""), "large child output is not retained after classification");
});

test("one degraded provider occupies one lane while grouped unrelated providers drain", async () => {
  const commands = [
    { id: "provider-a-1", failureDomain: "provider-a", executable: "ignored", args: [] as string[] },
    { id: "provider-a-2", failureDomain: "provider-a", executable: "ignored", args: [] as string[] },
    { id: "provider-a-3", failureDomain: "provider-a", executable: "ignored", args: [] as string[] },
    { id: "provider-b-1", failureDomain: "provider-b", executable: "ignored", args: [] as string[] },
    { id: "provider-c-1", failureDomain: "provider-c", executable: "ignored", args: [] as string[] },
    { id: "provider-d-1", failureDomain: "provider-d", executable: "ignored", args: [] as string[] },
    { id: "provider-e-1", failureDomain: "provider-e", executable: "ignored", args: [] as string[] },
  ];
  const launched: string[] = [];
  const activeByDomain = new Map<string, number>();
  let peakTotal = 0;
  let activeTotal = 0;
  let releaseDegraded!: () => void;
  const degradedPending = new Promise<void>((resolve) => { releaseDegraded = resolve; });
  let releaseFirstUnrelatedWave!: () => void;
  const firstUnrelatedWavePending = new Promise<void>((resolve) => { releaseFirstUnrelatedWave = resolve; });
  let resolveInitialWaveLaunched!: () => void;
  const initialWaveLaunched = new Promise<void>((resolve) => { resolveInitialWaveLaunched = resolve; });
  let unrelatedSettledCount = 0;
  let resolveUnrelatedSettled!: () => void;
  const unrelatedSettled = new Promise<void>((resolve) => { resolveUnrelatedSettled = resolve; });

  const pass = runBoundedChildPass(commands, {
    cwd: process.cwd(),
    env: process.env,
    concurrency: 4,
    onSettled: (result) => {
      if (!result.id.startsWith("provider-a-")) {
        unrelatedSettledCount += 1;
        if (unrelatedSettledCount === 4) resolveUnrelatedSettled();
      }
    },
  }, async (command) => {
    const domain = command.failureDomain!;
    launched.push(command.id);
    if (launched.length === 4) resolveInitialWaveLaunched();
    activeTotal += 1;
    peakTotal = Math.max(peakTotal, activeTotal);
    const activeForDomain = (activeByDomain.get(domain) ?? 0) + 1;
    activeByDomain.set(domain, activeForDomain);
    assert.equal(activeForDomain, 1, `${domain} never overlaps itself`);
    try {
      if (command.id === "provider-a-1") await degradedPending;
      if (["provider-b-1", "provider-c-1", "provider-d-1"].includes(command.id)) {
        await firstUnrelatedWavePending;
      }
      return {
        id: command.id,
        status: 0,
        signal: null,
        stdout: command.id,
        stderr: "",
        termination: "EXITED",
        errorMessage: null,
      };
    } finally {
      activeByDomain.set(domain, (activeByDomain.get(domain) ?? 1) - 1);
      activeTotal -= 1;
    }
  });

  await initialWaveLaunched;
  assert.deepEqual(
    launched,
    ["provider-a-1", "provider-b-1", "provider-c-1", "provider-d-1"],
  );
  assert.equal(peakTotal, 4, "unrelated work fills the bounded global pool");
  releaseFirstUnrelatedWave();
  await unrelatedSettled;
  assert.deepEqual(
    launched,
    ["provider-a-1", "provider-b-1", "provider-c-1", "provider-d-1", "provider-e-1"],
    "the dispatcher skips blocked same-provider work and drains every unrelated provider",
  );
  assert.equal(launched.includes("provider-a-2"), false, "a second child cannot compound the degraded provider");

  releaseDegraded();
  const results = await pass;
  assert.deepEqual(results.map((result) => result.id), commands.map((command) => command.id));
  assert.deepEqual(
    launched.slice(-2),
    ["provider-a-2", "provider-a-3"],
    "same-provider work resumes serially after the degraded child settles",
  );
});

test("failure-domain declarations and timeout bounds fail closed", () => {
  assert.equal(largestFailureDomainCardinality(["a", "a", "b"]), 2);
  assert.equal(largestFailureDomainCardinality([]), 0);
  assert.throws(() => largestFailureDomainCardinality([" "]), /FAILURE_DOMAIN_INVALID/);
  assert.throws(
    () => routineChildPassWorstCaseMs(3, 100, 2, 4),
    /FAILURE_DOMAIN_SIZE_INVALID/,
  );
});

test("standing routine data and intake launch together and one failure cannot suppress the other", async () => {
  const launched: string[] = [];
  let releaseRoutine!: () => void;
  const routinePending = new Promise<void>((resolve) => { releaseRoutine = resolve; });
  let intakeSettled!: () => void;
  const intakeDone = new Promise<void>((resolve) => { intakeSettled = resolve; });
  let passSettled = false;

  const pass = runIndependentRuntimePass([
    {
      id: "routine-civic-data",
      run: async () => {
        launched.push("routine-civic-data");
        await routinePending;
        throw new Error("routine child timed out");
      },
    },
    {
      id: "intake-runtime",
      run: async () => {
        launched.push("intake-runtime");
        intakeSettled();
      },
    },
  ]);
  void pass.then(() => { passSettled = true; });

  await intakeDone;
  assert.deepEqual(launched, ["routine-civic-data", "intake-runtime"]);
  assert.equal(passSettled, false, "the tick still owns the pending routine child and cannot overlap another tick");
  releaseRoutine();
  assert.deepEqual(await pass, [
    { id: "routine-civic-data", state: "FAILED", error: "routine child timed out" },
    { id: "intake-runtime", state: "COMPLETED", error: null },
  ]);
});

test("the standing scheduler advances a free lane on a later tick without overlapping a hung lane", async () => {
  let routineStarts = 0;
  let intakeStarts = 0;
  let intakeActive = 0;
  let intakePeak = 0;
  let releaseRoutine!: () => void;
  const routinePending = new Promise<void>((resolve) => { releaseRoutine = resolve; });
  let firstIntakeDone!: () => void;
  const firstIntake = new Promise<void>((resolve) => { firstIntakeDone = resolve; });
  let releaseSecondIntake!: () => void;
  const secondIntakePending = new Promise<void>((resolve) => { releaseSecondIntake = resolve; });
  const outcomes: string[] = [];
  const scheduler = new IndependentRuntimeLaneScheduler([
    {
      id: "routine",
      everyMs: 10,
      run: async () => {
        routineStarts += 1;
        await routinePending;
      },
    },
    {
      id: "intake",
      everyMs: 10,
      run: async () => {
        intakeStarts += 1;
        intakeActive += 1;
        intakePeak = Math.max(intakePeak, intakeActive);
        try {
          if (intakeStarts === 1) firstIntakeDone();
          else await secondIntakePending;
        } finally {
          intakeActive -= 1;
        }
      },
    },
  ], (outcome) => outcomes.push(`${outcome.id}:${outcome.state}`));

  assert.deepEqual(scheduler.tick(0, true), ["routine", "intake"]);
  await firstIntake;
  await Promise.resolve();
  assert.deepEqual(scheduler.tick(11), ["intake"], "the completed lane advances while routine remains hung");
  assert.deepEqual(scheduler.tick(22), [], "neither in-flight lane overlaps itself");
  assert.equal(routineStarts, 1);
  assert.equal(intakeStarts, 2);
  assert.equal(intakePeak, 1);

  releaseSecondIntake();
  releaseRoutine();
  await scheduler.waitForIdle();
  assert.deepEqual(outcomes.sort(), ["intake:COMPLETED", "intake:COMPLETED", "routine:COMPLETED"]);
});

test("Reader repair work drains continuously under a fixed cap after one item hangs or fails", async () => {
  const items = Array.from({ length: 8 }, (_, index) => `reader-${index}`);
  const launched: string[] = [];
  let active = 0;
  let peakActive = 0;
  let releaseHung!: () => void;
  const hung = new Promise<void>((resolve) => { releaseHung = resolve; });
  let laterReached!: () => void;
  const laterSiblingReached = new Promise<void>((resolve) => { laterReached = resolve; });

  const pass = runBoundedWorkPool(items, 3, async (item) => {
    launched.push(item);
    active += 1;
    peakActive = Math.max(peakActive, active);
    try {
      if (item === "reader-0") await hung;
      if (item === "reader-2") throw new Error("typed Reader unavailable");
      if (item === "reader-7") laterReached();
      return `checked:${item}`;
    } finally {
      active -= 1;
    }
  });

  await laterSiblingReached;
  assert.equal(launched.includes("reader-7"), true, "free workers reach the last unrelated contract while the first is hung");
  assert.ok(peakActive <= 3 && peakActive >= 2, `observed bounded active Reader work: ${peakActive}`);
  releaseHung();
  const results = await pass;
  assert.deepEqual(results.map((result) => result.index), items.map((_, index) => index));
  assert.deepEqual(results[2], { index: 2, ok: false, value: null, error: "typed Reader unavailable" });
  assert.deepEqual(results[7], { index: 7, ok: true, value: "checked:reader-7", error: null });
});

test("the real child boundary enforces both timeout and per-stream output limits", async () => {
  const results = await runBoundedChildPass([
    {
      id: "timeout",
      executable: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
    },
    {
      id: "output-limit",
      executable: process.execPath,
      args: ["-e", "process.stdout.write('x'.repeat(65536))"],
    },
    {
      id: "progressing",
      executable: process.execPath,
      args: ["-e", "let n=0; const timer=setInterval(()=>{console.log('RCD_PROGRESS='+JSON.stringify({key:'fact:'+ ++n,records:1})); if(n===7)clearInterval(timer)},1000)"],
    },
    {
      id: "unchanged",
      executable: process.execPath,
      args: ["-e", "console.log('RCD_PROGRESS='+JSON.stringify({key:'same',records:1}));setInterval(()=>console.log('RCD_PROGRESS='+JSON.stringify({key:'same',records:1})),1000)"],
    },
  ], {
    cwd: process.cwd(),
    env: process.env,
    // Allow loaded CI hosts to start Node; seven facts still outlive this idle allowance.
    timeoutMs: 5_000,
    maxBufferBytes: 1_024,
  });
  assert.equal(results[0]?.termination, "TIMED_OUT");
  assert.equal(results[1]?.termination, "OUTPUT_LIMIT_EXCEEDED");
  assert.equal(results[2]?.termination, "EXITED", "new facts keep a child working beyond its original idle allowance");
  assert.equal(results[2]?.status, 0);
  assert.equal(results[3]?.termination, "TIMED_OUT", "repeating one unchanged result is no progress");
  assert.match(results[3]!.errorMessage!, /NO_PROGRESS_PAUSED/);
});

test("national and publication source commands retain the progress-renewed timeout", async () => {
  const source = readFileSync(new URL("../scripts/routine-civic-data-runner.mts", import.meta.url), "utf8");
  const start = source.indexOf("function sourceChildCommand(");
  const end = source.indexOf("function recordSourceSettlementFailures", start);
  const snippet = transpileModule(source.slice(start, end), { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.None } }).outputText;
  const commandFor = new Function("admittedRuntimeChildEnvironment", "automaticRefreshContract", "routineSerialLane", `
    ${snippet} return sourceChildCommand;`)(() => process.env, () => null, routineSerialLane);
  const portraits = ROUTINE_SOURCE_TASKS.find(task => task.id.startsWith("people-portraits-"))!;
  assert.equal(commandFor({ id: portraits.id, kind: "SOURCE", task: portraits, command: portraits.command }).timeoutMs, 0,
    "standing portrait work overrides the parent's quiet interval so every due person finishes");
  const commands = ["national-place:85635", "worker-publication:registry-runtime-bindings:fixture"].map(id => ({
    ...commandFor({ id, kind: "SOURCE", task: { id, ownerInvocation: true, registeredContractId: id }, command: [] }),
    executable: process.execPath, args: ["-e", "setTimeout(()=>{},400)"],
  }));
  const results = await runBoundedChildPass(commands, { cwd: process.cwd(), env: process.env, timeoutMs: 100 });
  assert.deepEqual(results.map(result => result.termination), ["TIMED_OUT", "TIMED_OUT"]);
});

test("per-command child environments override the batch and never leak across siblings", async () => {
  const base = { ...process.env };
  delete base.BOUNDED_CHILD_TOKEN;
  delete base.BOUNDED_FIRST_ONLY;
  delete base.BOUNDED_SECOND_ONLY;
  const expression = "process.stdout.write(JSON.stringify([process.env.BOUNDED_CHILD_TOKEN,process.env.BOUNDED_FIRST_ONLY??null,process.env.BOUNDED_SECOND_ONLY??null]))";
  const results = await runBoundedChildPass([
    {
      id: "first-env",
      executable: process.execPath,
      args: ["-e", expression],
      env: { ...base, BOUNDED_CHILD_TOKEN: "first", BOUNDED_FIRST_ONLY: "yes" },
    },
    {
      id: "second-env",
      executable: process.execPath,
      args: ["-e", expression],
      env: { ...base, BOUNDED_CHILD_TOKEN: "second", BOUNDED_SECOND_ONLY: "yes" },
    },
  ], {
    cwd: process.cwd(),
    env: { ...base, BOUNDED_CHILD_TOKEN: "batch-must-not-leak" },
    timeoutMs: 1_000,
    maxBufferBytes: 1_024,
    concurrency: 2,
  });
  assert.deepEqual(JSON.parse(results[0]!.stdout), ["first", "yes", null]);
  assert.deepEqual(JSON.parse(results[1]!.stdout), ["second", null, "yes"]);
});

test("the Neon transport deadline aborts underlying I/O instead of abandoning a promise", async () => {
  let activeRequests = 0;
  let abortedRequests = 0;
  const neverSettlesWithoutAbort = neonRequestDeadlineFetch((_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      assert.ok(signal);
      activeRequests += 1;
      const abort = () => {
        activeRequests -= 1;
        abortedRequests += 1;
        reject(signal.reason ?? new Error("transport aborted"));
      };
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    }), 25);

  await assert.rejects(
    neverSettlesWithoutAbort("https://example.invalid/canonical-read"),
    /abort|timeout/i,
  );
  assert.equal(activeRequests, 0, "the timed-out transport has no orphaned active request");
  assert.equal(abortedRequests, 1);

  const parent = new AbortController();
  const parentCancelled = neverSettlesWithoutAbort(
    "https://example.invalid/canonical-write",
    { signal: parent.signal },
  );
  parent.abort(new Error("parent cancelled"));
  await assert.rejects(parentCancelled, /parent cancelled/);
  assert.equal(activeRequests, 0, "an upstream cancellation also reaches the underlying transport");
  assert.equal(abortedRequests, 2);
});

test("one timed-out canonical clock is isolated while ordered sibling clocks settle", async () => {
  const tasks = ROUTINE_SOURCE_TASKS.slice(0, 3);
  assert.equal(tasks.length, 3);
  const hungTaskId = tasks[1]!.id;
  let activeHungReads = 0;
  const boundedClockTransport = neonRequestDeadlineFetch((_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      assert.ok(signal);
      activeHungReads += 1;
      const abort = () => {
        activeHungReads -= 1;
        reject(signal.reason ?? new Error("clock transport aborted"));
      };
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    }), 25);

  const reads = await readRoutineTaskClocks(tasks, async (task) => {
    if (task.id === hungTaskId) {
      await boundedClockTransport("https://example.invalid/clock");
      return undefined;
    }
    return {
      lastAttemptedAt: task === tasks[0]
        ? "2026-09-08T11:00:00.000Z"
        : "2026-09-08T11:30:00.000Z",
    };
  }, 2);

  assert.deepEqual(reads.map(({ task }) => task.id), tasks.map(({ id }) => id));
  assert.equal(reads[0]?.ok, true);
  assert.equal(reads[1]?.ok, false);
  assert.match(reads[1]?.error ?? "", /abort|timeout/i);
  assert.equal(reads[2]?.ok, true, "the unrelated clock remains independently observable");
  assert.equal(activeHungReads, 0, "clock cancellation leaves no request for a later pass");
});

test("a killed Reader child is an exact delivery repair fault and cannot mutate source or LKG", async () => {
  const store = new MemoryRoutineDataStore();
  const domain = routineReaderRepairDomains().find(({ contracts }) =>
    contracts.length === 1 && contracts[0]?.id === "fec-funding");
  assert.ok(domain);
  const contract = domain.contracts[0]!;
  const seeded = await processRegisteredRoutineCandidate(store, "fec-funding", sourceGoodCandidate(), T0);
  assert.ok(seeded.promoted);
  const candidateId = seeded.candidate.candidate.id;
  const before = {
    pointer: await store.readPromotion(contract.recordClass, contract.scope),
    candidate: await store.readCandidate(candidateId),
    events: await store.events(candidateId),
  };
  const [run] = await runBoundedChildPass([{
    id: domain.id,
    executable: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
    timeoutMs: 75,
  }], {
    cwd: process.cwd(),
    env: process.env,
    timeoutMs: 5_000,
    maxBufferBytes: 1_024,
    concurrency: 1,
  });
  assert.equal(run?.termination, "TIMED_OUT", "the command-specific Reader bound overrides the broad pass bound");

  const reconciled = reconcileRoutineReaderRepairDomain(domain, run?.stdout ?? "", {
    taskId: domain.id,
    code: "READER_REPAIR_CHILD_TIMED_OUT",
    detail: "Reader process exceeded its killable deadline.",
  });
  assert.deepEqual(reconciled.references.map(({ contractId, disposition }) => ({ contractId, disposition })), [{
    contractId: "fec-funding",
    disposition: "REPAIR_FAILED",
  }]);
  assert.ok(reconciled.failures.some(({ code }) => code === "READER_READBACK_REPAIR_FAILED"));
  assert.deepEqual(await store.readPromotion(contract.recordClass, contract.scope), before.pointer);
  assert.deepEqual(await store.readCandidate(candidateId), before.candidate);
  assert.deepEqual(await store.events(candidateId), before.events);
});

test("the pilot outer bound contains the frontier (one a pass, two on a meeting lane), not a failed provider tail", () => {
  const passBound = routineFrontierPassBound();
  const admittedCommands = passBound.commandCount;
  const largestDomain = passBound.largestFailureDomainSize;
  assert.equal(largestDomain, SITTING_WINDOW_LANE_SLOTS_PER_PASS);
  assert.ok(admittedCommands > routineFailureDomainCount(), "meeting lanes take a second read a pass");
  const readerDomains = routineReaderRepairDomains();
  const bounds = {
    neonRequestDeadlineMs: STANDING_NEON_REQUEST_DEADLINE_MS,
    settlementRequestsPerCommand: ROUTINE_DURABLE_RECEIPT_MAX_REQUESTS,
    clockTaskCount: ROUTINE_SOURCE_TASKS.length,
    clockConcurrency: ROUTINE_CLOCK_READ_CONCURRENCY,
    clockRequestsPerTask: ROUTINE_CLOCK_MAX_REQUESTS_PER_TASK,
    coordinationRequests: 4,
    readerSingleDomains: readerDomains.filter(({ mode }) => mode === "SINGLE").length,
    readerSingleTimeoutMs: ROUTINE_READER_SINGLE_TIMEOUT_MS,
    readerMeetingDomains: readerDomains.filter(({ mode }) => mode === "MEETING_AGGREGATE").length,
    readerMeetingTimeoutMs: ROUTINE_READER_MEETING_TIMEOUT_MS,
    readerConcurrency: ROUTINE_READER_CHILD_CONCURRENCY,
  } as const;
  const outerTimeoutMs = routineRunnerOuterTimeoutMs(
    admittedCommands,
    largestDomain,
    bounds,
  );
  const boundedPassMs = routineChildPassWorstCaseMs(
    admittedCommands,
    ROUTINE_CHILD_TIMEOUT_MS,
    ROUTINE_CHILD_CONCURRENCY,
    largestDomain,
  );
  // A meeting lane's two reads run one after the other; the pass bound covers that chain.
  assert.ok(boundedPassMs >= Math.ceil(admittedCommands / ROUTINE_CHILD_CONCURRENCY) * ROUTINE_CHILD_TIMEOUT_MS);
  assert.ok(boundedPassMs >= largestDomain * ROUTINE_CHILD_TIMEOUT_MS);
  assert.ok(admittedCommands < ROUTINE_SOURCE_TASKS.length, "shared-provider tails are outside one pass");
  assert.equal(ROUTINE_FAILURE_DOMAIN_FRONTIER_PER_PASS, 1);
  assert.equal(ROUTINE_DATA_ADMISSION_MS, 5 * 60_000);
  assert.equal(
    routineRunnerOuterTimeoutCompatible(
      outerTimeoutMs,
      admittedCommands,
      largestDomain,
      bounds,
    ),
    true,
  );
  assert.equal(
    outerTimeoutMs,
    routineRunnerBoundedWorkMs(
      admittedCommands,
      largestDomain,
      bounds,
    ) + ROUTINE_RUNNER_COORDINATION_AND_PERSISTENCE_BUDGET_MS +
      ROUTINE_RUNNER_OUTER_GRACE_MS,
  );
  const runner = readFileSync("scripts/routine-civic-data-runner.mts", "utf8");
  const pilot = readFileSync("scripts/pilot-runner.mts", "utf8");
  assert.match(runner, /runBoundedChildPass\(/);
  assert.match(runner, /pendingRuns\.map/);
  assert.match(runner, /routineFailureDomainFrontier\(/);
  assert.match(runner, /latestUnreceiptedSupervisorAttempts\(/);
  assert.match(runner, /failureDomain:\s*pending\.task\.acquisitionFailureDomain/);
  assert.match(runner, /const sourceConcurrency = Math\.max\(1, pendingRuns\.length\)/);
  assert.match(runner, /concurrency:\s*sourceConcurrency/);
  assert.match(runner, /onSettled:\s*async \(run, index\) => settlePendingRun/);
  assert.match(runner, /discardOutputAfterSettlement:\s*true/);
  assert.doesNotMatch(runner, /waveStart|pendingWave/);
  assert.doesNotMatch(runner, /spawnSync/);
  assert.match(pilot, /runRuntimeChildren\(/);
  assert.match(pilot, /ROUTINE_DATA_ADMISSION_MS,[\s\S]*from "\.\.\/lib\/civic-data\/runner\.ts"/);
  assert.match(pilot, /id: "routine-civic-data", everyMs: ROUTINE_DATA_ADMISSION_MS/);
  assert.doesNotMatch(pilot, /ROUTINE_DATA_TIMEOUT_MS|ROUTINE_PASS_BOUND/);
});

test("the routine writer acquires its own OS singleton before store or clock access", () => {
  const runner = readFileSync("scripts/routine-civic-data-runner.mts", "utf8");
  const authority = runner.indexOf('assertRuntimeAuthority({ capabilities: ["ROUTINE_SUPERVISOR"] })');
  const singleton = runner.indexOf("await acquireProcessSingleton(");
  const writeHandle = runner.indexOf("prepareProductionCivicDataWrite()");
  const clock = runner.indexOf("store.clock(");
  assert.ok(authority > 0 && singleton > authority);
  assert.ok(writeHandle > singleton);
  assert.ok(clock > singleton);
  assert.match(runner, /ROUTINE_DATA_RUNNER_SINGLETON_PORT/);
  assert.match(runner, /ProcessSingletonHeldError/);
  assert.match(runner, /SUPERVISOR_FAILURE \(REFUSED_CONCURRENT\)/);
  assert.match(runner, /zero source candidates or clocks were written/);
  assert.match(runner, /if \(ROUTINE_DATA_PROCESS_LEASE !== null\) \{[\s\S]*prepareProductionCivicDataWrite\(\)/);
  assert.match(runner, /await ROUTINE_DATA_PROCESS_LEASE\.release\(\)/);
});

test("the standing authority envelope is narrowed independently for every runtime child", () => {
  const pilot = readFileSync("scripts/pilot-runner.mts", "utf8");
  const runner = readFileSync("scripts/routine-civic-data-runner.mts", "utf8");
  assert.ok(
    pilot.indexOf('assertRuntimeAuthority({ capabilities: ["STANDING_PARENT"] })') <
      pilot.indexOf("await acquireProcessSingleton("),
  );
  assert.match(pilot, /provider === "postgres"[\s\S]*!AUTO_RELEASE_HANDOFF[\s\S]*assertRuntimeAuthority/);
  for (const capability of [
    "RESEARCH_CYCLE",
    "CONSOLE_PUBLISHER",
    "ROUTINE_SUPERVISOR",
    "INTAKE_RUNTIME",
  ]) {
    assert.match(pilot, new RegExp(`standingChildEnvironment\\(\\s*"${capability}"`));
  }
  assert.match(runner, /capability:\s*"ROUTINE_CONTRACT",[\s\S]*contract:\s*pending\.task\.id/);
  assert.match(runner, /readerLaunch\.map[\s\S]*capability:\s*"ROUTINE_SUPERVISOR"/);
  assert.match(runner, /parentPid:\s*process\.pid/);
});

test("--only selection refuses typos and empty tokens before store access", () => {
  const all = routineTaskSelection([]);
  assert.equal(all.ok, true);
  if (all.ok) assert.equal(all.only, null);

  const selectedId = ROUTINE_SOURCE_TASKS[0]?.id;
  assert.ok(selectedId);
  const selected = routineTaskSelection([
    `--only=${selectedId},${selectedId}`,
    `--only=${selectedId}`,
  ]);
  assert.equal(selected.ok, true);
  if (selected.ok) assert.deepEqual([...selected.only ?? []], [selectedId], "duplicate ids are harmless");

  assert.deepEqual(routineTaskSelection(["--only="]), {
    ok: false,
    code: "EMPTY_ROUTINE_TASK_SELECTION",
    detail: "--only requires one or more non-empty routine source task ids",
  });
  assert.equal(routineTaskSelection([`--only=${selectedId},`]).ok, false, "every comma-delimited token is validated");
  assert.equal(routineTaskSelection(["--only=meetings"]).ok, false, "the retired aggregate meetings door cannot be selected");
  assert.deepEqual(routineTaskSelection([`--only=${selectedId},retired-or-misspelled`]), {
    ok: false,
    code: "UNKNOWN_ROUTINE_TASK_SELECTION",
    detail: "unknown or retired routine source task id(s): retired-or-misspelled",
  });

  const runner = readFileSync("scripts/routine-civic-data-runner.mts", "utf8");
  const selection = runner.indexOf("routineTaskSelection(process.argv.slice(2), [...STANDING_SOURCE_TASKS, ...WORKER_PUBLICATION_TASK_IDS.map(id => ({ id }))])");
  const publication = routineTaskSelection(["--only=registry-runtime:AZ"], [
    ...ROUTINE_SOURCE_TASKS, ...AUTOMATIC_REFRESH_TASKS, ...WORKER_PUBLICATION_TASK_IDS.map(id => ({ id })),
  ]);
  assert.equal(publication.ok, true, "targeted publication must stay selectable beside automatic refresh tasks");
  if (publication.ok) assert.deepEqual([...publication.only ?? []], ["registry-runtime:AZ"]);
  assert.match(runner, /let huntTasks: readonly RoutineSourceTask\[\] = \[\];\s*try \{\s*huntTasks = await readHuntSourceTasks\(store, supervisorFailures\);/,
    "a selected publication door must read its owed work; readHuntSourceTasks skips selected source-only passes itself");
  const refusal = runner.indexOf("if (!TASK_SELECTION.ok)");
  const singleton = runner.indexOf("await acquireProcessSingleton(");
  const writeHandle = runner.indexOf("prepareProductionCivicDataWrite()");
  const clock = runner.indexOf("store.clock(");
  assert.ok(selection > 0 && refusal > selection);
  assert.ok(singleton > refusal && writeHandle > singleton && clock > writeHandle);
  assert.match(runner, /SUPERVISOR_FAILURE \(CONFIG_REFUSED\)/);
  assert.match(runner, /const ROUTINE_DATA_PROCESS_LEASE = TASK_SELECTION\.ok \? await/);
});

test("each admitted meeting source/body contract is its own concurrent child boundary", () => {
  const runner = readFileSync("scripts/routine-civic-data-runner.mts", "utf8");
  assert.match(runner, /kind:\s*"MEETING_PARTITION"/);
  assert.match(runner, /MEETING_PARTITION_TASK_IDS\.has\(task\.id\) \? "MEETING_PARTITION" : "SINGLE"/);
  assert.match(runner, /command:\s*task\.command/);
  assert.match(runner, /dueCandidates\.push\(\{[\s\S]*?id:\s*task\.id,[\s\S]*?task,/);
  // Every admitted task, and only those, is launched, owed-soonest first (routinePassLaunchOrder).
  assert.match(runner, /for \(const \{ task \} of placeSourceLaunchOrder\(routinePassLaunchOrder\(admitted, admissionNowMs\)\)\) pendingRuns\.push\(pendingByTaskId\.get\(task\.id\)!\)/);
  assert.match(runner, /parsed\.receipts\.length !== 1/);
  assert.match(runner, /parsed\.receipts\[0\]\?\.source !== pending\.task\.id/);
  assert.doesNotMatch(runner, /--partitions=/);
  assert.doesNotMatch(runner, /kind:\s*"MEETINGS"/);
  assert.doesNotMatch(runner, /task\.id === "meetings"|ONLY\.has\("meetings"\)/);
});

test("ordinary final publication still serves all selected sources when federal minute checks are active", async () => {
  const runner = readFileSync("scripts/routine-civic-data-runner.mts", "utf8");
  const start = runner.indexOf("const finalReaderEdge =");
  const end = runner.indexOf("\nif (retirementOrigins !== null", start);
  assert.ok(runner.indexOf("await publishNowEdgeChecks?.stop();") < start && start > 0 && end > start);
  for (const publishNow of [false, true]) {
    const calls: unknown[] = [];
    const selected = [{ id: "openfema" }, { id: "congress-bulk-roster:AZ" }];
    const final = { status: "PUBLISHED", families: "all-selected" };
    const periodic = { status: "PUBLISHED", families: "periodic" };
    const context = {
      PUBLISH_NOW: publishNow, ONLY: new Set(selected.map(task => task.id)), selectedTasks: selected, store: {},
      publishNowEdgeChecks: { stop: async () => periodic, run: async () => { calls.push("periodic"); return periodic; } },
      publishSupervisorReaderEdge: async (_store: unknown, _at: string, tasks: unknown) => { calls.push(tasks); return final; },
      readerEdgeSupervisorFailure: () => null, supervisorFailures: [],
    };
    const complete = runInNewContext(transpileModule(`async function complete() {\n${runner.slice(start, end)}\nreturn readerEdge;\n}\ncomplete;`, {
      compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.CommonJS },
    }).outputText, context) as () => Promise<unknown>;
    const result = await complete();
    assert.deepEqual(calls, publishNow ? ["periodic"] : [selected]);
    assert.equal(result, publishNow ? periodic : final);
  }
});

test("Reader readback repair covers the observable registry independently of source cadence", () => {
  const runner = readFileSync("scripts/routine-civic-data-runner.mts", "utf8");
  const child = readFileSync("scripts/routine-civic-data-reader-repair.mts", "utf8");
  const protocol = readFileSync("lib/civic-data/reader-repair-protocol.ts", "utf8");
  assert.match(runner, /const readerContracts = selectedReaderRepairContracts\(/);
  assert.match(runner, /const readerDomains = routineReaderRepairDomains\(readerContracts\)/);
  assert.match(runner, /runBoundedChildPass\([\s\S]*readerLaunch\.map[\s\S]*scripts\/routine-civic-data-reader-repair\.mts/);
  assert.match(runner, /timeoutMs: domain\.timeoutMs/);
  assert.match(runner, /concurrency: ROUTINE_READER_CHILD_CONCURRENCY/);
  assert.match(runner, /reconcileRoutineReaderRepairDomain/);
  assert.match(runner, /READER_REPAIR_DENOMINATOR_MISMATCH/);
  assert.match(child, /repairRoutineReaderProjectionReadback\(store, contract/);
  assert.match(child, /repairMeetingReaderProjectionReadbacks\(/);
  // Repair composes once when needed; serving-copy publication runs independently.
  assert.match(child, /repairMeetingReaderProjectionReadbacks\([^;]*\{ aggregate, attestor \},?\s*\)/);
  assert.match(child, /const attestor = readerVerifierClosureAttestor\(\);/);
  assert.match(child, /repairRoutineReaderProjectionReadback\(store, contract, observedAt, undefined, \{ attestor \}\)/);
  assert.doesNotMatch(child, /preparePublishedMeetingSnapshot|publishReaderEdgeArtifacts/);
  assert.match(runner, /await publishNowEdgeChecks\?\.stop\(\);[\s\S]*?const finalReaderEdge = PUBLISH_NOW && publishNowEdgeChecks \? await publishNowEdgeChecks\.run\(\)\s*:\s*await publishSupervisorReaderEdge\(store, new Date\(\)\.toISOString\(\), ONLY === null \? null : selectedTasks\)/,
    "publish-now completes its serialized pointer sweep while ordinary repair keeps the selected source scope");
  const publicationChecks = runner.slice(runner.indexOf("const publishNowEdgeChecks ="), runner.indexOf("const admissionNowMs ="));
  assert.match(publicationChecks, /publishSupervisorReaderEdge\(store, new Date\(\)\.toISOString\(\), PUBLISH_NOW \? null\s*:\s*periodicFederalTasks\)/,
    "publish-now checks all promoted families while ordinary minute checks publish the selected federal sources");
  assert.equal(child.match(/readMeetingsProjection\(/g)?.length, 1, "the child composes in one place");
  assert.match(child, /serializeRoutineReaderRepairRecord/);
  assert.doesNotMatch(child, /processRegisteredRoutineCandidate|promoteMeetingPartitions|\.promote\(/);
  assert.match(runner, /RCD_READER_READBACK[\s\S]*RECORDED \$\{status\}/);
  assert.match(runner, /FAILED_BACKOFF/);
  assert.match(runner, /RCD_READER_READBACK \$\{reference\.contractId\}: CURRENT FAIL \(BACKOFF\)/);
  assert.match(runner, /readerReadbackFailures:\s*readerReadbacksRecordedFail \+ readerReadbacksCurrentFail/);
  assert.match(runner, /readerReadbackReferences:\s*RoutineCivicDataReaderReadbackReference\[\]/);
  assert.match(protocol, /disposition:\s*"REPAIR_FAILED"/);
  assert.match(runner, /readerReadback:\s*\{[\s\S]*denominator:\s*readerContracts\.length[\s\S]*references:/);
  assert.match(runner, /readerReadbackRepairFailures/);
  assert.match(protocol, /READER_READBACK_REPAIR_FAILED/);
  assert.doesNotMatch(runner, /verifiedSourceFailures\s*\+=\s*.*reader/i);
  assert.ok(
    MANUAL_PRODUCTION_SOURCE_CONTRACTS.every((contract) =>
      ROUTINE_SOURCE_TASKS.every((task) => task.id !== contract.id),
    ),
    "manual Reader-proof repair contracts must not become standing acquisition tasks",
  );
});

test("the pilot surfaces Reader failures without converting them into source or software failures", () => {
  const pilot = readFileSync("scripts/pilot-runner.mts", "utf8");
  assert.match(pilot, /line\.includes\(": RECORDED FAIL"\)/);
  assert.match(pilot, /line\.includes\(": CURRENT FAIL \(BACKOFF\)"\)/);
  assert.match(pilot, /canonical Reader delivery failure\(s\) recorded or under retry backoff/);
  assert.match(pilot, /source dispositions and LKG remain unchanged/);
});

test("the pilot awaits independently bounded routine and intake children without overlapping ticks", () => {
  const pilot = readFileSync("scripts/pilot-runner.mts", "utf8");
  assert.match(pilot, /async function runRoutineCivicData\(\): Promise<void>/);
  assert.match(pilot, /async function runIntakeRuntime\(\): Promise<void>/);
  assert.match(pilot, /runRuntimeChildren\(\[\{\s*id:\s*"routine-civic-data"/);
  assert.match(pilot, /runRuntimeChildren\(\[\{\s*id:\s*"intake-runtime"/);
  assert.doesNotMatch(pilot, /ROUTINE_DATA_TIMEOUT_MS|PUBLISH_TIMEOUT_MS/);
  assert.match(pilot, /new IndependentRuntimeLaneScheduler\(\[[\s\S]*run:\s*runRoutineCivicData[\s\S]*run:\s*runIntakeRuntime/);
  assert.match(pilot, /standingRuntimeTimer = setInterval\([\s\S]*runStandingRuntimeTick\("independent standing clock"\)/);
  assert.match(pilot, /async function runOneCycle\(owner: \{ readonly ownerIntentsUnreadable: boolean \}\): Promise</);
  assert.match(pilot, /const result = await runOneCycle\(owner\)/);
  assert.doesNotMatch(pilot, /spawnSync/);
  assert.ok(
    pilot.indexOf("standingRuntimeTimer = setInterval(") < pilot.indexOf("const result = await runOneCycle(owner)"),
    "the independent clock starts before research can remain pending",
  );
  assert.match(pilot, /clearInterval\(standingRuntimeTimer\)/);
  assert.match(pilot, /await standingRuntimeScheduler\.waitForIdle\(\)/);
});

test("the CISA government-domain contract has a Reader projection even before its first promotion", async () => {
  const dotgov = ROUTINE_SOURCE_CONTRACTS.find((contract) => contract.id === "dotgov");
  assert.ok(dotgov);
  assert.equal(dotgov.readerProjection?.id, "government-domains");
  assert.deepEqual(
    await repairRoutineReaderProjectionReadback(new MemoryRoutineDataStore(), dotgov, T0),
    { kind: "NO_PROMOTION", receipt: null },
  );
});

test("standing task construction enforces every declarative authority and validation field", () => {
  const base = ROUTINE_SOURCE_CONTRACTS[0];
  assert.equal(routineTaskFromContract(base).contract, base);
  assert.throws(() => routineTaskFromContract({
    ...base,
    authorityConstraint: { registry: "SOURCE_AUTHORITIES", sourceId: "census-data-api" },
  }), /ROUTINE_CONTRACT_AUTHORITY_MISMATCH/);
  assert.throws(() => routineTaskFromContract({ ...base, validationContract: [...VALIDATION_CHECKS].reverse() as unknown as typeof VALIDATION_CHECKS }), /ROUTINE_CONTRACT_VALIDATION_MISMATCH/);
  assert.throws(() => routineTaskFromContract({ ...base, autoPromotable: false }), /ROUTINE_CONTRACT_NOT_AUTO_PROMOTABLE/);
  assert.throws(() => routineTaskFromContract({ ...base, parserNormalizerVersion: "fec-funding\/1" }), /ROUTINE_CONTRACT_PARSER_MISMATCH/);
});

test("the routine runner derives its clock from durable candidate history", () => {
  const source = readFileSync("scripts/routine-civic-data-runner.mts", "utf8");
  assert.match(source, /readRoutineTaskClocks\([\s\S]*store\.clock\(task\.sourceId, task\.recordClass, task\.scope, task\.parserVersion\)/);
  const frozenAdmission = source.indexOf("const admissionNowMs = Date.now()");
  const clockReads = source.indexOf("const clockReads = FORCE");
  // Sitting windows are decided once, at the frozen instant, from the same reads
  // and the publisher-stated ends read in the same pass.
  const statedEnds = source.indexOf("statedSittingEndsRead(getDb())");
  const sittingSignals = source.indexOf("sittingWindowSignals(clockReads, admissionNowMs, statedEndsByTask)");
  const dueDecision = source.indexOf("routineTaskDue(task, durableClock, admissionNowMs, sittingHot, observedEveryMs)");
  assert.ok(frozenAdmission > 0 && frozenAdmission < clockReads && clockReads < statedEnds && statedEnds < sittingSignals && sittingSignals < dueDecision);
  assert.match(source, /STATED_ENDS_READ_FAILED/, "an unreadable end set is reported, and the day bound stands");
  assert.doesNotMatch(source, /routine-civic-data-runner\.json|readState\(|writeState\(/);
});

test("runner receipts are exact JSON, exact-count, and seven-zero structural evidence", () => {
  const good = {
    source: "fec-funding",
    candidateId: "candidate-1",
    acquisitionSucceeded: true,
    state: "PROMOTED",
    decision: "GOOD",
    promotedVersion: "candidate-1",
    lastKnownGoodVersion: "candidate-1",
    structuralReleaseContract: ZERO_RELEASE_EVENTS,
  };
  const parsed = parseRoutineRunnerReceipt(`diagnostic\nRCD_RECEIPT=${JSON.stringify(good)}\n`);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(successfulRoutineRunnerReceiptIssue(parsed.receipt), null);
  assert.equal(classifyRoutineChildOutcome({
    parsed,
    durableIssue: "candidate is not durable",
    exitStatus: 0,
    childDiagnostic: null,
  }).kind, "SUPERVISOR_FAILURE", "syntactically valid but non-durable output is not a source outcome");

  assert.equal(parseRoutineRunnerReceipt("RCD_RECEIPT=not-json").ok, false);
  assert.equal(parseRoutineRunnerReceipt(`RCD_RECEIPT=${JSON.stringify(good)}\nRCD_RECEIPT=${JSON.stringify(good)}`).ok, false);
  assert.equal(parseRoutineRunnerReceipt(`RCD_RECEIPT=${JSON.stringify({ ...good, structuralReleaseContract: { ...ZERO_RELEASE_EVENTS, githubActionsRuns: 1 } })}`).ok, false);
  const held = parseRoutineRunnerReceipt(`RCD_RECEIPT=${JSON.stringify({ ...good, state: "CANNOT_TELL", decision: "CANNOT_TELL", promotedVersion: null })}`);
  assert.equal(held.ok, true);
  if (held.ok) assert.match(successfulRoutineRunnerReceiptIssue(held.receipt) ?? "", /PROMOTED/);
});

test("the shared source printer reports the pointed candidate and observation for an unchanged recheck", async (t) => {
  const store = new MemoryRoutineDataStore();
  const original = sourceGoodCandidate();
  const seeded = await processRegisteredRoutineCandidate(store, "fec-funding", original, T0);
  assert.ok(seeded.promoted);
  const at = "2026-09-08T12:01:00.000Z";
  const recheck = { ...original, id: `cv-${"f".repeat(32)}`,
    retrieval: { ...original.retrieval, retrievedAt: at } };
  const outcome = await processRegisteredRoutineCandidate(store, "fec-funding", recheck, at);
  assert.ok(outcome.confirmed, "the real promotion door must take its unchanged-confirmation path");
  const printed: string[] = [];
  t.mock.method(console, "log", (line: string) => { printed.push(line); });
  printSourceRunnerReceipt("fec-funding", recheck, outcome);
  const parsed = parseRoutineRunnerReceipt(printed.join("\n"));
  assert.ok(parsed.ok);
  assert.equal(parsed.receipt.candidateId, original.id);
  assert.equal(parsed.receipt.confirmedAt, at);
  assert.equal(successfulRoutineRunnerReceiptIssue(parsed.receipt), null);
  assert.equal(await durableRoutineRunnerReceiptIssue(parsed.receipt,
    ROUTINE_SOURCE_TASKS.find(task => task.id === "fec-funding")!, store, "SUCCESS"), null);
  assert.equal(await store.readCandidateSummary(recheck.id), null, "an unchanged check never creates a candidate");
});

test("every standing source child emits its exact contract id and the supervisor persists admitted code identity", () => {
  const fixedChildren = [
    ["scripts/fetch-fec.mts", "fec-funding"],
    ["scripts/nh-gencourt-members.mts", "nh-members"],
    ["scripts/acs-population-promote.mts", "census-acs-population"],
    ["scripts/legistar-outcomes-ingest.mts", "pima-legistar-outcomes"],
    ["scripts/legistar-insite-minutes-ingest.mts", "mesa-legistar-minutes-outcomes"],
    ["scripts/fetch-dotgov.mts", "dotgov"],
  ] as const;
  for (const [path, contractId] of fixedChildren) {
    const source = readFileSync(path, "utf8");
    assert.match(
      source,
      new RegExp(`(?:RCD_RECEIPT=[\\s\\S]{0,500}?source:\\s*|printSourceRunnerReceipt\\()[\"']${contractId}[\"']`),
      `${path} must name ${contractId} in its successful protocol receipt`,
    );
  }
  for (const path of ["scripts/state-legislators.mts", "scripts/state-rollcalls.mts"]) {
    assert.match(
      readFileSync(path, "utf8"),
      /RCD_RECEIPT=[\s\S]{0,500}?source:\s*target\.contractId/,
      `${path} must bind each state invocation to its selected contract`,
    );
  }
  const failureHelper = readFileSync("lib/civic-data/source-acquisition-failure.ts", "utf8");
  assert.match(failureHelper, /source:\s*input\.contractId/);
  assert.doesNotMatch(failureHelper, /readonly sourceLabel:/);

  const runner = readFileSync("scripts/routine-civic-data-runner.mts", "utf8");
  assert.match(runner, /const ADMITTED_CODE_SHA = assertRuntimeAuthority\([\s\S]*\.sha/);
  assert.match(runner, /const RUNNING_CODE_SHA = TASK_SELECTION\.ok\s+\? ADMITTED_CODE_SHA\s+: null/);
  for (const mutation of ["await syncHeldDoors(", "await startCivicReadCacheHost("]) {
    assert.ok(runner.indexOf("const ADMITTED_CODE_SHA") < runner.indexOf(mutation), `${mutation} requires admitted code first`);
    assert.ok(runner.indexOf("const ROUTINE_DATA_PROCESS_LEASE") < runner.indexOf(mutation), `${mutation} requires the process lease first`);
  }
  assert.match(runner, /testedSha:\s*RUNNING_CODE_SHA/);
  assert.doesNotMatch(runner, /testedSha:\s*null/);
});

test("durable receipt verification rejects a publisher label in the task identity field", async () => {
  const task = ROUTINE_SOURCE_TASKS[0]!;
  const store = new MemoryRoutineDataStore();
  const good = sourceGoodCandidate();
  await processRegisteredRoutineCandidate(store, task.id, good, T0);
  const mislabeled = {
    source: "FEC OpenFEC",
    candidateId: good.id,
    acquisitionSucceeded: true,
    state: "PROMOTED" as const,
    decision: "GOOD" as const,
    promotedVersion: good.id,
    lastKnownGoodVersion: good.id,
    structuralReleaseContract: ZERO_RELEASE_EVENTS,
  };
  assert.match(
    await durableRoutineRunnerReceiptIssue(mislabeled, task, store, "SUCCESS") ?? "",
    /does not match registered task fec-funding/,
  );
});

test("same-cycle isolation requires exact task/candidate receipts, never aggregate counts", () => {
  const successReceipt = {
    source: "fec-funding",
    candidateId: "candidate-success",
    acquisitionSucceeded: true,
    state: "PROMOTED" as const,
    decision: "GOOD" as const,
    promotedVersion: "candidate-success",
    lastKnownGoodVersion: "candidate-success",
    structuralReleaseContract: ZERO_RELEASE_EVENTS,
  };
  const failedReceipt = {
    source: "dotgov",
    candidateId: "candidate-source-blocked",
    acquisitionSucceeded: false,
    state: "SOURCE_BLOCKED" as const,
    decision: "FAIL" as const,
    promotedVersion: null,
    lastKnownGoodVersion: "dotgov-lkg",
    structuralReleaseContract: ZERO_RELEASE_EVENTS,
  };
  const exact = routineCivicDataSupervisorOutcome({
    cycleId: "cycle:isolated",
    startedAt: T0,
    finishedAt: T0,
    testedSha: null,
    host: "test-host",
    provider: "memory",
    durable: true,
    attemptedTasks: 2,
    verifiedSourceSuccesses: 1,
    verifiedSourceFailures: 1,
    failures: [],
    taskReceipts: [
      {
        taskId: "fec-funding",
        sourceId: "FEC OpenFEC",
        recordClass: "FEC_FUNDING",
        scope: "federal-supported",
        classification: "VERIFIED_SOURCE_SUCCESS",
        receipt: successReceipt,
      },
      {
        taskId: "dotgov",
        sourceId: "CISA .gov registry",
        recordClass: "DOTGOV_REFERENCE",
        scope: "US:current-full:domains",
        classification: "VERIFIED_SOURCE_FAILURE",
        receipt: failedReceipt,
      },
    ],
  });
  assert.equal(exact.state, "SUCCEEDED", "a contained source failure is not a supervisor failure");
  assert.equal(routineSupervisorCycleIsolationIssue(exact), null);
  const sharedVersion = { ...exact, attemptedTasks: 2, verifiedSourceSuccesses: 2, verifiedSourceFailures: 0,
    taskReceipts: ["national-place:85635", "national-place:03060"].map(taskId => ({
      ...exact.taskReceipts[0], taskId, receipt: { ...successReceipt, source: taskId, confirmedAt: T0 } })) };
  const registeredJobs = new Set(sharedVersion.taskReceipts.map(row => row.taskId));
  assert.doesNotThrow(() => routineCivicDataSupervisorOutcome(sharedVersion),
    "the ordinary producer accepts separate jobs confirming a shared version");
  assert.throws(() => routineCivicDataSupervisorOutcome({ ...sharedVersion,
    taskReceipts: [sharedVersion.taskReceipts[0], sharedVersion.taskReceipts[0]] }), /TASK_RECEIPT_DUPLICATE/);
  const sharedHistory = routineUnreceiptedSupervisorAttemptHistory([{ id: "shared", runtimeOutcome: sharedVersion }], registeredJobs);
  assert.deepEqual(sharedHistory.issues, [], "separate exact jobs can confirm one unchanged canonical version");
  const duplicateJob = routineUnreceiptedSupervisorAttemptHistory([{ id: "duplicate", runtimeOutcome: {
    ...sharedVersion, taskReceipts: [sharedVersion.taskReceipts[0], sharedVersion.taskReceipts[0]] } }], registeredJobs);
  assert.ok(duplicateJob.issues.length > 0, "duplicating the exact job still contradicts history");

  const sameSourceOnly = routineCivicDataSupervisorOutcome({
    cycleId: "cycle:same-source-only",
    startedAt: T0,
    finishedAt: T0,
    testedSha: null,
    host: "test-host",
    provider: "memory",
    durable: true,
    attemptedTasks: 2,
    verifiedSourceSuccesses: 1,
    verifiedSourceFailures: 1,
    failures: [],
    taskReceipts: [
      {
        taskId: "meetings:ical:body-a",
        sourceId: "meetings-public-bodies",
        recordClass: "MEETING",
        scope: "source:ical:body:body-a",
        classification: "VERIFIED_SOURCE_FAILURE",
        receipt: { ...failedReceipt, source: "meetings:ical:body-a", candidateId: "candidate:meeting-a" },
      },
      {
        taskId: "meetings:ical:body-b",
        sourceId: "meetings-public-bodies",
        recordClass: "MEETING",
        scope: "source:ical:body:body-b",
        classification: "VERIFIED_SOURCE_SUCCESS",
        receipt: {
          ...successReceipt,
          source: "meetings:ical:body-b",
          candidateId: "candidate:meeting-b",
          promotedVersion: "candidate:meeting-b",
        },
      },
    ],
  });
  assert.equal(
    routineSupervisorCycleIsolationIssue(sameSourceOnly),
    "NO_UNAFFECTED_SOURCE_SUCCESS_RECEIPT",
    "a second task from the same source cannot prove cross-source failure isolation",
  );

  const aggregateOnly = routineCivicDataSupervisorOutcome({
    cycleId: "cycle:aggregate-only",
    startedAt: T0,
    finishedAt: T0,
    testedSha: null,
    host: "test-host",
    provider: "memory",
    durable: true,
    attemptedTasks: 2,
    verifiedSourceSuccesses: 1,
    verifiedSourceFailures: 1,
    failures: [],
  });
  assert.equal(routineSupervisorCycleIsolationIssue(aggregateOnly), "EXACT_TASK_RECEIPTS_UNAVAILABLE");

  const runner = readFileSync("scripts/routine-civic-data-runner.mts", "utf8");
  assert.match(runner, /captureTaskReceipt\(pending, child\.receipt, "VERIFIED_SOURCE_SUCCESS"\)/);
  assert.match(runner, /captureTaskReceipt\(pending, child\.receipt, "VERIFIED_SOURCE_FAILURE"\)/);
  assert.doesNotMatch(runner, /if \(supervisorFailures\.length > 0\) \{\s*try \{\s*const cycleId = await persistSupervisorOutcome/);

});

test("an exit-zero child is not called GOOD before exact receipt and canonical readback", () => {
  const source = readFileSync("scripts/routine-civic-data-runner.mts", "utf8");
  assert.match(source, /parseRoutineRunnerReceipt\(output\)/);
  assert.match(source, /await durableRoutineRunnerReceiptIssue\(parsedReceipt\.receipt, pending\.task, store/);
  assert.doesNotMatch(source, /run\.status === 0 \? "PROMOTED"/);
});

test("a child process or receipt failure is operational and cannot fabricate source state", async () => {
  const store = new MemoryRoutineDataStore();
  const good = sourceGoodCandidate();
  const seeded = await processRegisteredRoutineCandidate(store, "fec-funding", good, T0);
  assert.equal(seeded.candidate.state, "PROMOTED");
  const before = {
    candidate: await store.readCandidate(good.id),
    pointer: await store.readPromotion(good.recordClass, good.scope),
    events: await store.events(good.id),
    clock: await store.clock(good.sourceId, good.recordClass, good.scope),
  };

  const parsed = parseRoutineRunnerReceipt("child crashed before writing a source receipt");
  const classified = classifyRoutineChildOutcome({
    parsed,
    durableIssue: null,
    exitStatus: null,
    childDiagnostic: "spawn failed",
  });
  assert.equal(classified.kind, "SUPERVISOR_FAILURE");
  assert.equal(classified.state, "CANNOT_TELL");

  const repos = createMemoryRepositories();
  const operational = routineCivicDataSupervisorOutcome({
    cycleId: "routine-supervisor:test",
    startedAt: T0,
    finishedAt: T0,
    testedSha: null,
    host: "test-host",
    provider: repos.describe(),
    durable: repos.durable,
    attemptedTasks: 1,
    verifiedSourceSuccesses: 0,
    verifiedSourceFailures: 0,
    failures: [{ taskId: "fec-funding", code: classified.code, detail: classified.detail }],
  });
  await appendRoutineCivicDataSupervisorDigest(repos, {
    outcome: operational,
    lines: ["supervisor failed; source authority unchanged"],
  });
  const digests = await repos.ownerDigests.read("owner-digest");
  assert.equal(digests.length, 1);
  assert.equal(digests[0].runtimeOutcome?.kind, "ROUTINE_CIVIC_DATA_SUPERVISOR");
  assert.deepEqual(operational.attributionBoundary, {
    sourceReceiptAuthority: "SOURCE_ACQUISITION_CHILD_ONLY",
    supervisorCandidateWrites: 0,
    supervisorPointerWrites: 0,
    supervisorLkgChanges: 0,
  });
  assert.deepEqual({
    candidate: await store.readCandidate(good.id),
    pointer: await store.readPromotion(good.recordClass, good.scope),
    events: await store.events(good.id),
    clock: await store.clock(good.sourceId, good.recordClass, good.scope),
  }, before, "recording a supervisor fault must not create, revert, hold, or repoint source data");

  const runner = readFileSync("scripts/routine-civic-data-runner.mts", "utf8");
  assert.doesNotMatch(runner, /failedAcquisitionCandidate|processRegisteredRoutineCandidate|processRoutineCandidate/);
  assert.doesNotMatch(runner, /store\.(?:create|transition|promote|appendEvidence)\(/);
  const pilot = readFileSync("scripts/pilot-runner.mts", "utf8");
  assert.match(pilot, /exact durable source dispositions, if any, remain authoritative and unaltered/);
  assert.match(pilot, /no source disposition was fabricated or changed/);
  assert.doesNotMatch(pilot, /no source outcome was attributed/);
  assert.doesNotMatch(pilot, /one or more sources held LKG/);
});

test("a genuine source-unavailable child receipt remains durable and preserves exact LKG", async () => {
  const task = ROUTINE_SOURCE_TASKS[0];
  const store = new MemoryRoutineDataStore();
  const good = sourceGoodCandidate();
  await processRegisteredRoutineCandidate(store, task.id, good, T0);
  const failure = failedAcquisitionCandidate({
    sourceId: task.sourceId,
    recordClass: task.recordClass,
    scope: task.scope,
    requestedUrl: task.requestedUrl,
    attemptedAt: "2026-09-08T13:00:00.000Z",
    failureDetail: "The official publisher was unavailable.",
    parserVersion: task.parserVersion,
  });
  const held = await processRegisteredRoutineCandidate(store, task.id, failure, failure.retrieval.retrievedAt);
  assert.equal(held.candidate.state, "SOURCE_BLOCKED");
  assert.equal(held.candidate.lastKnownGoodVersion, good.id);
  assert.equal((await store.readPromotion(task.recordClass, task.scope))?.versionId, good.id);

  const receipt = {
    source: task.id,
    candidateId: failure.id,
    acquisitionSucceeded: false,
    state: held.candidate.state,
    decision: held.candidate.receipt?.decision ?? null,
    promotedVersion: null,
    lastKnownGoodVersion: held.candidate.lastKnownGoodVersion,
    structuralReleaseContract: ZERO_RELEASE_EVENTS,
  };
  const parsed = parseRoutineRunnerReceipt(`RCD_RECEIPT=${JSON.stringify(receipt)}`);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const durableIssue = await durableRoutineRunnerReceiptIssue(parsed.receipt, task, store, "HELD");
  assert.equal(durableIssue, null);
  const classified = classifyRoutineChildOutcome({
    parsed,
    durableIssue,
    exitStatus: 2,
    childDiagnostic: "source adapter reported publisher unavailable",
  });
  assert.equal(classified.kind, "VERIFIED_SOURCE_FAILURE");
  assert.equal(classified.state, "SOURCE_BLOCKED");
  assert.equal((await store.readPromotion(task.recordClass, task.scope))?.versionId, good.id);
});

test("a proven durable source outcome survives a later child execution failure", () => {
  const good = {
    source: "fec-funding",
    candidateId: "durable-before-timeout",
    acquisitionSucceeded: true,
    state: "PROMOTED" as const,
    decision: "GOOD" as const,
    promotedVersion: "durable-before-timeout",
    lastKnownGoodVersion: "durable-before-timeout",
    structuralReleaseContract: ZERO_RELEASE_EVENTS,
  };
  const parsed = parseRoutineRunnerReceipt(`RCD_RECEIPT=${JSON.stringify(good)}`);
  assert.equal(parsed.ok, true);
  assert.equal(classifyRoutineChildOutcome({
    parsed,
    durableIssue: null,
    exitStatus: null,
    childDiagnostic: "child timed out after emitting its durable receipt",
  }).kind, "VERIFIED_SOURCE_SUCCESS");

  const runner = readFileSync("scripts/routine-civic-data-runner.mts", "utf8");
  assert.match(runner, /successfulRoutineRunnerReceiptIssue\(parsedReceipt\.receipt\)/);
  assert.match(runner, /CHILD_EXIT_CONTRADICTED_SOURCE_RECEIPT/);
  assert.match(runner, /if \(executionFailure !== null\)[\s\S]*supervisorFailures\.push\(executionFailure\)/);
});

test("nonzero child receipts must prove a durable held candidate and cannot claim PROMOTED", async () => {
  const task = ROUTINE_SOURCE_TASKS[0];
  const noDurable: DurableReceiptStore = {
    readCandidate: async () => null,
    readCandidateSummary: async () => null,
    readPromotion: async () => null,
    readPromotionIdentity: async () => null,
  };
  const held = {
    source: "fec-funding",
    candidateId: "not-persisted",
    acquisitionSucceeded: false,
    state: "SOURCE_BLOCKED" as const,
    decision: "FAIL" as const,
    promotedVersion: null,
    lastKnownGoodVersion: null,
    structuralReleaseContract: ZERO_RELEASE_EVENTS,
  };
  assert.match(await durableRoutineRunnerReceiptIssue(held, task, noDurable, "HELD") ?? "", /not durable/);
  assert.match(await durableRoutineRunnerReceiptIssue({
    ...held,
    acquisitionSucceeded: true,
    state: "PROMOTED",
    decision: "GOOD",
    promotedVersion: held.candidateId,
    lastKnownGoodVersion: held.candidateId,
  }, task, noDurable, "HELD") ?? "", /nonzero child claimed a successful promotion/);
});

test("the durable receipt check proves a Reader-projected pointer by identity and reads nothing whole", async () => {
  class CountingStore extends MemoryRoutineDataStore {
    readonly whole: string[] = [];

    override async readCandidate(candidateId: string) {
      this.whole.push(`candidate:${candidateId}`);
      return super.readCandidate(candidateId);
    }

    // The proof's own narrowed read: the read model and normalized payload it
    // checks, never the change set, records or identities (candidateProofView).
    override async readCandidateProof(candidateId: string) {
      this.whole.push(`candidate-proof:${candidateId}`);
      return super.readCandidateProof(candidateId);
    }

    override async readPromotion<T>(recordClass: RoutineCandidate["recordClass"], scope: string) {
      this.whole.push(`promotion:${recordClass}:${scope}`);
      return super.readPromotion<T>(recordClass, scope);
    }
  }
  const task = ROUTINE_SOURCE_TASKS[0];
  assert.notEqual(task.contract.readerProjection, null, "fec-funding has a Reader projection the repair phase re-proves");
  const store = new CountingStore();
  const good = sourceGoodCandidate();
  const promoted = await processRegisteredRoutineCandidate(store, task.id, good, T0);
  assert.equal(promoted.candidate.state, "PROMOTED");
  const pointer = `promotion:${task.recordClass}:${task.scope}`;

  store.whole.length = 0;
  const success = {
    source: task.id,
    candidateId: good.id,
    acquisitionSucceeded: true,
    state: "PROMOTED" as const,
    decision: "GOOD" as const,
    promotedVersion: good.id,
    lastKnownGoodVersion: good.id,
    structuralReleaseContract: ZERO_RELEASE_EVENTS,
  };
  assert.equal(await durableRoutineRunnerReceiptIssue(success, task, store, "SUCCESS"), null);
  const placeJob = { ...task, id: "national-place:85635", registeredContractId: task.id };
  assert.equal(await durableRoutineRunnerReceiptIssue(success, placeJob, store, "SUCCESS"), null,
    "an independent job keeps its canonical source authority");
  assert.equal(await durableRoutineRunnerReceiptIssue({ ...success, source: placeJob.id }, placeJob, store, "SUCCESS"), null,
    "the parent-attributed exact job receipt remains readable");
  assert.match(await durableRoutineRunnerReceiptIssue({ ...success, source: "national-place:03000" }, placeJob, store, "SUCCESS") ?? "",
    /does not match registered task/);
  assert.deepEqual(store.whole, [], "success: identity only; the Reader repair reads the new version in full");

  // A contract no Reader readback ever proves keeps the full proven read on
  // success, and that proof still refuses a payload its candidate does not back.
  const unprojected = { ...task, contract: { ...task.contract, readerProjection: null } };
  store.whole.length = 0;
  assert.equal(await durableRoutineRunnerReceiptIssue(success, unprojected, store, "SUCCESS"), null);
  assert.deepEqual(store.whole, [pointer, `candidate-proof:${good.id}`], "no Reader projection: the new pointer's proof, once, narrowed");
  // A caller that does not name the contract keeps the full proof as well.
  const { contract: _contract, ...anonymous } = task;
  store.whole.length = 0;
  assert.equal(await durableRoutineRunnerReceiptIssue(success, anonymous, store, "SUCCESS"), null);
  assert.deepEqual(store.whole, [pointer, `candidate-proof:${good.id}`], "unnamed contract: the full proof");

  const failure = failedAcquisitionCandidate({
    sourceId: task.sourceId,
    recordClass: task.recordClass,
    scope: task.scope,
    requestedUrl: task.requestedUrl,
    attemptedAt: "2026-09-08T13:00:00.000Z",
    failureDetail: "The official publisher was unavailable.",
    parserVersion: task.parserVersion,
  });
  const held = await processRegisteredRoutineCandidate(store, task.id, failure, failure.retrieval.retrievedAt);
  assert.equal(held.candidate.state, "SOURCE_BLOCKED");
  const heldReceipt = {
    source: task.id,
    candidateId: failure.id,
    acquisitionSucceeded: false,
    state: "SOURCE_BLOCKED" as const,
    decision: held.candidate.receipt?.decision ?? null,
    promotedVersion: null,
    lastKnownGoodVersion: good.id,
    structuralReleaseContract: ZERO_RELEASE_EVENTS,
  };
  for (const expected of [task, unprojected]) {
    store.whole.length = 0;
    assert.equal(await durableRoutineRunnerReceiptIssue(heldReceipt, expected, store, "HELD"), null);
    assert.deepEqual(store.whole, [], "held: the unchanged LKG by identity; never the refused envelope or the LKG payload");
  }

  // The no-projection proof is still whole: a pointer whose payload no longer
  // matches its candidate's read model is refused.
  class TamperedStore extends CountingStore {
    override async readPromotion<T>(recordClass: RoutineCandidate["recordClass"], scope: string) {
      const row = await super.readPromotion<T>(recordClass, scope);
      return row === null ? null : { ...row, payload: { tampered: true } as T };
    }
  }
  const tampered = new TamperedStore();
  await processRegisteredRoutineCandidate(tampered, task.id, good, T0);
  assert.match(await durableRoutineRunnerReceiptIssue(success, unprojected, tampered, "SUCCESS") ?? "", /does not prove the reported GOOD candidate/);
});

test("the durable receipt check refuses invalid current identities and keeps exact LKG equality for holds", async () => {
  const task = ROUTINE_SOURCE_TASKS[0];
  const store = new MemoryRoutineDataStore();
  const good = sourceGoodCandidate();
  await processRegisteredRoutineCandidate(store, task.id, good, T0);
  const failure = failedAcquisitionCandidate({
    sourceId: task.sourceId,
    recordClass: task.recordClass,
    scope: task.scope,
    requestedUrl: task.requestedUrl,
    attemptedAt: "2026-09-08T13:00:00.000Z",
    failureDetail: "The official publisher was unavailable.",
    parserVersion: task.parserVersion,
  });
  const held = await processRegisteredRoutineCandidate(store, task.id, failure, failure.retrieval.retrievedAt);
  const real = await store.readPromotionIdentity(task.recordClass, task.scope);
  assert.ok(real);
  const success = {
    source: task.id,
    candidateId: good.id,
    acquisitionSucceeded: true,
    state: "PROMOTED" as const,
    decision: "GOOD" as const,
    promotedVersion: good.id,
    lastKnownGoodVersion: good.id,
    structuralReleaseContract: ZERO_RELEASE_EVENTS,
  };
  const heldReceipt = {
    source: task.id,
    candidateId: failure.id,
    acquisitionSucceeded: false,
    state: "SOURCE_BLOCKED" as const,
    decision: held.candidate.receipt?.decision ?? null,
    promotedVersion: null,
    lastKnownGoodVersion: good.id,
    structuralReleaseContract: ZERO_RELEASE_EVENTS,
  };
  // Every dataset door fails the test: a mismatch is refused from identity alone.
  const pointing = (identity: typeof real | null): DurableReceiptStore => Object.assign(Object.create(store), {
    readPromotionIdentity: async () => identity,
    readPromotion: async () => { throw new Error("the payload was read"); },
    readCandidate: async () => { throw new Error("the candidate was read"); },
  });
  assert.equal(await durableRoutineRunnerReceiptIssue(success, task, pointing(real), "SUCCESS"), null);
  assert.equal(await durableRoutineRunnerReceiptIssue(heldReceipt, task, pointing(real), "HELD"), null);
  for (const [label, identity] of [
    ["absent", null],
    ["an LKG that is not the current version", { ...real, lastKnownGoodVersionId: "cv-older" }],
    ["another source", { ...real, sourceId: "another-source" }],
    ["another class", { ...real, recordClass: "DOTGOV_REFERENCE" }],
    ["another scope", { ...real, scope: "US:another-scope" }],
  ] as const) {
    assert.match(
      await durableRoutineRunnerReceiptIssue(success, task, pointing(identity), "SUCCESS") ?? "",
      /does not carry a valid current LKG identity/,
      `success refuses a pointer with ${label}`,
    );
    assert.match(
      await durableRoutineRunnerReceiptIssue(heldReceipt, task, pointing(identity), "HELD") ?? "",
      /omitted the canonical|unchanged, proof-valid canonical LKG pointer/,
      `held refuses a pointer with ${label}`,
    );
  }
  const advanced = { ...real, versionId: "cv-newer", lastKnownGoodVersionId: "cv-newer" };
  assert.equal(await durableRoutineRunnerReceiptIssue(success, task, pointing(advanced), "SUCCESS"), null,
    "a completed promotion need not remain the serving version");
  assert.match(await durableRoutineRunnerReceiptIssue(heldReceipt, task, pointing(advanced), "HELD") ?? "",
    /unchanged, proof-valid canonical LKG pointer/, "held outcomes still prove the exact unchanged LKG");
});

test("two successful publications settle independently after the canonical pointer advances", async () => {
  const task = ROUTINE_SOURCE_TASKS[0];
  const store = new MemoryRoutineDataStore();
  const first = sourceGoodCandidate();
  const second = sourceGoodCandidate(20);
  const firstOutcome = await processRegisteredRoutineCandidate(store, task.id, first, T0);
  const secondOutcome = await processRegisteredRoutineCandidate(store, task.id, second, T0);
  assert.equal(firstOutcome.candidate.state, "PROMOTED");
  assert.equal(secondOutcome.candidate.state, "PROMOTED");
  assert.notEqual(first.id, second.id);
  assert.equal((await store.readPromotionIdentity(task.recordClass, task.scope))?.versionId, second.id);
  const receipt = {
    source: task.id, candidateId: first.id, acquisitionSucceeded: true,
    state: firstOutcome.candidate.state, decision: firstOutcome.candidate.receipt?.decision ?? null,
    promotedVersion: firstOutcome.candidate.promotedVersion,
    lastKnownGoodVersion: firstOutcome.candidate.lastKnownGoodVersion,
    structuralReleaseContract: ZERO_RELEASE_EVENTS,
  };
  const durableIssue = await durableRoutineRunnerReceiptIssue(receipt, task, store, "SUCCESS");
  assert.equal(durableIssue, null);
  const parsed = parseRoutineRunnerReceipt(`RCD_RECEIPT=${JSON.stringify(receipt)}`);
  assert.equal(classifyRoutineChildOutcome({ parsed, durableIssue,
    exitStatus: 0, childDiagnostic: null }).kind, "VERIFIED_SOURCE_SUCCESS");
  assert.equal(await durableRoutineRunnerReceiptIssue({ ...receipt, candidateId: second.id,
    promotedVersion: second.id, lastKnownGoodVersion: second.id }, task, store, "SUCCESS"), null);
  assert.match(await durableRoutineRunnerReceiptIssue({ ...receipt, source: "another-task" }, task, store, "SUCCESS") ?? "",
    /does not match registered task/);
  assert.match(await durableRoutineRunnerReceiptIssue({ ...receipt, candidateId: second.id }, task, store, "SUCCESS") ?? "",
    /differs from the durable candidate/);
  assert.match(await durableRoutineRunnerReceiptIssue({ ...receipt, candidateId: "cv-not-written" }, task, store, "SUCCESS") ?? "",
    /not durable/);
  assert.match(await durableRoutineRunnerReceiptIssue({ ...receipt, decision: "FAIL" }, task, store, "SUCCESS") ?? "",
    /not backed by the candidate's durable/);
  assert.match(await durableRoutineRunnerReceiptIssue(receipt, { ...task, sourceId: "another-source" }, store, "SUCCESS") ?? "",
    /does not match the registered task identity/);
});


test("C6: two reads of one host in one pass start at least the gap apart; other hosts do not wait, and the outer bound counts the gap", async () => {
  const events: { id: string; phase: "start" | "end"; at: number }[] = [];
  const done = (id: string): BoundedChildResult => ({ id, status: 0, signal: null, stdout: "", stderr: "", termination: "EXITED", errorMessage: null });
  const results = await runBoundedChildPass([
    { id: "tucson-1", failureDomain: "meeting-upstream:clerksboards.example", executable: "ignored", args: [] },
    { id: "tucson-2", failureDomain: "meeting-upstream:clerksboards.example", executable: "ignored", args: [] },
    { id: "pima", failureDomain: "meeting-upstream:legistar.example", executable: "ignored", args: [] },
  ], { cwd: process.cwd(), env: process.env, timeoutMs: 1_000, maxBufferBytes: 1, sameDomainGapMs: 120 }, async (command) => {
    events.push({ id: command.id, phase: "start", at: Date.now() });
    await new Promise((resolve) => setTimeout(resolve, 30));
    events.push({ id: command.id, phase: "end", at: Date.now() });
    return done(command.id);
  });
  assert.deepEqual(results.map(({ id }) => id), ["tucson-1", "tucson-2", "pima"]);
  const at = (id: string, phase: "start" | "end") => events.find((event) => event.id === id && event.phase === phase)!.at;
  assert.ok(at("tucson-2", "start") - at("tucson-1", "end") >= 115, "the host's second read waits the gap after its first");
  assert.ok(at("pima", "start") - at("tucson-1", "start") < 60, "another host is not held by that gap");
  assert.equal(ROUTINE_SAME_DOMAIN_CHILD_GAP_MS, 60_000);
  await assert.rejects(runBoundedChildPass([], { cwd: process.cwd(), env: process.env, sameDomainGapMs: -1 }), /DOMAIN_GAP_INVALID/);
  const bounds = {
    neonRequestDeadlineMs: 1_000, settlementRequestsPerCommand: 1, clockTaskCount: 1, clockConcurrency: 1,
    clockRequestsPerTask: 1, coordinationRequests: 1, readerSingleDomains: 0, readerSingleTimeoutMs: 0,
    readerMeetingDomains: 0, readerMeetingTimeoutMs: 0, readerConcurrency: 1,
  } as const;
  const chain = routineRunnerBoundedWorkMs(6, 3, bounds);
  const noGapChain = routineChildPassWorstCaseMs(6, ROUTINE_CHILD_TIMEOUT_MS + 1_000, ROUTINE_CHILD_CONCURRENCY, 3);
  assert.equal(chain, noGapChain + 2 * ROUTINE_SAME_DOMAIN_CHILD_GAP_MS + 1 * 1_000 + 1 * 1_000, "two gaps in a chain of three, plus the clock and coordination requests");
});

test("national people children share one serial lane: one at a time, back to back, while every source and state keeps its own turn", async () => {
  const people = ROUTINE_SOURCE_TASKS.filter(task => task.command[0] === "scripts/national-people-refresh.mts");
  assert.ok(people.length > 100);
  assert.deepEqual([...new Set(people.map(task => routineSerialLane(task.command)))], ["serial:scripts/national-people-refresh.mts"]);
  assert.equal(new Set(people.map(task => task.acquisitionFailureDomain)).size, people.length);
  assert.equal(routineFailureDomainFrontier(people.map(task => ({ task, lastConsideredAt: null }))).length, people.length,
    "admission still offers every due source and state each pass");
  const others = ROUTINE_SOURCE_TASKS.filter(task => task.command[0] !== "scripts/national-people-refresh.mts");
  assert.ok(others.every(task => routineSerialLane(task.command) === undefined));

  const [first, second] = [people.find(task => task.id.endsWith("-ca"))!, people.find(task => task.id.endsWith("-ny"))!];
  const tasks = [first, second, people.find(task => task.id.endsWith("-tx"))!, others[0]!];
  let peopleActive = 0, peopleMost = 0;
  const events: { id: string; phase: "start" | "end"; at: number }[] = [];
  const began = Date.now();
  await runBoundedChildPass(tasks.map(task => ({ id: task.id, failureDomain: task.acquisitionFailureDomain,
    serialLane: routineSerialLane(task.command), executable: "ignored", args: [] })), {
    cwd: process.cwd(), env: process.env, sameDomainGapMs: ROUTINE_SAME_DOMAIN_CHILD_GAP_MS, concurrency: tasks.length,
  }, async command => {
    const lane = command.serialLane !== undefined;
    if (lane) peopleMost = Math.max(peopleMost, ++peopleActive);
    events.push({ id: command.id, phase: "start", at: Date.now() });
    await new Promise(resolve => setTimeout(resolve, 30));
    events.push({ id: command.id, phase: "end", at: Date.now() });
    if (lane) peopleActive--;
    return { id: command.id, status: 0, signal: null, stdout: "", stderr: "", termination: "EXITED", errorMessage: null };
  });
  const at = (id: string, phase: "start" | "end") => events.find(event => event.id === id && event.phase === phase)!.at;
  assert.equal(peopleMost, 1, "one national people child at a time");
  assert.ok(at(others[0]!.id, "start") < at(first.id, "end"), "other sources run beside the people lane");
  assert.ok(Date.now() - began < ROUTINE_SAME_DOMAIN_CHILD_GAP_MS / 10, "the lane is not paced by the same-host gap");
  assert.ok(at(second.id, "start") >= at(first.id, "end"));

  const runner = readFileSync("scripts/routine-civic-data-runner.mts", "utf8");
  assert.match(runner, /serialLane: routineSerialLane\(pending\.command\)/);
  assert.match(runner, /command\.serialLane !== undefined && Date\.now\(\) >= Date\.parse\(RUN_STARTED_AT\) \+ ROUTINE_SERIAL_LANE_LAUNCH_MS[\s\S]{0,40}throw new Error\(`PASS_TIME_BUDGET: /);
  assert.ok(routinePreSpawnDeferral({ id: first.id, termination: "SPAWN_FAILED", status: null, signal: null, stdout: "", stderr: "",
    errorMessage: "PASS_TIME_BUDGET: serial:scripts/national-people-refresh.mts has had this pass's turn; the next pass continues it" }, false),
    "a lane past its turn leaves the rest owed for the next pass");
  assert.equal(ROUTINE_SERIAL_LANE_LAUNCH_MS, 30 * 60_000);
});

test("scoped source passes repair only matching reader pointers, including narrow meeting domains", () => {
  const all = [...observableRoutineContracts(), ...MANUAL_PRODUCTION_SOURCE_CONTRACTS];
  const voting = MANUAL_PRODUCTION_SOURCE_CONTRACTS.find(contract => contract.id === "voting-sites:AZ")!;
  const selected = selectedReaderRepairContracts(all, [voting]);
  assert.deepEqual(selected.map(contract => contract.id), ["voting-sites:AZ"]);
  assert.deepEqual(routineReaderRepairDomains(selected).map(domain => domain.id), ["reader-readback:voting-sites:AZ"]);
  const meetings = MEETING_PARTITION_CONTRACTS.slice(0, 2);
  const domains = routineReaderRepairDomains(selectedReaderRepairContracts(all, meetings));
  assert.equal(domains.length, 1);
  assert.deepEqual(domains[0].contracts.map(contract => contract.id), meetings.map(contract => contract.id));
  assert.equal(selectedReaderRepairContracts(all, null), all);
});


test("state publishers and artifact children retain the measured state reservation across small runs", async () => {
  const mib = 1024 * 1024;
  const slots = routineProcessSlots({ availableBytes: () => (1024 + 768) * mib, headroomBytes: 768 * mib, parentPeakBytes: 0,
    peakBytes: () => mib, host: workerMemoryHost({ processes: () => [] }) });
  const first = await slots.acquire("ballot-contests:CA/assemble-ballot-package.mts");
  const second = await slots.acquire("registry-runtime:AZ/promote-registry-runtime.mts");
  let admitted = false;
  const queued = slots.acquire("registry-runtime:AZ:reader-artifact/publish-state-authority.mts").then(release => {
    admitted = true; return release;
  });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(admitted, false);
  first();
  (await queued)();
  second();
});
