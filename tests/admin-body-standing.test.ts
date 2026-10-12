/**
 * A watched body's standing from the light read (versions, reads, the served version's readback)
 * must equal its standing from the full read.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { buildBodyViews, type BodyStoreFacts, type VersionFacts, type WatchedContract } from "../lib/control-plane/admin-view/bodies.ts";
import { containerStanding, indexBodies, registryBodyOf, observedCoverageStatus, coverageStatusPill } from "../lib/control-plane/admin-view/coverage.ts";
import { previewScopeBodies } from "../lib/control-plane/admin-view/scope-preview.ts";

const NOW = "2026-09-24T21:00:00.000Z";

const contract = (id: string, division: string): WatchedContract => ({
  id: `meetings:test:${id}`,
  scope: `source:test:body:${id}`,
  bodyId: `${division}#${id}`,
  ocdId: division,
  meetingSource: "test",
  jurisdiction: id,
  publishingOrg: id,
  sourceUrl: `https://example.gov/${id}`,
  verifiedAt: null,
  cadence: { description: "every hour", defaultEveryMs: 3_600_000 },
  retry: { afterMs: 900_000, description: "fifteen minutes later" },
});

const AZ = "ocd-division/country:us/state:az";
const working = contract("working", `${AZ}/place:tucson`);
const attention = contract("attention", `${AZ}/county:pima`);
const stuck = contract("stuck", `${AZ}/place:marana`);
const unread = contract("unread", `${AZ}/place:oro_valley`);
const changedOnly = contract("changed-only", `${AZ}/place:sahuarita`);
const contracts = [working, attention, stuck, unread, changedOnly];

const version = (c: WatchedContract, id: string, meetings: number): VersionFacts => ({
  scope: c.scope, versionId: id, promotedAt: "2026-09-24T19:00:00.000Z", meetings, fresh: meetings, carried: 0, docs: 1, noAgendaLink: 0,
  noAgendaAhead: 0, upcoming: 2, furthestAhead: "2026-12-01T00:00:00.000Z", bodyName: c.jurisdiction, jurisdiction: c.jurisdiction,
  outcome: "UNCHANGED", added: 0, changed: 0, removed: 0, held: 0,
});

/* The whole read: versions, reads, readbacks of current AND changing versions, the day tally and the change history. */
const full: BodyStoreFacts = {
  asOf: NOW,
  versions: [version(working, "cv-w", 12), version(attention, "cv-a", 5), version(changedOnly, "cv-c-now", 3)],
  attempts: [
    { scope: working.scope, candidateId: "cv-w", state: "PROMOTED", failureCode: null, failureDetail: null, acquisitionSucceeded: true, attemptedAt: "2026-09-24T19:00:00.000Z" },
    { scope: attention.scope, candidateId: "cv-a2", state: "REFUSED", failureCode: "PUBLISHER_RESPONSE_REFUSED", failureDetail: "HTTP 403", acquisitionSucceeded: false, attemptedAt: "2026-09-24T20:00:00.000Z" },
    { scope: stuck.scope, candidateId: "cv-s", state: "REFUSED", failureCode: "PUBLISHER_RESPONSE_REFUSED", failureDetail: "HTTP 500", acquisitionSucceeded: false, attemptedAt: "2026-09-24T20:10:00.000Z" },
    { scope: changedOnly.scope, candidateId: "cv-c-now", state: "PROMOTED", failureCode: null, failureDetail: null, acquisitionSucceeded: true, attemptedAt: "2026-09-24T19:30:00.000Z" },
  ],
  readbacks: [
    { candidateId: "cv-w", at: "2026-09-24T19:05:00.000Z", passed: true },
    { candidateId: "cv-a", at: "2026-09-24T19:05:00.000Z", passed: true },
    // A readback of a CHANGING version that is no longer served: history, never the current standing.
    { candidateId: "cv-c-old", at: "2026-09-23T10:00:00.000Z", passed: true },
  ],
  day: contracts.map((c) => ({ scope: c.scope, reads: 24, gotIn: 20, versions: 20, changedVersions: 1, cannotTell: 0, added: 1, changed: 0, removed: 0 })),
  changes: [
    { scope: changedOnly.scope, versionId: "cv-c-old", retrievedAt: "2026-09-23T09:59:00.000Z", promotedAt: "2026-09-23T10:00:00.000Z", validatedAt: "2026-09-23T10:00:00.000Z",
      added: 1, changed: 0, removed: 0, held: 0, meetingsAdded: 1, named: [], meetingsChanged: 0, changedNamed: [] },
  ],
};

/* The light read: the same versions and reads, only the served versions' readbacks, no day, no history. */
const light: BodyStoreFacts = {
  ...full,
  readbacks: full.readbacks.filter((r) => full.versions.some((v) => v.versionId === r.candidateId)),
  day: [],
  changes: null,
};

