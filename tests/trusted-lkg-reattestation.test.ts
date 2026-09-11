import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  dotGovCandidate,
  fecFundingCandidate,
  nhMembersCandidate,
  normalizedHash,
  officialStateRollCallsCandidate,
  sha256,
} from "../lib/civic-data/candidate-builders.ts";
import { civicRecordsFor } from "../lib/civic-data/changes.ts";
import { requiredRoutineContract } from "../lib/civic-data/contracts.ts";
import { requiredManualProductionContract } from "../lib/civic-data/manual-contracts.ts";
import {
  buildPdcV2TrustedLkgReattestationCandidate,
  executePdcV2TrustedLkgImportPlan,
  type PdcV2TrustedLkgImportPlan,
} from "../lib/civic-data/trusted-lkg-import-plan.ts";
import {
  processRegisteredManualCandidate,
  processRegisteredRoutineCandidate,
  processRoutineCandidate,
} from "../lib/civic-data/promotion.ts";
import {
  parseReaderProjectionReadback,
  READER_PROJECTION_READBACK_PREFIX,
} from "../lib/civic-data/reader-readback.ts";
import {
  readPromotedCivicData,
  readPromotedCivicDataBatch,
  promotionProofIssue,
} from "../lib/civic-data/read-model.ts";
import {
  projectRoutineDataObservability,
  type RoutineCandidateRow,
  type RoutinePromotionRow,
} from "../lib/civic-data/observability.ts";
import { routineTaskDue, routineTaskFromContract } from "../lib/civic-data/runner.ts";
import { readNhMembers } from "../lib/civic-data/state-members.ts";
import { officialStateRollIdentityAuthorityIssue } from "../lib/state-rollcalls/promotion-authority.ts";
import {
  MemoryRoutineDataStore,
  PromotionBaseChangedError,
} from "../lib/civic-data/store.ts";
import { PDC_V2_FROZEN_BASE_SHA } from "../lib/civic-data/trusted-lkg-import.ts";
import {
  NH_MEMBERS_V2_TO_V3_REATTESTATION,
  trustedLkgCandidateId,
  trustedLkgEvidenceSha256,
  trustedLkgImportEvidenceIssue,
} from "../lib/civic-data/trusted-lkg-import.ts";
import type {
  GencourtMember,
  MembersExtraction,
} from "../scripts/nh-gencourt-members.mts";
import type {
  CandidateEvent,
  CandidateVersionRecord,
  PromotedProjection,
  RoutineCandidate,
  ValidationReceipt,
} from "../lib/civic-data/types.ts";
import { VALIDATION_CHECKS } from "../lib/civic-data/types.ts";
import {
  federalDirectoryCandidate,
  type FederalDirectoryAcquisition,
} from "../lib/officials/federal-directory-data-plane.ts";
import {
  federalDirectoryFirstSeed,
  readFederalDirectoryProjection,
} from "../lib/officials/federal-directory-read-model.ts";

const RETRIEVED = "2026-09-08T00:00:00.000Z";
const LEGACY_VALIDATED = "2026-09-08T00:01:00.000Z";
const LEGACY_PROMOTED = "2026-09-08T00:02:00.000Z";
const CUTOVER = "2026-09-09T12:00:00.000Z";
const LIVE_RETRIEVED = "2026-09-10T12:00:00.000Z";
const IMPORTER_SHA = "a".repeat(40);
const FROZEN_NH_NORMALIZED_PAYLOAD_SHA256 =
  "6d686263bcb6e171afc121f57e98619baa1fc1656d52c3e354f32483644e4f06";

function sourceCandidate(): RoutineCandidate {
  return fecFundingCandidate({
    snapshot: {
      formatVersion: 1,
      fetchedAt: RETRIEVED,
      cycle: 2026,
      matchReport: { rosterMatched: 1, rosterTotal: 1, ballotMatched: 0, ballotTotal: 0 },
      candidates: [{
        dataClass: "FEC_COMMITTEE",
        fecCandidateId: "H6AZ01001",
        name: "Integrity successor control",
        state: "AZ",
        office: "H",
        district: "01",
        targetKeys: ["congress:integrity-control"],
        matchRoutes: ["bioguide-bridge"],
        principalCommitteeId: "C00999999",
        cycle: 2026,
        totals: {
          receipts: 10,
          disbursements: 1,
          cashOnHand: 9,
          individualItemized: 10,
          individualUnitemized: 0,
          smallDonorShare: 0,
          coverageEndDate: "2026-06-30",
        },
        topContributions: [],
        provenance: {
          sourceUrl: "https://api.open.fec.gov/v1/",
          sourceOrg: "Federal Election Commission",
          collectedAt: RETRIEVED,
          verifiedAt: RETRIEVED,
        },
      }],
      absences: [],
    },
    rawBodies: ["exact predecessor FEC bytes"],
    finalUrl: "https://api.open.fec.gov/v1/candidates/search/",
    retrievedAt: RETRIEVED,
    excludedFacts: [],
  });
}

function legacyCandidate(): RoutineCandidate {
  const current = sourceCandidate();
  const { normalizedPayloadHash: _missingPermanentDigest, ...normalization } = current.normalization;
  return JSON.parse(JSON.stringify({ ...current, normalization })) as RoutineCandidate;
}

function emptyPlan(): PdcV2TrustedLkgImportPlan {
  return {
    contractVersion: 1,
    frozenBaseSha: PDC_V2_FROZEN_BASE_SHA,
    frozenRoot: "C:/immutable-frozen-base",
    importerCodeSha: IMPORTER_SHA,
    importedAt: CUTOVER,
    candidates: [],
    meetingPartitionIdsWithLkg: [],
    meetingPartitionIdsWithoutLkg: [],
    meetingRows: 0,
    agendaDocumentRows: 0,
    manualContractIds: [],
  };
}

async function seededLegacyStore<T extends MemoryRoutineDataStore>(store: T): Promise<{
  readonly store: T;
  readonly predecessor: CandidateVersionRecord;
  readonly pointer: PromotedProjection;
}> {
  const legacy = legacyCandidate();
  const seeded = await processRoutineCandidate(store, legacy, RETRIEVED);
  assert.equal(seeded.candidate.state, "PROMOTED");
  const predecessor = await store.readCandidate(legacy.id);
  const pointer = await store.readPromotion(legacy.recordClass, legacy.scope);
  assert.ok(predecessor);
  assert.ok(pointer);
  return { store, predecessor, pointer };
}

function legacyDotGovCandidate(): RoutineCandidate {
  const rawText = readFileSync(
    new URL("../data/dotgov/snapshot.json", import.meta.url),
    "utf8",
  );
  const snapshot = JSON.parse(rawText) as Parameters<typeof dotGovCandidate>[0]["snapshot"];
  const current = dotGovCandidate({
    snapshot,
    rawText,
    finalUrl: snapshot.source.url,
    retrievedAt: RETRIEVED,
  });
  const { normalizedPayloadHash: _missingPermanentDigest, ...normalization } = current.normalization;
  return JSON.parse(JSON.stringify({ ...current, normalization })) as RoutineCandidate;
}

async function seededLegacyDotGovStore<T extends MemoryRoutineDataStore>(store: T): Promise<{
  readonly store: T;
  readonly predecessor: CandidateVersionRecord;
  readonly pointer: PromotedProjection;
}> {
  const legacy = legacyDotGovCandidate();
  const seeded = await processRoutineCandidate(store, legacy, RETRIEVED);
  assert.equal(seeded.candidate.state, "PROMOTED");
  const predecessor = await store.readCandidate(legacy.id);
  const pointer = await store.readPromotion(legacy.recordClass, legacy.scope);
  assert.ok(predecessor);
  assert.ok(pointer);
  return { store, predecessor, pointer };
}

function nhMember(
  chamber: "H" | "S",
  index: number,
  electedStatus: GencourtMember["electedStatus"] = "INCUMBENT",
): GencourtMember {
  return {
    chamber,
    familyName: `Family-${chamber}-${index}`,
    givenName: `Given-${chamber}-${index}`,
    middleName: null,
    seatNo: `${chamber}-${index + 1}`,
    county: chamber === "H" ? "Merrimack" : "Statewide",
    district: String(index + 1),
    electedStatus,
    party: index % 2 === 0 ? "R" : "D",
    title: chamber === "H" ? "Representative" : "Senator",
    phone: null,
    email: `member-${chamber.toLowerCase()}-${index}@example.invalid`,
    town: `Town ${index + 1}`,
    committees: [],
  };
}

