import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { isExpired, type WorkerRef } from "../lib/control-plane/attempt.ts";
import { evaluateCompletion, explainRefusals } from "../lib/control-plane/completion.ts";
import { createRouteTask, type RouteDisposition } from "../lib/control-plane/route-task.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";
import type { ValidationRecord } from "../lib/control-plane/audit.ts";
import {
  artifactsForAttempt,
  attemptsForRouteTask,
  beginAttemptFor,
  claimRouteTask,
  disposeRouteTask,
  loadCompletionSnapshot,
  reclaimRouteTask,
  recordArtifactMetadata,
  registerRouteTask,
  registerWorkItem,
  renewLease,
  transitionWorkItem,
} from "../lib/control-plane/repository/coordinator.ts";
import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import {
  assertDurableRepositories,
  type ArtifactRecord,
  type ControlPlaneRepositories,
} from "../lib/control-plane/repository/types.ts";

const PROJECT = "meanwhile";
const SUBJECT = "ocd-division/country:us/state:az/county:pima";
const ROUTE_ID = "LEGISTAR_EVENTDATES";
const HOST = "pima.legistar.com";
const POLICY = "policy-2026-08-29";
const METHOD_VERSION = 27;
const TTL = 60_000;

const T_CLAIM_A = "2026-08-29T09:00:00.000Z";
const T_PARTIAL = "2026-08-29T09:00:20.000Z";
const T_LAST_HEARTBEAT = "2026-08-29T09:00:40.000Z";
const T_SWEEP = "2026-08-29T09:03:00.000Z";
const T_CLAIM_B = "2026-08-29T09:03:05.000Z";
const T_DISPOSE = "2026-08-29T09:04:00.000Z";
const T_EVALUATE = "2026-08-29T09:05:00.000Z";

function workerRef(instance: string): WorkerRef {
  return { role: "ACQUIRER", provider: "anthropic", version: "opus-5", instance };
}

// Each step opens a fresh instance so no in-process cache passes for durability.
async function reopen(root: string): Promise<ControlPlaneRepositories> {
  const repos = await createFileRepositories(root);
  assertDurableRepositories(repos, "the crash-recovery acceptance test");
  return repos;
}

