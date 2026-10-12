/**
 * "Publishes ahead" says where the PUBLISHER's list ends only when
 * the promoted read was bounded, paginated to its end and claims it holds
 * everything listed; otherwise it says the limit was not checked, beside what
 * we hold. A failed horizon check is ours, not the publisher's limit.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBodyViews,
  horizonFromColumns,
  horizonIsPublishersLimit,
  publishesAheadWords,
  type BodyStoreFacts,
  type VersionFacts,
  type WatchedContract,
} from "../lib/control-plane/admin-view/bodies.ts";

const NOW = "2026-09-25T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);
const THROUGH = "2026-10-15T23:00:00.000Z";

test("MW-017: only a bounded, fully paginated read that claims completeness names the publisher's own limit", () => {
  const complete = { kind: "BOUNDED" as const, returnedRecords: 12, declaredTotal: 12, paginationComplete: true, claimsComplete: true };
  assert.equal(horizonIsPublishersLimit(complete), true);
  assert.match(publishesAheadWords({ furthestAhead: THROUGH, horizon: complete }, null, NOW_MS), /^The publisher lists through Oct 15, 2026 — 20 days ahead \(the read holds 12 of the 12 it lists\)$/);

  // The shape every routine meeting candidate carries today: bounded and paginated, but no completeness claim.
  const meetings = { ...complete, claimsComplete: false };
  const words = publishesAheadWords({ furthestAhead: THROUGH, horizon: meetings }, null, NOW_MS);
  assert.match(words, /^Not checked — the read does not claim it holds everything the publisher lists/);
  assert.match(words, /the version we hold lists meetings through Oct 15, 2026, 20 days ahead$/);
  assert.doesNotMatch(words, /The publisher lists through/);

  assert.match(publishesAheadWords({ furthestAhead: THROUGH, horizon: { ...complete, kind: "OPEN_FACT_SET" } }, null, NOW_MS), /^Not checked/);
  assert.match(publishesAheadWords({ furthestAhead: THROUGH, horizon: null }, null, NOW_MS), /^Unknown — the read records no horizon/);
  assert.match(publishesAheadWords({ furthestAhead: THROUGH }, null, NOW_MS), /^Unknown — whether the read holds everything the publisher lists was not read/);
  assert.match(publishesAheadWords({ furthestAhead: THROUGH, horizon: complete }, { state: "HORIZON_UNRESOLVED" }, NOW_MS), /^Not checked — the last read could not complete our check .*our check is incomplete; this is not a limit the publisher set/);
  assert.equal(publishesAheadWords(null, null, NOW_MS), "Unknown — nothing has been read from this source");
});

test("MW-017: the horizon columns parse to a slice; an unknown kind is no horizon, never bounded", () => {
  assert.deepEqual(horizonFromColumns({ horizon_kind: "BOUNDED", horizon_returned: "7", horizon_declared: "7", horizon_paginated: "true", horizon_complete: "false" }), {
    kind: "BOUNDED", returnedRecords: 7, declaredTotal: 7, paginationComplete: true, claimsComplete: false,
  });
  assert.equal(horizonFromColumns({ horizon_kind: null }), null);
  assert.equal(horizonFromColumns({ horizon_kind: "SOMETHING" }), null);
  assert.equal(horizonFromColumns({ horizon_kind: "BOUNDED", horizon_complete: "yes" })!.claimsComplete, false, "only a plain true is true");
});

test("MW-017: the body's schedule row uses the horizon, and the store reads five scalars off it, never the candidate", () => {
  const contract: WatchedContract = {
    id: "meetings:legistar:tucson-council", scope: "source:legistar:body:tucson-council", bodyId: "ocd-division/country:us/state:az/place:tucson#governing",
    ocdId: "ocd-division/country:us/state:az/place:tucson", meetingSource: "legistar", jurisdiction: "Tucson", publishingOrg: "City of Tucson",
    sourceUrl: "https://tucson.legistar.com/Calendar.aspx", verifiedAt: null, cadence: { description: "every hour", defaultEveryMs: 3_600_000 },
    retry: { afterMs: 900_000, description: "fifteen minutes later" },
  };
  const version: VersionFacts = {
    scope: contract.scope, versionId: "cv-1", promotedAt: "2026-09-25T11:00:00.000Z", meetings: 9, fresh: 9, carried: 0, docs: 0, noAgendaLink: 0, noAgendaAhead: 0,
    upcoming: 4, furthestAhead: THROUGH, bodyName: "Mayor and Council", jurisdiction: "Tucson", outcome: "UNCHANGED", added: 0, changed: 0, removed: 0, held: 0,
    horizon: { kind: "BOUNDED", returnedRecords: 9, declaredTotal: 9, paginationComplete: true, claimsComplete: false },
  };
  const store: BodyStoreFacts = {
    asOf: NOW, versions: [version], readbacks: [], day: [], changes: [],
    attempts: [{ scope: contract.scope, candidateId: "cv-1", state: "PROMOTED", failureCode: null, failureDetail: null, acquisitionSucceeded: true, attemptedAt: "2026-09-25T11:00:00.000Z" }],
  };
  const [body] = buildBodyViews({ contracts: [contract], store, nowIso: NOW });
  const row = body!.schedule.find(([k]) => k === "Publishes ahead")![1];
  assert.match(row, /^Not checked — /, "a routine read that does not claim completeness never states the publisher's limit");
});