function nhExtraction(
  house = 350,
  senate = 20,
  former = 1,
): MembersExtraction {
  const members: GencourtMember[] = [
    ...Array.from({ length: house }, (_, index) => nhMember("H", index)),
    ...Array.from({ length: senate }, (_, index) =>
      nhMember("S", index, index === 0 ? "NEW" : "INCUMBENT")
    ),
    ...Array.from({ length: former }, (_, index) => nhMember("H", house + index, "FORMER")),
  ];
  return {
    members,
    counts: {
      logicalInput: members.length,
      produced: members.length,
      dropped: 0,
      statedTotal: null,
      verdict: "COULD_NOT_ASSERT",
    },
    byStatus: {
      INCUMBENT: house + Math.max(0, senate - 1),
      NEW: senate > 0 ? 1 : 0,
      FORMER: former,
      UNSTATED: 0,
    },
    byChamber: { H: house + former, S: senate },
  };
}

function frozenNhExtraction(): MembersExtraction {
  const tracked = JSON.parse(readFileSync(
    new URL("../data/states/nh/hunt/nh-gencourt-members.json", import.meta.url),
    "utf8",
  )) as MembersExtraction & { readonly source: unknown };
  const { source: _trackedProvenance, ...extraction } = tracked;
  assert.equal(normalizedHash(extraction), FROZEN_NH_NORMALIZED_PAYLOAD_SHA256);
  return extraction;
}

function legacyNhIdentity(member: GencourtMember) {
  const officialComposite =
    `${member.chamber}:${member.seatNo}:${member.district}:${member.email ?? "no-email"}`;
  return {
    subjectId: `nh-general-court:${sha256(officialComposite).slice(0, 20)}`,
    jurisdiction: "US-NH",
    identifiers: {
      seatNo: member.seatNo,
      chamber: member.chamber,
      district: member.district,
      ...(member.email ? { officialEmail: member.email } : {}),
    },
    matchBasis: "OFFICIAL_ID" as const,
    ambiguous: false,
    chamber: member.chamber,
    office: member.title ?? (member.chamber === "S" ? "Senator" : "Representative"),
    term: "2025-2026",
    district: member.district,
  };
}

function legacyNhCandidate(extraction: MembersExtraction = nhExtraction()): RoutineCandidate {
  const current = extraction.members.filter(({ electedStatus }) =>
    electedStatus === "INCUMBENT" || electedStatus === "NEW"
  );
  const readModel = {
    formatVersion: 1,
    jurisdiction: "US-NH",
    term: "2025-2026",
    members: current,
  };
  const rawHash = sha256("exact frozen nh Members.txt bytes");
  const candidate = {
    id: `cv-legacy-nh-members-v2-${rawHash.slice(0, 20)}`,
    sourceId: "nh-general-court",
    recordClass: "STATE_LEGISLATOR",
    scope: "US-NH",
    retrieval: {
      succeeded: true,
      requestedUrl: "https://gc.nh.gov/downloads/Members.txt",
      finalUrl: "https://gc.nh.gov/downloads/Members.txt",
      httpStatus: 200,
      retrievedAt: RETRIEVED,
      rawHash,
    },
    normalization: {
      succeeded: true,
      parserVersion: "nh-general-court/2",
      schemaVersion: "Members.txt:2025-2026",
      normalizedHash: normalizedHash(extraction),
      inputRecords: extraction.counts.logicalInput,
      outputRecords: extraction.counts.produced,
      droppedRecords: extraction.counts.dropped,
      missingRequiredFields: [],
    },
    identities: extraction.members.map(legacyNhIdentity),
    temporal: {
      version: "2025-2026",
      expectedVersion: "2025-2026",
      sourceThrough: RETRIEVED,
      staleAtRetrieval: false,
    },
    semantics: {
      factKind: "current legislative membership as stated by electedStatus",
      violations: [],
    },
    horizon: {
      kind: "BOUNDED",
      query: "the complete Members.txt logical row set",
      returnedRecords: extraction.counts.produced,
      declaredTotal: extraction.counts.logicalInput,
      paginationComplete: true,
      claimsComplete: true,
    },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [
      {
        consumer: "lib/civic-data/state-members.ts",
        passed: current.length > 0,
        detail: `${current.length} rows marked INCUMBENT or NEW.`,
      },
      {
        consumer: "state chamber contract",
        passed: (extraction.byChamber.H ?? 0) > 0 && (extraction.byChamber.S ?? 0) > 0,
        detail: JSON.stringify(extraction.byChamber),
      },
    ],
    normalizedPayload: extraction,
    readModel,
  };
  // This is an exact durable pre-PDC `/2` row. Its historical schema predates
  // the required sourceProjectionEvidence field, so the JSONB-shaped fixture
  // intentionally crosses the current static interface only at this seam.
  return JSON.parse(JSON.stringify(candidate)) as RoutineCandidate;
}

function goodLegacyReceipt(candidate: RoutineCandidate): ValidationReceipt {
  return {
    contractVersion: 2,
    decision: "GOOD",
    candidateId: candidate.id,
    sourceId: candidate.sourceId,
    recordClass: candidate.recordClass,
    scope: candidate.scope,
    validatedAt: LEGACY_VALIDATED,
    checks: VALIDATION_CHECKS.map((check) => ({
      check,
      verdict: "PASS" as const,
      code: `LEGACY_${check}_PASS`,
      detail: `The frozen /2 validator recorded ${check} as passing.`,
    })),
    excludedFacts: [],
  };
}

type LegacyAuthority = {
  readonly predecessor: CandidateVersionRecord;
  readonly pointer: PromotedProjection;
  readonly history: readonly CandidateEvent[];
};

function legacyAuthorityFixture(
  candidate: RoutineCandidate,
  pointerKey: string,
  details: readonly [string, string, string, string],
): LegacyAuthority {
  const receipt = goodLegacyReceipt(candidate);
  const predecessor: CandidateVersionRecord = {
    candidate,
    state: "PROMOTED",
    acquisitionSucceeded: true,
    receipt,
    promotedVersion: candidate.id,
    lastKnownGoodVersion: candidate.id,
    failureCode: null,
    failureDetail: null,
  };
  const pointer: PromotedProjection = {
    key: pointerKey,
    sourceId: candidate.sourceId,
    recordClass: candidate.recordClass,
    scope: candidate.scope,
    versionId: candidate.id,
    lastKnownGoodVersionId: candidate.id,
    promotedAt: LEGACY_PROMOTED,
    payload: candidate.readModel,
    receipt,
  };
  const history: CandidateEvent[] = [
    { candidateId: candidate.id, sequence: 1, state: "FETCHED", at: RETRIEVED, detail: details[0] },
    { candidateId: candidate.id, sequence: 2, state: "NORMALIZED", at: LEGACY_VALIDATED, detail: details[1] },
    { candidateId: candidate.id, sequence: 3, state: "VALIDATED", at: LEGACY_VALIDATED, detail: details[2] },
    { candidateId: candidate.id, sequence: 4, state: "PROMOTED", at: LEGACY_PROMOTED, detail: details[3] },
  ];
  assert.equal(pointer.versionId, predecessor.candidate.id);
  assert.deepEqual(history.map(({ sequence }) => sequence), [1, 2, 3, 4]);
  return { predecessor, pointer, history };
}

function legacyNhAuthority(
  candidate: RoutineCandidate = legacyNhCandidate(),
): LegacyAuthority {
  return JSON.parse(JSON.stringify(legacyAuthorityFixture(
    candidate,
    "STATE_LEGISLATOR:US-NH",
    [
      "Legacy source bytes acquired.",
      "Legacy /2 payload normalized.",
      "Legacy GOOD receipt recorded.",
      "Legacy pointer promoted.",
    ],
  ))) as LegacyAuthority;
}

type MemoryInternals = {
  readonly candidates: Map<string, CandidateVersionRecord>;
  readonly history: Map<string, CandidateEvent[]>;
  readonly promotions: Map<string, PromotedProjection>;
};

function memoryInternals(store: MemoryRoutineDataStore): MemoryInternals {
  return store as unknown as MemoryInternals;
}

function seedLegacyNhStore<T extends MemoryRoutineDataStore>(
  store: T,
  authority = legacyNhAuthority(),
): T {
  const internals = memoryInternals(store);
  internals.candidates.set(authority.predecessor.candidate.id, structuredClone(authority.predecessor));
  internals.history.set(authority.predecessor.candidate.id, [...structuredClone(authority.history)]);
  internals.promotions.set(authority.pointer.key, structuredClone(authority.pointer));
  return store;
}

