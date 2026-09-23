/**
 * **A SETTLED ROUTE IS NEVER WALKED AGAIN, AND SETTLING IT NEVER CLOSES THE
 * OBLIGATION'S REMAINING WORK.** (2026-09-22.)
 *
 * The upstream cause of the dead leases in `tests/dead-lease-sweep.test.ts`. A
 * dispatch commits its disposition while it runs, and the cycle closes the
 * occurrence afterwards, so a cycle that ends between the two leaves the
 * occurrence open on a RouteTask that is already disposed. The next cycle
 * resumed it and dispatched it: `claimRouteTask` admitted the claim and flipped
 * DISPOSED to CLAIMED, a second Attempt opened, its disposition was refused as a
 * second one, and its lease was left behind. On 2026-09-22 production held 65
 * tasks in that shape and 62 more open occurrences waiting to produce it.
 *
 * The fix has two halves: `resumeOpenOccurrence` returns such an occurrence as
 * SETTLED and the cycle recovers it with the disposition already committed, and
 * `claimRouteTask` refuses a disposed RouteTask and writes nothing. Recovery
 * closes the OCCURRENCE by the rule a dispatch's own disposition is judged by,
 * and nothing more — so the tests below also hold what it must not close:
 * INGESTED bytes stay readable to parsing, verification and staging; a
 * WALKED_NO_YIELD or a non-reading disposition leaves the obligation owed and
 * walked again under a new RouteTask; an aborted or interrupted occurrence (no
 * disposition) is still dispatched, its earlier Attempt and partial evidence
 * kept.
 *
 * The fixture is the production shape, built by the calls production made: an
 * occurrence opened and dispatched to a committed disposition by a cycle that
 * then ended before its occurrence-and-debt phase. Every test runs on the
 * in-memory double AND the durable file store.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { claim } from "../lib/control-plane/attempt.ts";
import { recordAcquisition } from "../lib/control-plane/evidence/artifact.ts";
import {
  RouteTaskSettled,
  abandonAttempt,
  beginAttemptFor,
  claimRouteTask,
  disposeRouteTask,
  recordArtifactMetadata,
} from "../lib/control-plane/repository/coordinator.ts";
import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import { recordFailure } from "../lib/control-plane/scheduler/debt.ts";
import { dispatchOne, sweepExpiredLeases, type RunWork } from "../lib/control-plane/scheduler/dispatch.ts";
import {
  closeSettledOccurrence,
  findSettledOccurrences,
  loadDebts,
  openOccurrence,
  persistDebts,
  resumeOpenOccurrence,
  settledRouteTaskIds,
  standing,
} from "../lib/control-plane/scheduler/durable.ts";
import {
  isScheduled,
  scheduleObligation,
  type FreshnessObligation,
  type ScheduledObligation,
} from "../lib/control-plane/scheduler/obligation.ts";
import { stageOne } from "../lib/control-plane/scheduler/promotion-tail.ts";
import type { RouteDescriptor } from "../lib/control-plane/scheduler/registry.ts";
import {
  closeCycleOccurrences,
  digestLines,
  runCycle,
  type ResearchLanes,
} from "../lib/control-plane/scheduler/shadow-loop.ts";
import { cycleVault } from "../lib/control-plane/scheduler/vault.ts";
import { advanceHeldWorkerFleet, standingFleetRuntime } from "../lib/control-plane/workers/standing.ts";
import {
  installOperationalReferenceBundle,
  operationalReferenceBundle,
} from "../lib/civic-data/operational-references.ts";
import type { ContractReading } from "../lib/health/contracts.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
/* The held-evidence workers resolve the Avondale feed's subject through the operational registry. */
installOperationalReferenceBundle(operationalReferenceBundle({
  az: JSON.parse(readFileSync(join(ROOT, "data/states/az/jurisdictions/az.json"), "utf8")),
  nh: JSON.parse(readFileSync(join(ROOT, "data/states/nh/jurisdictions/nh.json"), "utf8")),
  nj: JSON.parse(readFileSync(join(ROOT, "data/states/nj/jurisdictions/nj.json"), "utf8")),
}));

const T0 = "2026-09-01T19:36:07.092Z"; // the cycle that committed its dispositions and died
const T1 = "2026-09-22T20:00:00.000Z"; // the cycle that resumes them
const T2 = "2026-09-22T21:00:00.000Z"; // the cycle after that
const TTL = 120_000;
const READER: ContractReading = { contract: "READER", state: "NOT_READY", reason: "fixture" };
const TRUTH: ContractReading = { contract: "TRUTH", state: "NOT_READY", reason: "fixture" };
const AVONDALE = "az:city:city-of-avondale";
const AVONDALE_EVENTS = "https://avondaleaz.api.civicclerk.com/v1/Events";

async function eachStore(): Promise<Array<readonly [string, ControlPlaneRepositories]>> {
  return [
    ["memory", createMemoryRepositories()],
    ["file", await createFileRepositories(mkdtempSync(join(tmpdir(), "wtp-settled-")))],
  ];
}

function obligation(id: string, over: Partial<FreshnessObligation> = {}): FreshnessObligation {
  return {
    id,
    recordClass: "meetings",
    subjectId: "wtp-body/settled",
    routeId: "legistar:events",
    active: true,
    readerImpactAt: null,
    observedChangeRateHours: null,
    lastWorkedAt: null,
    ...over,
  };
}

function scheduled(o: FreshnessObligation, now: string): ScheduledObligation {
  const row = scheduleObligation(o, Date.parse(now));
  assert.ok(isScheduled(row));
  return row;
}

