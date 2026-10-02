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

  const selectedRoot = createWorkItem({ project: origin.project, subject: origin.subject,
    obligation: "Selected same-period source root", why: "Broker-selected lineage", now: h.now() });
  await registerWorkItem(h.repos, selectedRoot, h.now());
  const successor = { ...createWorkItem({ project: origin.project, subject: origin.subject,
    obligation: "Selected root repair", why: "Linked successor", now: h.now() }),
    planRepair: { ...link, parentWorkItemId: selectedRoot.id, rootWorkItemId: selectedRoot.id } };
  await registerWorkItem(h.repos, successor, h.now());
  const siblingRequest = { ...request, childWorkItemId: successor.id };
  assert.equal(await authorizeInheritedHeldArtifact(h.repos, siblingRequest), false,
    "same-subject siblings do not grant byte reuse by themselves");
  assert.equal(await authorizeInheritedHeldArtifact(h.repos, siblingRequest,
    held => held.artifactId === capture.artifactId && held.originWorkItemId === origin.id ? selectedRoot.id : null), true,
    "a brokered exact sibling capture may be reused by the selected root's linked successor");
  assert.equal(await authorizeInheritedHeldArtifact(h.repos, { ...siblingRequest, artifactId:"other" },
    () => selectedRoot.id), false,"brokered lineage cannot fabricate absent capture metadata");

  const wrongSubject = { ...createWorkItem({ project: origin.project, subject: "other-subject",
    obligation: "Different subject repair", why: "Wrong subject", now: h.now() }), planRepair: link };
  await registerWorkItem(h.repos, wrongSubject, h.now());
  assert.equal(await authorizeInheritedHeldArtifact(h.repos, { ...request, childWorkItemId: wrongSubject.id }), false);

  const cyclic = { ...createWorkItem({ project: origin.project, subject: origin.subject,
    obligation: "Cyclic repair", why: "Invalid ancestry", now: h.now() }), planRepair: { ...link, parentWorkItemId: "" } };
  await registerWorkItem(h.repos, cyclic, h.now());
  assert.equal(await authorizeInheritedHeldArtifact(h.repos, { ...request, childWorkItemId: cyclic.id }), false);
});

test("inherited byte authorization reads only the authorized origin log and checks every exact capture", async t => {
  const h = await autonomousHarness(), origin = h.item;
  const capture = (await h.repos.artifacts.read(origin.id))[0];
  assert.ok(capture);
  const attempt = (await h.repos.attempts.mustRead(capture.attemptId)).value;
  const child = { ...createWorkItem({ project: origin.project, subject: origin.subject,
    obligation: "Reuse the authorized origin", why: "Fixture repair", now: h.now() }),
    planRepair: { parentWorkItemId: origin.id, rootWorkItemId: origin.id, depth: 1,
      proposalHash: "test-proposal", scoutAttemptId: attempt.id, sourceArtifactId: capture.artifactId,
      retainedEvidenceIds: [capture.artifactId], admittedAt: h.now(), authority: "WORK_INSTRUCTIONS_ONLY" as const, unresolved: [] } };
  await registerWorkItem(h.repos, child, h.now());
  const unrelated = createWorkItem({ project: origin.project, subject: origin.subject,
    obligation: "Independent origin", why: "No repair ancestry", now: h.now() });
  await registerWorkItem(h.repos, unrelated, h.now());
  await h.repos.artifacts.append(unrelated.id, "unrelated-log", { ...capture, workItemId: unrelated.id }, h.now());
  await h.repos.artifacts.append(origin.id, "wrong-owner", { ...capture, artifactId: "wrong-owner", workItemId: unrelated.id }, h.now());
  await h.repos.artifacts.append(origin.id, "partial", { ...capture, artifactId: "partial", partial: true }, h.now());
  const aborted = { ...attempt, id: "aborted-origin-capture", outcome: "ABORTED" as const };
  await h.repos.attempts.put(aborted.id, aborted, h.now());
  await h.repos.artifacts.append(origin.id, "aborted", { ...capture, artifactId: "aborted", attemptId: aborted.id }, h.now());
  await h.repos.artifacts.append(origin.id, "alternate-aborted", { ...capture, artifactId: "alternate", attemptId: aborted.id }, h.now());
  await h.repos.artifacts.append(origin.id, "alternate-completed", { ...capture, artifactId: "alternate" }, h.now());
  const read = h.repos.artifacts.read.bind(h.repos.artifacts), keys: string[] = [];
  t.mock.method(h.repos.artifacts, "readAll", async () => { assert.fail("an inherited artifact must never scan unrelated logs"); });
  t.mock.method(h.repos.artifacts, "read", async (key: string) => {
    assert.equal(key, origin.id, "only the already-authorized origin crosses the read boundary");
    keys.push(key);
    return read(key);
  });
  const request = { artifactId: capture.artifactId, originWorkItemId: origin.id,
    childWorkItemId: child.id, project: origin.project };
  assert.equal(await authorizeInheritedHeldArtifact(h.repos, request), true);
  for (const artifactId of ["wrong-owner", "partial", "aborted", "missing"]) {
    assert.equal(await authorizeInheritedHeldArtifact(h.repos, { ...request, artifactId }), false, artifactId);
  }
  assert.equal(await authorizeInheritedHeldArtifact(h.repos, { ...request, artifactId: "alternate" }), true,
    "a completed exact capture in this origin survives an earlier aborted capture");
  assert.equal(await authorizeInheritedHeldArtifact(h.repos, { ...request, originWorkItemId: unrelated.id }), false,
    "same project and subject do not authorize an unrelated owner");
  assert.deepEqual(keys, Array(6).fill(origin.id), "invalid ancestry is refused before any artifact log read");
});