test("ACCEPTANCE: a worker dies mid-walk; the obligation, the partial evidence and its attribution all survive", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "wtp-crash-"));
  try {

    const item = createWorkItem({
      project: PROJECT,
      subject: SUBJECT,
      obligation: "Publish the Board of Supervisors meeting calendar",
      why: "A reader in Pima County is owed the meetings their government has already scheduled.",
      contract: { inheritedRouteFloor: [ROUTE_ID], requiresValidation: true },
      now: T_CLAIM_A,
    });
    const task = createRouteTask({
      workItemId: item.id,
      routeId: ROUTE_ID,
      routeLabel: "Legistar /EventDates",
      target: HOST,
      inherited: true,
      now: T_CLAIM_A,
    });

    {
      const repos = await reopen(root);
      await registerWorkItem(repos, item, T_CLAIM_A);
      await registerRouteTask(repos, task, T_CLAIM_A);
    }

    let workerAAttemptId: string;
    {
      const repos = await reopen(root);
      const claimed = await claimRouteTask(repos, {
        routeTaskId: task.id,
        holder: "worker-A",
        now: T_CLAIM_A,
        ttlMs: TTL,
      });
      assert.equal(claimed.lease.value.holder, "worker-A", "STEP 1: A holds the lease");
      assert.equal(claimed.task.value.state, "CLAIMED", "STEP 1: the task is claimed");

      const attempt = await beginAttemptFor(repos, {
        routeTaskId: task.id,
        workItemId: item.id,
        worker: workerRef("A-instance-1"),
        lease: claimed.lease.value,
        now: T_CLAIM_A,
        methodVersion: METHOD_VERSION,
        policyVersion: POLICY,
      });
      workerAAttemptId = attempt.value.id;

      const partial: ArtifactRecord = {
        artifactId: "ar-pima-eventdates-page-1",
        workItemId: item.id,
        routeTaskId: task.id,
        attemptId: workerAAttemptId,
        tier: "SANITIZED_DERIVED",
        contentHash: "sha256-page1",
        byteLength: 8_412,
        contentType: "application/json",
        canonicalUrl: `https://${HOST}/OData/EventDates?$skip=0`,
        partial: true,
        recordedAt: T_PARTIAL,
      };
      const recorded = await recordArtifactMetadata(repos, partial, T_PARTIAL);
      assert.equal(recorded.appended, true, "STEP 1: the partial artifact is recorded");

      const renewed = await renewLease(repos, {
        routeTaskId: task.id,
        holder: "worker-A",
        now: T_LAST_HEARTBEAT,
        ttlMs: TTL,
      });
      assert.equal(renewed.value.heartbeatAt, T_LAST_HEARTBEAT, "STEP 1: A was alive at 09:00:40");
    }

    {
      const repos = await reopen(root);
      const attempt = await repos.attempts.mustRead(workerAAttemptId);
      assert.equal(attempt.value.outcome, null, "STEP 2: A left no outcome");
      assert.equal(attempt.value.endedAt, null, "STEP 2: A never closed its Attempt");
      assert.equal(
        (await repos.routeTasks.mustRead(task.id)).value.disposition,
        null,
        "STEP 2: and left NO disposition — a dead worker said nothing about the government",
      );
    }

    {
      const repos = await reopen(root);
      const lease = await repos.leases.mustRead(task.id);
      assert.equal(
        isExpired(lease.value, T_LAST_HEARTBEAT),
        false,
        "STEP 3: the lease was live at A's last heartbeat",
      );
      assert.equal(
        isExpired(lease.value, T_SWEEP),
        true,
        "STEP 3: and is expired by the sweep, with no clock read anywhere",
      );
    }

    {
      const repos = await reopen(root);

      const durableItem = await repos.workItems.mustRead(item.id);
      assert.equal(durableItem.value.obligation, item.obligation, "STEP 4: the WorkItem survived");
      assert.deepEqual(durableItem.value.contract.inheritedRouteFloor, [ROUTE_ID]);
      assert.deepEqual(durableItem.value.routeTaskIds, [task.id], "STEP 4: linked to its RouteTask");

      const durableTask = await repos.routeTasks.mustRead(task.id);
      assert.equal(durableTask.value.state, "CLAIMED", "STEP 4: the RouteTask survived");
      assert.equal(durableTask.value.inherited, true);

      const attempts = await attemptsForRouteTask(repos, task.id);
      assert.equal(attempts.length, 1, "STEP 4: A's Attempt survived");
      assert.equal(attempts[0].value.id, workerAAttemptId);
      assert.equal(attempts[0].value.worker.instance, "A-instance-1");
      assert.equal(attempts[0].value.methodVersion, METHOD_VERSION, "STEP 4: replay inputs too");

      const artifacts = await repos.artifacts.read(item.id);
      assert.equal(artifacts.length, 1, "STEP 4: the partial artifact survived");
      assert.equal(artifacts[0].partial, true, "STEP 4: and is still LABELLED partial");
      assert.equal(artifacts[0].attemptId, workerAAttemptId);
    }

    let workerBAttemptId: string;
    let claimedTaskRevision: number;
    {
      const repos = await reopen(root);
      const reclaimed = await reclaimRouteTask(repos, {
        routeTaskId: task.id,
        now: T_SWEEP,
        observedBy: "control-plane-sweeper",
      });

      assert.equal(reclaimed.task.value.state, "RECLAIMABLE", "STEP 5: the route is back in the pool");
      assert.equal(reclaimed.closed.length, 1, "STEP 5: A's Attempt was closed FROM OUTSIDE");
      const closedA = reclaimed.closed[0].value;
      assert.equal(closedA.outcome, "LEASE_EXPIRED", "STEP 5: as LEASE_EXPIRED, not COMPLETED");
      assert.match(closedA.abortReason ?? "", /stopped being renewed/, "STEP 5: with a NAMED reason");
      assert.match(closedA.abortReason ?? "", /control-plane-sweeper observed the abandonment/);
      assert.deepEqual(
        closedA.artifactIds,
        ["ar-pima-eventdates-page-1"],
        "STEP 5: A's partial evidence is carried onto its closed Attempt",
      );
      assert.equal(
        reclaimed.task.value.disposition,
        null,
        "STEP 5: the CONCLUSION is withheld — there was never one to keep",
      );

      const claimed = await claimRouteTask(repos, {
        routeTaskId: task.id,
        holder: "worker-B",
        now: T_CLAIM_B,
        ttlMs: TTL,
      });
      assert.equal(claimed.lease.value.holder, "worker-B", "STEP 5: B now holds the lease");
      claimedTaskRevision = claimed.task.revision;

      const attemptB = await beginAttemptFor(repos, {
        routeTaskId: task.id,
        workItemId: item.id,
        worker: workerRef("B-instance-1"),
        lease: claimed.lease.value,
        now: T_CLAIM_B,
        methodVersion: METHOD_VERSION,
        policyVersion: POLICY,
      });
      workerBAttemptId = attemptB.value.id;
      assert.notEqual(workerBAttemptId, workerAAttemptId, "STEP 5: B's Attempt is its own");
    }

    {
      const repos = await reopen(root);

      const full: ArtifactRecord = {
        artifactId: "ar-pima-eventdates-complete",
        workItemId: item.id,
        routeTaskId: task.id,
        attemptId: workerBAttemptId,
        tier: "SANITIZED_DERIVED",
        contentHash: "sha256-complete",
        byteLength: 41_902,
        contentType: "application/json",
        canonicalUrl: `https://${HOST}/OData/EventDates`,
        partial: false,
        recordedAt: T_DISPOSE,
      };
      await recordArtifactMetadata(repos, full, T_DISPOSE);

      const disposition: RouteDisposition = {
        disposition: "INGESTED",
        attemptId: workerBAttemptId,
        at: T_DISPOSE,
        artifactIds: [full.artifactId],
        observation: {
          rawCount: 41,
          normalizedCount: 41,
          routeOnlyCount: 6,
          earliest: "2026-01-06T00:00:00.000Z",
          latest: "2026-12-15T00:00:00.000Z",
        },
        permission: "ALLOWED",
        transport: "REACHABLE",
        note: "/EventDates returned the full 2026 Board of Supervisors calendar.",
      };

      const done = await disposeRouteTask(repos, {
        routeTaskId: task.id,
        attemptId: workerBAttemptId,
        expectedTaskRevision: claimedTaskRevision,
        disposition,
        now: T_DISPOSE,
        artifactIds: [full.artifactId],
      });
      assert.equal(done.committed, true, "STEP 6: the disposition was committed");
      assert.equal(done.task.value.state, "DISPOSED");
      assert.equal(done.attempt.value.outcome, "COMPLETED", "STEP 6: B's Attempt reached a boundary");
    }

    {
      const repos = await reopen(root);
      const commits = await repos.dispositions.readAll();
      assert.equal(commits.length, 1, "STEP 7: exactly one disposition commit, ever");
      assert.equal(commits[0].attemptId, workerBAttemptId);

      const durableTask = await repos.routeTasks.mustRead(task.id);
      assert.equal(durableTask.value.disposition?.disposition, "INGESTED");
      assert.equal(
        durableTask.value.disposition?.attemptId,
        workerBAttemptId,
        "STEP 7: and it belongs to the Attempt that earned it",
      );
      assert.deepEqual(
        [...durableTask.value.attemptIds].sort(),
        [workerAAttemptId, workerBAttemptId].sort(),
        "STEP 7: both Attempts are recorded; only one of them concluded anything",
      );

      const attempts = await attemptsForRouteTask(repos, task.id);
      const completed = attempts.filter((a) => a.value.outcome === "COMPLETED");
      assert.equal(completed.length, 1, "STEP 7: exactly one Attempt ever reached a boundary");
    }

    {
      const repos = await reopen(root);
      const all = await repos.artifacts.read(item.id);
      assert.equal(all.length, 2, "STEP 8: both captures are kept");

      const fromA = await artifactsForAttempt(repos, item.id, workerAAttemptId);
      assert.equal(fromA.length, 1, "STEP 8: A's partial is still here");
      assert.equal(fromA[0].artifactId, "ar-pima-eventdates-page-1");
      assert.equal(
        fromA[0].attemptId,
        workerAAttemptId,
        "STEP 8: and is attributed to A, NOT to the worker that finished",
      );
      assert.equal(fromA[0].partial, true, "STEP 8: still labelled partial, never promoted");

      const fromB = await artifactsForAttempt(repos, item.id, workerBAttemptId);
      assert.equal(fromB.length, 1);
      assert.equal(fromB[0].artifactId, "ar-pima-eventdates-complete");

      const attemptA = await repos.attempts.mustRead(workerAAttemptId);
      assert.deepEqual(attemptA.value.artifactIds, ["ar-pima-eventdates-page-1"]);
      assert.equal(attemptA.value.outcome, "LEASE_EXPIRED");
    }

    {
      const repos = await reopen(root);
      const validation: ValidationRecord = {
        workItemId: item.id,
        passed: true,
        at: T_EVALUATE,
        by: "validator-1",
        checked: ["inherited route floor", "artifact replayability"],
        detail: "The /EventDates capture replays to 41 normalised meetings.",
      };

      const snapshot = await loadCompletionSnapshot(repos, {
        workItemId: item.id,
        now: T_EVALUATE,
        validations: [validation],
      });

      assert.equal(snapshot.item.id, item.id);
      assert.equal(snapshot.routeTasks.length, 1);
      assert.equal(snapshot.routeTasks[0].state, "DISPOSED");
      assert.equal(snapshot.routeTasks[0].disposition?.attemptId, workerBAttemptId);

      const verdict = evaluateCompletion(snapshot, "VERIFIED_COMPLETE");
      assert.equal(
        verdict.mayComplete,
        true,
        `STEP 9: completion refused unexpectedly — ${explainRefusals(verdict)}`,
      );
      assert.equal(verdict.proposedState, "VERIFIED_COMPLETE");
      assert.ok(
        verdict.satisfied.some((s) => s.includes("inherited route floor")),
        "STEP 9: the inherited route floor was satisfied from durable state",
      );

      const moved = await transitionWorkItem(repos, {
        workItemId: item.id,
        to: "VERIFIED_COMPLETE",
        by: "control-plane",
        why: "Every inherited route carries a disposition and validation passed.",
        now: T_EVALUATE,
      });
      assert.equal(moved.value.state, "VERIFIED_COMPLETE");

      const history = await repos.transitions.read(item.id);
      assert.equal(history.length, 1, "STEP 9: the transition is in the replayable log");
      assert.equal(history[0].transition.from, "OPEN");
      assert.equal(history[0].transition.to, "VERIFIED_COMPLETE");
    }

    {
      const repos = await reopen(root);
      const snapshot = await loadCompletionSnapshot(repos, {
        workItemId: item.id,
        now: T_EVALUATE,
        validations: [
          {
            workItemId: item.id,
            passed: true,
            at: T_EVALUATE,
            by: "validator-1",
            checked: ["inherited route floor"],
            detail: "Re-read from disk in a process that never saw either worker.",
          },
        ],
      });
      assert.equal(snapshot.item.state, "VERIFIED_COMPLETE");
      assert.equal(evaluateCompletion(snapshot, "VERIFIED_COMPLETE").mayComplete, true);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ACCEPTANCE: a death between COMMIT and APPLY is recovered, not re-decided", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "wtp-crash2-"));
  try {
    const item = createWorkItem({
      project: PROJECT,
      subject: SUBJECT,
      obligation: "Publish the Board of Supervisors meeting calendar",
      why: "A reader is owed the meetings their government has already scheduled.",
      contract: { inheritedRouteFloor: [ROUTE_ID], requiresValidation: false },
      now: T_CLAIM_A,
    });
    const task = createRouteTask({
      workItemId: item.id,
      routeId: ROUTE_ID,
      routeLabel: "Legistar /EventDates",
      target: HOST,
      inherited: true,
      now: T_CLAIM_A,
    });

    const repos = await reopen(root);
    await registerWorkItem(repos, item, T_CLAIM_A);
    await registerRouteTask(repos, task, T_CLAIM_A);

    const claimed = await claimRouteTask(repos, {
      routeTaskId: task.id,
      holder: "worker-A",
      now: T_CLAIM_A,
      ttlMs: TTL,
    });
    const attempt = await beginAttemptFor(repos, {
      routeTaskId: task.id,
      workItemId: item.id,
      worker: workerRef("A-instance-1"),
      lease: claimed.lease.value,
      now: T_CLAIM_A,
      methodVersion: METHOD_VERSION,
      policyVersion: POLICY,
    });
    await recordArtifactMetadata(
      repos,
      {
        artifactId: "ar-complete",
        workItemId: item.id,
        routeTaskId: task.id,
        attemptId: attempt.value.id,
        tier: "SANITIZED_DERIVED",
        contentHash: "sha256-complete",
        byteLength: 41_902,
        contentType: "application/json",
        canonicalUrl: `https://${HOST}/OData/EventDates`,
        partial: false,
        recordedAt: T_DISPOSE,
      },
      T_DISPOSE,
    );

    const crashing: ControlPlaneRepositories = { ...repos, attempts: { ...repos.attempts,
      compareAndSet: async (...args) => {
        if (args[2].outcome === "COMPLETED") throw new Error("SEEDED_DEATH_AFTER_DISPOSITION_COMMIT");
        return repos.attempts.compareAndSet(...args);
      },
    } };
    await assert.rejects(disposeRouteTask(crashing, {
      routeTaskId: task.id,
      attemptId: attempt.value.id,
      expectedTaskRevision: claimed.task.revision,
      disposition: {
        disposition: "INGESTED",
        attemptId: attempt.value.id,
        at: T_DISPOSE,
        artifactIds: ["ar-complete"],
        observation: null,
        permission: "ALLOWED",
        transport: "REACHABLE",
        note: "/EventDates returned the full calendar.",
      },
      now: T_DISPOSE,
      artifactIds: ["ar-complete"],
    }), /SEEDED_DEATH_AFTER_DISPOSITION_COMMIT/);
    assert.equal((await repos.attempts.mustRead(attempt.id)).value.outcome, null);
    assert.equal((await repos.dispositions.readAll()).length, 1, "the immutable disposition survived the failed application");

    const restarted = await reopen(root);
    const stranger = createWorkItem({ project: PROJECT, subject: "ocd-division/country:us/state:nh/county:rockingham",
      obligation: "An unrelated place's meeting calendar", why: "A different reader's standing work.", now: T_CLAIM_A });
    await registerWorkItem(restarted, stranger, T_CLAIM_A);
    const strangerTask = createRouteTask({ workItemId: stranger.id, routeId: ROUTE_ID, routeLabel: "Another place",
      target: "other.legistar.com", inherited: true, now: T_CLAIM_A });
    await registerRouteTask(restarted, strangerTask, T_CLAIM_A);
    const strangerBefore = await restarted.routeTasks.mustRead(strangerTask.id);
    const fail = async (): Promise<never> => { throw new Error("UNRELATED_COMPLETION_HISTORY_READ"); };
    const scoped: ControlPlaneRepositories = { ...restarted,
      routeTasks: { ...restarted.routeTasks, list: fail, listChangedSince: fail,
        listWhere: async (fieldPath, value) => {
          assert.deepEqual([fieldPath, value], [["workItemId"], item.id]);
          return restarted.routeTasks.listWhere(fieldPath, value);
        },
        listWhereNarrowed: async (...args) => {
          assert.deepEqual(args.slice(0, 2), [["workItemId"], item.id]);
          return restarted.routeTasks.listWhereNarrowed(...args);
        } },
      attempts: { ...restarted.attempts, list: fail, listChangedSince: fail },
      dispositions: { ...restarted.dispositions, readAll: fail, readChangedSince: async (...args) => {
        assert.deepEqual(args[2]?.keys, [task.id], "dispositions are keyed by route, not work item");
        return restarted.dispositions.readChangedSince(...args);
      } },
      workerResults: { ...restarted.workerResults, readAll: fail, readChangedSince: async (...args) => {
        assert.deepEqual(args[2]?.keys, [item.id]);
        return restarted.workerResults.readChangedSince(...args);
      } },
    };
    const snapshot = await loadCompletionSnapshot(scoped, {
      workItemId: item.id,
      now: T_EVALUATE,
    });
    assert.equal(snapshot.routeTasks[0].state, "DISPOSED");
    assert.equal(snapshot.routeTasks[0].disposition?.disposition, "INGESTED");
    assert.equal(snapshot.routeTasks[0].disposition?.attemptId, attempt.value.id);
    assert.equal(snapshot.routeTasks.length, 1);
    assert.equal((await restarted.attempts.mustRead(attempt.id)).value.outcome, "COMPLETED");
    assert.equal((await restarted.leases.mustRead(task.id)).value.released, true);
    assert.deepEqual(await restarted.routeTasks.mustRead(strangerTask.id), strangerBefore);

    const verdict = evaluateCompletion(snapshot, "VERIFIED_COMPLETE");
    assert.equal(verdict.mayComplete, true, explainRefusals(verdict));
    assert.equal((await restarted.dispositions.readAll()).length, 1, "still exactly one");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