function legacyCongressAuthority(): LegacyAuthority {
  const projection = federalDirectoryFirstSeed().value;
  const acquisitions: FederalDirectoryAcquisition[] = [
    "legislators-current",
    "legislators-social-media",
    "legislators-district-offices",
    "committees-current",
    "committee-membership-current",
  ].map((name) => {
    const url = `https://raw.githubusercontent.com/unitedstates/congress-legislators/${projection.sourceSha}/${name}.yaml`;
    return { requestedUrl: url, finalUrl: url, httpStatus: 200, body: `legacy:${name}` };
  });
  const current = federalDirectoryCandidate({
    acquisitions,
    retrievedAt: RETRIEVED,
    projection,
  });
  const { normalizedPayloadHash: _missingPermanentDigest, ...normalization } = current.normalization;
  const canonicalRecords = civicRecordsFor("FEDERAL_DIRECTORY", current.readModel);
  // Reproduce the exact pre-fix concatenation: the two array-backed sections
  // retained order, while the two object-backed sections depended on object
  // insertion order and therefore changed after a Postgres JSONB round trip.
  const historicRecords = [
    ...projection.roster.officeholders.map((record) => ({
      key: `officeholder:${record.id}`,
      record,
    })),
    ...projection.roster.divisions.map((record) => ({
      key: `division:${record.officeholderId}:${record.ocdId}`,
      record,
    })),
    ...Object.entries(projection.directory.byMember).map(([key, record]) => ({
      key: `directory:${key}`,
      record,
    })),
    ...Object.entries(projection.directory.committees).map(([key, record]) => ({
      key: `committee:${key}`,
      record,
    })),
  ];
  assert.equal(historicRecords.length, canonicalRecords.length);
  const candidate = JSON.parse(JSON.stringify({
    ...current,
    normalization,
    civicRecords: historicRecords,
  })) as RoutineCandidate;
  assert.notDeepEqual(candidate.civicRecords, canonicalRecords);
  return legacyAuthorityFixture(
    candidate,
    `${candidate.recordClass}:${candidate.scope}`,
    [
      "Legacy Congress source set acquired.",
      "Legacy Congress projection normalized.",
      "Legacy Congress GOOD receipt recorded.",
      "Legacy Congress pointer promoted.",
    ],
  );
}

