/**
 * CH-23 part 1: the coordinator path keeps the in-round absence rules. A coordinator Scout runs on a stand-in
 * obligation, so a detective walk that argues the record absent is recorded on the real obligation with what would
 * reopen it (DP-04, DP-06), the item waits on that clock instead of being blocked for good, and a plain Scout walk
 * that found nothing goes to a detective after its backoff.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { ZERO_COST } from "../lib/control-plane/attempt.ts";
import { syncObligations } from "../lib/control-plane/scheduler/durable.ts";
import type { ScoutResult } from "../lib/control-plane/scheduler/scout-result.ts";
import { nextAutonomousOperation, runAutonomousCoordinator, type AutonomousCoordinatorRuntime } from "../lib/control-plane/workers/coordinator.ts";
import { scoutWalkedToNothing, unchangedScoutFailure } from "../lib/control-plane/workers/scout-scheduling.ts";
import { autonomousHarness } from "./helpers/autonomous-fleet.ts";

/* The re-walk after a walk that found nothing is behind CH-23's runner switch; each test sets it as it needs. */
function withOneHunterPath(on: boolean) {
  if (on) process.env.WTP_ONE_HUNTER_PATH = "1"; else delete process.env.WTP_ONE_HUNTER_PATH;
}

const OWNER = "freshness:fixture:owner";

async function ownedHarness(role: "SCOUT" | "DETECTIVE", rungs: number) {
  const h = await autonomousHarness({ plan: plan => ({ ...plan, sources: [], acquisition: [] }) });
  const recordClass = h.item.autonomousPlan!.contract.recordClass;
  await syncObligations(h.repos, [{ id: OWNER, recordClass, subjectId: h.item.subject, routeId: null, active: true,
    readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: null }], h.now());
  const at = h.now();
  await h.repos.occurrences.put(`occ-${OWNER}-000001`, { id: `occ-${OWNER}-000001`, obligationId: OWNER, sequence: 1, dueAt: at,
    workItemId: h.item.id, routeTaskId: "not-the-scout-task", openedAt: at, closedAt: null, disposition: null, unresolvedReason: null }, at);
  const runtime: AutonomousCoordinatorRuntime = { ...h.runtime, rollingCeilingUsd: 1, scoutFor: () => ({ lane: "BOUNDED_MODEL_WORKER",
    workerFor: ({ holder }) => ({ role: "SCOUT", provider: "offline-bounded-control", version: "1", instance: holder }),
    run: async request => {
      const result: ScoutResult = { formatVersion: 1, researchRole: role, attemptId: request.attemptId, obligationId: request.obligation.obligation.id,
        routeTaskId: request.routeTaskId, workItemId: h.item.id, subjectId: h.item.subject, routeId: null, recordClass, providerId: null,
        reason: "Offline walk fixture", outcome: "NO_PROGRESS", stoppedBy: "MODEL", rungs: [], distinctEvidenceRungs: rungs,
        candidates: [], findings: [], nextRungs: ["a county records request portal", "the state archive's index"], unverified: [],
        narrative: "Walked the ladder; nothing is published.", worker: { provider: "offline-bounded-control", model: "fixture", modelReported: null },
        usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, turns: 0, toolCalls: 0 },
        usd: 0, elapsedMs: 0, artifactIds: [], methodCandidateIds: [], refusal: null, startedAt: h.now(), recordedAt: h.now() };
      // As standing-runtime does: the result is kept under the stand-in obligation the dispatch ran on.
      await h.repos.scoutResults.append(result.obligationId, result.attemptId, result, result.recordedAt);
      return { kind: "ABORTED", ranAs: "BOUNDED_MODEL_WORKER", endedAt: h.now(),
        cost: { ...ZERO_COST, requestCount: 0, inputTokens: 0, outputTokens: 0, usd: 0 },
        detail: `SCOUT_NO_PROGRESS (MODEL): 0 rung(s) walked, ${rungs} distinct evidence-backed; next rungs: ${result.nextRungs.join("; ")}. The obligation stays owed.` };
    } }) };
  return { h, runtime };
}

test("with the switch on, a walk that found nothing is not an unchanged failure; a refused request still is", () => {
  withOneHunterPath(true);
  const ended = { endedAt: "2026-10-06T00:00:00.000Z", outcome: "ABORTED" } as const;
  const walked = { ...ended, abortReason: "the worker reached no boundary. SCOUT_NO_PROGRESS (MODEL): 5 rung(s) walked" };
  assert.equal(scoutWalkedToNothing(walked), true);
  assert.equal(unchangedScoutFailure(walked as never), false);
  assert.equal(unchangedScoutFailure({ ...ended, abortReason: "SCOUT_RESULT_REFUSED: HTTP 400 schema" } as never), true);
  withOneHunterPath(false);
  assert.equal(unchangedScoutFailure(walked as never), true, "with the switch off the old path holds");
});

