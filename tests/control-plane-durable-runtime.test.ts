import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  AttemptContract,
  LeaseConflict,
  claim,
  endAttempt,
  mayWriteDisposition,
  type WorkerRef,
} from "../lib/control-plane/attempt.ts";
import { createLedger, type HostBudget } from "../lib/control-plane/budget.ts";
import { CostCapExceeded, assertWithinHardCap } from "../lib/control-plane/cost.ts";
import { DispositionRefused, createRouteTask, disposeRoute, type RouteDisposition, type RouteTask } from "../lib/control-plane/route-task.ts";
import { createWorkItem, type WorkItem } from "../lib/control-plane/work-item.ts";
import {
  LeaseNotHeld,
  LeaseStillLive,
  acquireHostBudget,
  attemptsForRouteTask,
  beginAttemptFor,
  claimRouteTask,
  disposeRouteTask,
  dispositionCommitId,
  reclaimRouteTask,
  reconcile,
  registerRouteTask,
  registerWorkItem,
  releaseHostBudget,
  renewLease,
} from "../lib/control-plane/repository/coordinator.ts";
import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import {
  AppendOnlyViolation,
  ConcurrentModification,
  CorruptPersistedState,
  IdentityCollision,
  RepositoryLockHeld,
  assertDurableRepositories,
  type ArtifactRecord,
  type ControlPlaneRepositories,
  type DispositionCommit,
} from "../lib/control-plane/repository/types.ts";

const PROJECT = "meanwhile";
const SUBJECT = "ocd-division/country:us/state:az/county:pima";
const ROUTE_ID = "LEGISTAR_EVENTDATES";
const HOST = "pima.legistar.com";
const POLICY = "policy-2026-08-29";
const METHOD_VERSION = 27;
const TTL = 60_000;

const T0 = "2026-08-29T00:00:00.000Z";
const T30S = "2026-08-29T00:00:30.000Z";
const T45S = "2026-08-29T00:00:45.000Z";
const T2M = "2026-08-29T00:02:00.000Z";
const T3M = "2026-08-29T00:03:00.000Z";
const T5M = "2026-08-29T00:05:00.000Z";

function workerRef(instance: string): WorkerRef {
  return { role: "ACQUIRER", provider: "anthropic", version: "opus-5", instance };
}

function newItem(): WorkItem {
  return createWorkItem({
    project: PROJECT,
    subject: SUBJECT,
    obligation: "Publish the Board of Supervisors meeting calendar",
    why: "A reader in Pima County is owed the meetings their government has already scheduled.",
    contract: { inheritedRouteFloor: [ROUTE_ID] },
    now: T0,
  });
}

function newTask(item: WorkItem): RouteTask {
  return createRouteTask({
    workItemId: item.id,
    routeId: ROUTE_ID,
    routeLabel: "Legistar /EventDates",
    target: HOST,
    inherited: true,
    now: T0,
  });
}

function ingested(attemptId: string, artifactIds: readonly string[], at: string): RouteDisposition {
  return {
    disposition: "INGESTED",
    attemptId,
    at,
    artifactIds,
    observation: { rawCount: 41, normalizedCount: 41, routeOnlyCount: 6, earliest: T0, latest: T5M },
    permission: "ALLOWED",
    transport: "REACHABLE",
    note: "The /EventDates endpoint returned the 2026 calendar.",
  };
}

function artifactRecord(over: Partial<ArtifactRecord> & { attemptId: string; workItemId: string }): ArtifactRecord {
  return {
    artifactId: "ar-000000000000000000000001",
    routeTaskId: null,
    tier: "SANITIZED_DERIVED",
    contentHash: "sha256-aaaa",
    byteLength: 128,
    contentType: "application/json",
    canonicalUrl: `https://${HOST}/EventDates`,
    partial: false,
    recordedAt: T0,
    ...over,
  };
}

function pimaHost(over: Partial<HostBudget> = {}): HostBudget {
  return {
    host: HOST,
    maxConcurrent: 3,
    minIntervalMs: 0,
    dailyRequestCap: null,
    backoffUntil: null,
    observedCrawlDelayMs: null,
    vendor: "legistar",
    ...over,
  };
}

async function caught(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  return null;
}

