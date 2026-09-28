import assert from "node:assert/strict";
import test from "node:test";
import { autonomousHarness } from "./helpers/autonomous-fleet.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";
import { registerWorkItem } from "../lib/control-plane/repository/coordinator.ts";
import { authorizeInheritedHeldArtifact } from "../lib/control-plane/workers/research-runtime.ts";
import type { PlanRepairLink } from "../lib/control-plane/workers/plan-repair.ts";

test("held bytes cross only a linked same-subject repair ancestry with a completed origin capture", async () => {
  const h = await autonomousHarness();
  const origin = h.item;
  const capture = (await h.repos.artifacts.readAll()).find(row => row.workItemId === origin.id);
  assert.ok(capture);
  const originAttempt = (await h.repos.attempts.mustRead(capture.attemptId)).value;
  assert.equal(originAttempt.outcome, "COMPLETED");
  const link: PlanRepairLink = { parentWorkItemId: origin.id, rootWorkItemId: origin.id, depth: 1,
    proposalHash: "test-proposal", scoutAttemptId: originAttempt.id, sourceArtifactId: capture.artifactId,
    retainedEvidenceIds: [capture.artifactId], admittedAt: h.now(), authority: "WORK_INSTRUCTIONS_ONLY", unresolved: [] };
  const child = { ...createWorkItem({ project: origin.project, subject: origin.subject,
    obligation: "Continue the recorded repair", why: "Fixture repair successor", now: h.now() }), planRepair: link };
  await registerWorkItem(h.repos, child, h.now());
  const request = { artifactId: capture.artifactId, originWorkItemId: origin.id,
    childWorkItemId: child.id, project: origin.project };
  assert.equal(await authorizeInheritedHeldArtifact(h.repos, request), true);
  assert.equal(await authorizeInheritedHeldArtifact(h.repos, { ...request, artifactId: "missing" }), false);
  assert.equal(await authorizeInheritedHeldArtifact(h.repos, { ...request, originWorkItemId: child.id }), false);
  assert.equal(await authorizeInheritedHeldArtifact(h.repos, { ...request, project: "other-project" }), false);

  const unrelated = createWorkItem({ project: origin.project, subject: origin.subject,
    obligation: "Unrelated same-subject work", why: "No lineage", now: h.now() });
  await registerWorkItem(h.repos, unrelated, h.now());
  assert.equal(await authorizeInheritedHeldArtifact(h.repos, { ...request, childWorkItemId: unrelated.id }), false);

  const wrongSubject = { ...createWorkItem({ project: origin.project, subject: "other-subject",
    obligation: "Different subject repair", why: "Wrong subject", now: h.now() }), planRepair: link };
  await registerWorkItem(h.repos, wrongSubject, h.now());
  assert.equal(await authorizeInheritedHeldArtifact(h.repos, { ...request, childWorkItemId: wrongSubject.id }), false);

  const cyclic = { ...createWorkItem({ project: origin.project, subject: origin.subject,
    obligation: "Cyclic repair", why: "Invalid ancestry", now: h.now() }), planRepair: { ...link, parentWorkItemId: "" } };
  await registerWorkItem(h.repos, cyclic, h.now());
  assert.equal(await authorizeInheritedHeldArtifact(h.repos, { ...request, childWorkItemId: cyclic.id }), false);
});
