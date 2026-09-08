/**
 * Post-deploy RCD-10 acceptance against the production data plane.
 *
 * Run only after the three representative valid source promotions. This
 * script reads each promoted version through the same runtime adapter Reader
 * uses, injects one precisely invalid candidate, and proves the exact pointer
 * and payload remain last-known-good. It invokes no source, git, CI, build,
 * deploy, staging, or browser operation.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { clearPromotedReadModelCache } from "../lib/civic-data/read-model.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";
import { processRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { normalizedHash } from "../lib/civic-data/candidate-builders.ts";
import { promotedNhMembers } from "../lib/civic-data/state-members.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import type { CandidateState, RoutineCandidate, RoutineRecordClass } from "../lib/civic-data/types.ts";
import { assertWriteAllowed } from "../lib/db/write-guard.ts";
import { resolveProductionWriteHandle } from "../lib/db/write-handle.ts";
import { refreshFundingFromPromoted } from "../lib/funding/snapshot.ts";
import { refreshPopulationFromPromoted } from "../lib/reference/acs-population.ts";

const handle = resolveProductionWriteHandle();
process.env.DATABASE_URL = handle.connection;
process.env.WTP_DB_ROLE = "production";
process.env.WTP_SANCTIONED_WRITE = "routine-civic-data-promotion";
assertWriteAllowed("a routine civic data candidate/version promotion");

const store = new PostgresRoutineDataStore();
const runId = randomUUID();

interface AcceptanceTarget {
  readonly name: "FEC" | "STATE_LEGISLATOR" | "CENSUS_REFERENCE";
  readonly recordClass: RoutineRecordClass;
  readonly scope: string;
  readonly expectedInvalidState: CandidateState;
  readonly expectedFailureCode: string;
  readonly runtimeReadVersion: () => Promise<string | null>;
  readonly invalidate: (candidate: RoutineCandidate) => RoutineCandidate;
}

const targets: readonly AcceptanceTarget[] = [
  {
    name: "FEC",
    recordClass: "FEC_FUNDING",
    scope: "federal-supported",
    expectedInvalidState: "PARSE_INVALID",
    expectedFailureCode: "PARSER_FAILED",
    runtimeReadVersion: refreshFundingFromPromoted,
    invalidate: (candidate) => ({
      ...candidate,
      normalization: {
        ...candidate.normalization,
        succeeded: false,
        normalizedHash: null,
        failureDetail: "RCD-10 canary: deliberately malformed normalized FEC payload.",
      },
    }),
  },
  {
    name: "STATE_LEGISLATOR",
    recordClass: "STATE_LEGISLATOR",
    scope: "US-NH",
    expectedInvalidState: "IDENTITY_UNRESOLVED",
    expectedFailureCode: "STATE_MEMBER_SEAT_IDENTITY_INCOMPLETE",
    runtimeReadVersion: async () => (await promotedNhMembers())?.versionId ?? null,
    invalidate: (candidate) => ({
      ...candidate,
      identities: candidate.identities.map((identity, index) => index === 0 ? { ...identity, term: undefined } : identity),
    }),
  },
  {
    name: "CENSUS_REFERENCE",
    recordClass: "CENSUS_REFERENCE",
    scope: "acs-population",
    expectedInvalidState: "TEMPORAL_INVALID",
    expectedFailureCode: "WRONG_PERIOD_OR_VINTAGE",
    runtimeReadVersion: refreshPopulationFromPromoted,
    invalidate: (candidate) => ({
      ...candidate,
      temporal: { ...candidate.temporal, version: "1900" },
    }),
  },
] as const;

const results: Record<string, unknown> = {};

for (const target of targets) {
  const before = await store.readPromotion(target.recordClass, target.scope);
  assert.ok(before, `${target.name}: no promoted production version exists`);
  assert.equal(before.receipt.decision, "GOOD", `${target.name}: current production pointer has no GOOD receipt`);
  assert.ok(before.receipt.checks.every((check) => check.verdict === "PASS"), `${target.name}: current receipt is not eight-pass GOOD`);
  const valid = await store.readCandidate(before.versionId);
  assert.ok(valid, `${target.name}: promoted candidate ${before.versionId} is not durable`);
  assert.equal(valid.state, "PROMOTED");
  assert.equal(valid.candidate.retrieval.succeeded, true);

  clearPromotedReadModelCache();
  const validRuntimeVersion = await target.runtimeReadVersion();
  assert.equal(validRuntimeVersion, before.versionId, `${target.name}: runtime did not read the promoted version`);

  const invalidBase = target.invalidate(structuredClone(valid.candidate));
  const invalid: RoutineCandidate = {
    ...invalidBase,
    id: `rcd10-canary-${target.name.toLowerCase()}-${runId}`,
  };
  const outcome = await processRoutineCandidate(store, invalid, new Date().toISOString());
  assert.equal(outcome.promoted, null, `${target.name}: invalid canary promoted`);
  assert.equal(outcome.candidate.state, target.expectedInvalidState);
  assert.equal(outcome.candidate.failureCode, target.expectedFailureCode);

  const after = await store.readPromotion(target.recordClass, target.scope);
  assert.ok(after);
  assert.equal(after.versionId, before.versionId, `${target.name}: invalid canary moved the production pointer`);
  assert.equal(after.lastKnownGoodVersionId, before.lastKnownGoodVersionId, `${target.name}: invalid canary changed LKG`);
  assert.equal(normalizedHash(after.payload), normalizedHash(before.payload), `${target.name}: invalid canary mutated the served payload`);

  clearPromotedReadModelCache();
  const heldRuntimeVersion = await target.runtimeReadVersion();
  assert.equal(heldRuntimeVersion, before.versionId, `${target.name}: runtime stopped serving LKG after invalid canary`);

  results[target.name] = {
    sourceRetrieval: "PASS",
    authorityContract: "PASS",
    validationReceipt: "PASS",
    promotion: "PASS",
    runtimeReadsPromotedVersion: "PASS",
    validVersion: before.versionId,
    invalidCandidate: invalid.id,
    invalidState: outcome.candidate.state,
    invalidFailureCode: outcome.candidate.failureCode,
    invalidPromoted: false,
    lastKnownGoodHeld: true,
    releaseEvents: ZERO_RELEASE_EVENTS,
  };
}

console.log("RCD10_LIVE_ACCEPTANCE=" + JSON.stringify({ runId, classes: results, releaseEvents: ZERO_RELEASE_EVENTS }));
