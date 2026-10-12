import assert from "node:assert/strict";
import test from "node:test";

import { projectFixPreventionHistory, readFixPreventionHistory } from "../lib/control-plane/admin-view/fix-prevention-history.ts";
import type { ControlPlaneRepositories, Persisted } from "../lib/control-plane/repository/types.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";

const at = "2026-09-28T19:00:00.000Z";
const later = "2026-09-28T19:01:00.000Z";
const observedAt = "2026-09-28T19:03:00.000Z";
const assignmentKey = "zcta:2020/85635";
const receiptId = "send-original";
type Item = Parameters<typeof projectFixPreventionHistory>[0]["items"][number]["item"];
const root = { ...createWorkItem({ project: "normal", subject: "sierra-vista", obligation: "roster-owed",
  why: "The roster needs verification", now: at }),
  autonomousPlan: { ownerInstructions: [receiptId] },
  planRepairObservations: {
    "at-refused": { parentWorkItemId: "root", scoutAttemptId: "at-refused", code: "SOURCE_MAPPING_INVALID",
      successorWorkItemId: null, detail: "Raw model explanation must stay private." },
    "at-admitted": { parentWorkItemId: "root", scoutAttemptId: "at-admitted", code: "ADMITTED",
      successorWorkItemId: "child", detail: "Raw model explanation must stay private." },
  },
} as unknown as Item;
const rootItem: Item = { ...root, id: "root", planRepairObservations: {
  "at-refused": { parentWorkItemId: "root", scoutAttemptId: "at-refused", code: "SOURCE_MAPPING_INVALID",
    successorWorkItemId: null, detail: "Raw model explanation must stay private." },
  "at-admitted": { parentWorkItemId: "root", scoutAttemptId: "at-admitted", code: "ADMITTED",
    successorWorkItemId: "child", detail: "Raw model explanation must stay private." },
} };
const child: Item = { ...rootItem, id: "child", planRepairObservations: {},
  planRepair: { parentWorkItemId: rootItem.id, rootWorkItemId: rootItem.id, depth: 1,
    proposalHash: "hash", scoutAttemptId: "at-admitted", sourceArtifactId: "artifact",
    retainedEvidenceIds: [], admittedAt: later, authority: "WORK_INSTRUCTIONS_ONLY", unresolved: ["verify roster"] },
  publicationOutcome: { at: observedAt, workerResultId: "wr-1", status: "PARTIALLY_PUBLISHED",
    code: "PARTIAL_ROSTER", detail: "Some records remain unresolved", candidateId: "candidate", versionId: "version" },
};

function itemEvidence(item: Item) {
  return { item, scouts: [], results: [], scoutWindowFull: false, resultWindowFull: false };
}

test("admitted instructions and partial publication do not become a proved fix, prevention, or public effect", () => {
  const view = projectFixPreventionHistory({ requestedWorkItemId: rootItem.id, rootWorkItemId: rootItem.id,
    subjectId: rootItem.subject, scope: { assignmentKey, receiptId, match: "EXACT" }, observedAt,
    items: [itemEvidence(rootItem), itemEvidence(child)], lineageTruncated: false });
  assert.equal(view.fix.admittedInstructionSets, 1);
  assert.equal(view.fix.applied, null);
  assert.equal(view.prevention.proved, null);
  assert.equal(view.proof.fixProved, null);
  assert.equal(view.publicEffect.confirmed, null);
  assert.equal(view.publicEffect.recordedPublisherAttempts, 1);
  assert.equal(view.diagnosis.observedRefusals, 1);
  assert.equal(view.diagnosis.confirmedCause, null);
  assert.equal(JSON.stringify(view).includes("Raw model explanation"), false);
  assert.equal(JSON.stringify(view).includes("Some records remain unresolved"), false);
});

