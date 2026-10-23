import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
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
import { ConcurrentModification, type ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
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
import {
  closeCycleOccurrences,
  digestLines,
  runCycle,
  type ResearchLanes,
} from "../lib/control-plane/scheduler/shadow-loop.ts";
import { cycleVault } from "../lib/control-plane/scheduler/vault.ts";
import { advanceHeldWorkerFleet, standingFleetRuntime } from "../lib/control-plane/workers/standing.ts";
import { HELD_DIGGER_CLASSES, HELD_DIGGER_SOURCE_FIELDS, type HeldDiggerReads, type HeldDiggerSourceRow } from "../lib/control-plane/workers/held-digger-sources.ts";
import { MEETING_PARTITION_CONTRACTS } from "../lib/civic-data/meeting-partitions.ts";
import { askGapSourceUrl } from "../lib/control-plane/scheduler/providers/ask-gaps.ts";
import { eachStore } from "./control-plane-fixtures.ts";
import { methodFixture } from "./method-store-fixture.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

const T0 = "2026-09-01T19:36:07.092Z"; // the cycle that committed its dispositions and died
const T1 = "2026-09-22T20:00:00.000Z"; // the cycle that resumes them
const T2 = "2026-09-22T21:00:00.000Z"; // the cycle after that
const TTL = 120_000;

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

const neverRuns: RunWork = async () => {
  throw new Error("a settled route was walked again");
};

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
      const resumed = await resumeOpenOccurrence(repos, held, await repos.dispatchState.readOpen({ obligationIds: [held.id] }));
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
  });
  await closeCycleOccurrences(repos, { cycle, occurrenceFor: (id) => open.get(id)?.id ?? null, now });
  await persistDebts(repos, cycle.debts, now);
  return { cycle, ran, open };
}

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

test("cycle closure runs independent occurrences together and serializes occurrence aliases and shared obligations", { timeout: 10_000 }, async () => {
  for (const [label, repos] of await eachStore("wtp-close-parallel-")) {
    const first = await interrupted(repos, obligation("shared-obligation"), disposes("WALKED_NO_YIELD"));
    const other = await interrupted(repos, obligation("independent-obligation"), disposes("REQUIRES_NEW_ADAPTER"));
    const resumed = await resumeOpenOccurrence(repos, (await repos.obligations.mustRead("shared-obligation")).value, await repos.dispatchState.readOpen({ obligationIds: ["shared-obligation"] }));
    assert.equal(resumed?.kind, "SETTLED");
    if (resumed?.kind !== "SETTLED") throw new Error("fixture did not settle");
    const secondId = `${first.occurrenceId}:second-period`;
    await repos.occurrences.put(secondId, { ...(await repos.occurrences.mustRead(first.occurrenceId)).value,
      id: secondId, sequence: 2 }, T0);
    const entered = new Set<string>();
    let release!: () => void;
    const independentStarted = new Promise<void>(resolve => { release = resolve; });
    let firstReads = 0;
    const seen: string[] = [];
    const wrapped: ControlPlaneRepositories = { ...repos, occurrences: { ...repos.occurrences,
      mustRead: async id => {
        seen.push(id);
        if (id === first.occurrenceId && ++firstReads > 1) {
          assert.equal((await repos.occurrences.mustRead(id)).value.closedAt, T1, `${label}: alias waits for the first closure`);
        }
        if (id === secondId) {
          assert.equal((await repos.obligations.mustRead("shared-obligation")).value.lastWorkedAt, T1,
            `${label}: another occurrence waits for the same obligation's update`);
        }
        return repos.occurrences.mustRead(id);
      },
      compareAndSet: async (...args) => {
        if (args[0] === first.occurrenceId || args[0] === other.occurrenceId) {
          entered.add(args[0]);
          if (entered.size === 2) release();
          await independentStarted;
        }
        return repos.occurrences.compareAndSet(...args);
      },
    } };
    await closeCycleOccurrences(wrapped, { concurrency: 2, now: T1,
      cycle: { dispatched: [first.walked, other.walked, { ...first.walked, obligationId: "alias-row" }],
        recovered: [{ ...resumed.settled, occurrenceId: secondId, discharged: true }] },
      occurrenceFor: id => id === "independent-obligation" ? other.occurrenceId : first.occurrenceId });
    assert.equal(entered.size, 2, `${label}: distinct resource groups reached actual CAS concurrently`);
    assert.deepEqual(seen.filter(id => id !== other.occurrenceId), [first.occurrenceId, first.occurrenceId, secondId]);
    assert.equal((await repos.obligations.mustRead("shared-obligation")).value.lastWorkedAt, T0,
      `${label}: recovered reading keeps its original anchor after the dispatched closures`);
    assert.equal((await repos.obligations.mustRead("independent-obligation")).value.lastWorkedAt, null,
      `${label}: a non-reading remains owed`);
  }
});

