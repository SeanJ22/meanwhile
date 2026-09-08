/**
 * The invalid-candidate/LKG half of post-deploy RCD-10 acceptance.
 *
 * Run only after a settled software deployment and three NEW representative
 * valid source promotions. The caller must supply each prior version and the
 * distinct new GOOD version, which this script verifies against the durable
 * promotion event before injecting one precisely invalid candidate. It then
 * proves the exact pointer and runtime-adapter payload remain last-known-good.
 *
 * This script does NOT observe the deployed HTTP consumer or external release
 * systems. Git/PR/Actions/Netlify/Next/browser before/after evidence is a
 * separate required half of RCD-10; ZERO_RELEASE_EVENTS below is only the
 * structural contract. This script cannot by itself close RCD-10.
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

const runId = randomUUID();

function requiredVersionFlag(name: string): string {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length).trim();
  if (!value) throw new Error(`RCD10_EXPECTED_VERSION_REQUIRED:${name}`);
  return value;
}

const expectedVersions = {
  FEC: {
    prior: requiredVersionFlag("fec-prior"),
    good: requiredVersionFlag("fec-good"),
  },
  STATE_LEGISLATOR: {
    prior: requiredVersionFlag("state-prior"),
    good: requiredVersionFlag("state-good"),
  },
  CENSUS_REFERENCE: {
    prior: requiredVersionFlag("census-prior"),
    good: requiredVersionFlag("census-good"),
  },
} as const;

for (const [name, versions] of Object.entries(expectedVersions)) {
  assert.notEqual(versions.prior, versions.good, `${name}: the post-deploy GOOD version must be new`);
}

const handle = resolveProductionWriteHandle();
process.env.DATABASE_URL = handle.connection;
process.env.WTP_DB_ROLE = "production";
process.env.WTP_SANCTIONED_WRITE = "routine-civic-data-promotion";
assertWriteAllowed("a routine civic data candidate/version promotion");

const store = new PostgresRoutineDataStore();

interface AcceptanceTarget {
  readonly name: "FEC" | "STATE_LEGISLATOR" | "CENSUS_REFERENCE";
  readonly recordClass: RoutineRecordClass;
  readonly scope: string;
  readonly expectedInvalidState: CandidateState;
  readonly expectedFailureCode: string;
  readonly priorVersionId: string;
  readonly expectedGoodVersionId: string;
  readonly runtimeAdapterReadVersion: () => Promise<string | null>;
  readonly invalidate: (candidate: RoutineCandidate) => RoutineCandidate;
}

const targets: readonly AcceptanceTarget[] = [
  {
    name: "FEC",
    recordClass: "FEC_FUNDING",
    scope: "federal-supported",
    expectedInvalidState: "PARSE_INVALID",
    expectedFailureCode: "PARSER_FAILED",
    priorVersionId: expectedVersions.FEC.prior,
    expectedGoodVersionId: expectedVersions.FEC.good,
    runtimeAdapterReadVersion: refreshFundingFromPromoted,
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
    priorVersionId: expectedVersions.STATE_LEGISLATOR.prior,
    expectedGoodVersionId: expectedVersions.STATE_LEGISLATOR.good,
    runtimeAdapterReadVersion: async () => (await promotedNhMembers())?.versionId ?? null,
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
    priorVersionId: expectedVersions.CENSUS_REFERENCE.prior,
    expectedGoodVersionId: expectedVersions.CENSUS_REFERENCE.good,
    runtimeAdapterReadVersion: refreshPopulationFromPromoted,
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
  assert.equal(before.versionId, target.expectedGoodVersionId, `${target.name}: current pointer is not the stated new post-deploy GOOD version`);
  assert.equal(before.receipt.decision, "GOOD", `${target.name}: current production pointer has no GOOD receipt`);
  assert.ok(before.receipt.checks.every((check) => check.verdict === "PASS"), `${target.name}: current receipt is not eight-pass GOOD`);
  const valid = await store.readCandidate(before.versionId);
  assert.ok(valid, `${target.name}: promoted candidate ${before.versionId} is not durable`);
  assert.equal(valid.state, "PROMOTED");
  assert.equal(valid.candidate.retrieval.succeeded, true);
  const promotionEvent = (await store.events(valid.candidate.id)).find((event) => event.state === "PROMOTED");
  assert.ok(promotionEvent, `${target.name}: new GOOD candidate has no durable PROMOTED event`);
  assert.ok(
    promotionEvent.detail.includes(`from ${target.priorVersionId} to ${target.expectedGoodVersionId}`),
    `${target.name}: promotion event does not prove the stated prior-to-new transition`,
  );

  clearPromotedReadModelCache();
  const validRuntimeVersion = await target.runtimeAdapterReadVersion();
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
  const heldRuntimeVersion = await target.runtimeAdapterReadVersion();
  assert.equal(heldRuntimeVersion, before.versionId, `${target.name}: runtime stopped serving LKG after invalid canary`);

  results[target.name] = {
    sourceRetrieval: "PASS",
    authorityContract: "PASS",
    validationReceipt: "PASS",
    promotion: "PASS",
    priorVersion: target.priorVersionId,
    newGoodVersion: before.versionId,
    runtimeAdapterReadsPromotedVersion: "PASS",
    deployedRuntimeConsumerEvidence: "REQUIRED_SEPARATELY",
    invalidCandidate: invalid.id,
    invalidState: outcome.candidate.state,
    invalidFailureCode: outcome.candidate.failureCode,
    invalidPromoted: false,
    lastKnownGoodHeld: true,
    structuralReleaseContract: ZERO_RELEASE_EVENTS,
    observedReleaseEvents: "REQUIRED_SEPARATELY",
  };
}

console.log("RCD10_INVALID_LKG_CANARY=" + JSON.stringify({
  runId,
  classes: results,
  structuralReleaseContract: ZERO_RELEASE_EVENTS,
  observedReleaseEvents: "REQUIRED_SEPARATELY",
  rcd10Complete: false,
}));