/** A route walked to a terminal disposition that carries no bytes. */
function disposes(disposition: "WALKED_NO_YIELD" | "REQUIRES_NEW_ADAPTER"): RunWork {
  const reached = disposition === "WALKED_NO_YIELD";
  return async () => ({
    ranAs: "DETERMINISTIC",
    kind: "DISPOSED",
    disposition: {
      disposition,
      observation: null,
      permission: reached ? "ALLOWED" : "CANNOT_TELL",
      transport: reached ? "REACHABLE" : "OTHER_NAMED_FAILURE",
      note: `the fixture route closed ${disposition}`,
    },
    detail: `walked to ${disposition}`,
  });
}

/** A route that retrieved real bytes: vaulted first, then disposed INGESTED over them. */
function ingests(vaultRoot: string, url: string, body: string): RunWork {
  const vault = cycleVault(vaultRoot);
  return async ({ workItemId, attemptId, obligation: row }) => {
    const { artifact } = recordAcquisition(
      {
        canonicalUrl: url,
        retrievedAt: T0,
        httpStatus: 200,
        contentType: "application/json",
        sourceId: new URL(url).hostname,
        methodRouteId: row.obligation.routeId ?? "fixture",
        workItemId,
        attemptId,
        permission: "ALLOWED",
        transport: "REACHABLE",
      },
      body,
    );
    await vault.put(artifact, body);
    return {
      ranAs: "DETERMINISTIC",
      kind: "DISPOSED",
      artifacts: [
        {
          artifactId: artifact.id,
          tier: artifact.tier,
          contentHash: artifact.contentHash,
          byteLength: artifact.byteLength,
          contentType: artifact.contentType,
          canonicalUrl: artifact.canonicalUrl,
          partial: false,
          recordedAt: T0,
        },
      ],
      disposition: {
        disposition: "INGESTED",
        observation: null,
        permission: "ALLOWED",
        transport: "REACHABLE",
        note: "the fixture retrieved and vaulted the record",
      },
      detail: "retrieved",
    };
  };
}

/**
 * An occurrence walked to a committed disposition by a cycle that then ended
 * before its occurrence-and-debt phase: no occurrence closed, no debt persisted.
 */
async function interrupted(repos: ControlPlaneRepositories, o: FreshnessObligation, run: RunWork) {
  await repos.obligations.put(o.id, standing(o, T0), T0);
  const opened = await openOccurrence(repos, {
    obligation: (await repos.obligations.mustRead(o.id)).value,
    dueAt: T0,
    now: T0,
  });
  assert.ok(opened);
  const walked = await dispatchOne(repos, {
    obligation: scheduled(o, T0),
    routeTaskId: opened.routeTask.id,
    holder: "freshness-shadow@died",
    now: T0,
    leaseTtlMs: TTL,
    maturity: () => "GRADUATED",
    executor: { lane: "DETERMINISTIC", run },
  });
  return {
    occurrenceId: opened.occurrence.id,
    routeTaskId: opened.routeTask.id,
    workItemId: opened.workItem.id,
    walked,
  };
}

/** Fails the test the moment a settled route is walked. */
const neverRuns: RunWork = async () => {
  throw new Error("a settled route was walked again");
};

/**
 * One cycle as the standing runner runs it: occurrences resumed or opened in
 * step with dispatch (scripts/freshness-shadow.mts `openOccurrenceInStep`), then
 * closed by `closeCycleOccurrences` and the debt persisted. `scan` runs the
 * runner's pre-dispatch scan (`findSettledOccurrences` from a RouteTask
 * listing); without it, only a lane that reaches a row recovers it.
 */
async function cycleAt(
  repos: ControlPlaneRepositories,
  now: string,
  run: RunWork = neverRuns,
  options: { readonly scan?: boolean; readonly maxDispatches?: number; readonly research?: ResearchLanes } = {},
) {
  const rows = (await repos.obligations.list()).map((row) => row.value);
  const open = new Map<string, { id: string; routeTaskId: string }>();
  let ran = 0;
  const settledOccurrences = options.scan
    ? await findSettledOccurrences(repos, { obligations: rows, settledRouteTaskIds: settledRouteTaskIds(await repos.routeTasks.list()) })
    : undefined;
  const cycle = await runCycle({
    repos,
    obligations: rows,
    debts: await loadDebts(repos),
    routeTaskFor: (id) => open.get(id)?.routeTaskId ?? null,
    ...(settledOccurrences !== undefined ? { settledOccurrences } : {}),
    ...(options.maxDispatches !== undefined ? { maxDispatches: options.maxDispatches } : {}),
    ...(options.research !== undefined ? { research: options.research } : {}),
    openOccurrence: async (row) => {
      const held = rows.find((o) => o.id === row.obligation.id)!;
      const resumed = await resumeOpenOccurrence(repos, held);
      if (resumed?.kind === "SETTLED") return { settled: resumed.settled };
      if (resumed !== null) {
        open.set(held.id, { id: resumed.id, routeTaskId: resumed.routeTaskId });
        return true;
      }
      const opened = await openOccurrence(repos, { obligation: held, dueAt: row.nextDueAt, now });
      if (opened === null) return false;
      open.set(held.id, { id: opened.occurrence.id, routeTaskId: opened.routeTask.id });
      return true;
    },
    maturity: () => "GRADUATED",
    executor: {
      lane: "DETERMINISTIC",
      run: async (input) => {
        ran += 1;
        return run(input);
      },
    },
    holder: `freshness-shadow@${now}`,
    now,
    leaseTtlMs: TTL,
    reader: READER,
    truth: TRUTH,
  });
  await closeCycleOccurrences(repos, { cycle, occurrenceFor: (id) => open.get(id)?.id ?? null, now });
  await persistDebts(repos, cycle.debts, now);
  return { cycle, ran, open };
}

/** Everything a second walk of one route would write, read back. */
async function routeState(repos: ControlPlaneRepositories, routeTaskId: string, workItemId: string) {
  return {
    task: await repos.routeTasks.mustRead(routeTaskId),
    lease: await repos.leases.read(routeTaskId),
    attempts: (await repos.attempts.list()).filter((row) => row.value.routeTaskId === routeTaskId),
    commits: await repos.dispositions.read(routeTaskId),
    artifacts: await repos.artifacts.read(workItemId),
    leaseSlots: (await repos.leases.list()).map((row) => row.id),
  };
}