test("failed cycle closure joins every independent write before returning the original first error", { timeout: 10_000 }, async () => {
  for (const [label, repos] of await eachStore("wtp-close-failure-")) {
    const fixtures = await Promise.all(["first", "fast-failure", "slow", "remaining"].map(id =>
      interrupted(repos, obligation(id), disposes("WALKED_NO_YIELD"))));
    const [first, fast, slow, remaining] = fixtures;
    const firstError = new ConcurrentModification("FreshnessOccurrence", first!.occurrenceId, 1, 2);
    const fastError = new Error("later closure failed first in wall-clock order");
    let failFirst!: () => void, releaseSlow!: () => void, slowStarted!: () => void, laterFailed!: () => void, remainingClosed!: () => void;
    const firstFailure = new Promise<void>(resolve => { failFirst = resolve; });
    const slowFinish = new Promise<void>(resolve => { releaseSlow = resolve; });
    const slowEntry = new Promise<void>(resolve => { slowStarted = resolve; });
    const fastFailure = new Promise<void>(resolve => { laterFailed = resolve; });
    const remainingWrite = new Promise<void>(resolve => { remainingClosed = resolve; });
    let firstCalls = 0, returned = false;
    const wrapped: ControlPlaneRepositories = { ...repos, occurrences: { ...repos.occurrences,
      compareAndSet: async (...args) => {
        const id = args[0];
        if (id === first!.occurrenceId) { firstCalls++; await firstFailure; throw firstError; }
        if (id === fast!.occurrenceId) { laterFailed(); throw fastError; }
        if (id === slow!.occurrenceId) { slowStarted(); await slowFinish; }
        const result = await repos.occurrences.compareAndSet(...args);
        if (id === remaining!.occurrenceId) remainingClosed();
        return result;
      },
    } };
    const closing = closeCycleOccurrences(wrapped, { concurrency: 2, now: T1,
      cycle: { dispatched: [...fixtures.map(fixture => fixture.walked), { ...first!.walked, obligationId: "first-alias" }], recovered: [] },
      occurrenceFor: id => id === "first-alias" ? first!.occurrenceId : fixtures.find(fixture => fixture.walked.obligationId === id)!.occurrenceId,
    }).then(() => { returned = true; return null; }, error => { returned = true; return error; });
    await Promise.all([fastFailure, slowEntry]);
    assert.equal(returned, false, `${label}: a faster failure cannot return with other closures running`);
    failFirst();
    await remainingWrite;
    assert.equal(returned, false, `${label}: remaining independent groups run, and the slow write is still joined`);
    releaseSlow();
    assert.equal(await closing, firstError, `${label}: original operation order chooses the error and preserves its class`);
    assert.equal(firstCalls, 1, `${label}: a dependent alias does not retry the unchanged failure`);
    for (const fixture of [slow!, remaining!]) {
      assert.equal((await repos.occurrences.mustRead(fixture.occurrenceId)).value.closedAt, T1);
      assert.equal((await repos.obligations.mustRead(fixture.walked.obligationId)).value.lastWorkedAt, T1);
    }
  }
});

