import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import { runInNewContext } from "node:vm";
import { beginAttempt, claim, endAttempt, type Attempt } from "../lib/control-plane/attempt.ts";
import { recordAcquisition } from "../lib/control-plane/evidence/artifact.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { putArtifact } from "../lib/control-plane/evidence/store.ts";
import { writeFieldManual } from "../lib/control-plane/field-manual.ts";
import { fingerprint } from "../lib/control-plane/ids.ts";
import { beginAttemptFor, claimRouteTask, disposeRouteTask, recordArtifactMetadata, registerRouteTask, registerWorkItem } from "../lib/control-plane/repository/coordinator.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import type { ArtifactRecord, ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import { createRouteTask, type RouteTask } from "../lib/control-plane/route-task.ts";
import { standing } from "../lib/control-plane/scheduler/durable.ts";
import { isScheduled, scheduleObligation } from "../lib/control-plane/scheduler/obligation.ts";
import { askGapSourceUrl } from "../lib/control-plane/scheduler/providers/ask-gaps.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";
import { autonomousStandingRuntime } from "../lib/control-plane/workers/standing-runtime.ts";
import { planHeldWorkerFleet } from "../lib/control-plane/workers/standing-plan.ts";
import { advanceHeldWorkerFleet, legacyHeldWorkOwed } from "../lib/control-plane/workers/standing.ts";
import { HELD_DIGGER_CLASSES, HELD_DIGGER_SOURCE_FIELDS, type HeldDiggerReads, type HeldDiggerSourceRow } from "../lib/control-plane/workers/held-digger-sources.ts";
import { FLEET_POLICY_VERSION } from "../lib/control-plane/workers/runtime.ts";
import { workerTaskAdmission } from "../lib/control-plane/workers/scheduling.ts";
import { MEETING_PARTITION_CONTRACTS } from "../lib/civic-data/meeting-partitions.ts";
import { methodVersionEntry } from "./method-store-fixture.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url)), START = "2026-10-20T07:00:00.000Z";
const PARTITION = MEETING_PARTITION_CONTRACTS.find(row => row.bodyId.startsWith("curated:az/") && row.derivedFamily === null && askGapSourceUrl(row.bodyId, [row.id], Date.parse(START)))!;
assert.ok(PARTITION, "the recorded door fixture supplies a real registered meeting source");
const SUBJECT = PARTITION.bodyId, DIVISION = PARTITION.ocdId ?? "ocd-division/country:us/state:az";
const PROFILE = "https://example.gov/ada", METHOD = { version: 3, updatedOn: "2026-10-20", routes: [] };

function memoryDiggerReads(repos: ControlPlaneRepositories): HeldDiggerReads {
  return {
    async sourceChanges(since, page) {
      const changed = await repos.routeTasks.listChangedSince!(since, undefined, { projection: HELD_DIGGER_SOURCE_FIELDS,
        page: rows => page(rows as unknown as readonly HeldDiggerSourceRow[]) });
      return { through: changed.through! };
    },
    async pendingTaskIds() {
      const ids: string[] = [];
      for (const kind of HELD_DIGGER_CLASSES) for (const row of await repos.routeTasks.listWhereNarrowed(["workerTask", "contract", "recordClass"], kind, { state: true })) {
        const state = (row.value as { state: string }).state;
        if (state === "PENDING" || state === "RECLAIMABLE") ids.push(row.id);
      }
      return ids;
    },
  };
}