test("SEEDED: an open occurrence on an already-disposed RouteTask is recovered, never dispatched — no second claim, Attempt or lease", async () => {
  for (const [label, repos] of await eachStore()) {
    const vaultRoot = mkdtempSync(join(tmpdir(), "wtp-settled-vault-"));
    /* Two occurrences a single dying cycle disposed, like the 62 production still held: a reading and a route fact. */
    const read = await interrupted(repos, obligation("ob-ingested"), ingests(vaultRoot, "https://example.gov/feed.json", '{"rows":[1]}'));
    const adapter = await interrupted(repos, obligation("ob-adapter"), disposes("REQUIRES_NEW_ADAPTER"));
    await repos.debts.put(
      "ob-adapter",
      recordFailure(null, {
        obligationId: "ob-adapter",
        cause: "REFUSED_BY_HOST",
        detail: "an earlier occurrence's failure",
        target: "legistar:events",
        dueAt: T0,
        now: T0,
      }),
      T0,
    );
    for (const [name, fixture, disposition] of [["reading", read, "INGESTED"], ["adapter", adapter, "REQUIRES_NEW_ADAPTER"]] as const) {
      assert.equal(fixture.walked.dispositionCommitted, true, `${label}/${name}: the dying cycle committed its disposition`);
      assert.equal(fixture.walked.disposition, disposition);
      assert.equal((await repos.occurrences.mustRead(fixture.occurrenceId)).value.closedAt, null, `${label}/${name}: and left the occurrence open`);
    }
    const before = {
      read: await routeState(repos, read.routeTaskId, read.workItemId),
      adapter: await routeState(repos, adapter.routeTaskId, adapter.workItemId),
    };
    assert.equal(before.read.task.value.state, "DISPOSED");
    assert.equal(before.read.lease?.value.released, true, `${label}: the disposition released its lease`);

    const { cycle, ran } = await cycleAt(repos, T1);

    assert.equal(ran, 0, `${label}: no executor ran — neither settled route was walked again`);
    assert.deepEqual(cycle.dispatched, [], `${label}: nothing was dispatched`);
    assert.deepEqual(
      cycle.recovered.map((r) => [r.obligationId, r.disposition.disposition, r.discharged]).sort(),
      [["ob-adapter", "REQUIRES_NEW_ADAPTER", false], ["ob-ingested", "INGESTED", true]],
      `${label}: both recovered, the reading as a discharge and the route fact as still owed`,
    );
    for (const recovered of cycle.recovered) {
      const task = await repos.routeTasks.mustRead(recovered.routeTaskId);
      assert.deepEqual(recovered.disposition, task.value.disposition, `${label}: recovered verbatim, never re-derived`);
    }
    for (const [name, fixture] of [["reading", read], ["adapter", adapter]] as const) {
      assert.deepEqual(
        await routeState(repos, fixture.routeTaskId, fixture.workItemId),
        before[name === "reading" ? "read" : "adapter"],
        `${label}/${name}: the RouteTask, its lease, Attempts, disposition commit, artifacts and the lease slots are exactly as the dying cycle left them`,
      );
    }

    /* What discharge closed, and what it did not. */
    const readOccurrence = (await repos.occurrences.mustRead(read.occurrenceId)).value;
    assert.equal(readOccurrence.closedAt, T1);
    assert.equal(readOccurrence.disposition, "INGESTED");
    assert.equal(readOccurrence.unresolvedReason, null);
    const readObligation = (await repos.obligations.mustRead("ob-ingested")).value;
    assert.equal(readObligation.openOccurrenceId, null);
    assert.equal(readObligation.lastWorkedAt, T0, `${label}: anchored on the reading's own time, not on the recovery`);
    assert.equal(readObligation.active, true, `${label}: the standing obligation recurs; it is never completed`);

    const adapterOccurrence = (await repos.occurrences.mustRead(adapter.occurrenceId)).value;
    assert.equal(adapterOccurrence.closedAt, T1);
    assert.equal(adapterOccurrence.disposition, null, `${label}: a route fact is not a reading`);
    assert.match(adapterOccurrence.unresolvedReason ?? "", /already disposed REQUIRES_NEW_ADAPTER .*obligation stays owed/);
    assert.equal((await repos.obligations.mustRead("ob-adapter")).value.lastWorkedAt, null, `${label}: the anchor does not move`);
    const debt = (await repos.debts.mustRead("ob-adapter")).value;
    assert.equal(debt.consecutiveFailures, 2, `${label}: the owed obligation accrues debt as a WORKED non-reading does`);
    assert.equal(debt.cause, "REFUSED_BY_HOST");
    assert.match(debt.detail, /REQUIRES_NEW_ADAPTER/);

    /* Reported apart from dispatches, and a recovered reading is not overdue. */
    const lines = digestLines(cycle);
    assert.ok(
      lines.some((l) => /^ {2}recovered +2 open occurrence\(s\).*1 reading\(s\) discharged, 1 still owed/.test(l)),
      `${label}: the digest names the recovery`,
    );
    assert.ok(lines.some((l) => /^ {2}dispatched +0 /.test(l)), `${label}: and counts no dispatch for it`);
    assert.equal(cycle.risk.obligationsOverdue, 1, `${label}: two due, one reading recovered, one still owed`);
  }
});