test("SEEDED: an open occurrence on an already-disposed RouteTask is recovered, never dispatched — no second claim, Attempt or lease", async () => {
  for (const [label, repos] of await eachStore("wtp-settled-")) {
    const vaultRoot = mkdtempSync(join(tmpdir(), "wtp-settled-vault-"));
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
    assert.equal(debt.cause, "AWAITING_ADAPTER", `${label}: a missing adapter is not a host refusal`);
    assert.match(debt.detail, /REQUIRES_NEW_ADAPTER/);

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
  for (const [label, repos] of await eachStore("wtp-settled-")) {
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

    const resumed = await resumeOpenOccurrence(repos, (await repos.obligations.mustRead("ob-settled")).value, await repos.dispatchState.readOpen({ obligationIds: ["ob-settled"] }));
    assert.equal(resumed?.kind, "SETTLED", `${label}: resumed as settled despite state ${residue.task.value.state}`);

    const sweep = await sweepExpiredLeases(repos, { now: T2, observedBy: "sweeper" });
    assert.deepEqual(sweep.releasedSettled, [walked.routeTaskId], `${label}: the sweep releases the dead lease`);
  }
});

test("claimRouteTask refuses a RouteTask disposed while the claim raced for its lease, and gives back the lease it won", async () => {
  for (const [label, repos] of await eachStore("wtp-settled-")) {
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

test("a recovered INGESTED calendar occurrence keeps its exact bytes eligible for the native held-meeting worker", async () => {
  const partition = MEETING_PARTITION_CONTRACTS.find(row => row.bodyId.startsWith("curated:az/") && row.derivedFamily === null && askGapSourceUrl(row.bodyId, [row.id], Date.parse(T0)));
  assert.ok(partition);
  const sourceUrl = askGapSourceUrl(partition.bodyId, [partition.id], Date.parse(T0))!;
  const feed = JSON.stringify([{ id: 7, bodyId: partition.bodyId, name: "Recorded council meeting", date: "2026-09-04" }]);
  for (const [label, repos] of await eachStore("wtp-settled-")) {
    const vaultRoot = mkdtempSync(join(tmpdir(), "wtp-settled-vault-"));
    const held = await interrupted(
      repos,
      obligation("ob-held-calendar", { subjectId: partition.bodyId, routeId: "CALENDAR_STALE" }),
      ingests(vaultRoot, sourceUrl, feed),
    );
    const committed = (await repos.routeTasks.mustRead(held.routeTaskId)).value.disposition!;
    const { cycle, ran } = await cycleAt(repos, T1);
    assert.equal(ran, 0);
    assert.equal(cycle.recovered.length, 1);
    const recovered = cycle.recovered[0];
    assert.equal(recovered.discharged, true);

    const records = await repos.artifacts.read(held.workItemId);
    assert.deepEqual(records.map((r) => r.artifactId), committed.artifactIds, `${label}: the artifact record stands`);
    assert.equal(records[0].attemptId, committed.attemptId);
    assert.equal((await repos.dispositions.read(held.routeTaskId)).length, 1, `${label}: one commit, never a second`);

    const later = cycleVault(vaultRoot);
    assert.equal(later.ledger.size, 0, `${label}: this cycle retrieved nothing`);
    assert.equal(await later.readHeld(records[0]), feed, `${label}: the recovered bytes are read back`);
    assert.equal(await later.readHeld({ ...records[0], attemptId: "at-someone-else" }), null, `${label}: only under the record's own identity`);

    const diggerReads: HeldDiggerReads = {
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
    const runtime = Object.assign(standingFleetRuntime({ root: ROOT, method: methodFixture(), vaultRoot, repos, now: () => T2 }), { diggerReads });
    await advanceHeldWorkerFleet(ROOT, runtime, 1, true);
    const worker = (await repos.routeTasks.list()).find(
      (row) => row.value.workerTask?.role === "ACQUIRER" && row.value.workerTask.artifactId === committed.artifactIds[0],
    );
    assert.ok(worker, `${label}: a native held-meeting task is queued for the recovered bytes`);
    assert.equal(worker.value.workItemId, held.workItemId); assert.equal(worker.value.state, "PENDING");
    assert.equal(worker.value.workerTask!.contract.schemaVersion, 2);
    assert.equal(worker.value.workerTask!.contract.recordClass, "HELD_MEETING_DETAILS");
    assert.equal(worker.value.workerTask!.contract.subjectId, partition.bodyId);
    if (worker.value.workerTask!.contract.schemaVersion === 2) {
      assert.deepEqual(worker.value.workerTask!.contract.sourceScope.canonicalUrls, [sourceUrl]);
      assert.deepEqual(worker.value.workerTask!.contract.sourceScope.observationArtifactIds, committed.artifactIds);
    }
    assert.equal((await repos.routeTasks.mustRead(held.routeTaskId)).value.target, partition.bodyId, "the real subject-target occurrence is preserved");
  }
});

test("a recovered WALKED_NO_YIELD discharges this period's reading only: the obligation comes due again under a new RouteTask", async () => {
  for (const [label, repos] of await eachStore("wtp-settled-")) {
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

    const next = await cycleAt(repos, T2, disposes("WALKED_NO_YIELD"));
    assert.equal(next.ran, 1, `${label}: walked again`);
    const again = next.open.get("ob-empty");
    assert.ok(again);
    assert.notEqual(again.routeTaskId, empty.routeTaskId, `${label}: a new occurrence with its own RouteTask`);
    assert.equal((await repos.occurrences.mustRead(again.id)).value.sequence, 2);
    assert.equal((await repos.dispositions.read(again.routeTaskId)).length, 1);

    assert.equal((await repos.routeTasks.mustRead(empty.routeTaskId)).value.disposition?.disposition, "WALKED_NO_YIELD");
    assert.equal((await repos.dispositions.read(empty.routeTaskId)).length, 1, `${label}: its commit is still in the log`);
    assert.equal((await repos.occurrences.mustRead(empty.occurrenceId)).value.routeTaskId, empty.routeTaskId);
  }
});

test("a recovered adapter wait leaves the obligation owed without retrying unchanged missing code", async () => {
  for (const [label, repos] of await eachStore("wtp-settled-")) {
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
    assert.equal(retried.ran, 0, `${label}: elapsed backoff cannot supply a missing adapter`);
    assert.ok(retried.cycle.deferred.some(row=>row.obligationId==='ob-walled' && /AWAITING_ADAPTER/.test(row.why)),JSON.stringify(retried.cycle.deferred));
    assert.equal((await repos.obligations.mustRead('ob-walled')).value.lastWorkedAt,null);
    assert.equal((await repos.routeTasks.mustRead(walled.routeTaskId)).value.state, "DISPOSED", `${label}: the settled one untouched`);
  }
});

test("an aborted or interrupted occurrence is still resumed and dispatched, and its earlier Attempt and partial evidence are kept", async () => {
  for (const [label, repos] of await eachStore("wtp-settled-")) {
    const vaultRoot = mkdtempSync(join(tmpdir(), "wtp-settled-vault-"));
    const vault = cycleVault(vaultRoot);

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

function closedScoutLane(modelIds: ReadonlySet<string>): ResearchLanes {
  return {
    decide: (row) =>
      modelIds.has(row.obligation.id)
        ? { kind: "BOUNDED_MODEL_WORKER", why: "fixture model row", disagreement: null }
        : { kind: "DETERMINISTIC", why: "fixture deterministic row", disagreement: null },
  };
}

test("BEFORE DISPATCH: every settled occurrence is recovered with no dispatch capacity at all (a zero ceiling, a debt backoff, a closed Scout lane) and nothing is walked", async () => {
  for (const [label, repos] of await eachStore("wtp-settled-")) {
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
  for (const [label, repos] of await eachStore("wtp-settled-")) {
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
  for (const [label, repos] of await eachStore("wtp-settled-")) {
    await interrupted(repos, obligation("ob-settled"), disposes("WALKED_NO_YIELD"));
    await repos.obligations.put("ob-open", standing(obligation("ob-open", { subjectId: "wtp-body/open" }), T0), T0);
    await openOccurrence(repos, { obligation: (await repos.obligations.mustRead("ob-open")).value, dueAt: T0, now: T0 });
    await interrupted(repos, obligation("ob-closed", { subjectId: "wtp-body/closed" }), disposes("WALKED_NO_YIELD"));

    const obligations = (await repos.obligations.list()).map((row) => row.value);
    const routeTasks = await repos.routeTasks.list();
    const closing = await resumeOpenOccurrence(repos, (await repos.obligations.mustRead("ob-closed")).value, await repos.dispatchState.readOpen({ obligationIds: ["ob-closed"] }));
    assert.equal(closing?.kind, "SETTLED");
    if (closing?.kind === "SETTLED") await closeSettledOccurrence(repos, { settled: closing.settled, now: T1 });

    const found = await findSettledOccurrences(repos, { obligations, settledRouteTaskIds: settledRouteTaskIds(routeTasks) });
    assert.deepEqual(found.map((s) => s.obligationId), ["ob-settled"], `${label}: only the settled one still open`);
    const confirmed = await resumeOpenOccurrence(repos, (await repos.obligations.mustRead("ob-settled")).value, await repos.dispatchState.readOpen({ obligationIds: ["ob-settled"] }));
    assert.deepEqual(found[0], confirmed?.kind === "SETTLED" ? confirmed.settled : null, `${label}: exactly what a lane's resume reads`);
    assert.deepEqual(
      await findSettledOccurrences(repos, { obligations, settledRouteTaskIds: new Set() }),
      [],
      `${label}: a listing that names no settled RouteTask yields no candidate`,
    );
  }
});