async function withFileRepos<R>(
  fn: (repos: ControlPlaneRepositories, root: string) => Promise<R>,
): Promise<R> {
  const root = await mkdtemp(path.join(tmpdir(), "wtp-cp-"));
  try {
    return await fn(await createFileRepositories(root), root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function forBothProviders(
  body: (repos: ControlPlaneRepositories, label: string) => Promise<void>,
): Promise<void> {
  await body(createMemoryRepositories(), "memory double");
  await withFileRepos((repos) => body(repos, "durable file store"));
}

async function seeded(
  repos: ControlPlaneRepositories,
): Promise<{ item: WorkItem; task: RouteTask }> {
  const item = newItem();
  const task = newTask(item);
  await registerWorkItem(repos, item, T0);
  await registerRouteTask(repos, task, T0);
  return { item, task };
}

test("SEEDED: a DIFFERENT value under one derived id is refused; an identical re-put is a no-op", async () => {
  await forBothProviders(async (repos, label) => {
    const { task } = await seeded(repos);

    const again = await repos.routeTasks.put(task.id, task, T30S);
    assert.equal(again.created, false, `${label}: an identical re-put creates nothing`);
    assert.equal(again.persisted.revision, 1, `${label}: and does not move the revision`);

    const impostor: RouteTask = { ...task, routeLabel: "Legistar /Events (a different route)" };
    assert.equal(impostor.id, task.id, "the fixture must collide on id or it proves nothing");
    const thrown = await caught(() => repos.routeTasks.put(impostor.id, impostor, T30S));

    assert.ok(thrown instanceof IdentityCollision, `${label}: refused as IdentityCollision`);
    assert.equal(thrown.kind, "RouteTask");
    assert.equal(thrown.id, task.id);
    assert.match(thrown.message, /already holds a DIFFERENT value/);

    const persisted = await repos.routeTasks.mustRead(task.id);
    assert.equal(persisted.value.routeLabel, "Legistar /EventDates");
    assert.equal(persisted.revision, 1);
  });
});

test("SEEDED: rewriting a recorded history entry is refused as AppendOnlyViolation", async () => {
  await forBothProviders(async (repos, label) => {
    const { item } = await seeded(repos);
    const record = artifactRecord({ attemptId: "at-alpha", workItemId: item.id });

    const first = await repos.artifacts.append(item.id, record.artifactId, record, T0);
    assert.equal(first.appended, true, `${label}: the first append lands`);

    const retry = await repos.artifacts.append(item.id, record.artifactId, record, T30S);
    assert.equal(retry.appended, false, `${label}: an identical retry adds nothing`);
    assert.equal((await repos.artifacts.read(item.id)).length, 1);

    const rewritten = { ...record, attemptId: "at-beta" };
    const thrown = await caught(() =>
      repos.artifacts.append(item.id, record.artifactId, rewritten, T30S),
    );

    assert.ok(thrown instanceof AppendOnlyViolation, `${label}: refused as AppendOnlyViolation`);
    assert.equal(thrown.recordId, record.artifactId);
    assert.match(thrown.message, /History is appended to, never rewritten/);

    const history = await repos.artifacts.read(item.id);
    assert.equal(history.length, 1, `${label}: history is unchanged`);
    assert.equal(history[0].attemptId, "at-alpha", "attribution survived the rewrite attempt");
  });
});

test("SEEDED: a write quoting a stale revision is refused, naming expected versus found", async () => {
  await forBothProviders(async (repos, label) => {
    const { task } = await seeded(repos);
    const first = await repos.routeTasks.read(task.id);
    assert.ok(first !== null);

    const moved = await repos.routeTasks.compareAndSet(
      task.id,
      first.revision,
      { ...first.value, state: "CLAIMED" },
      T30S,
    );
    assert.equal(moved.revision, first.revision + 1, `${label}: the revision advances by one`);
    assert.equal(moved.value.state, "CLAIMED");

    const thrown = await caught(() =>
      repos.routeTasks.compareAndSet(
        task.id,
        first.revision,
        { ...first.value, state: "RECLAIMABLE" },
        T45S,
      ),
    );

    assert.ok(thrown instanceof ConcurrentModification, `${label}: refused by name`);
    assert.equal(thrown.expectedRevision, 1);
    assert.equal(thrown.foundRevision, 2);
    assert.match(thrown.message, /read revision 1/);
    assert.match(thrown.message, /holds revision 2/);

    const after = await repos.routeTasks.mustRead(task.id);
    assert.equal(after.value.state, "CLAIMED", `${label}: the live writer's value stands`);
  });
});

test("SEEDED: two workers race for one available RouteTask and exactly one holds the lease", async () => {
  await withFileRepos(async (repos, root) => {
    const { task } = await seeded(repos);

    const alphaLease = claim(task.id, "worker-alpha", T0, TTL, null);
    const betaLease = claim(task.id, "worker-beta", T0, TTL, null);
    const raw = await Promise.allSettled([
      repos.leases.put(task.id, alphaLease, T0),
      repos.leases.put(task.id, betaLease, T0),
    ]);
    const creations = raw.filter((r) => r.status === "fulfilled" && r.value.created);
    assert.equal(creations.length, 1, "exactly one exclusive creation of the lease slot wins");
    const loser = raw.find((r) => r.status === "rejected");
    assert.ok(loser !== undefined, "and the other is refused rather than silently overwriting");
    assert.ok((loser as PromiseRejectedResult).reason instanceof IdentityCollision);

    await withFileRepos(async (fresh, freshRoot) => {
      const seededFresh = await seeded(fresh);
      const results = await Promise.allSettled([
        claimRouteTask(fresh, {
          routeTaskId: seededFresh.task.id,
          holder: "worker-alpha",
          now: T0,
          ttlMs: TTL,
        }),
        claimRouteTask(fresh, {
          routeTaskId: seededFresh.task.id,
          holder: "worker-beta",
          now: T0,
          ttlMs: TTL,
        }),
      ]);

      const won = results.filter((r) => r.status === "fulfilled");
      const lost = results.filter((r) => r.status === "rejected");
      assert.equal(won.length, 1, "exactly one worker claims the task");
      assert.equal(lost.length, 1, "and exactly one loses");

      const refusal = (lost[0] as PromiseRejectedResult).reason;
      assert.ok(refusal instanceof LeaseConflict, "the loser is refused as LeaseConflict");
      assert.equal(refusal.routeTaskId, seededFresh.task.id);
      assert.match(refusal.message, /A second claim is refused rather than duplicating/);

      const observer = await createFileRepositories(freshRoot);
      const held = await observer.leases.mustRead(seededFresh.task.id);
      assert.equal(held.value.holder, refusal.heldBy, "the durable holder is the winner");
      assert.equal(held.value.released, false);
      assert.equal(
        (await observer.routeTasks.mustRead(seededFresh.task.id)).value.state,
        "CLAIMED",
      );
    });

    const winner = (await repos.leases.mustRead(task.id)).value.holder;
    const later = await claimRouteTask(repos, {
      routeTaskId: task.id,
      holder: "worker-gamma",
      now: T2M,
      ttlMs: TTL,
    });
    assert.equal(later.lease.value.holder, "worker-gamma", "an expired lease is claimable");
    assert.notEqual(winner, "worker-gamma");

    const reopened = await createFileRepositories(root);
    assert.equal((await reopened.leases.mustRead(task.id)).value.holder, "worker-gamma");
  });
});

test("SEEDED: a stranger renewing someone else's LIVE lease is refused as LeaseNotHeld", async () => {
  await forBothProviders(async (repos, label) => {
    const { task } = await seeded(repos);
    await claimRouteTask(repos, {
      routeTaskId: task.id,
      holder: "worker-alpha",
      now: T0,
      ttlMs: TTL,
    });
    const before = await repos.leases.mustRead(task.id);

    // `heartbeat()` in attempt.ts checks expiry, not ownership.
    const thrown = await caught(() =>
      renewLease(repos, { routeTaskId: task.id, holder: "worker-beta", now: T30S, ttlMs: TTL }),
    );

    assert.ok(thrown instanceof LeaseNotHeld, `${label}: refused as LeaseNotHeld`);
    assert.equal(thrown.claimant, "worker-beta");
    assert.equal(thrown.actualHolder, "worker-alpha");
    assert.match(thrown.message, /refused on OWNERSHIP, before expiry was considered/);

    const untouched = await repos.leases.mustRead(task.id);
    assert.equal(untouched.revision, before.revision, `${label}: the lease did not move`);
    assert.equal(untouched.value.expiresAt, before.value.expiresAt);

    const renewed = await renewLease(repos, {
      routeTaskId: task.id,
      holder: "worker-alpha",
      now: T30S,
      ttlMs: TTL,
    });
    assert.equal(renewed.value.holder, "worker-alpha");
    assert.equal(renewed.value.heartbeatAt, T30S);
    assert.equal(
      (await repos.leases.mustRead(task.id)).value.expiresAt,
      new Date(Date.parse(T30S) + TTL).toISOString(),
    );
  });
});

test("SEEDED: an EXPIRED lease cannot be renewed, not even by its own holder", async () => {
  await forBothProviders(async (repos, label) => {
    const { task } = await seeded(repos);
    await claimRouteTask(repos, {
      routeTaskId: task.id,
      holder: "worker-alpha",
      now: T0,
      ttlMs: TTL,
    });

    const inTime = await renewLease(repos, {
      routeTaskId: task.id,
      holder: "worker-alpha",
      now: T45S,
      ttlMs: TTL,
    });
    assert.equal(inTime.value.heartbeatAt, T45S, `${label}: a live lease renews`);
    const before = await repos.leases.mustRead(task.id);

    const thrown = await caught(() =>
      renewLease(repos, { routeTaskId: task.id, holder: "worker-alpha", now: T5M, ttlMs: TTL }),
    );
    assert.ok(thrown instanceof Error, `${label}: an expired renewal is refused`);
    assert.match((thrown as Error).message, /expired/);
    assert.match((thrown as Error).message, /cannot be renewed/);
    assert.match((thrown as Error).message, /reclaimable/);

    assert.equal(
      (await repos.leases.mustRead(task.id)).revision,
      before.revision,
      `${label}: the durable lease is unchanged by a refused renewal`,
    );
  });
});

test("SEEDED: reclaiming a task whose lease is still LIVE is refused as LeaseStillLive", async () => {
  await forBothProviders(async (repos, label) => {
    const { task } = await seeded(repos);
    const claimed = await claimRouteTask(repos, {
      routeTaskId: task.id,
      holder: "worker-alpha",
      now: T0,
      ttlMs: TTL,
    });
    await beginAttemptFor(repos, {
      routeTaskId: task.id,
      workItemId: task.workItemId,
      worker: workerRef("alpha-1"),
      lease: claimed.lease.value,
      now: T0,
      methodVersion: METHOD_VERSION,
      policyVersion: POLICY,
    });

    const thrown = await caught(() =>
      reclaimRouteTask(repos, { routeTaskId: task.id, now: T30S, observedBy: "impatient-sweeper" }),
    );
    assert.ok(thrown instanceof LeaseStillLive, `${label}: refused as LeaseStillLive`);
    assert.equal(thrown.holder, "worker-alpha");
    assert.match(thrown.message, /Death is observed from OUTSIDE/);

    assert.equal((await repos.routeTasks.mustRead(task.id)).value.state, "CLAIMED");

    const reclaimed = await reclaimRouteTask(repos, {
      routeTaskId: task.id,
      now: T2M,
      observedBy: "control-plane-sweeper",
    });
    assert.equal(reclaimed.task.value.state, "RECLAIMABLE");
    assert.equal(reclaimed.closed.length, 1);
    assert.equal(reclaimed.closed[0].value.outcome, "LEASE_EXPIRED");
    assert.match(reclaimed.closed[0].value.abortReason ?? "", /stopped being renewed/);
  });
});

test("SEEDED: a stale worker cannot dispose a route that moved underneath it", async () => {
  await withFileRepos(async (repos) => {
    const { task } = await seeded(repos);

    const alphaClaim = await claimRouteTask(repos, {
      routeTaskId: task.id,
      holder: "worker-alpha",
      now: T0,
      ttlMs: TTL,
    });
    const alphaAttempt = await beginAttemptFor(repos, {
      routeTaskId: task.id,
      workItemId: task.workItemId,
      worker: workerRef("alpha-1"),
      lease: alphaClaim.lease.value,
      now: T0,
      methodVersion: METHOD_VERSION,
      policyVersion: POLICY,
    });
    const staleRevision = alphaClaim.task.revision;

    await reclaimRouteTask(repos, {
      routeTaskId: task.id,
      now: T2M,
      observedBy: "control-plane-sweeper",
    });
    const betaClaim = await claimRouteTask(repos, {
      routeTaskId: task.id,
      holder: "worker-beta",
      now: T2M,
      ttlMs: TTL,
    });
    const betaAttempt = await beginAttemptFor(repos, {
      routeTaskId: task.id,
      workItemId: task.workItemId,
      worker: workerRef("beta-1"),
      lease: betaClaim.lease.value,
      now: T2M,
      methodVersion: METHOD_VERSION,
      policyVersion: POLICY,
    });

    const staleWrite = await caught(() =>
      disposeRouteTask(repos, {
        routeTaskId: task.id,
        attemptId: alphaAttempt.value.id,
        expectedTaskRevision: staleRevision,
        disposition: ingested(alphaAttempt.value.id, ["ar-partial"], T3M),
        now: T3M,
        artifactIds: ["ar-partial"],
      }),
    );
    assert.ok(staleWrite instanceof ConcurrentModification, "refused by the CAS, by name");
    assert.equal(staleWrite.expectedRevision, staleRevision);
    assert.equal(staleWrite.kind, "RouteTask");
    assert.ok(
      (staleWrite.foundRevision ?? 0) > staleRevision,
      "the refusal names the revision that actually landed",
    );

    const current = await repos.routeTasks.mustRead(task.id);
    const wrongHolder = await caught(() =>
      disposeRouteTask(repos, {
        routeTaskId: task.id,
        attemptId: alphaAttempt.value.id,
        expectedTaskRevision: current.revision,
        disposition: ingested(alphaAttempt.value.id, ["ar-partial"], T3M),
        now: T3M,
        artifactIds: ["ar-partial"],
      }),
    );
    assert.ok(wrongHolder instanceof LeaseNotHeld, "refused by the lease guard, by name");
    assert.equal(wrongHolder.actualHolder, "worker-beta");

    const live = await repos.routeTasks.mustRead(task.id);
    const disposed = await disposeRouteTask(repos, {
      routeTaskId: task.id,
      attemptId: betaAttempt.value.id,
      expectedTaskRevision: live.revision,
      disposition: ingested(betaAttempt.value.id, ["ar-beta"], T3M),
      now: T3M,
      artifactIds: ["ar-beta"],
    });
    assert.equal(disposed.task.value.state, "DISPOSED");
    assert.equal(disposed.attempt.value.outcome, "COMPLETED");

    const commits = await repos.dispositions.read(task.id);
    assert.equal(commits.length, 1, "exactly one disposition commit");
    assert.equal(commits[0].attemptId, betaAttempt.value.id);
    assert.equal(
      (await repos.routeTasks.mustRead(task.id)).value.disposition?.attemptId,
      betaAttempt.value.id,
    );
  });
});

test("SEEDED: a crash between COMMIT and APPLY leaves no half-write a reader can see", async () => {
  await withFileRepos(async (repos, root) => {
    const { task } = await seeded(repos);
    const claimed = await claimRouteTask(repos, {
      routeTaskId: task.id,
      holder: "worker-alpha",
      now: T0,
      ttlMs: TTL,
    });
    const attempt = await beginAttemptFor(repos, {
      routeTaskId: task.id,
      workItemId: task.workItemId,
      worker: workerRef("alpha-1"),
      lease: claimed.lease.value,
      now: T0,
      methodVersion: METHOD_VERSION,
      policyVersion: POLICY,
    });

    const taskRow = await repos.routeTasks.mustRead(task.id);
    const disposition = ingested(attempt.value.id, ["ar-alpha"], T3M);
    const closedAttempt = endAttempt(attempt.value, "COMPLETED", T3M, {
      artifactIds: ["ar-alpha"],
    });
    const disposedTask = disposeRoute(taskRow.value, closedAttempt, disposition);
    const commit: DispositionCommit = {
      commitId: dispositionCommitId(task.id, attempt.value.id, disposition),
      routeTaskId: task.id,
      workItemId: task.workItemId,
      attemptId: attempt.value.id,
      disposition,
      closedAttempt,
      disposedTask,
      taskRevision: taskRow.revision,
      attemptRevision: attempt.revision,
      committedAt: T3M,
    };
    await repos.dispositions.append(task.id, commit.commitId, commit, T3M);

    assert.equal(
      (await repos.routeTasks.mustRead(task.id)).value.disposition,
      null,
      "the RouteTask has not yet recorded the disposition",
    );
    assert.equal(
      (await repos.attempts.mustRead(attempt.value.id)).value.outcome,
      null,
      "the Attempt has not yet been closed",
    );

    const restarted = await createFileRepositories(root);
    const fail = async (): Promise<never> => { throw new Error("COUNTRY_RECONCILIATION_ROWS_MATERIALIZED"); };
    let pages = 0;
    const observed: ControlPlaneRepositories = { ...restarted,
      dispositions: { ...restarted.dispositions, readAll: fail, readChangedSince: async (since, held, options) => {
        assert.ok(options?.page, "global recovery must consume pages rather than return the full commit history");
        return restarted.dispositions.readChangedSince(since, held, { ...options, page: async rows => {
          pages++;
          await options.page!(rows);
        } });
      } },
      routeTasks: { ...restarted.routeTasks, list: fail, listNarrowed: fail },
      attempts: { ...restarted.attempts, list: fail, listNarrowed: fail },
    };
    const report = await reconcile(observed, T5M);
    assert.equal(pages, 1);
    assert.equal(report.commitsSeen, 1);
    assert.deepEqual(report.healed, [commit.commitId], "the unapplied commit was completed");

    const healedTask = await restarted.routeTasks.mustRead(task.id);
    const healedAttempt = await restarted.attempts.mustRead(attempt.value.id);
    assert.equal(healedTask.value.state, "DISPOSED");
    assert.equal(healedTask.value.disposition?.disposition, "INGESTED");
    assert.equal(healedTask.value.disposition?.attemptId, attempt.value.id);
    assert.equal(healedAttempt.value.outcome, "COMPLETED");

    const second = await reconcile(await createFileRepositories(root), T5M);
    assert.equal(second.commitsSeen, 1);
    assert.deepEqual(second.healed, [], "a completed recovery does not re-apply itself");
  });
});

test("SEEDED: a refused disposition writes NEITHER aggregate and commits nothing", async () => {
  await withFileRepos(async (repos) => {
    const { task } = await seeded(repos);
    const claimed = await claimRouteTask(repos, {
      routeTaskId: task.id,
      holder: "worker-alpha",
      now: T0,
      ttlMs: TTL,
    });
    const attempt = await beginAttemptFor(repos, {
      routeTaskId: task.id,
      workItemId: task.workItemId,
      worker: workerRef("alpha-1"),
      lease: claimed.lease.value,
      now: T0,
      methodVersion: METHOD_VERSION,
      policyVersion: POLICY,
    });
    const before = await repos.routeTasks.mustRead(task.id);

    const thrown = await caught(() =>
      disposeRouteTask(repos, {
        routeTaskId: task.id,
        attemptId: attempt.value.id,
        expectedTaskRevision: before.revision,
        disposition: { ...ingested(attempt.value.id, [], T3M), artifactIds: [] },
        now: T3M,
      }),
    );
    assert.ok(thrown instanceof DispositionRefused, "refused as DispositionRefused");
    assert.match(thrown.message, /cannot be replayed is not evidence/);

    assert.deepEqual(await repos.dispositions.read(task.id), [], "nothing was committed");
    const after = await repos.routeTasks.mustRead(task.id);
    assert.equal(after.revision, before.revision, "the RouteTask did not move");
    assert.equal(after.value.disposition, null);
    assert.equal(
      (await repos.attempts.mustRead(attempt.value.id)).value.outcome,
      null,
      "and the Attempt was not closed",
    );

    const ok = await disposeRouteTask(repos, {
      routeTaskId: task.id,
      attemptId: attempt.value.id,
      expectedTaskRevision: after.revision,
      disposition: ingested(attempt.value.id, ["ar-alpha"], T3M),
      now: T3M,
      artifactIds: ["ar-alpha"],
    });
    assert.equal(ok.task.value.state, "DISPOSED");
    assert.equal((await repos.dispositions.read(task.id)).length, 1);
  });
});

test("SEEDED: twelve workers on one publisher contend on ONE DURABLE HostBudget", async () => {
  await withFileRepos(async (repos, root) => {
    await repos.budget.install(createLedger({ hosts: [pimaHost()] }), T0);

    const results = [];
    for (let worker = 0; worker < 12; worker += 1) {
      results.push(await acquireHostBudget(repos, { host: HOST, now: T0 }));
    }

    const granted = results.filter((r) => r.granted);
    const refused = results.filter((r) => !r.granted);
    assert.equal(granted.length, 3, "exactly the SHARED maxConcurrent is granted");
    assert.equal(refused.length, 9, "the other nine wait");
    for (const r of refused) {
      assert.equal(r.refusal, "HOST_CONCURRENCY");
      assert.ok(r.waitMs > 0, "a refusal states a wait rather than just failing");
      assert.match(r.reason, /pima\.legistar\.com/);
      assert.match(r.reason, /3/);
    }

    const restarted = await createFileRepositories(root);
    const ledger = await restarted.budget.read();
    assert.equal(ledger.value.hostState[HOST].inFlight, 3, "in-flight survived the restart");

    const thirteenth = await acquireHostBudget(restarted, { host: HOST, now: T0 });
    assert.equal(thirteenth.granted, false, "a brand-new process gets no second allowance");
    assert.equal(thirteenth.refusal, "HOST_CONCURRENCY");

    await releaseHostBudget(restarted, { host: HOST, now: T0 });
    await releaseHostBudget(restarted, { host: HOST, now: T0 });
    assert.equal((await acquireHostBudget(restarted, { host: HOST, now: T0 })).granted, true);
    assert.equal((await acquireHostBudget(restarted, { host: HOST, now: T0 })).granted, true);
    const overTheLine = await acquireHostBudget(restarted, { host: HOST, now: T0 });
    assert.equal(overTheLine.granted, false, "back at the shared limit");
    assert.equal(overTheLine.refusal, "HOST_CONCURRENCY");
  });
});

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function costGatedBranches(source: string): string[] {
  return stripComments(source)
    .split("\n")
    .filter((line) => /\b(if|while)\s*\(/.test(line))
    // Substrings, not whole words: camelCase identifiers like `spentUsd` must match.
    .filter((line) => /(budget|cap|spend|spent|usd|token|ledger|acquire|cost)/i.test(line));
}

test("SEEDED: no cost or budget refusal can produce or alter a RouteDisposition", async () => {
  const planted = costGatedBranches(
    ["async function disposeRouteTask() {", "  if (spentUsd >= capUsd) return null;", "}"].join("\n"),
  );
  assert.equal(planted.length, 1, "the detector fires on a cost-gated branch");
  assert.match(planted[0], /spentUsd/);

  assert.deepEqual(
    costGatedBranches("// if (spentUsd >= capUsd) this would be a defect\nreturn null;"),
    [],
    "a comment naming the defect is not the defect",
  );

  const file = fileURLToPath(
    new URL("../lib/control-plane/repository/coordinator.ts", import.meta.url),
  );
  const source = await readFile(file, "utf8");
  const start = source.indexOf("export async function disposeRouteTask(");
  const end = source.indexOf("async function applyDispositionCommit(");
  assert.ok(start > 0 && end > start, "the disposition path was located in the source");
  assert.deepEqual(
    costGatedBranches(source.slice(start, end)),
    [],
    "nothing on the disposition path branches on a cost or budget value",
  );

  await withFileRepos(async (repos) => {
    const { task } = await seeded(repos);
    const claimed = await claimRouteTask(repos, {
      routeTaskId: task.id,
      holder: "worker-alpha",
      now: T0,
      ttlMs: TTL,
    });
    const attempt = await beginAttemptFor(repos, {
      routeTaskId: task.id,
      workItemId: task.workItemId,
      worker: workerRef("alpha-1"),
      lease: claimed.lease.value,
      now: T0,
      methodVersion: METHOD_VERSION,
      policyVersion: POLICY,
    });

    const capped = await caught(async () => assertWithinHardCap(5, 5, "usd"));
    assert.ok(capped instanceof CostCapExceeded, "the cap fires at the cap");
    assert.match(capped.message, /A hard cap stops SCHEDULING/);

    const abandoned = endAttempt(attempt.value, "ABORTED", T3M, {
      abortReason: `Scheduling stopped: ${capped.message}`,
    });
    assert.equal(
      mayWriteDisposition(abandoned),
      false,
      "a cost-stopped Attempt may never carry a conclusion",
    );
    await repos.attempts.compareAndSet(attempt.value.id, attempt.revision, abandoned, T3M);

    const row = await repos.routeTasks.mustRead(task.id);
    const thrown = await caught(() =>
      disposeRouteTask(repos, {
        routeTaskId: task.id,
        attemptId: attempt.value.id,
        expectedTaskRevision: row.revision,
        disposition: {
          ...ingested(attempt.value.id, ["ar-alpha"], T3M),
          disposition: "WALKED_NO_YIELD",
          artifactIds: [],
        },
        now: T3M,
      }),
    );
    assert.ok(thrown instanceof AttemptContract, "the closed Attempt refuses to end again");
    assert.match((thrown as Error).message, /already ended as ABORTED/);

    assert.equal(
      (await repos.routeTasks.mustRead(task.id)).value.disposition,
      null,
      "the route is still open: a scheduling stop said nothing about the government",
    );
    assert.deepEqual(await repos.dispositions.read(task.id), []);
  });
});

test("SEEDED: corrupt persisted state is a FAILED read, never an empty result set", async () => {
  await withFileRepos(async (repos, root) => {
    const { item, task } = await seeded(repos);

    assert.equal((await repos.routeTasks.mustRead(task.id)).value.routeId, ROUTE_ID);
    assert.equal((await repos.routeTasks.list()).length, 1);
    assert.deepEqual(await repos.dispositions.readAll(), [], "a store with no commits is empty");

    const dir = path.join(root, "aggregates", "route-tasks");
    const [name] = (await readdir(dir)).filter((n) => n.endsWith(".json"));
    await writeFile(path.join(dir, name), '{ "id": "rt-', "utf8");

    const onRead = await caught(() => repos.routeTasks.read(task.id));
    assert.ok(onRead instanceof CorruptPersistedState, "refused as CorruptPersistedState");
    assert.match(onRead.location, /route-tasks/);
    assert.match(onRead.message, /This is a FAILED read/);

    // `list()` must not answer an unreadable store with `[]`: a caller would conclude no route work is owed.
    const onList = await caught(() => repos.routeTasks.list());
    assert.ok(onList instanceof CorruptPersistedState, "a listing over corruption also refuses");

    await writeFile(
      path.join(dir, name),
      JSON.stringify({ id: task.id, revision: 0, updatedAt: T0, value: task }),
      "utf8",
    );
    const onRevision = await caught(() => repos.routeTasks.read(task.id));
    assert.ok(onRevision instanceof CorruptPersistedState);
    assert.match(onRevision.message, /revision 0/);
    assert.match(onRevision.message, /makes every CAS unsound/);

    await repos.artifacts.append(
      item.id,
      "ar-1",
      artifactRecord({ attemptId: "at-x", workItemId: item.id, artifactId: "ar-1" }),
      T0,
    );
    const logDir = path.join(root, "logs", "artifacts");
    const [logName] = await readdir(logDir);
    await writeFile(path.join(logDir, logName), '{"key":"a","recordId":"b","record":\n', "utf8");
    const onLine = await caught(() => repos.artifacts.read(item.id));
    assert.ok(onLine instanceof CorruptPersistedState, "a bad history line refuses");
    assert.match(onLine.location, /:1$/, "and names the file AND the line");
    assert.match(onLine.message, /silently shorten the record/);
  });

  const root = await mkdtemp(path.join(tmpdir(), "wtp-cp-"));
  const repos = await createFileRepositories(root);
  assert.deepEqual(await repos.routeTasks.list(), [], "a fresh root is honestly empty");
  await rm(root, { recursive: true, force: true });
  const gone = await caught(() => repos.routeTasks.list());
  assert.ok(gone instanceof CorruptPersistedState, "a vanished root is corruption, not emptiness");
  assert.match(gone.message, /the store root itself is absent/);
});

test("SEEDED: a read-modify-write section entered while held is refused as RepositoryLockHeld", async () => {
  await forBothProviders(async (repos, label) => {
    const thrown = await caught(() =>
      repos.locks.withLock("host:pima", async () =>
        repos.locks.withLock("host:pima", async () => "should never run"),
      ),
    );
    assert.ok(thrown instanceof RepositoryLockHeld, `${label}: refused as RepositoryLockHeld`);
    assert.equal(thrown.lockName, "host:pima");
    assert.match(thrown.message, /refused\s+rather than interleaved/);

    assert.equal(await repos.locks.withLock("host:pima", async () => "first"), "first");
    assert.equal(await repos.locks.withLock("host:pima", async () => "second"), "second");

    // The lock is released even when the body throws.
    const inner = await caught(() =>
      repos.locks.withLock("host:pima", async () => {
        throw new Error("the body failed");
      }),
    );
    assert.match((inner as Error).message, /the body failed/);
    assert.equal(
      await repos.locks.withLock("host:pima", async () => "recovered"),
      "recovered",
      `${label}: a throwing body still releases the lock`,
    );
  });
});

test("SEEDED: an in-memory store is refused where durability is the property under test", async () => {
  const thrown = await caught(async () =>
    assertDurableRepositories(createMemoryRepositories(), "the crash-recovery acceptance test"),
  );
  assert.ok(thrown instanceof Error);
  assert.match((thrown as Error).message, /the crash-recovery acceptance test/);
  assert.match((thrown as Error).message, /loses every obligation the moment the process ends/);

  await withFileRepos(async (repos, root) => {
    assertDurableRepositories(repos, "the crash-recovery acceptance test");
    assert.equal(repos.durable, true);
    assert.ok(repos.describe().includes(path.resolve(root)), "and names where the state lives");
  });

  const noRoot = await caught(() => createFileRepositories("   "));
  assert.match((noRoot as Error).message, /requires an explicit root directory/);
});

test("attempts are listed against their RouteTask from durable state alone", async () => {
  await withFileRepos(async (repos, root) => {
    const { task } = await seeded(repos);
    const claimed = await claimRouteTask(repos, {
      routeTaskId: task.id,
      holder: "worker-alpha",
      now: T0,
      ttlMs: TTL,
    });
    await beginAttemptFor(repos, {
      routeTaskId: task.id,
      workItemId: task.workItemId,
      worker: workerRef("alpha-1"),
      lease: claimed.lease.value,
      now: T0,
      methodVersion: METHOD_VERSION,
      policyVersion: POLICY,
    });

    const restarted = await createFileRepositories(root);
    const attempts = await attemptsForRouteTask(restarted, task.id);
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].value.worker.instance, "alpha-1");
    assert.equal(attempts[0].value.methodVersion, METHOD_VERSION);
    assert.equal(attempts[0].value.policyVersion, POLICY, "replay inputs survive the restart");
  });
});