test("SEEDED: claimRouteTask refuses a disposed RouteTask and writes nothing, and a dead lease on one is left for the sweep", async () => {
  for (const [label, repos] of await eachStore()) {
    const walked = await interrupted(repos, obligation("ob-settled"), disposes("WALKED_NO_YIELD"));
    const before = await routeState(repos, walked.routeTaskId, walked.workItemId);

    await assert.rejects(
      claimRouteTask(repos, { routeTaskId: walked.routeTaskId, holder: "late-dispatch", now: T1, ttlMs: TTL }),
      (error: unknown) =>
        error instanceof RouteTaskSettled &&
        error.routeTaskId === walked.routeTaskId &&
        /already disposed as WALKED_NO_YIELD/.test(error.message),
    );
    assert.deepEqual(await routeState(repos, walked.routeTaskId, walked.workItemId), before, `${label}: nothing moved`);

    /* The 65's shape: the pre-fix claim took the slot and wrote CLAIMED, and its dispatch left the lease. */
    const slot = await repos.leases.mustRead(walked.routeTaskId);
    const legacy = await repos.leases.compareAndSet(
      walked.routeTaskId,
      slot.revision,
      claim(walked.routeTaskId, "legacy-dispatch", T1, TTL, slot.value),
      T1,
    );
    const task = await repos.routeTasks.mustRead(walked.routeTaskId);
    await repos.routeTasks.compareAndSet(walked.routeTaskId, task.revision, { ...task.value, state: "CLAIMED" }, T1);
    const redundant = await beginAttemptFor(repos, {
      routeTaskId: walked.routeTaskId,
      workItemId: walked.workItemId,
      worker: { role: "ACQUIRER", provider: "we-the-people", version: "deterministic-walker", instance: "legacy-dispatch" },
      lease: legacy.value,
      now: T1,
      methodVersion: 0,
      policyVersion: "unversioned",
    });
    await assert.rejects(
      abandonAttempt(repos, {
        routeTaskId: walked.routeTaskId,
        attemptId: redundant.value.id,
        outcome: "ABORTED",
        reason: "the control plane refused the proposed disposition",
        now: T1,
      }),
      /settled route/,
    );
    const residue = await routeState(repos, walked.routeTaskId, walked.workItemId);
    assert.equal(residue.task.value.state, "CLAIMED", `${label}: the production residue, asserted`);
    assert.equal(residue.lease?.value.released, false);

    await assert.rejects(
      claimRouteTask(repos, { routeTaskId: walked.routeTaskId, holder: "next-dispatch", now: T2, ttlMs: TTL }),
      RouteTaskSettled,
    );
    assert.deepEqual(
      await routeState(repos, walked.routeTaskId, walked.workItemId),
      residue,
      `${label}: the refusal does not take over the dead lease, open an Attempt or touch the state`,
    );

    /* A still-open occurrence on it is SETTLED: disposition is read, not the overwritten state. */
    const resumed = await resumeOpenOccurrence(repos, (await repos.obligations.mustRead("ob-settled")).value);
    assert.equal(resumed?.kind, "SETTLED", `${label}: resumed as settled despite state ${residue.task.value.state}`);

    const sweep = await sweepExpiredLeases(repos, { now: T2, observedBy: "sweeper" });
    assert.deepEqual(sweep.releasedSettled, [walked.routeTaskId], `${label}: the sweep releases the dead lease`);
  }
});

test("claimRouteTask refuses a RouteTask disposed while the claim raced for its lease, and gives back the lease it won", async () => {
  for (const [label, repos] of await eachStore()) {
    await repos.obligations.put("ob-race", standing(obligation("ob-race"), T0), T0);
    const opened = await openOccurrence(repos, {
      obligation: (await repos.obligations.mustRead("ob-race")).value,
      dueAt: T0,
      now: T0,
    });
    assert.ok(opened);
    const routeTaskId = opened.routeTask.id;
    const first = await claimRouteTask(repos, { routeTaskId, holder: "worker-a", now: T0, ttlMs: TTL });
    const walking = await beginAttemptFor(repos, {
      routeTaskId,
      workItemId: opened.workItem.id,
      worker: { role: "ACQUIRER", provider: "we-the-people", version: "deterministic-walker", instance: "worker-a" },
      lease: first.lease.value,
      now: T0,
      methodVersion: 0,
      policyVersion: "unversioned",
    });

    /* Worker B passes the settled check; worker A commits its disposition before B reads the lease slot. */
    let disposedDuringRace = false;
    const racing = new Proxy(repos, {
      get(target, kind, receiver) {
        const store = Reflect.get(target, kind, receiver);
        if (kind !== "leases") return store;
        return new Proxy(store, {
          get(leases, method) {
            const operation = Reflect.get(leases, method);
            if (method !== "read" || typeof operation !== "function") {
              return typeof operation === "function" ? operation.bind(leases) : operation;
            }
            return async (...args: unknown[]) => {
              if (!disposedDuringRace) {
                disposedDuringRace = true;
                await disposeRouteTask(repos, {
                  routeTaskId,
                  attemptId: walking.value.id,
                  expectedTaskRevision: (await repos.routeTasks.mustRead(routeTaskId)).revision,
                  now: T0,
                  disposition: {
                    disposition: "WALKED_NO_YIELD",
                    attemptId: walking.value.id,
                    at: T0,
                    artifactIds: [],
                    observation: null,
                    permission: "ALLOWED",
                    transport: "REACHABLE",
                    note: "worker A finished first",
                  },
                });
              }
              return operation.apply(leases, args);
            };
          },
        });
      },
    });
    const settledTask = async () => (await repos.routeTasks.mustRead(routeTaskId)).value;

    await assert.rejects(
      claimRouteTask(racing, { routeTaskId, holder: "worker-b", now: T0, ttlMs: TTL }),
      RouteTaskSettled,
    );
    assert.equal(disposedDuringRace, true, `${label}: the race happened`);
    const task = await settledTask();
    assert.equal(task.state, "DISPOSED", `${label}: B's refusal did not overwrite the state`);
    assert.equal(task.disposition?.attemptId, walking.value.id, `${label}: A's disposition stands`);
    const lease = (await repos.leases.mustRead(routeTaskId)).value;
    assert.equal(lease.holder, "worker-b", `${label}: B won the slot...`);
    assert.equal(lease.released, true, `${label}: ...and gave it back`);
    assert.deepEqual(
      (await repos.attempts.list()).filter((row) => row.value.routeTaskId === routeTaskId).map((row) => row.id),
      [walking.value.id],
      `${label}: B opened no Attempt`,
    );
  }
});