test("legacy Congress JSONB member ordering receives one exact canonical integrity successor", async () => {
  const authority = legacyCongressAuthority();
  const before = structuredClone(authority.predecessor);
  const store = new MemoryRoutineDataStore();
  const internals = memoryInternals(store);
  internals.candidates.set(before.candidate.id, structuredClone(before));
  internals.history.set(before.candidate.id, [...structuredClone(authority.history)]);
  internals.promotions.set(authority.pointer.key, structuredClone(authority.pointer));

  let prospectiveReattestationPredecessorIds: readonly string[] | undefined;
  const result = await executePdcV2TrustedLkgImportPlan(store, emptyPlan(), {
    beforeFirstWrite: async (predecessorIds) => {
      prospectiveReattestationPredecessorIds = [...predecessorIds];
    },
  });
  assert.deepEqual(prospectiveReattestationPredecessorIds, [before.candidate.id]);
  const disposition = result.dispositions.find(({ contractId }) =>
    contractId === "congress-bulk-roster"
  );
  assert.equal(disposition?.disposition, "REATTESTED_EXISTING_AUTHORITY");
  const pointer = await store.readPromotion("FEDERAL_DIRECTORY", "US:current-congress-directory");
  assert.ok(pointer);
  assert.notEqual(pointer.versionId, before.candidate.id);
  const successor = await store.readCandidate(pointer.versionId);
  assert.ok(successor);
  assert.equal(result.reattestedExisting, 1);
  assert.equal(successor.candidate.temporal.staleAtRetrieval, true);
  assert.equal(successor.candidate.changeSet?.outcome, "UNCHANGED");
  assert.equal(successor.candidate.bootstrapImport?.sourceAuthenticated, false);
  assert.deepEqual(
    successor.candidate.civicRecords,
    civicRecordsFor("FEDERAL_DIRECTORY", successor.candidate.readModel),
  );
  assert.equal(trustedLkgImportEvidenceIssue(successor.candidate, before), null);
  assert.deepEqual(await store.readCandidate(before.candidate.id), before);
  const read = await readFederalDirectoryProjection({ store, now: CUTOVER, bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  assert.equal(read.metadata.versionId, successor.candidate.id);
  const exactPointer = structuredClone(pointer);
  const exactSuccessor = structuredClone(successor);
  const replay = await executePdcV2TrustedLkgImportPlan(store, emptyPlan());
  assert.equal(replay.reattestedExisting, 0);
  assert.equal(replay.skippedExisting, 1);
  assert.deepEqual(
    await store.readPromotion("FEDERAL_DIRECTORY", "US:current-congress-directory"),
    exactPointer,
  );
  assert.deepEqual(await store.readCandidate(successor.candidate.id), exactSuccessor);

  const contract = requiredManualProductionContract("congress-bulk-roster");
  const build = (candidateAuthority: typeof authority) =>
    buildPdcV2TrustedLkgReattestationCandidate({
      contract,
      pointer: candidateAuthority.pointer,
      predecessor: candidateAuthority.predecessor,
      reattestedAt: CUTOVER,
      importerCodeSha: IMPORTER_SHA,
    });
  const exactOrder = structuredClone(authority);
  (exactOrder.predecessor.candidate as { civicRecords?: unknown }).civicRecords =
    civicRecordsFor("FEDERAL_DIRECTORY", exactOrder.predecessor.candidate.readModel);
  assert.doesNotThrow(() => build(exactOrder), "exact order remains the ordinary control");

  type MutableMember = { key?: string; record?: unknown };
  const refusals: readonly [string, (candidate: RoutineCandidate) => void][] = [
    ["changed member", (candidate) => {
      const members = candidate.civicRecords as MutableMember[];
      members[0] = { ...members[0]!, record: { planted: "content mismatch" } };
    }],
    ["removed member", (candidate) => {
      (candidate.civicRecords as MutableMember[]).pop();
    }],
    ["extra member", (candidate) => {
      (candidate.civicRecords as MutableMember[]).push({ key: "planted:extra", record: null });
    }],
    ["duplicate key", (candidate) => {
      const members = candidate.civicRecords as MutableMember[];
      members.push(structuredClone(members[0]!));
    }],
    ["malformed member", (candidate) => {
      const members = candidate.civicRecords as MutableMember[];
      delete members[0]!.record;
    }],
    ["present payload digest", (candidate) => {
      (candidate.normalization as { normalizedPayloadHash?: string }).normalizedPayloadHash =
        trustedLkgEvidenceSha256(candidate.normalizedPayload);
    }],
    ["incorrect payload digest", (candidate) => {
      (candidate.normalization as { normalizedPayloadHash?: string }).normalizedPayloadHash =
        "f".repeat(64);
    }],
    ["legacy hash binds payload instead of Reader", (candidate) => {
      (candidate.normalization as { normalizedHash?: string }).normalizedHash =
        trustedLkgEvidenceSha256(candidate.normalizedPayload);
    }],
    ["wrong parser", (candidate) => {
      (candidate.normalization as { parserVersion: string }).parserVersion = "congress-directory/2-near";
    }],
    ["wrong source", (candidate) => {
      (candidate as { sourceId: string }).sourceId = "registry-reviewed-bindings";
    }],
    ["wrong class", (candidate) => {
      (candidate as { recordClass: string }).recordClass = "REGISTRY_RUNTIME_BINDING";
    }],
    ["wrong scope", (candidate) => {
      (candidate as { scope: string }).scope = "US:wrong-directory";
    }],
  ];
  for (const [label, mutate] of refusals) {
    const changed = structuredClone(authority);
    mutate(changed.predecessor.candidate);
    assert.throws(
      () => build(changed),
      /TRUSTED_LKG_REATTESTATION_(?:CONTRACT_MISMATCH|INVALID):congress-bulk-roster/,
      label,
    );
  }

  const relabeled = structuredClone(successor.candidate) as RoutineCandidate & {
    bootstrapImport: NonNullable<RoutineCandidate["bootstrapImport"]>;
  };
  assert.equal(relabeled.bootstrapImport.kind, "TRUSTED_LKG_REATTESTATION");
  (relabeled.bootstrapImport as { contractId: string }).contractId = "registry-runtime-bindings";
  (relabeled as { id: string }).id = trustedLkgCandidateId(relabeled.bootstrapImport);
  assert.match(
    trustedLkgImportEvidenceIssue(relabeled, before) ?? "",
    /predecessor carries civic members which conflict with its exact Reader projection/,
    "the order-only bridge cannot be relabeled onto another contract",
  );

  const freshProjection = federalDirectoryFirstSeed().value;
  const freshAcquisitions: FederalDirectoryAcquisition[] = [
    "legislators-current",
    "legislators-social-media",
    "legislators-district-offices",
    "committees-current",
    "committee-membership-current",
  ].map((name) => {
    const url = `https://raw.githubusercontent.com/unitedstates/congress-legislators/${freshProjection.sourceSha}/${name}.yaml`;
    return { requestedUrl: url, finalUrl: url, httpStatus: 200, body: `fresh:${name}` };
  });
  const fresh = federalDirectoryCandidate({
    acquisitions: freshAcquisitions,
    retrievedAt: LIVE_RETRIEVED,
    projection: freshProjection,
  });
  const freshOutcome = await processRegisteredManualCandidate(
    store,
    "congress-bulk-roster",
    fresh,
    LIVE_RETRIEVED,
  );
  assert.equal(freshOutcome.candidate.state, "PROMOTED");
  assert.equal(freshOutcome.readerReadback?.status, "PASS");
  assert.equal(
    (await store.readPromotion("FEDERAL_DIRECTORY", "US:current-congress-directory"))?.versionId,
    fresh.id,
    "a later source-authenticated candidate replaces the integrity bridge normally",
  );
});

function liveNhCandidate(extraction: MembersExtraction = nhExtraction()): RoutineCandidate {
  const current = extraction.members.filter(({ electedStatus }) =>
    electedStatus === "INCUMBENT" || electedStatus === "NEW"
  );
  return nhMembersCandidate({
    rawText: "fresh Members.txt source bytes",
    rawIdentityText: "fresh legislators.txt and RollCallHistory.txt source bytes",
    finalUrl: "https://gc.nh.gov/downloads/Members.txt",
    identityFinalUrl: "https://gc.nh.gov/dynamicdatadump/legislators.txt",
    httpStatus: 200,
    identityHttpStatus: 200,
    retrievedAt: LIVE_RETRIEVED,
    extraction,
    identityCrosswalk: {
      matches: current.map((member, index) => ({
        member,
        officialPersonId: String(10_000 + index),
        officeholderId: `nh-general-court:${10_000 + index}`,
        matchBasis: "EXACT_OFFICIAL_EMAIL" as const,
      })),
      sourceVersion: "2025-2026",
      observedIdentityRows: current.length,
      ordinaryMatches: current.length,
      reviewedExceptionMatches: 0,
    },
  });
}

function healthyNhRollCandidate(
  tag: string,
  rosterVersionId: string,
  officeholderIds: readonly string[],
  retrievedAt: string,
): RoutineCandidate {
  const officeholderId = officeholderIds[0];
  assert.ok(officeholderId);
  const officialPersonId = officeholderId.slice("nh-general-court:".length);
  const rollCallId = `nh-general-court:roll-${tag}`;
  const sourceUrl = "https://gc.nh.gov/nhgcrollcalls/";
  return officialStateRollCallsCandidate({
    sourceId: "nh-general-court",
    jurisdiction: "US-NH",
    rawBodies: [`New Hampshire General Court official roll bytes ${tag}`],
    requestedUrl: sourceUrl,
    finalUrl: sourceUrl,
    httpStatus: 200,
    retrievedAt,
    term: "2026",
    expectedTerm: "2026",
    session: "regular",
    declaredRollTotal: 1,
    identityAuthority: {
      contractId: "nh-members",
      versionId: rosterVersionId,
      currentOfficeholderIds: officeholderIds,
      sessionParticipantIds: officeholderIds,
      sessionParticipantSourceVersion: `official-participants-${tag}`,
    },
    rolls: [{
      id: rollCallId,
      sourceId: "nh-general-court",
      officialRollCallId: `official-roll-${tag}`,
      eventId: `official-event-${tag}`,
      chamber: "House",
      term: "2026",
      session: "regular",
      actionStage: "Third Reading",
      expectedActionStage: "Third Reading",
      state: "NH",
      sessionId: 0,
      billNumber: "HB 1",
      billTitle: "Import-only identity authority control",
      motion: "Third Reading",
      date: retrievedAt.slice(0, 10),
      yea: 1,
      nay: 0,
      absent: 0,
      nv: 0,
      result: "Passed 1-0",
      billUrl: sourceUrl,
      rollCallUrl: sourceUrl,
      retrievedAt,
    }],
    positions: [{
      officeholderId,
      officialPersonId,
      rollCallId,
      position: "YES",
      publisherPosition: "Yes",
    }],
  });
}

test("the exact frozen NH /2 LKG receives one stale import-only /3 successor and fresh /3 authority supersedes it", async () => {
  const extraction = frozenNhExtraction();
  const authority = legacyNhAuthority(legacyNhCandidate(extraction));
  const store = seedLegacyNhStore(new MemoryRoutineDataStore(), authority);
  assert.equal(
    promotionProofIssue(
      "STATE_LEGISLATOR",
      "US-NH",
      authority.pointer,
      authority.predecessor,
    ),
    "the candidate Reader projection does not match its durable normalized hash",
    "the bridge is entered only for the observed legacy Reader-hash defect",
  );
  const immutablePredecessor = structuredClone(authority.predecessor);

  const result = await executePdcV2TrustedLkgImportPlan(store, emptyPlan());
  const disposition = result.dispositions.find(({ contractId }) => contractId === "nh-members");
  assert.equal(result.promoted, 1);
  assert.equal(result.reattestedExisting, 1);
  assert.equal(disposition?.disposition, "REATTESTED_EXISTING_AUTHORITY");
  assert.equal(disposition?.readerReadback, "PASS");

  const bridgePointer = await store.readPromotion("STATE_LEGISLATOR", "US-NH");
  assert.ok(bridgePointer);
  assert.notEqual(bridgePointer.versionId, authority.pointer.versionId);
  const bridge = await store.readCandidate(bridgePointer.versionId);
  assert.ok(bridge);
  const evidence = bridge.candidate.bootstrapImport;
  assert.equal(evidence?.kind, "TRUSTED_LKG_REATTESTATION");
  if (evidence?.kind !== "TRUSTED_LKG_REATTESTATION") assert.fail("NH bridge evidence missing");
  assert.equal(evidence.contractUpgrade, NH_MEMBERS_V2_TO_V3_REATTESTATION);
  assert.equal(evidence.sourceAuthenticated, false);
  assert.equal(evidence.predecessorVersionId, authority.predecessor.candidate.id);
  assert.equal(bridge.candidate.normalization.parserVersion, "nh-general-court/3");
  assert.equal(bridge.candidate.normalization.normalizedHash, normalizedHash(bridge.candidate.readModel));
  assert.equal(
    bridge.candidate.normalization.normalizedPayloadHash,
    normalizedHash(bridge.candidate.normalizedPayload),
  );
  assert.deepEqual(bridge.candidate.normalizedPayload, authority.predecessor.candidate.normalizedPayload);
  assert.equal(bridge.candidate.temporal.staleAtRetrieval, true);
  assert.equal(bridge.candidate.changeSet?.outcome, "UNCHANGED");
  assert.deepEqual(
    await store.readCandidate(authority.predecessor.candidate.id),
    immutablePredecessor,
    "the historical /2 row remains byte-immutable",
  );

  const bridgeModel = bridge.candidate.readModel as {
    readonly members: readonly GencourtMember[];
    readonly identities: readonly {
      readonly officeholderId: string;
      readonly officialPersonId: string;
      readonly chamber: string;
      readonly seatNo: string;
      readonly district: string;
    }[];
    readonly officialIdentityAuthority?: unknown;
  };
  assert.equal(bridgeModel.members.length, 388);
  assert.equal(bridgeModel.identities.length, bridgeModel.members.length);
  assert.equal("officialIdentityAuthority" in bridgeModel, false);
  assert.equal(new Set(bridgeModel.identities.map(({ officeholderId }) => officeholderId)).size, 388);
  assert.equal(new Set(bridgeModel.identities.map(({ officialPersonId }) => officialPersonId)).size, 388);
  for (const [index, member] of bridgeModel.members.entries()) {
    const identity = bridgeModel.identities[index];
    assert.ok(identity);
    assert.deepEqual(
      { chamber: identity.chamber, seatNo: identity.seatNo, district: identity.district },
      { chamber: member.chamber, seatNo: member.seatNo, district: member.district },
    );
  }
  assert.equal(
    new Set(bridge.candidate.identities.map(({ subjectId }) => subjectId)).size,
    bridge.candidate.identities.length,
  );
  const rollCandidateCiting = (
    versionId: string,
    officeholderIds: readonly string[],
  ) => ({
    recordClass: "STATE_ROLL_CALL",
    scope: "US-NH",
    normalization: { outputRecords: 1 },
    horizon: { returnedRecords: 1, claimsComplete: false },
    readModel: {
      officialIdentityAuthority: {
        contractId: "nh-members",
        sourceId: "nh-general-court",
        scope: "US-NH",
        versionId,
        currentOfficeholderIdsSha256: normalizedHash([...officeholderIds].sort()),
      },
    },
  }) as unknown as RoutineCandidate;
  assert.equal(
    await officialStateRollIdentityAuthorityIssue(
      store,
      rollCandidateCiting(
        bridge.candidate.id,
        bridgeModel.identities.map(({ officeholderId }) => officeholderId),
      ),
    ),
    "The canonical NH roster is an import-only identity projection, not a source-authenticated official PersonID authority.",
    "synthetic bridge identities cannot be laundered into official roll-call PersonID authority",
  );

  const typedBridge = await readNhMembers({ store, now: CUTOVER, bypassCache: true });
  assert.equal(typedBridge.kind, "PROMOTED");
  if (typedBridge.kind !== "PROMOTED") assert.fail("the /3 bridge did not pass the typed NH Reader");
  assert.equal(typedBridge.metadata.versionId, bridge.candidate.id);
  const contract = requiredRoutineContract("nh-members");
  const clock = await store.clock(contract.sourceId, contract.recordClass, contract.scope);
  assert.deepEqual(clock, {});
  assert.equal(routineTaskDue(routineTaskFromContract(contract), clock, Date.parse(CUTOVER)), true);

  const replay = await executePdcV2TrustedLkgImportPlan(store, emptyPlan());
  assert.equal(replay.promoted, 0);
  assert.equal(replay.reattestedExisting, 0);
  assert.equal(replay.skippedExisting, 1);
  assert.equal(
    (await store.readPromotion("STATE_LEGISLATOR", "US-NH"))?.versionId,
    bridge.candidate.id,
    "replay must not create a second bridge successor",
  );

  const fresh = liveNhCandidate(extraction);
  const promoted = await processRegisteredRoutineCandidate(
    store,
    "nh-members",
    fresh,
    LIVE_RETRIEVED,
  );
  assert.equal(promoted.candidate.state, "PROMOTED");
  assert.equal(promoted.promoted?.versionId, fresh.id);
  assert.equal(promoted.readerReadback?.status, "PASS");
  assert.equal(promoted.candidate.candidate.bootstrapImport, undefined);
  const liveModel = promoted.candidate.candidate.readModel as {
    readonly identities: readonly { readonly officeholderId: string }[];
    readonly officialIdentityAuthority?: { readonly sourceVersion: string };
  };
  assert.equal(liveModel.officialIdentityAuthority?.sourceVersion, "2025-2026");
  assert.equal(
    (await store.readPromotion("STATE_LEGISLATOR", "US-NH"))?.versionId,
    fresh.id,
    "fresh publisher-authenticated /3 authority supersedes the stale bridge",
  );
  assert.equal(
    await officialStateRollIdentityAuthorityIssue(
      store,
      rollCandidateCiting(
        fresh.id,
        liveModel.identities.map(({ officeholderId }) => officeholderId),
      ),
    ),
    null,
    "fresh /3 publisher PersonIDs remain usable by the exact roll-call cross-pointer contract",
  );
});

test("the import-only NH bridge end-to-end refuses a healthy roll candidate without moving its LKG or a sibling source", async () => {
  const extraction = frozenNhExtraction();

  // First prove the same roll candidate shape is healthy under a genuine `/3`
  // roster and retain that exact promoted roll as the pre-existing LKG.
  const authorityStore = new MemoryRoutineDataStore();
  const liveRoster = liveNhCandidate(extraction);
  const liveRosterOutcome = await processRegisteredRoutineCandidate(
    authorityStore,
    "nh-members",
    liveRoster,
    LIVE_RETRIEVED,
  );
  assert.equal(liveRosterOutcome.candidate.state, "PROMOTED");
  const liveModel = liveRoster.readModel as {
    readonly identities: readonly { readonly officeholderId: string }[];
  };
  const liveOfficeholderIds = liveModel.identities.map(({ officeholderId }) => officeholderId);
  const priorRoll = healthyNhRollCandidate(
    "preexisting-lkg",
    liveRoster.id,
    liveOfficeholderIds,
    "2026-09-10T12:01:00.000Z",
  );
  const priorRollOutcome = await processRegisteredRoutineCandidate(
    authorityStore,
    "nh-state-rollcalls",
    priorRoll,
    priorRoll.retrieval.retrievedAt,
  );
  assert.equal(priorRollOutcome.candidate.state, "PROMOTED");
  const authorityInternals = memoryInternals(authorityStore);
  const priorRollRow = authorityInternals.candidates.get(priorRoll.id);
  const priorRollHistory = authorityInternals.history.get(priorRoll.id);
  const priorRollPointer = authorityInternals.promotions.get("STATE_ROLL_CALL:US-NH");
  assert.ok(priorRollRow);
  assert.ok(priorRollHistory);
  assert.ok(priorRollPointer);

  const legacyAuthority = legacyNhAuthority(legacyNhCandidate(extraction));
  const store = seedLegacyNhStore(new MemoryRoutineDataStore(), legacyAuthority);
  await executePdcV2TrustedLkgImportPlan(store, emptyPlan());
  const bridgePointer = await store.readPromotion("STATE_LEGISLATOR", "US-NH");
  assert.ok(bridgePointer);
  const bridge = await store.readCandidate(bridgePointer.versionId);
  assert.ok(bridge);
  const bridgeModel = bridge.candidate.readModel as {
    readonly identities: readonly { readonly officeholderId: string }[];
  };

  // Recreate only the already-promoted roll authority in the cutover store;
  // the test then exercises the real registered promotion door for the new
  // otherwise-healthy acquisition.
  const internals = memoryInternals(store);
  internals.candidates.set(priorRoll.id, structuredClone(priorRollRow));
  internals.history.set(priorRoll.id, structuredClone(priorRollHistory));
  internals.promotions.set(priorRollPointer.key, structuredClone(priorRollPointer));
  const exactPriorRollRow = structuredClone(priorRollRow);
  const exactPriorRollPointer = structuredClone(priorRollPointer);

  const sibling = sourceCandidate();
  const siblingOutcome = await processRegisteredRoutineCandidate(
    store,
    "fec-funding",
    sibling,
    sibling.retrieval.retrievedAt,
  );
  assert.equal(siblingOutcome.candidate.state, "PROMOTED");
  const siblingPointer = await store.readPromotion("FEC_FUNDING", "federal-supported");
  const siblingRow = await store.readCandidate(sibling.id);
  assert.ok(siblingPointer);
  assert.ok(siblingRow);

  const proposed = healthyNhRollCandidate(
    "bridge-refusal",
    bridge.candidate.id,
    bridgeModel.identities.map(({ officeholderId }) => officeholderId),
    "2026-09-10T12:02:00.000Z",
  );
  const refused = await processRegisteredRoutineCandidate(
    store,
    "nh-state-rollcalls",
    proposed,
    proposed.retrieval.retrievedAt,
  );
  assert.equal(refused.candidate.state, "DEPENDENT_CONSUMER_INVALID");
  assert.equal(refused.candidate.failureCode, "DEPENDENT_CONSUMER_REJECTED");
  assert.match(refused.candidate.failureDetail ?? "", /import-only identity projection/);
  assert.equal(refused.promoted, null);
  assert.equal(refused.candidate.lastKnownGoodVersion, priorRoll.id);
  assert.deepEqual(
    await store.readPromotion("STATE_ROLL_CALL", "US-NH"),
    exactPriorRollPointer,
    "the existing NH roll pointer/LKG remains byte-identical",
  );
  assert.deepEqual(
    await store.readCandidate(priorRoll.id),
    exactPriorRollRow,
    "the existing NH roll candidate row remains byte-identical",
  );
  assert.deepEqual(
    await store.readPromotion("FEC_FUNDING", "federal-supported"),
    siblingPointer,
    "the bridge-specific refusal cannot move an unrelated source pointer",
  );
  assert.deepEqual(
    await store.readCandidate(sibling.id),
    siblingRow,
    "the bridge-specific refusal cannot rewrite an unrelated source row",
  );
});

test("the NH bridge refuses every near-miss legacy shape and cannot be relabeled onto another contract", () => {
  const contract = requiredRoutineContract("nh-members");
  const build = (authority: ReturnType<typeof legacyNhAuthority>) =>
    buildPdcV2TrustedLkgReattestationCandidate({
      contract,
      pointer: authority.pointer,
      predecessor: authority.predecessor,
      reattestedAt: CUTOVER,
      importerCodeSha: IMPORTER_SHA,
    });
  const mutateCandidate = (
    mutation: (candidate: Record<string, unknown>) => void,
  ): ReturnType<typeof legacyNhAuthority> => {
    const candidate = structuredClone(legacyNhCandidate()) as unknown as Record<string, unknown>;
    mutation(candidate);
    return legacyNhAuthority(candidate as unknown as RoutineCandidate);
  };
  const refusals: readonly [string, ReturnType<typeof legacyNhAuthority>][] = [
    ["extra normalization key", mutateCandidate((candidate) => {
      (candidate.normalization as Record<string, unknown>).unexpectedDigest = "f".repeat(64);
    })],
    ["extra Reader-model key", mutateCandidate((candidate) => {
      (candidate.readModel as Record<string, unknown>).unexpectedAuthority = true;
    })],
    ["wrong legacy parser", mutateCandidate((candidate) => {
      (candidate.normalization as Record<string, unknown>).parserVersion = "nh-general-court/2-near";
    })],
    ["present payload digest", mutateCandidate((candidate) => {
      (candidate.normalization as Record<string, unknown>).normalizedPayloadHash = "f".repeat(64);
    })],
    ["payload mutation without rederived digest", mutateCandidate((candidate) => {
      const payload = candidate.normalizedPayload as { members: Array<Record<string, unknown>> };
      payload.members[0]!.givenName = "Tampered";
    })],
    ["Reader projection mutation", mutateCandidate((candidate) => {
      const model = candidate.readModel as { members: Array<Record<string, unknown>> };
      model.members[0]!.givenName = "Tampered";
    })],
    ["legacy identity mutation", mutateCandidate((candidate) => {
      const identities = candidate.identities as Array<Record<string, unknown>>;
      identities[0]!.subjectId = "nh-general-court:tampered";
    })],
    ["current chamber below permanent floor", legacyNhAuthority(legacyNhCandidate(nhExtraction(349, 20)))],
    ["duplicate current seat composite", (() => {
      const extraction = structuredClone(nhExtraction());
      const members = extraction.members as GencourtMember[];
      members[1] = {
        ...members[1]!,
        seatNo: members[0]!.seatNo,
        district: members[0]!.district,
      };
      return legacyNhAuthority(legacyNhCandidate(extraction));
    })()],
  ];
  for (const [label, authority] of refusals) {
    assert.throws(
      () => build(authority),
      /TRUSTED_LKG_REATTESTATION_(?:CONTRACT_MISMATCH|INVALID):nh-members/,
      label,
    );
  }

  const exact = legacyNhAuthority();
  assert.throws(
    () => build({
      ...exact,
      pointer: { ...exact.pointer, payload: { members: [] } },
    }),
    /TRUSTED_LKG_REATTESTATION_INVALID:nh-members/,
    "pointer payload tamper",
  );
  assert.throws(() => buildPdcV2TrustedLkgReattestationCandidate({
    contract: requiredRoutineContract("dotgov"),
    pointer: exact.pointer,
    predecessor: exact.predecessor,
    reattestedAt: CUTOVER,
    importerCodeSha: IMPORTER_SHA,
  }), /TRUSTED_LKG_REATTESTATION_CONTRACT_MISMATCH:dotgov/);

  const successor = build(exact);
  assert.equal(trustedLkgImportEvidenceIssue(successor, exact.predecessor), null);
  const withoutMarker = structuredClone(successor) as RoutineCandidate & {
    bootstrapImport: NonNullable<RoutineCandidate["bootstrapImport"]>;
  };
  if (withoutMarker.bootstrapImport.kind !== "TRUSTED_LKG_REATTESTATION") {
    assert.fail("expected re-attestation evidence");
  }
  delete (withoutMarker.bootstrapImport as { contractUpgrade?: string }).contractUpgrade;
  (withoutMarker as { id: string }).id = trustedLkgCandidateId(withoutMarker.bootstrapImport);
  assert.match(
    trustedLkgImportEvidenceIssue(withoutMarker, exact.predecessor) ?? "",
    /do not share one exact registered source contract/,
  );
  const unknownMarker = structuredClone(successor) as RoutineCandidate & {
    bootstrapImport: NonNullable<RoutineCandidate["bootstrapImport"]>;
  };
  (unknownMarker.bootstrapImport as { contractUpgrade?: string }).contractUpgrade = "NH_MEMBERS_V2_TO_V4";
  assert.match(
    trustedLkgImportEvidenceIssue(unknownMarker, exact.predecessor) ?? "",
    /unsupported contract upgrade/,
  );
  const crossContractMarker = structuredClone(successor) as RoutineCandidate & {
    bootstrapImport: NonNullable<RoutineCandidate["bootstrapImport"]>;
  };
  (crossContractMarker.bootstrapImport as { contractId: string }).contractId = "dotgov";
  assert.match(
    trustedLkgImportEvidenceIssue(crossContractMarker, exact.predecessor) ?? "",
    /attached to another contract/,
  );
});

test("legacy durable LKG receives an exact no-data-change integrity successor and is immediately due", async () => {
  const { store, predecessor, pointer } = await seededLegacyStore(new MemoryRoutineDataStore());
  const before = structuredClone(predecessor);
  const result = await executePdcV2TrustedLkgImportPlan(store, emptyPlan());
  assert.equal(result.promoted, 1);
  assert.equal(result.reattestedExisting, 1);
  assert.equal(result.skippedExisting, 0);
  assert.equal(result.dispositions[0]?.contractId, "fec-funding");
  assert.equal(result.dispositions[0]?.disposition, "REATTESTED_EXISTING_AUTHORITY");

  const currentPointer = await store.readPromotion("FEC_FUNDING", "federal-supported");
  assert.ok(currentPointer);
  assert.notEqual(currentPointer.versionId, pointer.versionId);
  const successor = await store.readCandidate(currentPointer.versionId);
  assert.ok(successor);
  assert.equal(successor.candidate.bootstrapImport?.kind, "TRUSTED_LKG_REATTESTATION");
  assert.equal(successor.candidate.retrieval.retrievedAt, RETRIEVED, "no new publisher retrieval is claimed");
  assert.equal(successor.candidate.temporal.sourceThrough, predecessor.candidate.temporal.sourceThrough);
  assert.equal(successor.candidate.temporal.staleAtRetrieval, true);
  assert.deepEqual(successor.candidate.readModel, predecessor.candidate.readModel);
  assert.deepEqual(successor.candidate.normalizedPayload, predecessor.candidate.normalizedPayload);
  assert.equal(successor.candidate.changeSet?.outcome, "UNCHANGED");
  assert.deepEqual(await store.readCandidate(predecessor.candidate.id), before, "the predecessor row remains immutable");

  const read = await readPromotedCivicData("FEC_FUNDING", "federal-supported", {
    store,
    now: CUTOVER,
    bypassCache: true,
  });
  assert.equal(read.kind, "PROMOTED");
  assert.equal(read.metadata.versionId, successor.candidate.id);
  const contract = requiredRoutineContract("fec-funding");
  const observableCandidate = (row: CandidateVersionRecord): RoutineCandidateRow => ({
    id: row.candidate.id,
    sourceId: row.candidate.sourceId,
    recordClass: row.candidate.recordClass,
    scope: row.candidate.scope,
    state: row.state,
    acquisitionSucceeded: row.acquisitionSucceeded,
    retrievedAt: row.candidate.retrieval.retrievedAt,
    sourceThrough: row.candidate.temporal.sourceThrough,
    candidate: row.candidate,
    validationReceipt: row.receipt,
    promotedVersionId: row.promotedVersion,
    lastKnownGoodVersionId: row.lastKnownGoodVersion,
    failureCode: row.failureCode,
    failureDetail: row.failureDetail,
  });
  const promotionRow: RoutinePromotionRow = {
    key: currentPointer.key,
    sourceId: currentPointer.sourceId,
    recordClass: currentPointer.recordClass,
    scope: currentPointer.scope,
    currentVersionId: currentPointer.versionId,
    lastKnownGoodVersionId: currentPointer.lastKnownGoodVersionId,
    promotedAt: currentPointer.promotedAt,
    payload: currentPointer.payload,
    validationReceipt: currentPointer.receipt,
  };
  const successorEvents = (await store.events(successor.candidate.id)).map((event) => ({
    id: `event:${event.candidateId}:${event.sequence}`,
    ...event,
  }));
  const predecessorEvents = (await store.events(before.candidate.id)).map((event) => ({
    id: `event:${event.candidateId}:${event.sequence}`,
    ...event,
  }));
  const admin = projectRoutineDataObservability({
    candidates: [observableCandidate(before), observableCandidate(successor)],
    events: [...predecessorEvents, ...successorEvents],
    promotions: [promotionRow],
  }, CUTOVER, [contract]);
  assert.equal(admin.contracts[0]?.canonicalPromotion.kind, "MEASURED");
  if (admin.contracts[0]?.canonicalPromotion.kind !== "MEASURED") {
    assert.fail("Admin canonical proof missing");
  }
  assert.equal(admin.contracts[0].canonicalPromotion.value.authorityOrigin, "TRUSTED_LKG_IMPORT");
  for (const window of ["24h", "7d", "30d"] as const) {
    const history = admin.contracts[0].histories[window];
    assert.ok(
      history.counts.promotions.members.some((event) => event.candidateId === successor.candidate.id),
      `${window} includes the exact re-attestation promotion event`,
    );
    assert.ok(
      history.counts.unchangedOutcomes.members.some((outcome) =>
        outcome.candidateId === successor.candidate.id && outcome.outcome === "UNCHANGED"),
      `${window} proves the exact no-data-change re-attestation outcome`,
    );
  }
  const clock = await store.clock(contract.sourceId, contract.recordClass, contract.scope);
  assert.deepEqual(clock, {}, "neither transfer nor predecessor timestamp postpones the next source read");
  assert.equal(routineTaskDue(routineTaskFromContract(contract), clock, Date.parse(CUTOVER)), true);

  const replay = await executePdcV2TrustedLkgImportPlan(store, emptyPlan());
  assert.equal(replay.promoted, 0);
  assert.equal(replay.reattestedExisting, 0);
  assert.equal(replay.skippedExisting, 1);
  assert.equal((await store.readPromotion("FEC_FUNDING", "federal-supported"))?.versionId, successor.candidate.id);
});

test("a date-only legacy GOOD receipt is re-attested instead of being misclassified as 0026-ready", async () => {
  const store = new MemoryRoutineDataStore();
  const { predecessor, pointer } = await seededLegacyStore(store);
  const internals = store as unknown as {
    readonly candidates: Map<string, CandidateVersionRecord>;
    readonly history: Map<string, CandidateEvent[]>;
    readonly promotions: Map<string, PromotedProjection>;
  };
  const legacyReceipt: ValidationReceipt = {
    ...predecessor.receipt!,
    // Date.parse accepts this legacy shape, but the permanent contract does
    // not: its exact terminal event clock cannot be recovered from a date.
    validatedAt: "2026-09-08",
  };
  internals.candidates.set(predecessor.candidate.id, {
    ...predecessor,
    receipt: legacyReceipt,
  });
  internals.promotions.set(pointer.key, {
    ...pointer,
    promotedAt: "2026-09-08T00:02:00.000Z",
    receipt: legacyReceipt,
  });
  internals.history.set(predecessor.candidate.id, (internals.history.get(predecessor.candidate.id) ?? [])
    .map((event) => event.state === "VALIDATED"
      ? { ...event, at: "2026-09-08T00:01:00.000Z" }
      : event.state === "PROMOTED"
        ? { ...event, at: "2026-09-08T00:02:00.000Z" }
        : event));

  const result = await executePdcV2TrustedLkgImportPlan(store, emptyPlan());
  assert.equal(result.dispositions[0]?.disposition, "REATTESTED_EXISTING_AUTHORITY");
  const successorPointer = await store.readPromotion("FEC_FUNDING", "federal-supported");
  assert.ok(successorPointer);
  assert.notEqual(successorPointer.versionId, predecessor.candidate.id);
  const successor = await store.readCandidate(successorPointer.versionId);
  assert.ok(successor?.receipt);
  assert.equal(new Date(Date.parse(successor.receipt.validatedAt)).toISOString(), successor.receipt.validatedAt);
  assert.ok((await store.events(successorPointer.versionId)).some((event) =>
    event.state === "VALIDATED" && Date.parse(event.at) === Date.parse(successor.receipt!.validatedAt)
  ));
  assert.equal(
    (await store.readCandidate(predecessor.candidate.id))?.receipt?.validatedAt,
    "2026-09-08",
    "the malformed legacy row remains immutable historical evidence",
  );
});

test("re-attestation refuses pointer tamper, legacy-digest tamper, and cross-contract laundering", async () => {
  const { predecessor, pointer } = await seededLegacyStore(new MemoryRoutineDataStore());
  assert.throws(() => buildPdcV2TrustedLkgReattestationCandidate({
    contract: requiredRoutineContract("fec-funding"),
    pointer: { ...pointer, payload: { candidates: [] } },
    predecessor,
    reattestedAt: CUTOVER,
    importerCodeSha: IMPORTER_SHA,
  }), /predecessor row, candidate, receipt, payload, or legacy digest/);

  assert.throws(() => buildPdcV2TrustedLkgReattestationCandidate({
    contract: requiredRoutineContract("fec-funding"),
    pointer,
    predecessor: {
      ...predecessor,
      candidate: {
        ...predecessor.candidate,
        normalization: { ...predecessor.candidate.normalization, normalizedHash: "f".repeat(64) },
      },
    },
    reattestedAt: CUTOVER,
    importerCodeSha: IMPORTER_SHA,
  }), /legacy normalized hash binds neither/);

  assert.throws(() => buildPdcV2TrustedLkgReattestationCandidate({
    contract: requiredRoutineContract("dotgov"),
    pointer,
    predecessor,
    reattestedAt: CUTOVER,
    importerCodeSha: IMPORTER_SHA,
  }), /REATTESTATION_CONTRACT_MISMATCH:dotgov/);
});

class ReattestationRaceStore extends MemoryRoutineDataStore {
  override async promote(candidateId: string, receipt: ValidationReceipt, at: string) {
    const row = await this.readCandidate(candidateId);
    if (row?.candidate.bootstrapImport?.kind === "TRUSTED_LKG_REATTESTATION") {
      throw new PromotionBaseChangedError(
        candidateId,
        row.candidate.bootstrapImport.predecessorVersionId,
        "concurrent-newer-authority",
      );
    }
    return super.promote(candidateId, receipt, at);
  }
}

class InterruptedReattestationReadbackStore extends MemoryRoutineDataStore {
  interrupted = false;

  override async appendEvidence(
    ...args: Parameters<MemoryRoutineDataStore["appendEvidence"]>
  ): Promise<Awaited<ReturnType<MemoryRoutineDataStore["appendEvidence"]>>> {
    const [candidateId, , , detail] = args;
    const row = await this.readCandidate(candidateId);
    if (
      !this.interrupted &&
      row?.candidate.bootstrapImport?.kind === "TRUSTED_LKG_REATTESTATION" &&
      detail.startsWith(READER_PROJECTION_READBACK_PREFIX)
    ) {
      this.interrupted = true;
      throw new Error("SIMULATED_REATTESTATION_READBACK_INTERRUPTION");
    }
    return super.appendEvidence(...args);
  }
}

class DuplicatePredecessorBatchStore extends MemoryRoutineDataStore {
  duplicateCandidateId: string | null = null;

  override async readCandidates(
    ...args: Parameters<MemoryRoutineDataStore["readCandidates"]>
  ): Promise<Awaited<ReturnType<MemoryRoutineDataStore["readCandidates"]>>> {
    const rows = await super.readCandidates(...args);
    const duplicate = this.duplicateCandidateId === null
      ? undefined
      : rows.find(({ candidateId }) => candidateId === this.duplicateCandidateId);
    return duplicate ? [...rows, structuredClone(duplicate)] : rows;
  }
}

test("ordinary source authority fails closed when a re-attestation predecessor is missing or changed", async () => {
  for (const condition of ["missing", "changed"] as const) {
    const authority = legacyNhAuthority();
    const store = seedLegacyNhStore(new MemoryRoutineDataStore(), authority);
    await executePdcV2TrustedLkgImportPlan(store, emptyPlan());
    const bridgePointer = await store.readPromotion("STATE_LEGISLATOR", "US-NH");
    assert.ok(bridgePointer);
    assert.notEqual(bridgePointer.versionId, authority.predecessor.candidate.id);

    const internals = memoryInternals(store);
    if (condition === "missing") {
      internals.candidates.delete(authority.predecessor.candidate.id);
    } else {
      internals.candidates.set(authority.predecessor.candidate.id, {
        ...authority.predecessor,
        candidate: {
          ...authority.predecessor.candidate,
          semantics: {
            ...authority.predecessor.candidate.semantics,
            factKind: `${authority.predecessor.candidate.semantics.factKind} (changed)`,
          },
        },
      });
    }

    const fresh = liveNhCandidate();
    const held = await processRegisteredRoutineCandidate(
      store,
      "nh-members",
      fresh,
      LIVE_RETRIEVED,
    );
    assert.equal(held.promoted, null, condition);
    assert.equal(held.candidate.state, "CANNOT_TELL", condition);
    assert.equal(held.candidate.failureCode, "LKG_PROMOTION_PROOF_INVALID", condition);
    assert.match(
      held.candidate.failureDetail ?? "",
      condition === "missing"
        ? /exact immutable predecessor candidate row is unavailable/
        : /NH \/2 to \/3 successor changes predecessor semantics/,
      condition,
    );
    assert.equal(
      (await store.readPromotion("STATE_LEGISLATOR", "US-NH"))?.versionId,
      bridgePointer.versionId,
      `${condition} predecessor evidence cannot be bypassed by fresh source authority`,
    );
  }
});

test("the NH bridge CAS race keeps /2 live and durably refuses the unadmitted successor", async () => {
  const authority = legacyNhAuthority();
  const store = seedLegacyNhStore(new ReattestationRaceStore(), authority);
  await assert.rejects(
    executePdcV2TrustedLkgImportPlan(store, emptyPlan()),
    /TRUSTED_LKG_REATTESTATION_PROMOTION_REFUSED:nh-members:PROMOTION_BASE_CHANGED/,
  );
  assert.equal(
    (await store.readPromotion("STATE_LEGISLATOR", "US-NH"))?.versionId,
    authority.predecessor.candidate.id,
  );
  const refused = [...memoryInternals(store).candidates.values()].find(({ candidate }) =>
    candidate.bootstrapImport?.kind === "TRUSTED_LKG_REATTESTATION"
  );
  assert.equal(refused?.state, "CANNOT_TELL");
  assert.equal(refused?.failureCode, "PROMOTION_BASE_CHANGED");
});

test("NH bridge replay repairs an interrupted typed Reader receipt without another successor", async () => {
  const authority = legacyNhAuthority();
  const store = seedLegacyNhStore(new InterruptedReattestationReadbackStore(), authority);
  await assert.rejects(
    executePdcV2TrustedLkgImportPlan(store, emptyPlan()),
    /SIMULATED_REATTESTATION_READBACK_INTERRUPTION/,
  );
  const bridgePointer = await store.readPromotion("STATE_LEGISLATOR", "US-NH");
  assert.ok(bridgePointer);
  assert.notEqual(bridgePointer.versionId, authority.predecessor.candidate.id);
  assert.equal(
    (await store.events(bridgePointer.versionId))
      .filter(({ detail }) => detail.startsWith(READER_PROJECTION_READBACK_PREFIX)).length,
    0,
  );

  const replay = await executePdcV2TrustedLkgImportPlan(store, emptyPlan());
  assert.equal(replay.promoted, 0);
  assert.equal(replay.reattestedExisting, 0);
  assert.equal(replay.skippedExisting, 1);
  assert.equal(
    (await store.readPromotion("STATE_LEGISLATOR", "US-NH"))?.versionId,
    bridgePointer.versionId,
  );
  assert.equal(
    (await store.events(bridgePointer.versionId))
      .filter(({ detail }) => detail.startsWith(READER_PROJECTION_READBACK_PREFIX)).length,
    1,
  );
});

test("a pointer race leaves the predecessor live and the successor durably refused", async () => {
  const { store, predecessor } = await seededLegacyStore(new ReattestationRaceStore());
  await assert.rejects(
    executePdcV2TrustedLkgImportPlan(store, emptyPlan()),
    /TRUSTED_LKG_REATTESTATION_PROMOTION_REFUSED:fec-funding:PROMOTION_BASE_CHANGED/,
  );
  assert.equal(
    (await store.readPromotion("FEC_FUNDING", "federal-supported"))?.versionId,
    predecessor.candidate.id,
  );
  const events = (await store.events(predecessor.candidate.id));
  assert.equal(events.at(-1)?.state, "PROMOTED");
});

test("replay repairs a missing typed Reader receipt after pointer promotion without rewriting authority", async () => {
  const store = new InterruptedReattestationReadbackStore();
  const { predecessor } = await seededLegacyStore(store);
  await assert.rejects(
    executePdcV2TrustedLkgImportPlan(store, emptyPlan()),
    /SIMULATED_REATTESTATION_READBACK_INTERRUPTION/,
  );
  assert.equal(store.interrupted, true);
  const promotedBeforeReplay = await store.readPromotion("FEC_FUNDING", "federal-supported");
  assert.ok(promotedBeforeReplay);
  assert.notEqual(promotedBeforeReplay.versionId, predecessor.candidate.id);
  assert.equal(
    (await store.events(promotedBeforeReplay.versionId))
      .filter(({ detail }) => detail.startsWith(READER_PROJECTION_READBACK_PREFIX)).length,
    0,
  );

  const replay = await executePdcV2TrustedLkgImportPlan(store, emptyPlan());
  assert.equal(replay.promoted, 0);
  assert.equal(replay.reattestedExisting, 0);
  assert.equal(replay.skippedExisting, 1);
  assert.equal(
    (await store.readPromotion("FEC_FUNDING", "federal-supported"))?.versionId,
    promotedBeforeReplay.versionId,
    "receipt repair must not create another authority version",
  );
  const readbacks = (await store.events(promotedBeforeReplay.versionId))
    .filter(({ detail }) => detail.startsWith(READER_PROJECTION_READBACK_PREFIX));
  assert.equal(readbacks.length, 1);
});

test("dotgov re-attestation durably records its source-scoped projection proof and replay is idempotent", async () => {
  const store = new InterruptedReattestationReadbackStore();
  const { predecessor } = await seededLegacyDotGovStore(store);
  await assert.rejects(
    executePdcV2TrustedLkgImportPlan(store, emptyPlan()),
    /SIMULATED_REATTESTATION_READBACK_INTERRUPTION/,
  );
  const promotedBeforeReplay = await store.readPromotion(
    "DOTGOV_REFERENCE",
    "US:current-full:election-domains",
  );
  assert.ok(promotedBeforeReplay);
  assert.notEqual(promotedBeforeReplay.versionId, predecessor.candidate.id);
  assert.equal(
    (await store.events(promotedBeforeReplay.versionId))
      .filter(({ detail }) => detail.startsWith(READER_PROJECTION_READBACK_PREFIX)).length,
    0,
  );

  const replay = await executePdcV2TrustedLkgImportPlan(store, emptyPlan());
  assert.equal(replay.promoted, 0);
  assert.equal(replay.reattestedExisting, 0);
  assert.equal(replay.skippedExisting, 1);
  assert.equal(replay.dispositions[0]?.contractId, "dotgov");
  assert.equal(replay.dispositions[0]?.readerReadback, "PASS");
  assert.equal(
    (await store.readPromotion("DOTGOV_REFERENCE", "US:current-full:election-domains"))?.versionId,
    promotedBeforeReplay.versionId,
    "source-scoped receipt repair must not create another authority version",
  );
  const readbacks = (await store.events(promotedBeforeReplay.versionId))
    .map(({ detail }) => parseReaderProjectionReadback(detail))
    .filter((receipt) => receipt !== null);
  assert.equal(readbacks.length, 1);
  assert.deepEqual(readbacks[0], {
    contractVersion: 2,
    kind: "READER_PROJECTION_READBACK",
    contractId: "dotgov",
    sourceId: "cisa-dotgov-registry",
    recordClass: "DOTGOV_REFERENCE",
    scope: "US:current-full:election-domains",
    projectionId: "source-scoped:dotgov",
    versionId: promotedBeforeReplay.versionId,
    pointerKey: "DOTGOV_REFERENCE:US:current-full:election-domains",
    observedAt: CUTOVER,
    evidenceKind: "TYPED_READER_READ_MODEL",
    verifierId: "lib/civic-data/candidate-integrity.ts#dotGovProjectionVerification",
    verifierCodeSha: IMPORTER_SHA,
    status: "PASS",
    detail: "The source-scoped CISA projection contains 693 structurally valid election-domain rows.",
  });

  const secondReplay = await executePdcV2TrustedLkgImportPlan(store, emptyPlan());
  assert.equal(secondReplay.skippedExisting, 1);
  assert.equal(
    (await store.events(promotedBeforeReplay.versionId))
      .filter(({ detail }) => detail.startsWith(READER_PROJECTION_READBACK_PREFIX)).length,
    1,
    "an exact-code source-scoped PASS receipt is idempotent",
  );
});

test("permanent Reader proof fails closed without the exact predecessor row", async () => {
  const { store } = await seededLegacyStore(new MemoryRoutineDataStore());
  await executePdcV2TrustedLkgImportPlan(store, emptyPlan());
  const pointer = await store.readPromotion("FEC_FUNDING", "federal-supported");
  assert.ok(pointer);
  const successor = await store.readCandidate(pointer.versionId);
  assert.ok(successor);
  const predecessorId = successor.candidate.bootstrapImport?.kind === "TRUSTED_LKG_REATTESTATION"
    ? successor.candidate.bootstrapImport.predecessorVersionId
    : assert.fail("successor lacks re-attestation evidence");
  const missingPredecessorStore = {
    readPromotion: store.readPromotion.bind(store),
    readCandidate: async (candidateId: string) => candidateId === predecessorId
      ? null
      : store.readCandidate(candidateId),
  };
  const read = await readPromotedCivicData("FEC_FUNDING", "federal-supported", {
    store: missingPredecessorStore,
    now: CUTOVER,
    bypassCache: true,
  });
  assert.equal(read.kind, "STORE_UNREACHABLE");
  if (read.kind !== "STORE_UNREACHABLE") assert.fail("expected fail-closed proof result");
  assert.equal(read.code, "PROMOTION_PROOF_INVALID");
  assert.match(read.detail, /exact immutable predecessor candidate row is unavailable/);
});

test("batch Reader proof rejects duplicate predecessor rows instead of selecting one", async () => {
  const store = new DuplicatePredecessorBatchStore();
  await seededLegacyStore(store);
  await executePdcV2TrustedLkgImportPlan(store, emptyPlan());
  const pointer = await store.readPromotion("FEC_FUNDING", "federal-supported");
  assert.ok(pointer);
  const successor = await store.readCandidate(pointer.versionId);
  assert.ok(successor);
  store.duplicateCandidateId = successor.candidate.bootstrapImport?.kind === "TRUSTED_LKG_REATTESTATION"
    ? successor.candidate.bootstrapImport.predecessorVersionId
    : assert.fail("successor lacks re-attestation evidence");

  const [read] = await readPromotedCivicDataBatch("FEC_FUNDING", ["federal-supported"], {
    store,
    now: CUTOVER,
    bypassCache: true,
  });
  assert.equal(read?.kind, "STORE_UNREACHABLE");
  if (read?.kind !== "STORE_UNREACHABLE") assert.fail("expected fail-closed proof result");
  assert.equal(read.code, "PROMOTION_PROOF_INVALID");
  assert.match(read.detail, /more than one immutable predecessor row/);
});
