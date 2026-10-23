import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { beginAttemptFor, claimRouteTask, disposeRouteTask, recordArtifactMetadata, registerRouteTask, registerWorkItem } from "../lib/control-plane/repository/coordinator.ts";
import type { ArtifactRecord, ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";
import { createRouteTask } from "../lib/control-plane/route-task.ts";
import { standing } from "../lib/control-plane/scheduler/durable.ts";
import { HELD_DIGGER_CURSOR, HELD_DIGGER_SOURCE_FIELDS, hasOwedHeldDiggers, isHeldDiggerTask, planHeldDiggers, type HeldDiggerPlanRuntime } from "../lib/control-plane/workers/held-digger-plan.ts";
import { FLEET_POLICY_VERSION } from "../lib/control-plane/workers/runtime.ts";
import { HELD_DIGGER_CLASSES, type HeldDiggerReads, type HeldDiggerSourceRow } from "../lib/control-plane/workers/held-digger-sources.ts";

const AT = "2026-10-20T07:00:00.000Z", NOW = "2026-10-20T07:01:00.000Z";
const DIVISION = "ocd-division/country:us/state:az/place:example";

async function acquisition(repos: ControlPlaneRepositories, options: { subject?: string; routeId?: string; key?: string; close?: boolean; partial?: boolean;
  scope?: readonly string[]; obligationSubject?: string } = {}) {
  const subject = options.subject ?? "member:opaque-ada", key = options.key ?? "one", routeId = options.routeId ?? "held-subject-details:profile";
  const obligationId = `freshness:held-subject:${key}#profile`;
  await repos.obligations.put(obligationId, standing({ id: obligationId, recordClass: "held-subject-enrichment", subjectId: options.obligationSubject ?? subject,
    routeId, active: true, scopeDivisions: options.scope ?? [DIVISION], readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: null }, AT), AT);
  const item = createWorkItem({ project: "freshness", subject, obligation: `${obligationId}#1`, why: "Reader-visible owed details.", priority: "P0", now: AT });
  await registerWorkItem(repos, item, AT);
  const route = createRouteTask({ workItemId: item.id, routeId, routeLabel: "Read existing held source", target: `https://example.gov/${key}`,
    inherited: false, now: AT });
  await registerRouteTask(repos, route, AT);
  const holder = `fixture-${key}`, claim = await claimRouteTask(repos, { routeTaskId: route.id, holder, now: AT, ttlMs: 60_000 });
  const attempt = await beginAttemptFor(repos, { workItemId: item.id, routeTaskId: route.id, lease: claim.lease.value, now: AT, methodVersion: 3,
    policyVersion: FLEET_POLICY_VERSION, worker: { role: "ACQUIRER", provider: "fixture", version: "1", instance: holder } });
  const artifact: ArtifactRecord = { artifactId: `artifact-${key}`, workItemId: item.id, routeTaskId: route.id, attemptId: attempt.id,
    tier: "RAW", contentHash: "a".repeat(64), byteLength: 100, contentType: "text/html", canonicalUrl: route.target,
    partial: options.partial ?? false, recordedAt: AT };
  await recordArtifactMetadata(repos, artifact, AT);
  const close = async () => disposeRouteTask(repos, { routeTaskId: route.id, attemptId: attempt.id, now: AT,
    expectedTaskRevision: (await repos.routeTasks.mustRead(route.id)).revision, artifactIds: [artifact.artifactId],
    disposition: { disposition: "INGESTED", attemptId: attempt.id, at: AT, artifactIds: [artifact.artifactId], observation: null,
      permission: "ALLOWED", transport: "REACHABLE", note: "Saved source response." } });
  if (options.close !== false) await close();
  return { item, route, attempt, artifact, close };
}

function runtime(repos = createMemoryRepositories()): HeldDiggerPlanRuntime {
  // Explicit fixture adapter. Production uses server-filtered CP reads and never this whole-memory history.
  const diggerReads: HeldDiggerReads = {
    async sourceChanges(since, page) {
      const read = repos.routeTasks.listChangedSince!;
      const changed = await read(since, undefined, { projection: HELD_DIGGER_SOURCE_FIELDS,
        page: rows => page(rows as unknown as readonly HeldDiggerSourceRow[]) });
      return { through: changed.through! };
    },
    async pendingTaskIds() {
      const ids: string[] = [];
      for (const kind of HELD_DIGGER_CLASSES) for (const row of await repos.routeTasks.listWhereNarrowed(["workerTask", "contract", "recordClass"], kind, { id: true, state: true })) {
        const state = (row.value as { state: string }).state;
        if (state === "PENDING" || state === "RECLAIMABLE") ids.push(row.id);
      }
      return ids;
    },
  };
  return { repos, diggerReads, methodVersion: 3, now: () => NOW };
}

test("closed acquisition creates an exact one-subject worker on the same Admin work item, and replay deduplicates", async () => {
  const r = runtime(), f = await acquisition(r.repos);
  const [task] = await planHeldDiggers(r);
  assert.ok(task && isHeldDiggerTask(task));
  assert.equal(task.workItemId, f.item.id);
  assert.equal(task.workerTask!.contract.subjectId, f.item.subject);
  assert.equal(task.workerTask!.contract.schemaVersion, 2);
  if (task.workerTask!.contract.schemaVersion === 2) {
    assert.equal(task.workerTask!.contract.jurisdiction.state, "AZ", "opaque member identity uses the provider's exact scope");
    assert.deepEqual(task.workerTask!.contract.sourceScope.routeIds, [f.route.id]);
    assert.deepEqual(task.workerTask!.contract.sourceScope.observationArtifactIds, [f.artifact.artifactId]);
    assert.equal(task.workerTask!.contract.expectedSourceDate, AT);
  }
  assert.equal((await r.repos.workItems.mustRead(f.item.id)).value.priority, "P0", "queue attachment preserves Admin ordering");
  assert.deepEqual((await planHeldDiggers(r)).map(row => row.id), [task.id]);
  assert.equal((await r.repos.routeTasks.list()).length, 2);
  assert.equal((await r.repos.artifacts.read(f.item.id))[0]!.recordedAt, AT);
});

test("an artifact appended before HTTP closes is discovered by the later route change, even after its occurrence closed", async () => {
  const r = runtime(), f = await acquisition(r.repos, { close: false });
  assert.deepEqual(await planHeldDiggers(r), []);
  const before = await r.repos.passCursors.mustRead(HELD_DIGGER_CURSOR);
  await f.close();
  const [task] = await planHeldDiggers(r);
  assert.ok(task);
  assert.equal(task.workItemId, f.item.id);
  assert.equal((await r.repos.routeTasks.mustRead(f.route.id)).value.state, "DISPOSED");
  assert.ok((await r.repos.passCursors.mustRead(HELD_DIGGER_CURSOR)).revision > before.revision);
});

test("each held-meeting gap queues the native one-body worker without reopening its HTTP route", async () => {
  const r = runtime();
  for (const code of ["AGENDA_NOT_HELD", "CALENDAR_STALE", "OUTCOME_NOT_READ", "MEETINGS_NOT_HELD"]) {
    await acquisition(r.repos, { subject: `${DIVISION}#council`, routeId: code, key: code });
  }
  const tasks = await planHeldDiggers(r);
  assert.equal(tasks.length, 4);
  assert.ok(tasks.every(task => task.workerTask?.contract.recordClass === "HELD_MEETING_DETAILS" && task.workerTask.contract.subjectId === `${DIVISION}#council`));
  assert.equal((await r.repos.routeTasks.list()).filter(row => !row.value.workerTask && row.value.state === "DISPOSED").length, 4);
});

test("planning pages only changed closure metadata, reads exact owned artifacts, and never materializes country content", async () => {
  const repos = createMemoryRepositories(), f = await acquisition(repos), changed = repos.routeTasks.listChangedSince!;
  let pages = 0, exactReads = 0;
  const guarded = { ...repos, routeTasks: { ...repos.routeTasks, list: async () => { throw Error("WHOLE_ROUTE_TABLE_FORBIDDEN"); },
    listChangedSince: async (...args: Parameters<typeof changed>) => {
      assert.deepEqual(args[2]?.projection, HELD_DIGGER_SOURCE_FIELDS);
      assert.equal(typeof args[2]?.page, "function");
      const original = args[2]!.page!;
      return changed(args[0], args[1], { ...args[2], page: async rows => {
        for (const row of rows) { pages++; await original([row]); }
      } });
    } }, artifacts: { ...repos.artifacts,
    readAll: async () => { throw Error("ALL_ARTIFACTS_FORBIDDEN"); },
    readChangedSince: async () => { throw Error("COUNTRY_ARTIFACT_HISTORY_FORBIDDEN"); },
    readWhere: async (...args: Parameters<typeof repos.artifacts.readWhere>) => {
      exactReads++; assert.deepEqual(args, [f.item.id, ["artifactId"], f.artifact.artifactId]);
      return repos.artifacts.readWhere(args[0], args[1], args[2]);
    },
    read: async (key: string) => { assert.equal(key, f.item.id); return repos.artifacts.read(key); },
  } };
  assert.equal((await planHeldDiggers(runtime(guarded))).length, 1);
  assert.equal(pages, 1); assert.equal(exactReads, 2, "planner and enqueue independently verify the same exact acquisition artifact");
});

test("partial, unrelated, and worker-produced captures do not recursively create diggers", async () => {
  const r = runtime();
  await acquisition(r.repos, { key: "partial", partial: true });
  await acquisition(r.repos, { key: "unrelated", routeId: "arbitrary-http" });
  const f = await acquisition(r.repos, { key: "worker" });
  const source = await r.repos.routeTasks.mustRead(f.route.id);
  await r.repos.routeTasks.compareAndSet(source.id, source.revision, { ...source.value, workerTask: {
    schemaVersion: 1, role: "ACQUIRER", artifactId: f.artifact.artifactId, producerResultId: null, validatorResultId: null,
    auditScope: "CAPTURED_ARTIFACT", implementationVersion: "fixture", contract: { schemaVersion: 1, recordClass: "CIVICCLERK_EVENTS", subjectId: f.item.subject,
      sourceBodyId: null, sourceBodyName: null, publisherSlug: "fixture", requiredFields: [], expectedSourceDate: null, completenessScope: "Fixture." },
  } }, NOW);
  assert.deepEqual(await planHeldDiggers(r), []);
  assert.equal(await hasOwedHeldDiggers(r), false);
});

test("an unavailable or foreign subject scope fails visibly and leaves the source pass retryable", async () => {
  const r = runtime();
  await acquisition(r.repos, { scope: [DIVISION, "ocd-division/country:us/state:nh"] });
  await assert.rejects(planHeldDiggers(r), /HELD_DIGGER_SUBJECT_SCOPE_AMBIGUOUS/);
  assert.equal(await r.repos.passCursors.read(HELD_DIGGER_CURSOR), null);
  const other = runtime();
  await acquisition(other.repos, { obligationSubject: "member:someone-else" });
  await assert.rejects(planHeldDiggers(other), /HELD_DIGGER_SUBJECT_SCOPE_UNAVAILABLE/);
  assert.equal(await other.repos.passCursors.read(HELD_DIGGER_CURSOR), null);
});

test("a failed later page preserves the previous cursor while earlier durable queue entries deduplicate on retry", async () => {
  const repos = createMemoryRepositories();
  await acquisition(repos, { key: "first" }); await acquisition(repos, { key: "second" });
  const original = repos.routeTasks.listChangedSince!;
  let fail = true;
  const r = runtime({ ...repos, routeTasks: { ...repos.routeTasks, listChangedSince: async (...args: Parameters<typeof original>) => {
    const result = await original(args[0], args[1], { ...args[2], page: async rows => {
      await args[2]!.page!([rows[0]!]);
      if (fail) throw Error("LATER_PAGE_UNAVAILABLE");
      for (const row of rows.slice(1)) await args[2]!.page!([row]);
    } });
    return result;
  } } });
  await assert.rejects(planHeldDiggers(r), /LATER_PAGE_UNAVAILABLE/);
  assert.equal(await repos.passCursors.read(HELD_DIGGER_CURSOR), null);
  assert.equal((await repos.routeTasks.list()).filter(row => isHeldDiggerTask(row.value)).length, 1);
  fail = false;
  assert.equal((await planHeldDiggers(r)).length, 2);
  assert.equal((await repos.routeTasks.list()).filter(row => isHeldDiggerTask(row.value)).length, 2);
});

test("standing's owed signal and following plan share one metadata pass, while pending workers remain owed after cursor moves", async () => {
  const repos = createMemoryRepositories(); await acquisition(repos);
  const read = repos.routeTasks.listChangedSince!; let scans = 0;
  const r = runtime({ ...repos, routeTasks: { ...repos.routeTasks, listChangedSince: async (...args: Parameters<typeof read>) => {
    scans++; return read(...args);
  } } });
  assert.equal(await hasOwedHeldDiggers(r), true);
  assert.equal(await hasOwedHeldDiggers(r), true);
  assert.equal((await planHeldDiggers(r)).length, 1);
  assert.equal(scans, 1);
  const cursor = await repos.passCursors.mustRead(HELD_DIGGER_CURSOR);
  await repos.passCursors.compareAndSet(cursor.id, cursor.revision, { through: "2099-01-01T00:00:00.000Z" }, NOW);
  assert.equal((await planHeldDiggers(r)).length, 1);
  assert.equal(scans, 2, "the unchanged worker stays due even when acquisition metadata is outside the incremental window");
});

test("a worker already in flight or ended with a permanent failure stays governed by ordinary attempt admission", async () => {
  const r = runtime(); await acquisition(r.repos);
  const [task] = await planHeldDiggers(r);
  assert.ok(task);
  const held = await r.repos.routeTasks.mustRead(task.id);
  await r.repos.routeTasks.compareAndSet(task.id, held.revision, { ...held.value, state: "CLAIMED" }, NOW);
  assert.deepEqual(await planHeldDiggers(r), [], "a source replay never duplicates an active worker");
  const claim = await r.repos.routeTasks.mustRead(task.id);
  const failedId = "attempt-permanent-failure";
  const f = await r.repos.attempts.list();
  const source = f[0]!.value;
  await r.repos.attempts.put(failedId, { ...source, id: failedId, routeTaskId: task.id, outcome: "ABORTED", endedAt: AT,
    abortReason: "HELD_DETAIL_SOURCE_RECEIPT_REFUSED" }, AT);
  await r.repos.routeTasks.compareAndSet(task.id, claim.revision, { ...claim.value, state: "RECLAIMABLE", attemptIds: [failedId] }, NOW);
  assert.deepEqual(await planHeldDiggers(r), [], "an unchanged permanent failure requires a changed source, method or input");
});