test("a recovered INGESTED occurrence keeps its bytes eligible for parsing, verification and staging", async () => {
  const feed = JSON.stringify({
    "@odata.context": "https://avondaleaz.api.civicclerk.com/v1/$metadata#Events",
    value: [{
      id: 7, eventName: "Council fixture 7", startDateTime: "2026-09-04T18:00:00", eventDate: "2026-09-04T00:00:00",
      categoryId: 26, eventCategoryName: "City Council", isPublished: true,
    }],
  });
  for (const [label, repos] of await eachStore()) {
    const vaultRoot = mkdtempSync(join(tmpdir(), "wtp-settled-vault-"));
    const held = await interrupted(
      repos,
      obligation("ob-avondale", { subjectId: AVONDALE, routeId: "avondale-civicclerk-events" }),
      ingests(vaultRoot, AVONDALE_EVENTS, feed),
    );
    const committed = (await repos.routeTasks.mustRead(held.routeTaskId)).value.disposition!;
    const { cycle, ran } = await cycleAt(repos, T1);
    assert.equal(ran, 0);
    assert.equal(cycle.recovered.length, 1);
    const recovered = cycle.recovered[0];
    assert.equal(recovered.discharged, true);

    /* The evidence is the disposing Attempt's, untouched. */
    const records = await repos.artifacts.read(held.workItemId);
    assert.deepEqual(records.map((r) => r.artifactId), committed.artifactIds, `${label}: the artifact record stands`);
    assert.equal(records[0].attemptId, committed.attemptId);
    assert.equal((await repos.dispositions.read(held.routeTaskId)).length, 1, `${label}: one commit, never a second`);

    /* STAGING: a later cycle's vault reads the bytes back by held identity, and nothing else's. */
    const later = cycleVault(vaultRoot);
    assert.equal(later.ledger.size, 0, `${label}: this cycle retrieved nothing`);
    assert.equal(await later.readHeld(records[0]), feed, `${label}: the recovered bytes are read back`);
    assert.equal(await later.readHeld({ ...records[0], attemptId: "at-someone-else" }), null, `${label}: only under the record's own identity`);
    const staged = stageOne({
      root: mkdtempSync(join(tmpdir(), "wtp-settled-stage-")),
      obligationId: recovered.obligationId,
      providerId: "fixture",
      recordClass: "meetings",
      subjectId: AVONDALE,
      route: {
        routeId: "avondale-civicclerk-events",
        label: "Avondale CivicClerk events",
        executorClass: "DETERMINISTIC",
        executorReason: "fixture",
        open: { kind: "HTTP_GET", url: AVONDALE_EVENTS },
        citation: "fixture",
      },
      disposition: recovered.disposition.disposition,
      artifactIds: recovered.disposition.artifactIds,
      body: await later.readHeld(records[0]),
      nextDueAt: null,
      detail: "recovered",
      stagedOn: "2026-09-22",
    });
    assert.match(staged.readerSentence, /ACQUIRED and is held/, `${label}: staged as held, never as "not yet reached"`);
    assert.ok(staged.unresolved.some((u) => u.includes(committed.artifactIds[0])), `${label}: citing the held artifact`);

    /* PARSING, VALIDATION, AUDIT: the held-evidence workers still enqueue the first stage for it. */
    const runtime = standingFleetRuntime({ root: ROOT, vaultRoot, repos, now: () => T2 });
    await advanceHeldWorkerFleet(ROOT, runtime, 1);
    const parser = (await repos.routeTasks.list()).find(
      (row) => row.value.workerTask?.role === "PARSER" && row.value.workerTask.artifactId === committed.artifactIds[0],
    );
    assert.ok(parser, `${label}: a PARSER task is queued for the recovered bytes`);
    assert.equal(parser.value.workItemId, held.workItemId);
    assert.equal(parser.value.state, "PENDING");
  }
});

test("a recovered INGESTED occurrence with a normalizer stages PROMOTION-READY from bytes an earlier cycle vaulted", async () => {
  const body = JSON.stringify({
    draw: 1,
    recordsTotal: 1,
    recordsFiltered: 1,
    data: [{ EntityID: 1, EntityLastName: "Fixture, Filer <br>(1)", Income: 1, Expense: 0, CashBalance: 1 }],
  });
  const route: RouteDescriptor = {
    routeId: "az-sos-seethemoney-datatables",
    label: "the Arizona filer index",
    executorClass: "DETERMINISTIC",
    executorReason: "fixture",
    open: { kind: "HTTP_GET", url: "https://seethemoney.az.gov/Reporting/GetNEWTableData/" },
    citation: "fixture",
  };
  for (const [label, repos] of await eachStore()) {
    const vaultRoot = mkdtempSync(join(tmpdir(), "wtp-settled-vault-"));
    const held = await interrupted(
      repos,
      obligation("ob-az-money", { recordClass: "campaign-finance", routeId: route.routeId }),
      ingests(vaultRoot, "https://seethemoney.az.gov/Reporting/GetNEWTableData/", body),
    );
    const { cycle } = await cycleAt(repos, T1);
    const recovered = cycle.recovered[0];
    const record = (await repos.artifacts.read(held.workItemId)).find((r) => r.artifactId === recovered.disposition.artifactIds[0])!;
    const staged = stageOne({
      root: mkdtempSync(join(tmpdir(), "wtp-settled-stage-")),
      obligationId: recovered.obligationId,
      providerId: "campaign-finance",
      recordClass: "campaign-finance",
      subjectId: "az-sos-cfs-2026",
      route,
      disposition: recovered.disposition.disposition,
      artifactIds: recovered.disposition.artifactIds,
      body: await cycleVault(vaultRoot).readHeld(record),
      nextDueAt: null,
      detail: "recovered",
      stagedOn: "2026-09-22",
    });
    assert.equal(staged.state, "STAGED_PROMOTION_READY", `${label}: normalized and staged, not left as inventory`);
    assert.equal(staged.rowCount, 1);
  }
});