function repositories(override: { readonly child?: Item; readonly root?: Item } = {}) {
  const work = new Map([[rootItem.id, override.root ?? rootItem], [child.id, override.child ?? child]]);
  const calls: string[] = [];
  const row = <T>(id: string, value: T): Persisted<T> => ({ id, value, revision: 1, updatedAt: at });
  const repos = {
    workItems: { read: async (id: string) => { calls.push(`work:${id}`); return work.has(id) ? row(id, work.get(id)!) : null; },
      list: () => { throw new Error("broad work scan"); } },
    obligations: { read: async (id: string) => { calls.push(`obligation:${id}`);
      return row(id, { assignments: [{ assignmentKey, ref: receiptId }] }); } },
    scoutResults: { readRecentWhere: async (key: string, _path: readonly string[], id: string) => {
      calls.push(`scout:${key}:${id}`);
      return id === rootItem.id ? [{ workItemId: id, attemptId: "at-refused", recordedAt: at }] : [];
    }, readAll: () => { throw new Error("broad Scout scan"); } },
    workerResults: { readRecentWhere: async (key: string) => { calls.push(`result:${key}`);
      return key === child.id ? [{ workItemId: key, id: "wr-1", endedAt: later,
        result: { role: "VALIDATOR", verdict: "PASS", detail: "Private raw result" } }] : [];
    }, readAll: () => { throw new Error("broad result scan"); } },
  } as unknown as ControlPlaneRepositories;
  return { repos, calls };
}

test("point-linked lineage and exact scope produce bounded safe history, without fleet scans", async () => {
  const { repos, calls } = repositories();
  const result = await readFixPreventionHistory(repos, { workItemId: child.id, subjectId: rootItem.subject,
    scope: { assignmentKey, receiptId }, observedAt, limit: 2 });
  assert.equal(result.kind, "HELD");
  if (result.kind !== "HELD") return;
  assert.equal(result.value.scope?.match, "EXACT");
  assert.equal(result.value.rootWorkItemId, rootItem.id);
  assert.equal(result.value.knownLineageItems, 2);
  assert.equal(result.value.returnedEvents, 2);
  assert.equal(result.value.hasEarlierKnownEvents, true);
  assert.equal(result.value.proof.recordedWorkerChecks, 1);
  assert.equal(JSON.stringify(result).includes("Private raw result"), false);
  assert(calls.includes(`work:${rootItem.id}`));
});

test("scope receipt and lineage links fail closed; legacy missing work tags remain visible as unconfirmed", async () => {
  const wrongScope = await readFixPreventionHistory(repositories().repos, { workItemId: rootItem.id,
    scope: { assignmentKey, receiptId: "later-send" }, observedAt });
  assert.equal(wrongScope.kind, "NOT_RECORDED");
  const foreign = { ...child, subject: "other-subject" } as Item;
  const foreignRead = await readFixPreventionHistory(repositories({ child: foreign }).repos, { workItemId: rootItem.id, observedAt });
  assert.equal(foreignRead.kind, "HELD");
  if (foreignRead.kind === "HELD") {
    assert.equal(foreignRead.value.knownLineageItems, 1);
    assert.match(foreignRead.value.gaps.join(" "), /invalidated parent|validated parent/);
  }
  const forgedDepth = { ...child, planRepair: { ...child.planRepair!, depth: 9 } } as Item;
  const forgedRead = await readFixPreventionHistory(repositories({ child: forgedDepth }).repos, { workItemId: rootItem.id, observedAt });
  assert.equal(forgedRead.kind, "HELD");
  if (forgedRead.kind === "HELD") assert.equal(forgedRead.value.knownLineageItems, 1);
  const legacy = { ...rootItem, autonomousPlan: undefined } as unknown as Item;
  const legacyRead = await readFixPreventionHistory(repositories({ root: legacy }).repos, { workItemId: rootItem.id,
    scope: { assignmentKey, receiptId }, observedAt });
  assert.equal(legacyRead.kind, "HELD");
  if (legacyRead.kind === "HELD") assert.equal(legacyRead.value.scope?.match, "UNCONFIRMED");
});