async function harness(t: TestContext) {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "worker-standing-"));
  t.after(() => rm(vaultRoot, { recursive: true, force: true }));
  const store = new DurableEvidenceStore(vaultRoot), repos = createMemoryRepositories();
  let ordinal = 0, time = Date.parse(START);
  const now = () => new Date(time += 1_000).toISOString();
  await writeFieldManual(repos, [methodVersionEntry(METHOD)], now());
  const runtime = Object.assign(await autonomousStandingRuntime({ root: ROOT, vaultRoot, repos, now, environment: { NODE_ENV: "test" } }),
    { diggerReads: memoryDiggerReads(repos) });
  async function hold(options: { routeId?: string; subject?: string; profile?: boolean; close?: boolean; partial?: boolean } = {}) {
    const number = ++ordinal, at = now(), subject = options.subject ?? SUBJECT;
    const source = options.profile ? PROFILE : askGapSourceUrl(SUBJECT, [PARTITION.id], Date.parse(at))!;
    const routeId = options.routeId ?? (options.profile ? `held-subject-details:${fingerprint([source])}` : "CALENDAR_STALE");
    const obligationId = `freshness:held-source:${number}`, obligation = { id: obligationId, recordClass: options.profile ? "held-subject-enrichment" : "held-meeting-details",
      subjectId: subject, routeId, active: true, scopeDivisions: [DIVISION], readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: null };
    await repos.obligations.put(obligationId, standing(obligation, at), at);
    const item = createWorkItem({ project: "freshness", subject, obligation: `${obligationId}#1`, why: "Read this held source's remaining facts.", priority: "P0", now: at });
    await registerWorkItem(repos, item, at);
    const route = createRouteTask({ workItemId: item.id, routeId, routeLabel: "Known held source", target: subject, inherited: false, now: at });
    await registerRouteTask(repos, route, at);
    const holder = `fixture-http-${number}`, lease = await claimRouteTask(repos, { routeTaskId: route.id, holder, now: at, ttlMs: 60_000 });
    const attempt = await beginAttemptFor(repos, { routeTaskId: route.id, workItemId: item.id, lease: lease.lease.value, now: at,
      methodVersion: METHOD.version, policyVersion: FLEET_POLICY_VERSION, worker: { role: "ACQUIRER", provider: "fixture", version: "http/1", instance: holder } });
    const text = `<main><h1>Recorded held source</h1><p>Revision ${number}</p></main>`;
    const { artifact } = recordAcquisition({ canonicalUrl: source, retrievedAt: at, httpStatus: 200, contentType: "text/html", sourceId: new URL(source).hostname,
      methodRouteId: routeId, workItemId: item.id, attemptId: attempt.id, permission: "ALLOWED", transport: "REACHABLE" }, text);
    await putArtifact(store, "freshness", artifact, Buffer.from(text));
    const record: ArtifactRecord = { artifactId: artifact.id, workItemId: item.id, routeTaskId: route.id, attemptId: attempt.id, tier: artifact.tier,
      contentHash: artifact.contentHash, byteLength: artifact.byteLength, contentType: artifact.contentType, canonicalUrl: source, partial: options.partial ?? false, recordedAt: at };
    await recordArtifactMetadata(repos, record, at);
    const close = async () => disposeRouteTask(repos, { routeTaskId: route.id, attemptId: attempt.id,
      expectedTaskRevision: (await repos.routeTasks.mustRead(route.id)).revision, artifactIds: [artifact.id], now: now(),
      disposition: { disposition: "INGESTED", attemptId: attempt.id, at, artifactIds: [artifact.id], observation: null,
        permission: "ALLOWED", transport: "REACHABLE", note: "Saved exact source; its remaining facts stay owed." } });
    if (options.close !== false) await close();
    return { item, route, record, close, obligation, source };
  }
  return { repos, runtime, now, hold };
}

test("standing plans every closed held calendar source as a schema-2 one-subject acquirer without computation", async t => {
  const h = await harness(t);
  const captures: Awaited<ReturnType<typeof h.hold>>[] = [];
  for (let i = 0; i < 20; i++) captures.push(await h.hold());
  const before = (await h.repos.attempts.list()).length, tasks = await planHeldWorkerFleet(ROOT, h.runtime, true);
  assert.equal(tasks.length, 20);
  for (const task of tasks) {
    assert.ok(task.workerTask); assert.equal(task.workerTask.role, "ACQUIRER"); assert.equal(task.workerTask.contract.schemaVersion, 2);
    assert.equal(task.workerTask.contract.recordClass, "HELD_MEETING_DETAILS"); assert.equal(task.workerTask.contract.subjectId, SUBJECT); assert.equal(task.state, "PENDING");
    const source = captures.find(capture => capture.item.id === task.workItemId)!;
    if (task.workerTask.contract.schemaVersion === 2) {
      assert.deepEqual(task.workerTask.contract.sourceScope.observationArtifactIds, [source.record.artifactId]);
      assert.deepEqual(task.workerTask.contract.sourceScope.routeIds, [source.route.id]);
      assert.deepEqual(task.workerTask.contract.sourceScope.canonicalUrls, [source.source]);
    }
    assert.equal((await h.repos.routeTasks.mustRead(source.route.id)).value.target, SUBJECT, "the original scheduler target is retained");
  }
  assert.equal((await h.repos.attempts.list()).length, before); assert.equal((await h.repos.workerResults.readAll()).length, 0);
  assert.deepEqual(new Set((await planHeldWorkerFleet(ROOT, h.runtime, true)).map(task => task.id)), new Set(tasks.map(task => task.id)));
});

test("standing owed waits for an eligible completed source and retains pending work after its source cursor moves", async t => {
  const h = await harness(t); assert.equal(await legacyHeldWorkOwed(ROOT, h.runtime), false);
  await h.hold({ routeId: "unrelated-http" }); await h.hold({ partial: true }); const held = await h.hold({ close: false });
  assert.equal(await legacyHeldWorkOwed(ROOT, h.runtime), false); await held.close();
  assert.equal(await legacyHeldWorkOwed(ROOT, h.runtime), true);
  const [task] = await planHeldWorkerFleet(ROOT, h.runtime, true); assert.ok(task);
  assert.equal(task.workerTask?.artifactId, held.record.artifactId); assert.equal(await legacyHeldWorkOwed(ROOT, h.runtime), true);
  assert.deepEqual((await planHeldWorkerFleet(ROOT, h.runtime, true)).map(row => row.id), [task.id]);
});