test("a recovered WALKED_NO_YIELD discharges this period's reading only: the obligation comes due again under a new RouteTask", async () => {
  for (const [label, repos] of await eachStore()) {
    const empty = await interrupted(repos, obligation("ob-empty"), disposes("WALKED_NO_YIELD"));
    await repos.debts.put(
      "ob-empty",
      recordFailure(null, {
        obligationId: "ob-empty",
        cause: "TRANSPORT_FAILED",
        detail: "an earlier occurrence could not connect",
        target: "legistar:events",
        dueAt: T0,
        now: T0,
      }),
      T0,
    );

    const recovery = await cycleAt(repos, T1);
    assert.equal(recovery.ran, 0);
    assert.equal(recovery.cycle.recovered[0].discharged, true);
    assert.equal((await repos.obligations.mustRead("ob-empty")).value.lastWorkedAt, T0);
    assert.equal((await repos.debts.mustRead("ob-empty")).value.consecutiveFailures, 0, `${label}: the reading clears the debt, as a dispatched one does`);

    /* The need stays open: the next cycle walks the obligation again, under a NEW RouteTask. */
    const next = await cycleAt(repos, T2, disposes("WALKED_NO_YIELD"));
    assert.equal(next.ran, 1, `${label}: walked again`);
    const again = next.open.get("ob-empty");
    assert.ok(again);
    assert.notEqual(again.routeTaskId, empty.routeTaskId, `${label}: a new occurrence with its own RouteTask`);
    assert.equal((await repos.occurrences.mustRead(again.id)).value.sequence, 2);
    assert.equal((await repos.dispositions.read(again.routeTaskId)).length, 1);

    /* And the earlier walk is kept as the evidence the next approach inherits. */
    assert.equal((await repos.routeTasks.mustRead(empty.routeTaskId)).value.disposition?.disposition, "WALKED_NO_YIELD");
    assert.equal((await repos.dispositions.read(empty.routeTaskId)).length, 1, `${label}: its commit is still in the log`);
    assert.equal((await repos.occurrences.mustRead(empty.occurrenceId)).value.routeTaskId, empty.routeTaskId);
  }
});

test("a recovered non-reading disposition leaves the obligation owed: unresolved, in debt, and retried under a new RouteTask", async () => {
  for (const [label, repos] of await eachStore()) {
    const walled = await interrupted(repos, obligation("ob-walled"), disposes("REQUIRES_NEW_ADAPTER"));

    const recovery = await cycleAt(repos, T1);
    assert.equal(recovery.ran, 0);
    const occurrence = (await repos.occurrences.mustRead(walled.occurrenceId)).value;
    assert.equal(occurrence.disposition, null, `${label}: closed unresolved`);
    const debt = (await repos.debts.mustRead("ob-walled")).value;
    assert.equal(debt.consecutiveFailures, 1);
    assert.equal(debt.retryAt, "2026-09-22T20:15:00.000Z", `${label}: on the ordinary backoff`);

    const heldBack = await cycleAt(repos, "2026-09-22T20:10:00.000Z", disposes("REQUIRES_NEW_ADAPTER"));
    assert.equal(heldBack.ran, 0, `${label}: not re-walked before its backoff`);
    assert.ok(heldBack.cycle.deferred.some((d) => d.obligationId === "ob-walled"), `${label}: deferred by name, never dropped`);

    const retried = await cycleAt(repos, "2026-09-22T20:20:00.000Z", disposes("REQUIRES_NEW_ADAPTER"));
    assert.equal(retried.ran, 1, `${label}: retried once the backoff elapsed`);
    assert.notEqual(retried.open.get("ob-walled")?.routeTaskId, walled.routeTaskId, `${label}: under a new RouteTask`);
    assert.equal((await repos.routeTasks.mustRead(walled.routeTaskId)).value.state, "DISPOSED", `${label}: the settled one untouched`);
  }
});