const standingOf = (store: BodyStoreFacts) =>
  buildBodyViews({ contracts, store, nowIso: NOW }).map((v) => ({ id: v.id, ocdId: v.ocdId, status: v.status, readerVisible: v.readerVisible }));

test("the light read decides every standing exactly as the full read does", () => {
  const fromFull = standingOf(full);
  assert.deepEqual(standingOf(light), fromFull);
  const byId = new Map(fromFull.map((v) => [v.id, v.status]));
  assert.equal(byId.get(working.bodyId), "WORKING");
  assert.equal(byId.get(attention.bodyId), "NEEDS ATTENTION");
  assert.equal(byId.get(stuck.bodyId), "STUCK");
  assert.equal(byId.get(unread.bodyId), "NOT READ YET");
  assert.equal(byId.get(changedOnly.bodyId), "NEEDS ATTENTION", "a passed readback of an older changing version never stands in for the served one");
});

test("the preview's counts are the same from either read", () => {
  const registry = contracts.map((c) => registryBodyOf({ id: c.bodyId, name: c.jurisdiction, ocdId: c.ocdId, coverageStatus: "WALKED", bodyClass: "GOVERNING" }));
  const codes = [
    { zcta5: "85701", whole: true, fraction: 1, indexed: true, divisions: [`${AZ}/place:tucson`, `${AZ}/county:pima`] },
    { zcta5: "85653", whole: false, fraction: 0.4, indexed: true, divisions: [`${AZ}/place:marana`, `${AZ}/place:oro_valley`, `${AZ}/place:sahuarita`] },
    { zcta5: "85000", whole: true, fraction: null, indexed: false, divisions: [] },
  ];
  const index = indexBodies(registry);
  const a = containerStanding(codes, index, buildBodyViews({ contracts, store: full, nowIso: NOW }));
  const b = containerStanding(codes, index, buildBodyViews({ contracts, store: light, nowIso: NOW }));
  assert.deepEqual(b.counts, a.counts);
  assert.deepEqual(b.perCode.map((c) => c.counts), a.perCode.map((c) => c.counts));
});

test("normal published body readings advance the stale registry preview without hiding a later failed read", () => {
  const registry = contracts.map(c => registryBodyOf({ id: c.bodyId, name: c.jurisdiction, ocdId: c.ocdId, coverageStatus: "NOT_ATTEMPTED" }));
  const codes = [{ zcta5: "85701", whole: true, fraction: 1, indexed: true, divisions: contracts.map(c => c.ocdId!), partial: [] }];
  const index = indexBodies(registry);
  const views = buildBodyViews({ contracts, store: light, nowIso: NOW });
  const baseline = containerStanding(codes, index, []);
  assert.equal(baseline.counts.neverWalked, 5);
  const current = containerStanding(codes, index, views);
  assert.equal(current.counts.wayIn, 3);
  assert.equal(current.counts.neverWalked, 1);
  assert.equal(current.counts.other, 1);
  const preview = new Map(previewScopeBodies(codes, index, views).map(body => [body.id, body.coverageStatus]));
  assert.equal(preview.get(working.bodyId), "LIVE");
  assert.equal(preview.get(attention.bodyId), "LIVE", "the retained publication still proves a recorded route");
  assert.equal(views.find(body => body.id === attention.bodyId)!.status, "NEEDS ATTENTION", "current failure remains visible");
  assert.equal(preview.get(stuck.bodyId), "READ_UNRESOLVED", "a failed read is neither success nor never attempted");
  assert.equal(coverageStatusPill(preview.get(stuck.bodyId)!).pill, "READ · UNRESOLVED");
  assert.equal(preview.get(unread.bodyId), "NOT_ATTEMPTED", "a scheduled clock alone proves no read");
});

test("a sibling body's successful reading cannot improve another body on the same division", () => {
  const sibling = registryBodyOf({ id: `${working.ocdId}#sibling`, ocdId: working.ocdId, coverageStatus: "NOT_ATTEMPTED" });
  const views = buildBodyViews({ contracts, store: light, nowIso: NOW });
  const workingView = views.find(body => body.id === working.bodyId)!;
  assert.equal(observedCoverageStatus(sibling, workingView), "NOT_ATTEMPTED");
  const codes = [{ zcta5: "85701", whole: true, fraction: 1, indexed: true, divisions: [working.ocdId!], partial: [] }];
  assert.equal(containerStanding(codes, indexBodies([sibling]), views).counts.wayIn, 0);
  assert.equal(previewScopeBodies(codes, indexBodies([sibling]), views)[0].coverageStatus, "NOT_ATTEMPTED");
});