test("the planner round's own held statement plans a held source in a state with no legacy saved pages", async t => {
  const round = readFileSync(path.join(ROOT, "scripts/freshness-shadow.mts"), "utf8");
  const wave = round.indexOf("async function runAutonomousWave");
  const statement = /^ {2}const held = .*;$/m.exec(round.slice(wave))?.[0];
  assert.ok(wave > 0 && statement, "runAutonomousWave plans held work in one statement");
  assert.doesNotMatch(round, /legacyArtifactActivityRepositories|HELD_EVENT_URL_PREFIXES/, "held planning is not gated on legacy saved pages");
  const h = await harness(t); const held = await h.hold();
  const tasks = await runInNewContext(`(async () => { ${statement} return held; })()`,
    { ROOT, fleet: h.runtime, legacyHeldWorkOwed, planHeldWorkerFleet }) as readonly RouteTask[];
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]!.workerTask?.contract.recordClass, "HELD_MEETING_DETAILS");
  assert.equal(tasks[0]!.workerTask?.artifactId, held.record.artifactId);
});

test("the actual standing factory selects native executors and custom beginTask skips research history", async t => {
  const h = await harness(t); await h.hold(); await h.hold({ profile: true, subject: "member:opaque-ada" });
  const tasks = await planHeldWorkerFleet(ROOT, h.runtime, true); assert.equal(tasks.length, 2);
  const original = h.repos.workItems.read;
  h.repos.workItems.read = async () => { throw Error("CUSTOM_DIGGER_MUST_NOT_READ_RESEARCH_LINEAGE"); };
  try {
    for (const task of tasks) {
      await h.runtime.beginTask!(task);
      const executor = h.runtime.roleExecutor!(task, "actual-standing-fixture"); assert.equal(executor.lane, "DETERMINISTIC");
      const scheduled = scheduleObligation({ id: "fixture", recordClass: "held-meeting-details", subjectId: task.workerTask!.contract.subjectId,
        routeId: "CALENDAR_STALE", active: true, readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: null }, Date.parse(START));
      assert.ok(isScheduled(scheduled));
      const worker = executor.workerFor!({ executor: "DETERMINISTIC", obligation: scheduled, holder: "actual-standing-fixture" });
      assert.equal(worker.role, "ACQUIRER"); assert.equal(worker.provider, "we-the-people");
      assert.equal(worker.version, task.workerTask!.contract.recordClass === "HELD_MEETING_DETAILS" ? "held-meeting-details/1" : "held-subject-details/1");
    }
  } finally { h.repos.workItems.read = original; }
  assert.equal((await h.repos.workerResults.readAll()).length, 0);
});

test("legacy-only advancement uses held sources while ordinary standing skips their generalized parser chain", async t => {
  const h = await harness(t); await h.hold(); await advanceHeldWorkerFleet(ROOT, h.runtime, 1, true);
  const queued = (await h.repos.routeTasks.list()).filter(row => row.value.workerTask);
  assert.equal(queued.length, 1); assert.equal(queued[0]!.value.workerTask?.role, "ACQUIRER");
  assert.deepEqual(await planHeldWorkerFleet(ROOT, h.runtime), []);
  assert.equal((await h.repos.routeTasks.list()).filter(row => row.value.workerTask).length, 1);
});

test("a subject-target capture with an unrelated source hash cannot create a held-subject worker", async t => {
  const h = await harness(t); await h.hold({ profile: true, subject: "member:opaque-ada", routeId: "held-subject-details:wrong-source-hash" });
  assert.deepEqual(await planHeldWorkerFleet(ROOT, h.runtime, true), []);
});

function failedAttempt(task: RouteTask, ordinal: number): Attempt {
  const at = new Date(Date.parse(START) + ordinal * 24 * 60 * 60_000).toISOString();
  const opened = beginAttempt({ routeTaskId: task.id, workItemId: task.workItemId,
    worker: { role: "ACQUIRER", provider: "fixture", version: "held-source/1", instance: `failure-${ordinal}` },
    lease: claim(task.id, `failure-${ordinal}`, at, 60_000, null), now: at, methodVersion: METHOD.version, policyVersion: FLEET_POLICY_VERSION });
  return endAttempt(opened, "CRASHED", at, { abortReason: "WORKER_PROCESS_CRASHED" });
}

test("held worker crashes retain ordinary retry admission and the existing six-hour cap", async t => {
  const h = await harness(t); await h.hold(); const [task] = await planHeldWorkerFleet(ROOT, h.runtime, true); assert.ok(task);
  const attempts = Array.from({ length: 9 }, (_, i) => failedAttempt(task, i + 1));
  const reclaimable = { ...task, state: "RECLAIMABLE" as const, attemptIds: attempts.map(attempt => attempt.id) }, latest = attempts.at(-1)!;
  const waiting = workerTaskAdmission(reclaimable, [...attempts].reverse(), latest.endedAt!);
  assert.equal(waiting.state, "BACKOFF"); assert.equal(waiting.consecutiveFailures, 9);
  assert.equal(Date.parse(waiting.retryAt!) - Date.parse(latest.endedAt!), 6 * 60 * 60_000);
  assert.equal(workerTaskAdmission(reclaimable, attempts, waiting.retryAt!).due, true);
  assert.equal(workerTaskAdmission({ ...reclaimable, state: "CLAIMED" }, attempts, waiting.retryAt!).state, "IN_FLIGHT");
});