test("an aborted or interrupted occurrence is still resumed and dispatched, and its earlier Attempt and partial evidence are kept", async () => {
  for (const [label, repos] of await eachStore()) {
    const vaultRoot = mkdtempSync(join(tmpdir(), "wtp-settled-vault-"));
    const vault = cycleVault(vaultRoot);

    /* ABORTED: the worker reached no boundary but kept a partial capture. */
    const aborted = await interrupted(repos, obligation("ob-aborted"), async ({ workItemId, attemptId }) => {
      const body = '{"partial":';
      const { artifact } = recordAcquisition(
        {
          canonicalUrl: "https://example.gov/partial.json",
          retrievedAt: T0,
          httpStatus: 206,
          contentType: "application/json",
          sourceId: "example.gov",
          methodRouteId: "legistar:events",
          workItemId,
          attemptId,
          permission: "ALLOWED",
          transport: "REACHABLE",
        },
        body,
      );
      await vault.put(artifact, body);
      return {
        ranAs: "DETERMINISTIC",
        kind: "ABORTED",
        artifacts: [
          {
            artifactId: artifact.id,
            tier: artifact.tier,
            contentHash: artifact.contentHash,
            byteLength: artifact.byteLength,
            contentType: artifact.contentType,
            canonicalUrl: artifact.canonicalUrl,
            partial: true,
            recordedAt: T0,
          },
        ],
        detail: "the connection dropped mid-body",
      };
    });
    assert.equal(aborted.walked.dispositionCommitted, false);
    assert.equal((await repos.routeTasks.mustRead(aborted.routeTaskId)).value.state, "RECLAIMABLE");

    /* INTERRUPTED: a worker killed mid-walk, its Attempt open and its lease left to expire. */
    await repos.obligations.put("ob-killed", standing(obligation("ob-killed"), T0), T0);
    const killed = await openOccurrence(repos, {
      obligation: (await repos.obligations.mustRead("ob-killed")).value,
      dueAt: T0,
      now: T0,
    });
    assert.ok(killed);
    const claimed = await claimRouteTask(repos, { routeTaskId: killed.routeTask.id, holder: "killed", now: T0, ttlMs: TTL });
    const open = await beginAttemptFor(repos, {
      routeTaskId: killed.routeTask.id,
      workItemId: killed.workItem.id,
      worker: { role: "ACQUIRER", provider: "we-the-people", version: "deterministic-walker", instance: "killed" },
      lease: claimed.lease.value,
      now: T0,
      methodVersion: 0,
      policyVersion: "unversioned",
    });
    await recordArtifactMetadata(
      repos,
      {
        artifactId: "ar-partial-killed",
        workItemId: killed.workItem.id,
        routeTaskId: killed.routeTask.id,
        attemptId: open.value.id,
        tier: "RAW",
        contentHash: `sha256-${"a".repeat(64)}`,
        byteLength: 10,
        contentType: "application/json",
        canonicalUrl: "https://example.gov/killed.json",
        partial: true,
        recordedAt: T0,
      },
      T0,
    );

    const { cycle, ran } = await cycleAt(repos, T1, disposes("WALKED_NO_YIELD"));
    assert.deepEqual(cycle.recovered, [], `${label}: neither is settled, so neither is recovered`);
    assert.equal(ran, 2, `${label}: both are walked again`);
    assert.deepEqual(cycle.reclaim.reclaimed, [killed.routeTask.id], `${label}: the killed one reclaimed from outside first`);

    for (const [name, routeTaskId, firstOutcome, partialId] of [
      ["aborted", aborted.routeTaskId, "ABORTED", null],
      ["killed", killed.routeTask.id, "LEASE_EXPIRED", "ar-partial-killed"],
    ] as const) {
      const attempts = (await repos.attempts.list())
        .filter((row) => row.value.routeTaskId === routeTaskId)
        .sort((a, b) => (a.value.startedAt < b.value.startedAt ? -1 : 1));
      assert.deepEqual(attempts.map((row) => row.value.outcome), [firstOutcome, "COMPLETED"], `${label}/${name}: the earlier Attempt kept`);
      assert.ok(attempts[0].value.artifactIds.length > 0, `${label}/${name}: with its partial evidence attributed`);
      if (partialId !== null) assert.deepEqual(attempts[0].value.artifactIds, [partialId]);
      const task = (await repos.routeTasks.mustRead(routeTaskId)).value;
      assert.equal(task.disposition?.disposition, "WALKED_NO_YIELD", `${label}/${name}: then walked to a disposition`);
      assert.equal(task.disposition?.attemptId, attempts[1].id);
    }
    assert.equal((await repos.occurrences.mustRead(aborted.occurrenceId)).value.disposition, "WALKED_NO_YIELD");
    assert.equal((await repos.occurrences.mustRead(killed.occurrence.id)).value.disposition, "WALKED_NO_YIELD");
  }
});

/** A Scout lane that admits nothing, like production's while no delivery path is open. */
function closedScoutLane(modelIds: ReadonlySet<string>): ResearchLanes {
  return {
    decide: (row) =>
      modelIds.has(row.obligation.id)
        ? { kind: "BOUNDED_MODEL_WORKER", why: "fixture model row", disagreement: null }
        : { kind: "DETERMINISTIC", why: "fixture deterministic row", disagreement: null },
    admitScout: () => ({ admit: false, code: "LANE_DISABLED", why: "the fixture Scout lane is closed" }),
    modelExecutor: { lane: "BOUNDED_MODEL_WORKER", run: neverRuns },
    maxConcurrentScouts: 2,
    scoutLeaseTtlMs: TTL,
    scoutWallMs: 60_000,
  };
}