test("a coordinator detective's argued absence is recorded on the real obligation and holds the item on its clock", async () => {
  withOneHunterPath(true);
  const { h, runtime } = await ownedHarness("DETECTIVE", 4);
  const run = await runAutonomousCoordinator(runtime, { maximum: 1, concurrency: 1 });
  assert.equal(run.dispatches.length, 1);
  const owner = (await h.repos.obligations.mustRead(OWNER)).value;
  assert.ok(owner.absentUntil && Date.parse(owner.absentUntil) > Date.parse(h.now()), "the owner holds the absence");
  assert.equal(owner.nextDueAt, owner.absentUntil);
  assert.match(owner.absenceUnlock?.text ?? "", /county records request portal/, "what would reopen it is kept (DP-06)");
  assert.ok(owner.absenceUnlock?.triggers.some(t => t.kind === "ROUTE"), "a new route for the record class reopens it");
  assert.equal((await h.repos.obligations.read(run.dispatches[0].routeTaskId!)), null, "nothing is written under the stand-in");

  const held = await nextAutonomousOperation(runtime, h.item.id);
  assert.equal(held.action, "BLOCKED");
  assert.ok(held.reason.includes(owner.absentUntil!), held.reason);
  assert.match(held.reason, /or sooner if this appears: a county records request portal/);

  h.advanceTo(new Date(Date.parse(owner.absentUntil!) + 60_000).toISOString());
  assert.equal((await nextAutonomousOperation(runtime, h.item.id)).action, "SCOUT", "walked again once the absence lapses");
});

test("an absence cleared early by a new capability lets the item walk again at once", async () => {
  withOneHunterPath(true);
  const { h, runtime } = await ownedHarness("DETECTIVE", 4);
  await runAutonomousCoordinator(runtime, { maximum: 1, concurrency: 1 });
  const row = await h.repos.obligations.mustRead(OWNER);
  await h.repos.obligations.compareAndSet(OWNER, row.revision, { ...row.value, absentUntil: null, absenceUnlock: null, nextDueAt: h.now() }, h.now());
  h.advanceTo(new Date(Date.parse(h.now()) + 3 * 3_600_000).toISOString());
  assert.equal((await nextAutonomousOperation(runtime, h.item.id)).action, "SCOUT");
});

test("a plain Scout that found nothing records no absence and goes to a detective after its backoff, not blocked for good", async () => {
  withOneHunterPath(true);
  const { h, runtime } = await ownedHarness("SCOUT", 4);
  await runAutonomousCoordinator(runtime, { maximum: 1, concurrency: 1 });
  assert.equal((await h.repos.obligations.mustRead(OWNER)).value.absentUntil ?? null, null, "only a detective walk argues absence (DP-04)");
  const waiting = await nextAutonomousOperation(runtime, h.item.id);
  assert.equal(waiting.action, "BLOCKED");
  assert.doesNotMatch(waiting.reason, /unchanged Scout request already failed/);
  h.advanceTo(new Date(Date.parse(h.now()) + 3 * 3_600_000).toISOString());
  assert.equal((await nextAutonomousOperation(runtime, h.item.id)).action, "SCOUT");
});

test("with the switch off, the argued absence is still recorded and the old block stands after it lapses", async () => {
  withOneHunterPath(false);
  const { h, runtime } = await ownedHarness("DETECTIVE", 4);
  await runAutonomousCoordinator(runtime, { maximum: 1, concurrency: 1 });
  const owner = (await h.repos.obligations.mustRead(OWNER)).value;
  assert.ok(owner.absentUntil, "recording the absence only removes paid re-walks, so it is not switched");
  h.advanceTo(new Date(Date.parse(owner.absentUntil!) + 60_000).toISOString());
  assert.match((await nextAutonomousOperation(runtime, h.item.id)).reason, /unchanged Scout request already failed/);
});

test("a detective walk under the evidence floor is not an argued absence", async () => {
  const { h, runtime } = await ownedHarness("DETECTIVE", 1);
  await runAutonomousCoordinator(runtime, { maximum: 1, concurrency: 1 });
  assert.equal((await h.repos.obligations.mustRead(OWNER)).value.absentUntil ?? null, null);
});