test("BEFORE DISPATCH: every settled occurrence is recovered with no dispatch capacity at all (a zero ceiling, a debt backoff, a closed Scout lane) and nothing is walked", async () => {
  for (const [label, repos] of await eachStore()) {
    const vaultRoot = mkdtempSync(join(tmpdir(), "wtp-settled-vault-"));
    const fixtures = {
      "ob-ingested": await interrupted(repos, obligation("ob-ingested"), ingests(vaultRoot, "https://example.gov/feed.json", '{"rows":[1]}')),
      "ob-adapter": await interrupted(repos, obligation("ob-adapter"), disposes("REQUIRES_NEW_ADAPTER")),
      "ob-scout": await interrupted(repos, obligation("ob-scout", { subjectId: "wtp-body/scout" }), disposes("WALKED_NO_YIELD")),
      "ob-backed-off": await interrupted(repos, obligation("ob-backed-off", { subjectId: "wtp-body/backed-off" }), disposes("WALKED_NO_YIELD")),
    };
    await repos.debts.put(
      "ob-adapter",
      recordFailure(null, { obligationId: "ob-adapter", cause: "REFUSED_BY_HOST", detail: "an earlier failure", target: "legistar:events", dueAt: T0, now: T0 }),
      T0,
    );
    const holding = recordFailure(null, {
      obligationId: "ob-backed-off",
      cause: "UPSTREAM_ERROR",
      detail: "a failure whose backoff has not elapsed",
      target: "legistar:events",
      dueAt: T0,
      now: "2026-09-22T19:59:00.000Z",
    });
    assert.ok(holding.retryAt > T1, "precondition: the backoff still holds at T1");
    await repos.debts.put("ob-backed-off", holding, T0);
    /* Due, never opened and not settled: ordinary work that the ceiling must still defer by name. */
    await repos.obligations.put("ob-owed", standing(obligation("ob-owed", { subjectId: "wtp-body/owed" }), T0), T0);
    const before = Object.fromEntries(
      await Promise.all(Object.entries(fixtures).map(async ([id, f]) => [id, await routeState(repos, f.routeTaskId, f.workItemId)] as const)),
    );

    const { cycle, ran } = await cycleAt(repos, T1, neverRuns, {
      scan: true,
      maxDispatches: 0,
      research: closedScoutLane(new Set(["ob-scout"])),
    });

    assert.equal(ran, 0, `${label}: nothing was walked`);
    assert.deepEqual(cycle.dispatched, [], `${label}: nothing was dispatched, on either lane`);
    assert.deepEqual(
      cycle.recovered.map((r) => [r.obligationId, r.disposition.disposition, r.discharged]).sort(),
      [
        ["ob-adapter", "REQUIRES_NEW_ADAPTER", false],
        ["ob-backed-off", "WALKED_NO_YIELD", true],
        ["ob-ingested", "INGESTED", true],
        ["ob-scout", "WALKED_NO_YIELD", true],
      ],
      `${label}: all four recovered once each, whatever the ceiling, the backoff or the Scout lane`,
    );
    assert.deepEqual(
      cycle.deferred.map((d) => d.obligationId),
      ["ob-owed"],
      `${label}: a recovered row is not also reported deferred; the one owed row is deferred by the ceiling`,
    );
    assert.match(cycle.deferred[0].why, /stated ceiling of 0/);
    assert.equal(cycle.lanes?.model.due, 0, `${label}: the recovered model row never reached the Scout lane`);
    for (const [id, f] of Object.entries(fixtures)) {
      assert.deepEqual(
        await routeState(repos, f.routeTaskId, f.workItemId),
        before[id],
        `${label}/${id}: no claim, Attempt, lease, disposition or artifact was written`,
      );
      assert.notEqual((await repos.occurrences.mustRead(f.occurrenceId)).value.closedAt, null, `${label}/${id}: closed`);
      assert.equal((await repos.obligations.mustRead(id)).value.openOccurrenceId, null);
    }
    const debts = new Map((await loadDebts(repos)).map((d) => [d.obligationId, d]));
    assert.equal(debts.get("ob-adapter")?.consecutiveFailures, 2, `${label}: the route fact accrues one failure`);
    assert.equal(debts.get("ob-backed-off")?.consecutiveFailures, 0, `${label}: a recovered reading clears the debt it was held under`);
    assert.match(debts.get("ob-backed-off")?.detail ?? "", /^cleared at .*discharged/, `${label}: as a tombstone, never a deletion`);
    assert.equal((await repos.obligations.mustRead("ob-backed-off")).value.lastWorkedAt, T0, `${label}: anchored on the reading's own time`);
  }
});

test("BEFORE DISPATCH: a recovered row is withheld from its lane, so an open lane neither recovers it twice nor walks it", async () => {
  for (const [label, repos] of await eachStore()) {
    const adapter = await interrupted(repos, obligation("ob-adapter"), disposes("REQUIRES_NEW_ADAPTER"));
    await repos.debts.put(
      "ob-adapter",
      recordFailure(null, { obligationId: "ob-adapter", cause: "REFUSED_BY_HOST", detail: "an earlier failure", target: "legistar:events", dueAt: T0, now: T0 }),
      T0,
    );
    const before = await routeState(repos, adapter.routeTaskId, adapter.workItemId);

    const { cycle, ran } = await cycleAt(repos, T1, neverRuns, { scan: true });

    assert.equal(ran, 0, `${label}: the admitted lane did not walk it`);
    assert.deepEqual(cycle.recovered.map((r) => r.obligationId), ["ob-adapter"], `${label}: recovered exactly once`);
    assert.deepEqual(await routeState(repos, adapter.routeTaskId, adapter.workItemId), before);
    assert.equal(
      (await loadDebts(repos)).find((d) => d.obligationId === "ob-adapter")?.consecutiveFailures,
      2,
      `${label}: one failure accrued, not one per recovery`,
    );
  }
});

test("findSettledOccurrences names exactly the open occurrences whose RouteTask is settled, each confirmed by a fresh read", async () => {
  for (const [label, repos] of await eachStore()) {
    await interrupted(repos, obligation("ob-settled"), disposes("WALKED_NO_YIELD"));
    /* Open on a RouteTask with no disposition: owed work, for a lane to dispatch. */
    await repos.obligations.put("ob-open", standing(obligation("ob-open", { subjectId: "wtp-body/open" }), T0), T0);
    await openOccurrence(repos, { obligation: (await repos.obligations.mustRead("ob-open")).value, dueAt: T0, now: T0 });
    /* Settled, and closed after both listings below were taken. */
    await interrupted(repos, obligation("ob-closed", { subjectId: "wtp-body/closed" }), disposes("WALKED_NO_YIELD"));

    const obligations = (await repos.obligations.list()).map((row) => row.value);
    const routeTasks = await repos.routeTasks.list();
    const closing = await resumeOpenOccurrence(repos, (await repos.obligations.mustRead("ob-closed")).value);
    assert.equal(closing?.kind, "SETTLED");
    if (closing?.kind === "SETTLED") await closeSettledOccurrence(repos, { settled: closing.settled, now: T1 });

    const found = await findSettledOccurrences(repos, { obligations, settledRouteTaskIds: settledRouteTaskIds(routeTasks) });
    assert.deepEqual(found.map((s) => s.obligationId), ["ob-settled"], `${label}: only the settled one still open`);
    const confirmed = await resumeOpenOccurrence(repos, (await repos.obligations.mustRead("ob-settled")).value);
    assert.deepEqual(found[0], confirmed?.kind === "SETTLED" ? confirmed.settled : null, `${label}: exactly what a lane's resume reads`);
    assert.deepEqual(
      await findSettledOccurrences(repos, { obligations, settledRouteTaskIds: new Set() }),
      [],
      `${label}: a listing that names no settled RouteTask yields no candidate`,
    );
  }
});
