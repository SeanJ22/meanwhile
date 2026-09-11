import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join, posix } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { candidateChangeSet, canonicalCivicDataJson, civicRecordsFor } from "../lib/civic-data/changes.ts";
import {
  buildPdcV2TrustedLkgImportPlan,
  executePdcV2PermanentCutoverImportPlan,
  executePdcV2TrustedLkgImportPlan,
  inspectTrustedLkgRepository,
  PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS,
  PDC_V2_TRUSTED_LKG_MANUAL_CONTRACT_IDS,
  pdcV2PermanentCutoverPlanIssue,
  trustedLkgFrozenRepositoryIssue,
  trustedLkgImporterRepositoryIssue,
  type PdcV2TrustedLkgImportPlan,
} from "../lib/civic-data/trusted-lkg-import-plan.ts";
import { meetingsCandidate } from "../lib/civic-data/candidate-builders.ts";
import {
  MEETING_PARTITION_CONTRACTS,
  requiredMeetingPartitionContract,
} from "../lib/civic-data/meeting-partitions.ts";
import {
  processRegisteredMeetingPartitionCandidate,
  processRoutineCandidate,
} from "../lib/civic-data/promotion.ts";
import {
  MemoryRoutineDataStore,
  PDC_V2_LEGACY_MEETINGS_RETIREMENT_PREFIX,
  pdcV2CanonicalMeetingFactEvidence,
  type PdcV2LegacyMeetingsRetirementInput,
  type RoutineDataStore,
} from "../lib/civic-data/store.ts";
import {
  parseReaderProjectionReadback,
  serializeReaderProjectionReadback,
} from "../lib/civic-data/reader-readback.ts";
import {
  PDC_V2_FROZEN_BASE_SHA,
  trustedLkgPredecessorRecordSha256,
  trustedLkgImportEvidenceIssue,
} from "../lib/civic-data/trusted-lkg-import.ts";
import {
  sourceProjectionEvidence,
  type CandidateEvent,
  type CandidateVersionRecord,
  type PromotedProjection,
  type RoutineCandidate,
  type TrustedLkgImportEvidence,
} from "../lib/civic-data/types.ts";
import {
  resolveVenue,
  venueResolutionRecordId,
  type VenueEntry,
} from "../lib/meetings/venue-cache.ts";
import { canonicalAgendaDocument } from "../lib/meetings/agenda-documents.ts";
import { exactVenueMatchContentKey } from "../lib/meetings/venue-record-identity.ts";
import { validateSnapshot, type MeetingsSnapshot } from "../lib/meetings/snapshot.ts";
import { officeholderIdentityMayEnterReader } from "../lib/officials/roster-authority.ts";
import type { SourceSnapshot } from "../lib/corpus/types.ts";
import { readOfficeholderStatementsProjection } from "../lib/corpus/data-plane.ts";
import { readRegistryRuntimeProjection } from "../lib/registry/runtime-read-model.ts";
import { readerPositionsFor } from "../lib/corpus/reader-positions.ts";
import {
  consumePdcV2PrewriteAdmission,
  parsePdcV2TrustedLkgImporterArguments,
  pdcV2PrewriteAdmissionReceiptIssue,
  pdcV2TrustedLkgExecutingImporterIssue,
  redactPdcV2TrustedLkgImporterError,
} from "../scripts/pdc-v2-trusted-lkg-import.mts";

const IMPORTED_AT = "2026-09-09T12:00:00.000Z";
const LATER = "2026-09-09T13:00:00.000Z";
const IMPORTER_SHA = "a".repeat(40);
const CONTRACT_MIGRATION_SQL = readFileSync(
  join(process.cwd(), "lib", "db", "migrations", "0026_lame_sunset_bain.sql"),
  "utf8",
);

function firstSeedEvidence(candidate: RoutineCandidate): TrustedLkgImportEvidence {
  const evidence = candidate.bootstrapImport;
  assert.ok(evidence);
  if (evidence.kind !== "TRUSTED_LKG_IMPORT") assert.fail("planned frozen candidate is not a first-seed import");
  return evidence;
}

/** Every Reader-serving collection in the twelve imported manual authorities. */
const AUDITED_MANUAL_READER_COLLECTION_PATHS = [
  "registry-runtime-bindings:registry.divisions",
  "registry-runtime-bindings:registry.bodies",
  "registry-runtime-bindings:bodyRosters",
  "registry-runtime-bindings:rosterReaderDispositions",
  "registry-runtime-bindings:statewideExecutives",
  "registry-runtime-bindings:officialCandidacies.rows",
  "registry-runtime-bindings:officialPhotos.photos",
  "registry-runtime-bindings:rosterPhotos",
  "congress-rollcalls:snapshot.votes",
  "congress-rollcalls:snapshot.positions",
  "congress-rollcalls:billSummaries.summaries",
  "congress-rollcalls:billSummaries.pending",
  "federal-key-votes:snapshot.entries",
  "federal-key-votes:snapshot.misses",
  "federal-key-votes:snapshot.lawMisses",
  "federal-key-votes:positions.positions",
  "candidate-profiles:cards.cards",
  "candidate-profiles:cards.hunts",
  "candidate-profiles:links.links",
  "candidate-profiles:links.hunts",
  "candidate-corpus:documents",
  "candidate-corpus:failures",
  "officeholder-statements:snapshots",
  "az-official-actions:actions",
  "az-official-actions:legislative.openRoutes",
  "comment-access:records",
  "ballot-navigation:records",
  "campaign-sites:records",
  "venue-resolutions:records",
  "everyday-routing:records",
] as const;

/** Scalar/aggregate civic facts which need an exact Admin delta member. */
const AUDITED_MANUAL_READER_SCALAR_PATHS = [
  "congress-rollcalls:snapshot.congress",
  "congress-rollcalls:snapshot.session",
  "congress-rollcalls:snapshot.window",
  "congress-rollcalls:snapshot.identifierMatch",
  "congress-rollcalls:billSummaries.note",
  "federal-key-votes:snapshot.criteria",
  "federal-key-votes:positions.note",
  "candidate-corpus:attempted",
  "az-official-actions:note",
  "az-official-actions:source",
  "az-official-actions:denominator",
  "az-official-actions:legislative",
] as const;

/** Schema, timestamps, and retired evidence are payload provenance, not current civic-record changes. */
const AUDITED_NON_CIVIC_METADATA_PATHS = [
  "registry-runtime-bindings:formatVersion",
  "registry-runtime-bindings:registry.generatedAt",
  "registry-runtime-bindings:officialCandidacies.formatVersion",
  "registry-runtime-bindings:officialCandidacies.rule",
  "congress-rollcalls:formatVersion",
  "congress-rollcalls:snapshot.generatedAt",
  "congress-rollcalls:billSummaries.curatedAt",
  "federal-key-votes:formatVersion",
  "federal-key-votes:selectionVersion",
  "federal-key-votes:snapshot.formatVersion",
  "federal-key-votes:snapshot.fetchedAt",
  "federal-key-votes:positions.formatVersion",
  "federal-key-votes:positions.fetchedAt",
  "federal-key-votes:positions.retiredMappings",
  "candidate-profiles:cards.formatVersion",
  "candidate-profiles:cards.curatedAt",
  "candidate-profiles:cards.note",
  "candidate-profiles:links.curatedAt",
  "candidate-profiles:links.note",
  "candidate-corpus:formatVersion",
  "candidate-corpus:fetchedAt",
  "comment-access/ballot-navigation/campaign-sites/venue-resolutions/everyday-routing:kind",
  "everyday-routing:formatVersion/derived-denominator",
] as const;

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    windowsHide: true,
  }).trim();
}

async function withFrozenBase(
  work: (frozenRoot: string, repositoryRoot: string) => Promise<void>,
): Promise<void> {
  const callerCwd = process.cwd();
  const repositoryRoot = git(process.cwd(), "rev-parse", "--show-toplevel");
  const temporaryRoot = mkdtempSync(join(tmpdir(), "wtp-pdc-v2-frozen-"));
  const frozenRoot = join(temporaryRoot, "fc67");
  try {
    execFileSync("git", ["clone", "--shared", "--no-checkout", "--quiet", repositoryRoot, frozenRoot], {
      windowsHide: true,
    });
    execFileSync("git", ["-C", frozenRoot, "checkout", "--detach", "--quiet", PDC_V2_FROZEN_BASE_SHA], {
      windowsHide: true,
    });
    await work(frozenRoot, repositoryRoot);
    assert.equal(
      process.cwd().toLowerCase(),
      callerCwd.toLowerCase(),
      "the frozen importer must restore its caller's working directory",
    );
  } finally {
    process.chdir(callerCwd);
    // Yield between bounded Windows retries so loader handles can close before
    // the exact test-owned detached clone is removed.
    await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 15, retryDelay: 250 });
  }
}

test("frozen module evaluation cannot change the process working directory", () => {
  const repositoryRoot = git(process.cwd(), "rev-parse", "--show-toplevel");
  const source = readFileSync(
    join(repositoryRoot, "lib", "civic-data", "trusted-lkg-import-plan.ts"),
    "utf8",
  );
  assert.doesNotMatch(source, /\bprocess\.chdir\s*\(/);
});

test("the exact frozen module closure is cwd-neutral and cleanup-safe", async () => {
  const callerCwd = process.cwd();
  await withFrozenBase(async (frozenRoot) => {
    const roots = [
      "lib/registry/body-rosters.ts",
      "lib/officials/statewide-executives.ts",
      "lib/registry/comment-access.ts",
      "lib/ballot/polling-place-links.ts",
      "lib/ballot/registration-links.ts",
      "lib/officials/campaign-sites.ts",
      "lib/meetings/venue-cache.ts",
      "lib/routing/everyday.ts",
    ] as const;
    for (const path of roots) {
      const url = pathToFileURL(join(frozenRoot, ...path.split("/")));
      url.searchParams.set("pdc-v2-cleanup-proof", path);
      await import(url.href);
      assert.equal(process.cwd().toLowerCase(), callerCwd.toLowerCase(), path);
    }
  });
  assert.equal(process.cwd().toLowerCase(), callerCwd.toLowerCase());
});

class CountingMemoryRoutineDataStore extends MemoryRoutineDataStore {
  createCalls = 0;
  preContractGateCalls = 0;
  preImportIntegrityGateCalls = 0;
  finalMigrationPreflightCalls = 0;
  readonly terminalOrder: string[] = [];
  prospectiveReattestationSets: readonly string[][] = [];
  lastRetirementInput: PdcV2LegacyMeetingsRetirementInput | null = null;
  assertRetirementProofReadOnly = false;

  override async assertPdcV2PreContractMigrationState(): Promise<void> {
    this.preContractGateCalls += 1;
    this.terminalOrder.push("PRE_CONTRACT_SCHEMA");
    await super.assertPdcV2PreContractMigrationState();
  }

  override async assertPdcV2PreImportDataIntegrity(
    ...args: Parameters<MemoryRoutineDataStore["assertPdcV2PreImportDataIntegrity"]>
  ): Promise<void> {
    this.preImportIntegrityGateCalls += 1;
    this.prospectiveReattestationSets = [
      ...this.prospectiveReattestationSets,
      [...args[1]].sort(),
    ];
    this.terminalOrder.push("PRE_IMPORT_GLOBAL_INTEGRITY");
    await super.assertPdcV2PreImportDataIntegrity(...args);
  }

  override async assertPdcV2ContractMigrationPreflight(
    ...args: Parameters<MemoryRoutineDataStore["assertPdcV2ContractMigrationPreflight"]>
  ): Promise<void> {
    this.finalMigrationPreflightCalls += 1;
    this.terminalOrder.push("POST_IMPORT_GLOBAL_INTEGRITY");
    await super.assertPdcV2ContractMigrationPreflight(...args);
  }

  override async create(...args: Parameters<MemoryRoutineDataStore["create"]>): Promise<void> {
    this.createCalls += 1;
    this.terminalOrder.push("CREATE");
    await super.create(...args);
  }

  override async retirePdcV2LegacyMeetingsAggregate(
    ...args: Parameters<MemoryRoutineDataStore["retirePdcV2LegacyMeetingsAggregate"]>
  ): Promise<Awaited<ReturnType<MemoryRoutineDataStore["retirePdcV2LegacyMeetingsAggregate"]>>> {
    this.lastRetirementInput = structuredClone(args[0]);
    this.terminalOrder.push("RETIRE_LEGACY_AGGREGATE");
    if (!this.assertRetirementProofReadOnly) {
      return super.retirePdcV2LegacyMeetingsAggregate(...args);
    }
    const internals = this as unknown as {
      candidates: Map<string, CandidateVersionRecord>;
      history: Map<string, CandidateEvent[]>;
      promotions: Map<string, PromotedProjection>;
    };
    const mapSnapshot = <T>(map: ReadonlyMap<string, T>): string => canonicalCivicDataJson(
      [...map.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => [key, structuredClone(value)]),
    );
    const before = {
      candidates: mapSnapshot(internals.candidates),
      history: mapSnapshot(internals.history),
      promotions: mapSnapshot(internals.promotions),
      replacement: canonicalCivicDataJson(args[0].replacementPointers.map(({ scope, versionId }) => ({
        scope,
        versionId,
        pointer: structuredClone(internals.promotions.get(`MEETING:${scope}`)),
        candidate: structuredClone(internals.candidates.get(versionId)),
        events: structuredClone(internals.history.get(versionId) ?? []),
      }))),
    };
    let result: Awaited<ReturnType<MemoryRoutineDataStore["retirePdcV2LegacyMeetingsAggregate"]>>;
    try {
      result = await super.retirePdcV2LegacyMeetingsAggregate(...args);
    } catch (error) {
      assert.equal(mapSnapshot(internals.candidates), before.candidates);
      assert.equal(mapSnapshot(internals.history), before.history);
      assert.equal(mapSnapshot(internals.promotions), before.promotions);
      throw error;
    }
    assert.equal(
      canonicalCivicDataJson(args[0].replacementPointers.map(({ scope, versionId }) => ({
        scope,
        versionId,
        pointer: structuredClone(internals.promotions.get(`MEETING:${scope}`)),
        candidate: structuredClone(internals.candidates.get(versionId)),
        events: structuredClone(internals.history.get(versionId) ?? []),
      }))),
      before.replacement,
      "the retirement proof is read-only for every replacement authority row",
    );
    assert.equal(mapSnapshot(internals.candidates), before.candidates);
    if (result.disposition === "ALREADY_RETIRED_PROVEN") {
      assert.equal(mapSnapshot(internals.history), before.history);
      assert.equal(mapSnapshot(internals.promotions), before.promotions);
    } else {
      const legacyHistory = structuredClone(internals.history.get(result.legacyVersionId) ?? []);
      const terminalEvent = legacyHistory.pop();
      assert.deepEqual(terminalEvent, {
        candidateId: result.legacyVersionId,
        sequence: legacyHistory.length + 1,
        state: "PROMOTED",
        at: result.retiredAt,
        detail: result.detail,
      });
      const expectedHistory = new Map(internals.history);
      expectedHistory.set(result.legacyVersionId, legacyHistory);
      assert.equal(mapSnapshot(expectedHistory), before.history);
      const expectedPromotions = new Map(internals.promotions);
      const admittedLegacyPointer = args[0].observedLegacyVersionId === result.legacyVersionId
        ? {
            key: "MEETING:supported-bodies",
            sourceId: "meetings-public-bodies",
            recordClass: "MEETING" as const,
            scope: "supported-bodies",
            versionId: result.legacyVersionId,
            lastKnownGoodVersionId: result.legacyVersionId,
            promotedAt: (args[0].observedLegacyEvents ?? [])[3]!.at,
            payload: args[0].observedLegacyPayload,
            receipt: args[0].observedLegacyCandidateRecord!.receipt!,
          }
        : null;
      assert.ok(admittedLegacyPointer);
      expectedPromotions.set(admittedLegacyPointer.key, admittedLegacyPointer);
      assert.equal(mapSnapshot(expectedPromotions), before.promotions);
    }
    return result;
  }
}

function releaseMemoryRoutineDataStore(store: MemoryRoutineDataStore): void {
  const retained = store as unknown as {
    candidates: Map<string, CandidateVersionRecord>;
    history: Map<string, CandidateEvent[]>;
    promotions: Map<string, PromotedProjection>;
    lastRetirementInput?: PdcV2LegacyMeetingsRetirementInput | null;
    legacyBaseVersionId?: string | null;
    legacySuccessor?: RoutineCandidate | null;
  };
  retained.candidates.clear();
  retained.history.clear();
  retained.promotions.clear();
  if ("lastRetirementInput" in retained) retained.lastRetirementInput = null;
  if ("legacyBaseVersionId" in retained) retained.legacyBaseVersionId = null;
  if ("legacySuccessor" in retained) retained.legacySuccessor = null;
}

async function seedLegacyMeetingsAggregate(
  store: MemoryRoutineDataStore,
  plan: PdcV2TrustedLkgImportPlan,
  transform: (snapshot: MeetingsSnapshot) => MeetingsSnapshot = (snapshot) => snapshot,
): Promise<string> {
  const meetingPlans = plan.candidates.filter(({ door }) => door === "MEETING_PARTITION");
  const snapshots = meetingPlans.map(({ candidate }) => candidate.readModel as MeetingsSnapshot);
  const frozenSnapshot: MeetingsSnapshot = {
    formatVersion: 1,
    generatedAt: snapshots.map(({ generatedAt }) => generatedAt).sort().at(-1)!,
    counts: {
      fresh: snapshots.reduce((count, value) => count + value.counts.fresh, 0),
      carried: snapshots.reduce((count, value) => count + value.counts.carried, 0),
      total: snapshots.reduce((count, value) => count + value.counts.total, 0),
      duplicatesCollapsed: snapshots.reduce(
        (count, value) => count + (value.counts.duplicatesCollapsed ?? 0),
        0,
      ),
    },
    sources: snapshots.flatMap(({ sources }) => sources),
    meetings: snapshots.flatMap(({ meetings }) => meetings),
    agendaDocuments: snapshots.flatMap(({ agendaDocuments }) => agendaDocuments),
  };
  const snapshot = transform(structuredClone(frozenSnapshot));
  const template = meetingPlans[0]!.candidate;
  const legacyAt = "2026-09-09T11:00:00.000Z";
  const payloadHash = sha256(canonicalCivicDataJson(snapshot));
  const sourceUrl = snapshot.meetings[0]!.provenance!.sourceUrl;
  assert.ok(sourceUrl, "the frozen legacy aggregate fixture has a source URL");
  const { bootstrapImport: _bootstrapImport, changeSet: _changeSet, ...base } = template;
  const candidate: RoutineCandidate = {
    ...base,
    id: "cv-pdc-v2-legacy-meetings-aggregate",
    scope: "supported-bodies",
    sourceProjectionEvidence: sourceProjectionEvidence(
      "meetings-public-bodies",
      "MEETING",
      "supported-bodies",
    ),
    retrieval: {
      succeeded: true,
      requestedUrl: sourceUrl,
      finalUrl: sourceUrl,
      httpStatus: 200,
      retrievedAt: legacyAt,
      rawHash: payloadHash,
    },
    normalization: {
      ...template.normalization,
      normalizedHash: payloadHash,
      normalizedPayloadHash: payloadHash,
      inputRecords: snapshot.meetings.length,
      outputRecords: snapshot.meetings.length,
      droppedRecords: 0,
      missingRequiredFields: [],
    },
    identities: snapshot.meetings.map((meeting) => {
      const identity = meetingPlans
        .flatMap(({ candidate: value }) => value.identities)
        .find(({ subjectId }) => subjectId === meeting.id);
      assert.ok(identity, `legacy aggregate meeting ${meeting.id} has frozen identity evidence`);
      return identity;
    }),
    temporal: {
      version: snapshot.generatedAt,
      expectedVersion: snapshot.generatedAt,
      sourceThrough: snapshot.generatedAt,
      staleAtRetrieval: false,
    },
    semantics: { ...template.semantics, violations: [] },
    horizon: {
      ...template.horizon,
      query: "legacy supported-bodies aggregate",
      returnedRecords: snapshot.meetings.length,
      declaredTotal: snapshot.meetings.length,
    },
    dependentChecks: [
      {
        consumer: "legacy aggregate continuity fixture",
        passed: true,
        detail: `${snapshot.meetings.length} meetings and ${snapshot.agendaDocuments.length} agenda documents.`,
      },
    ],
    normalizedPayload: snapshot,
    readModel: snapshot,
    civicRecords: civicRecordsFor("MEETING", snapshot),
    excludedFacts: meetingPlans.flatMap(({ candidate: value }) => value.excludedFacts ?? []),
  };
  // Production legacy rows are JSONB-backed; mirror that exact durable shape
  // instead of leaving JavaScript-only undefined properties in the memory store.
  const durableCandidate = JSON.parse(JSON.stringify(candidate)) as RoutineCandidate;
  const outcome = await processRoutineCandidate(store, durableCandidate, legacyAt, null);
  assert.equal(outcome.candidate.state, "PROMOTED");
  assert.equal(outcome.promoted?.versionId, candidate.id);
  return candidate.id;
}

function legacySnapshotWithoutMeeting(
  snapshot: MeetingsSnapshot,
  meetingId: string,
): MeetingsSnapshot {
  const meeting = snapshot.meetings.find(({ id }) => id === meetingId);
  assert.ok(meeting, `legacy aggregate contains meeting ${meetingId}`);
  const sourceName = meeting.id.slice(0, meeting.id.indexOf(":"));
  const sources = structuredClone(snapshot.sources);
  if (meeting.carried) {
    const source = sources.find((row) =>
      row.source === sourceName && (row.carriedForward ?? 0) > 0 &&
      (meeting.carried?.reason !== "UNEXPLAINED_DISAPPEARANCE" ||
        (row.ok && (row.unreachableOcdIds?.length ?? 0) === 0))
    );
    assert.ok(source, `${sourceName} carries the removed meeting`);
    source.carriedForward = (source.carriedForward ?? 0) - 1;
  } else {
    const source = sources.find((row) =>
      row.source === sourceName && row.normalized > 0
    );
    assert.ok(source, `${sourceName} reports the removed fresh meeting`);
    source.normalized -= 1;
    if (source.fetched > 0) source.fetched -= 1;
  }
  const meetings = snapshot.meetings.filter(({ id }) => id !== meetingId);
  const carried = meetings.filter((row) => row.carried).length;
  const next: MeetingsSnapshot = {
    ...structuredClone(snapshot),
    counts: {
      ...snapshot.counts,
      fresh: meetings.length - carried,
      carried,
      total: meetings.length,
    },
    sources,
    meetings,
    agendaDocuments: snapshot.agendaDocuments.filter((document) =>
      document.meetingId !== meetingId
    ),
  };
  return next;
}

class InterruptAfterCreateStore extends CountingMemoryRoutineDataStore {
  interrupted = false;
  interruptOnCreateCall = 2;

  override async transition(...args: Parameters<MemoryRoutineDataStore["transition"]>): Promise<Awaited<ReturnType<MemoryRoutineDataStore["transition"]>>> {
    if (!this.interrupted && this.createCalls === this.interruptOnCreateCall) {
      this.interrupted = true;
      throw new Error("SIMULATED_PROCESS_INTERRUPTION_AFTER_DURABLE_CREATE");
    }
    return super.transition(...args);
  }
}

class InterruptFirstReaderReadbackStore extends CountingMemoryRoutineDataStore {
  interrupted = false;
  successfulReaderReadbacks = 0;

  override async appendEvidence(...args: Parameters<MemoryRoutineDataStore["appendEvidence"]>): Promise<Awaited<ReturnType<MemoryRoutineDataStore["appendEvidence"]>>> {
    if (!this.interrupted) {
      this.interrupted = true;
      throw new Error("SIMULATED_PROCESS_INTERRUPTION_AFTER_POINTER_BEFORE_READER_RECEIPT");
    }
    this.successfulReaderReadbacks += 1;
    return super.appendEvidence(...args);
  }
}

class RefusePreContractStore extends CountingMemoryRoutineDataStore {
  override async assertPdcV2PreContractMigrationState(): Promise<void> {
    await super.assertPdcV2PreContractMigrationState();
    throw new Error("PLANTED_PRECONTRACT_SCHEMA_REFUSAL");
  }
}

class RefusePreImportIntegrityStore extends CountingMemoryRoutineDataStore {
  override async assertPdcV2PreImportDataIntegrity(
    ...args: Parameters<MemoryRoutineDataStore["assertPdcV2PreImportDataIntegrity"]>
  ): Promise<void> {
    await super.assertPdcV2PreImportDataIntegrity(...args);
    throw new Error("PLANTED_PREIMPORT_GLOBAL_INTEGRITY_REFUSAL");
  }
}

class DriftLegacyBeforeFirstWriteStore extends CountingMemoryRoutineDataStore {
  override async assertPdcV2PreImportDataIntegrity(
    ...args: Parameters<MemoryRoutineDataStore["assertPdcV2PreImportDataIntegrity"]>
  ): Promise<void> {
    await super.assertPdcV2PreImportDataIntegrity(...args);
    const promotions = (this as unknown as {
      promotions: Map<string, PromotedProjection>;
    }).promotions;
    const key = "MEETING:supported-bodies";
    const original = promotions.get(key);
    assert.ok(original);
    promotions.set(key, {
      ...original,
      payload: {
        ...(original.payload as MeetingsSnapshot),
        generatedAt: "2026-09-09T11:00:00.001Z",
      },
    });
  }
}

class SwapLegacyVersionAfterFirstWriteStore extends CountingMemoryRoutineDataStore {
  private legacyBaseVersionId: string | null = null;
  private legacySuccessor: RoutineCandidate | null = null;
  private swapped = false;

  configureLegacySuccessor(baseVersionId: string, successor: RoutineCandidate): void {
    this.legacyBaseVersionId = baseVersionId;
    this.legacySuccessor = successor;
  }

  override async create(
    ...args: Parameters<MemoryRoutineDataStore["create"]>
  ): Promise<void> {
    await super.create(...args);
    if (
      !this.swapped && this.legacyBaseVersionId && this.legacySuccessor &&
      args[0].candidate.scope !== "supported-bodies"
    ) {
      this.swapped = true;
      const successor = this.legacySuccessor;
      await processRoutineCandidate(
        this,
        successor,
        successor.retrieval.retrievedAt,
        this.legacyBaseVersionId,
      );
    }
  }
}

class DriftLegacyPayloadAtRetirementStore extends CountingMemoryRoutineDataStore {
  override async retirePdcV2LegacyMeetingsAggregate(
    ...args: Parameters<MemoryRoutineDataStore["retirePdcV2LegacyMeetingsAggregate"]>
  ): Promise<Awaited<ReturnType<MemoryRoutineDataStore["retirePdcV2LegacyMeetingsAggregate"]>>> {
    const promotions = (this as unknown as {
      promotions: Map<string, Awaited<ReturnType<MemoryRoutineDataStore["readPromotion"]>>>;
    }).promotions;
    const key = "MEETING:supported-bodies";
    const original = promotions.get(key);
    assert.ok(original);
    promotions.set(key, { ...original, payload: { planted: "legacy payload drift" } });
    try {
      return await super.retirePdcV2LegacyMeetingsAggregate(...args);
    } finally {
      promotions.set(key, original);
    }
  }
}

class DriftLegacyCandidateAtRetirementStore extends CountingMemoryRoutineDataStore {
  override async retirePdcV2LegacyMeetingsAggregate(
    ...args: Parameters<MemoryRoutineDataStore["retirePdcV2LegacyMeetingsAggregate"]>
  ): Promise<Awaited<ReturnType<MemoryRoutineDataStore["retirePdcV2LegacyMeetingsAggregate"]>>> {
    const candidates = (this as unknown as {
      candidates: Map<string, CandidateVersionRecord>;
    }).candidates;
    const versionId = args[0].observedLegacyVersionId;
    assert.ok(versionId);
    const original = candidates.get(versionId);
    assert.ok(original);
    candidates.set(versionId, {
      ...original,
      candidate: {
        ...original.candidate,
        normalizedPayload: {
          ...(original.candidate.normalizedPayload as MeetingsSnapshot),
          generatedAt: "2026-09-09T11:00:00.001Z",
        },
      },
    });
    try {
      return await super.retirePdcV2LegacyMeetingsAggregate(...args);
    } finally {
      candidates.set(versionId, original);
    }
  }
}

class FakePdcAdmissionIpc {
  connected = true;
  readonly sent: unknown[] = [];
  private readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  on(event: "message" | "disconnect" | "error", listener: (...args: unknown[]) => void): this {
    const current = this.listeners.get(event) ?? new Set();
    current.add(listener);
    this.listeners.set(event, current);
    return this;
  }

  off(event: "message" | "disconnect" | "error", listener: (...args: unknown[]) => void): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  send(message: unknown): boolean {
    this.sent.push(message);
    return true;
  }

  emit(event: "message" | "disconnect" | "error", ...args: unknown[]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(...args);
  }
}

function pdcAdmissionFixture(nowMs: number = Date.now()) {
  const nonce = "b".repeat(64);
  const expected = {
    importSha: "c".repeat(40),
    frozenBaseSha: PDC_V2_FROZEN_BASE_SHA,
    migrationBlobSha1: "d".repeat(40),
    parentPid: process.ppid,
    childPid: process.pid,
  } as const;
  const nonceSha256 = createHash("sha256").update(nonce).digest("hex");
  const receipt = {
    schemaVersion: 1,
    type: "PDC_V2_IMPORT_PREWRITE_ADMISSION",
    result: "QUIESCENCE_REPROVED",
    nonceSha256,
    ...expected,
    githubProofSha256: "e".repeat(64),
    narrowRoleProofSha256: "f".repeat(64),
    issuedAt: new Date(nowMs - 1_000).toISOString(),
    expiresAt: new Date(nowMs + 20_000).toISOString(),
    gates: {
      legacyWorkflowDefinitionsDisabled: 8,
      nonterminalLegacyRuns: 0,
      obsoleteScheduledTasks: 0,
      startupLaunchers: 0,
      oldProcessTreeMembers: 0,
      localImportCommitCleanExactHead: true,
    },
  } as const;
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    WTP_PDC_V2_ADMISSION_PROTOCOL: "1",
    WTP_PDC_V2_ADMISSION_NONCE: nonce,
    WTP_PDC_V2_ADMISSION_PARENT_PID: String(process.ppid),
  };
  return { nonce, nonceSha256, expected, receipt, env };
}

test("the temporary importer CLI requires its exact explicit production invocation", () => {
  const parsed = parsePdcV2TrustedLkgImporterArguments([
    "node",
    "scripts/pdc-v2-trusted-lkg-import.mts",
    "--promote",
    "--admission-ipc",
    "--frozen-root=C:\\frozen\\fc67",
  ]);
  assert.equal(parsed.frozenRoot, "C:\\frozen\\fc67");
  assert.equal(parsed.admissionIpc, true);
  for (const argv of [
    ["node", "script", "--frozen-root=C:\\frozen\\fc67"],
    ["node", "script", "--promote"],
    ["node", "script", "--promote", "--frozen-root=C:\\frozen\\fc67"],
    ["node", "script", "--promote", "--admission-ipc", "--frozen-root=relative"],
    ["node", "script", "--promote", "--admission-ipc", "--admission-ipc", "--frozen-root=C:\\frozen\\fc67"],
    ["node", "script", "--promote", "--promote", "--admission-ipc", "--frozen-root=C:\\frozen\\fc67"],
    ["node", "script", "--promote", "--admission-ipc", "--frozen-root=C:\\frozen\\fc67", "--extra"],
  ]) {
    assert.throws(() => parsePdcV2TrustedLkgImporterArguments(argv));
  }

  const source = readFileSync(join(process.cwd(), "scripts", "pdc-v2-trusted-lkg-import.mts"), "utf8");
  const plan = source.indexOf("  const plan = await buildPdcV2TrustedLkgImportPlan");
  const migrationRead = source.indexOf("  const contractMigrationBytes = readFileSync");
  const prewriteRepositoryCheck = source.indexOf("  const prewriteImporterFacts = inspectTrustedLkgRepository");
  const admission = source.indexOf("  const admissionNonce = await consumePdcV2PrewriteAdmission");
  const authority = source.indexOf("  const trustedImportAuthority = temporaryTrustedLkgImportEnvironment");
  const guard = source.indexOf("  prepareProductionCivicDataWrite();");
  const store = source.indexOf("  const store = new PostgresRoutineDataStore();");
  const execute = source.indexOf("  const result = await executePdcV2PermanentCutoverImportPlan");
  assert.ok(
    plan >= 0 &&
      plan < migrationRead &&
      migrationRead < prewriteRepositoryCheck &&
      prewriteRepositoryCheck < admission &&
      admission < authority &&
      authority < guard &&
      guard < store &&
      store < execute,
  );
  assert.match(source, /repositoryRoot: prewriteImporterFacts\.repositoryRoot/);
  assert.match(source, /headSha: prewriteImporterFacts\.headSha/);
  assert.match(source, /processPid: process\.pid/);
  assert.match(source, /nonce: admissionNonce/);
  assert.match(source, /for \(const key of Object\.values\(RUNTIME_AUTHORITY_ENV\)\)/);
  assert.equal(source.match(/inspectTrustedLkgRepository\(resolve\(cwd\)\)/g)?.length, 2);
  assert.match(
    source,
    /gitBlobId\(contractMigrationBytes\)[\s\S]*trackedBlobIds\[contractMigrationPath\]/,
  );
  assert.doesNotMatch(
    source,
    /export\s+async\s+function\s+runPdcV2TrustedLkgImporter/,
    "another entry script cannot import and invoke the production importer",
  );
  assert.match(source, /if \(isDirectModuleExecution\(import\.meta\.url\)\) \{/);
  assert.doesNotMatch(source, /from ["']node:child_process["']/);
  assert.doesNotMatch(source, /\b(?:writeFile|appendFile|fetch)\s*\(/);

  const secret = "postgresql://owner:do-not-print@db.example.test/app?sslmode=require";
  const safe = redactPdcV2TrustedLkgImporterError(
    new Error(
      `connection failed for ${secret}; password=also-secret token=and-this; ` +
      `Authorization: Bearer bearer-secret; "api_key":"json-secret"; client_secret='client secret'`,
    ),
    { DATABASE_URL: secret },
  );
  assert.doesNotMatch(safe, /do-not-print|also-secret|and-this|bearer-secret|json-secret|client secret/);
  assert.match(safe, /\[REDACTED_DATABASE_URL\]/);
  assert.match(source, /console\.error\(redactPdcV2TrustedLkgImporterError\(error\)\)/);
  assert.doesNotMatch(source, /console\.error\(error\)/);
});

test("the Postgres retirement lock binds the exact pre-read replacement promotion clock", () => {
  const storeSource = readFileSync(join(process.cwd(), "lib", "civic-data", "store.ts"), "utf8");
  assert.match(
    storeSource,
    /replacement\."promoted_at" = \(expected#>>'\{pointer,promotedAt\}'\)::timestamptz/,
    "a promotedAt-only pointer race must falsify the locked replacement proof",
  );
  assert.match(
    storeSource,
    /pointer: fullPointer,[\s\S]*events: replacementHistories\.get\(pointer\.versionId\)/,
    "the SQL witness must serialize the same full pointer and history read before the lock",
  );
});

test("the importer consumes one fresh parent-bound quiescence lease before opening writes", async () => {
  const now = Date.parse("2026-09-09T14:00:00.000Z");
  const fixture = pdcAdmissionFixture(now);
  assert.equal(
    pdcV2PrewriteAdmissionReceiptIssue(
      fixture.receipt,
      { ...fixture.expected, nonceSha256: fixture.nonceSha256 },
      now,
    ),
    null,
  );
  const planted = [
    { ...fixture.receipt, nonceSha256: "0".repeat(64) },
    { ...fixture.receipt, parentPid: fixture.receipt.parentPid + 1 },
    { ...fixture.receipt, childPid: fixture.receipt.childPid + 1 },
    { ...fixture.receipt, importSha: "0".repeat(40) },
    { ...fixture.receipt, frozenBaseSha: "0".repeat(40) },
    { ...fixture.receipt, migrationBlobSha1: "0".repeat(40) },
    { ...fixture.receipt, gates: { ...fixture.receipt.gates, nonterminalLegacyRuns: 1 } },
    { ...fixture.receipt, extra: true },
    {
      ...fixture.receipt,
      issuedAt: new Date(now + 1).toISOString(),
      expiresAt: new Date(now + 10_000).toISOString(),
    },
    {
      ...fixture.receipt,
      issuedAt: new Date(now - 31_000).toISOString(),
      expiresAt: new Date(now + 1).toISOString(),
    },
    {
      ...fixture.receipt,
      issuedAt: "2026-09-09T14:00:00Z",
    },
  ];
  for (const receipt of planted) {
    assert.notEqual(
      pdcV2PrewriteAdmissionReceiptIssue(
        receipt,
        { ...fixture.expected, nonceSha256: fixture.nonceSha256 },
        now,
      ),
      null,
    );
  }

  const ipc = new FakePdcAdmissionIpc();
  const live = pdcAdmissionFixture();
  const admitted = consumePdcV2PrewriteAdmission({
    expected: live.expected,
    env: live.env,
    ipc,
    timeoutMs: 100,
  });
  assert.equal(ipc.sent.length, 1);
  assert.deepEqual(ipc.sent[0], {
    schemaVersion: 1,
    type: "PDC_V2_IMPORT_PREWRITE_READY",
    nonceSha256: live.nonceSha256,
    ...live.expected,
  });
  ipc.emit("message", live.receipt);
  assert.equal(await admitted, live.nonce);
  assert.equal(live.env.WTP_PDC_V2_ADMISSION_PROTOCOL, undefined);
  assert.equal(live.env.WTP_PDC_V2_ADMISSION_NONCE, undefined);
  assert.equal(live.env.WTP_PDC_V2_ADMISSION_PARENT_PID, undefined);

  const disconnectedIpc = new FakePdcAdmissionIpc();
  const disconnectedFixture = pdcAdmissionFixture();
  const disconnected = consumePdcV2PrewriteAdmission({
    expected: disconnectedFixture.expected,
    env: disconnectedFixture.env,
    ipc: disconnectedIpc,
    timeoutMs: 100,
  });
  disconnectedIpc.emit("disconnect");
  await assert.rejects(disconnected, /PDC_V2_PREWRITE_ADMISSION_PARENT_DISCONNECTED/);

  const duplicateIpc = new FakePdcAdmissionIpc();
  const duplicateFixture = pdcAdmissionFixture();
  const duplicate = consumePdcV2PrewriteAdmission({
    expected: duplicateFixture.expected,
    env: duplicateFixture.env,
    ipc: duplicateIpc,
    timeoutMs: 100,
  });
  duplicateIpc.emit("message", duplicateFixture.receipt);
  duplicateIpc.emit("message", duplicateFixture.receipt);
  await assert.rejects(duplicate, /PDC_V2_PREWRITE_ADMISSION_MULTIPLE_RECEIPTS_REFUSED/);

  const timeoutIpc = new FakePdcAdmissionIpc();
  const timeoutFixture = pdcAdmissionFixture();
  await assert.rejects(
    consumePdcV2PrewriteAdmission({
      expected: timeoutFixture.expected,
      env: timeoutFixture.env,
      ipc: timeoutIpc,
      timeoutMs: 1,
    }),
    /PDC_V2_PREWRITE_ADMISSION_TIMEOUT/,
  );

  const closedIpc = new FakePdcAdmissionIpc();
  closedIpc.connected = false;
  const closedFixture = pdcAdmissionFixture();
  await assert.rejects(
    consumePdcV2PrewriteAdmission({
      expected: closedFixture.expected,
      env: closedFixture.env,
      ipc: closedIpc,
    }),
    /PDC_V2_PREWRITE_ADMISSION_CHANNEL_REFUSED/,
  );
});

test("the exact venue identity is browser-safe across every alias-aware Next client reachability path", () => {
  const paths = git(
    process.cwd(),
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "*.ts",
    "*.tsx",
    "*.mts",
    "*.js",
    "*.jsx",
    "*.mjs",
  )
    .split(/\r?\n/)
    .filter(Boolean)
    .map((path) => path.replaceAll("\\", "/"))
    .filter((path) => existsSync(join(process.cwd(), ...path.split("/"))));
  const held = new Set(paths);
  const reverse = new Map<string, Set<string>>();
  const specifierPattern = /(?:\b(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?|\bimport\s*\(\s*)["']([^"']+)["']/g;
  for (const path of paths) {
    const source = readFileSync(join(process.cwd(), ...path.split("/")), "utf8");
    for (const match of source.matchAll(specifierPattern)) {
      const specifier = match[1]!;
      if (!specifier.startsWith(".") && !specifier.startsWith("@/")) continue;
      const base = specifier.startsWith("@/")
        ? posix.normalize(specifier.slice(2))
        : posix.normalize(posix.join(posix.dirname(path), specifier));
      const candidates = /\.[cm]?[jt]sx?$/.test(base)
        ? [base]
        : [
            `${base}.ts`,
            `${base}.tsx`,
            `${base}.mts`,
            `${base}.js`,
            `${base}.jsx`,
            `${base}.mjs`,
            `${base}/index.ts`,
            `${base}/index.tsx`,
            `${base}/index.mts`,
            `${base}/index.js`,
            `${base}/index.jsx`,
            `${base}/index.mjs`,
          ];
      const dependency = candidates.find((candidate) => held.has(candidate));
      if (!dependency) continue;
      const importers = reverse.get(dependency) ?? new Set<string>();
      importers.add(path);
      reverse.set(dependency, importers);
    }
  }
  const target = "lib/meetings/venue-cache.ts";
  const ancestors = new Set<string>();
  const queue = [target];
  while (queue.length > 0) {
    const dependency = queue.shift()!;
    for (const importer of reverse.get(dependency) ?? []) {
      if (ancestors.has(importer)) continue;
      ancestors.add(importer);
      queue.push(importer);
    }
  }
  const clientAncestors = [...ancestors].filter((path) =>
    /^\s*["']use client["'];/.test(readFileSync(join(process.cwd(), ...path.split("/")), "utf8"))
  );
  assert.ok(ancestors.size > 0, "the proof must actually traverse venue consumers");
  assert.ok(clientAncestors.length > 0, "the alias-aware proof must reach the known Next client boundary");
  assert.doesNotMatch(
    readFileSync(join(process.cwd(), "lib", "meetings", "venue-cache.ts"), "utf8"),
    /(?:from\s*["']node:|import\s*\(\s*["']node:|require\s*\(\s*["']node:)/,
  );
  assert.doesNotMatch(
    readFileSync(join(process.cwd(), "lib", "meetings", "venue-record-identity.ts"), "utf8"),
    /(?:from\s*["']node:|import\s*\(\s*["']node:|require\s*\(\s*["']node:)/,
  );
});

test("the browser-safe venue content key is an exact UTF-16 encoding", () => {
  assert.equal(exactVenueMatchContentKey(""), "utf16-0-");
  assert.equal(exactVenueMatchContentKey("abc"), "utf16-3-006100620063");
  assert.equal(exactVenueMatchContentKey("é"), "utf16-1-00e9");
  assert.equal(exactVenueMatchContentKey("e\u0301"), "utf16-2-00650301");
  assert.equal(exactVenueMatchContentKey("🏛️"), "utf16-3-d83cdfdbfe0f");
  assert.equal(exactVenueMatchContentKey("\ud800"), "utf16-1-d800");
  assert.notEqual(exactVenueMatchContentKey("é"), exactVenueMatchContentKey("e\u0301"));
  assert.notEqual(exactVenueMatchContentKey("\ud800"), exactVenueMatchContentKey("�"));
});

// This deliberately performs three complete frozen builds plus the full import;
// historical isolated runs take 10-16 minutes, so retain a bounded 20-minute ceiling.
test("exact fc67 fixtures deterministically build and seed only the 95 absent trusted-LKG pointers", {
  timeout: 1_200_000,
}, async () => {
  await withFrozenBase(async (frozenRoot, repositoryRoot) => {
    const frozenFacts = inspectTrustedLkgRepository(frozenRoot);
    assert.equal(frozenFacts.headSha, PDC_V2_FROZEN_BASE_SHA);
    assert.equal(frozenFacts.clean, true);
    assert.equal(frozenFacts.detached, true);
    assert.equal(trustedLkgFrozenRepositoryIssue(frozenFacts), null);
    assert.match(
      trustedLkgFrozenRepositoryIssue({ ...frozenFacts, clean: false }) ?? "",
      /not clean/,
    );
    assert.match(
      trustedLkgFrozenRepositoryIssue({ ...frozenFacts, detached: false }) ?? "",
      /must be detached/,
    );
    assert.match(
      trustedLkgFrozenRepositoryIssue({ ...frozenFacts, headSha: "b".repeat(40) }) ?? "",
      /not fc67e8cd34c489590c403f7b4a0d6008fa755296/,
    );
    assert.match(
      trustedLkgFrozenRepositoryIssue(frozenFacts, frozenFacts) ?? "",
      /must be separate/,
    );
    assert.equal(
      pdcV2TrustedLkgExecutingImporterIssue(repositoryRoot),
      null,
      "the executing importer is the exact script beneath the attested repository root",
    );
    assert.match(
      pdcV2TrustedLkgExecutingImporterIssue(
        repositoryRoot,
        join(frozenRoot, "scripts", "pilot-runner.mts"),
      ) ?? "",
      /executing importer belongs to .*not the attested repository/,
      "an absolute script from another checkout cannot borrow this checkout's clean HEAD identity",
    );
    assert.match(
      pdcV2TrustedLkgExecutingImporterIssue(
        repositoryRoot,
        join(repositoryRoot, "scripts", "pilot-runner.mts"),
      ) ?? "",
      /not the exact committed importer path/,
      "another executable in the same clean checkout cannot stand in for the importer",
    );

    const importerFacts = {
      ...frozenFacts,
      requestedRoot: repositoryRoot,
      repositoryRoot,
      headSha: IMPORTER_SHA,
      clean: true,
      detached: false,
      frozenBaseIsAncestor: true,
      importerTrackedAtHead: true,
      importerMatchesHead: true,
    };
    assert.equal(trustedLkgImporterRepositoryIssue(importerFacts), null);
    assert.match(trustedLkgImporterRepositoryIssue({ ...importerFacts, clean: false }) ?? "", /not clean/);
    assert.match(trustedLkgImporterRepositoryIssue({ ...importerFacts, frozenBaseIsAncestor: false }) ?? "", /not an ancestor/);
    assert.match(trustedLkgImporterRepositoryIssue({ ...importerFacts, importerTrackedAtHead: false }) ?? "", /not tracked/);
    assert.match(trustedLkgImporterRepositoryIssue({ ...importerFacts, importerMatchesHead: false }) ?? "", /does not match/);

    const options = { frozenRoot, importerCodeSha: IMPORTER_SHA, importedAt: IMPORTED_AT } as const;
    const plan = await buildPdcV2TrustedLkgImportPlan(options);
    assertPlanDenominator(plan);
    assertManualReaderMemberCoverage(plan);
    const serializedCandidates = plan.candidates.map(({ contractId, candidate }) => ({
      contractId,
      bytes: Buffer.byteLength(JSON.stringify(candidate)),
    })).sort((left, right) => right.bytes - left.bytes);
    assert.equal(serializedCandidates[0]?.contractId, "registry-runtime-bindings");
    assert.ok(
      serializedCandidates[0]!.bytes < 24 * 1024 * 1024,
      `largest candidate ${serializedCandidates[0]!.contractId} is ${serializedCandidates[0]!.bytes} bytes; ` +
      "the one-candidate Neon HTTP write/read must retain at least 2x headroom beneath its 64 MiB response limit",
    );
    const rebuilt = await buildPdcV2TrustedLkgImportPlan(options);
    assert.deepEqual(
      rebuilt.candidates.map(({ contractId, candidate }) => [contractId, candidate.id]),
      plan.candidates.map(({ contractId, candidate }) => [contractId, candidate.id]),
      "the same frozen bytes, importer SHA, and import instant produce the same content-addressed candidates",
    );

    const fixtureHashes = new Map<string, { sha256: string; bytes: number }>();
    for (const { contractId, candidate } of plan.candidates) {
      const evidence = candidate.bootstrapImport;
      assert.ok(evidence, `${contractId} carries the trusted import envelope`);
      if (evidence.kind !== "TRUSTED_LKG_IMPORT") assert.fail(`${contractId} is not a first-seed import`);
      assert.equal(evidence.sourceAuthenticated, false);
      assert.equal(evidence.frozenBaseSha, PDC_V2_FROZEN_BASE_SHA);
      assert.equal(evidence.importerCodeSha, IMPORTER_SHA);
      assert.notEqual(evidence.frozenBaseSha, evidence.importerCodeSha);
      assert.equal(candidate.temporal.staleAtRetrieval, true);
      assert.equal(candidate.horizon.claimsComplete, false);
      assert.equal(candidate.absence.claimsAbsence, false);
      assert.equal(candidate.retrieval.finalUrl, null);
      assert.ok((candidate.civicRecords?.length ?? 0) > 0);
      const explicitlyHeld = candidate.excludedFacts ?? [];
      assert.equal(
        candidate.normalization.inputRecords,
        candidate.normalization.outputRecords + explicitlyHeld.length,
        `${contractId} dispositions every frozen input into its Reader projection or exact held evidence`,
      );
      assert.equal(candidate.normalization.droppedRecords, explicitlyHeld.length);
      assert.equal(
        explicitlyHeld.length,
        contractId === "officeholder-statements"
          ? PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS.heldOfficeholderStatementSnapshots
          : 0,
      );
      assert.equal(evidence.normalizedPayloadSha256, sha256(canonicalCivicDataJson(candidate.readModel)));
      assert.deepEqual(evidence.fixtures.map(({ path }) => path), [...evidence.fixtures.map(({ path }) => path)].sort());
      for (const fixture of evidence.fixtures) {
        let expected = fixtureHashes.get(fixture.path);
        if (!expected) {
          const bytes = readFileSync(join(frozenRoot, ...fixture.path.split("/")));
          expected = { sha256: sha256(bytes), bytes: bytes.byteLength };
          fixtureHashes.set(fixture.path, expected);
        }
        assert.deepEqual(
          { sha256: fixture.sha256, bytes: fixture.bytes },
          expected,
          `${contractId}:${fixture.path} identifies exact ${PDC_V2_FROZEN_BASE_SHA} bytes`,
        );
      }
    }

    const profiles = plan.candidates.find(({ contractId }) => contractId === "candidate-profiles")!.candidate;
    const frozenLinks = readFileSync(join(frozenRoot, "data", "ballot", "candidate-links-2026.json"));
    assert.deepEqual(
      firstSeedEvidence(profiles).fixtures.find(({ path }) => path === "data/ballot/candidate-links-2026.json"),
      {
        path: "data/ballot/candidate-links-2026.json",
        sha256: sha256(frozenLinks),
        bytes: frozenLinks.byteLength,
      },
      "the divergent current-worktree candidate-link seed cannot enter frozen evidence",
    );
    const keyVotes = plan.candidates.find(({ contractId }) => contractId === "federal-key-votes")!.candidate;
    const frozenKeyVotes = JSON.parse(
      readFileSync(join(frozenRoot, "data", "votes", "key-votes-snapshot.json"), "utf8"),
    ) as {
      readonly criteria: string;
      readonly misses: readonly { readonly id: string; readonly chamber: string; readonly reason: string }[];
      readonly lawMisses?: readonly { readonly id: string; readonly reason: string }[];
      readonly entries: readonly {
        readonly id: string;
        readonly title: string;
        readonly explainer: string;
        readonly explainerSource: string;
        readonly explainerReadAt: string;
        readonly house: readonly Record<string, unknown>[];
        readonly senate: readonly Record<string, unknown>[];
      }[] & readonly Readonly<Record<string, unknown>>[];
    };
    const frozenPositions = JSON.parse(
      readFileSync(join(frozenRoot, "data", "votes", "key-vote-positions.json"), "utf8"),
    ) as {
      readonly positions: Readonly<Record<string, unknown>>;
      readonly retiredMappings?: Readonly<Record<string, unknown>>;
    };
    const frozenLawTitleBytes = readFileSync(join(frozenRoot, "data", "votes", "law-titles-cache.json"));
    const frozenLawTitles = JSON.parse(frozenLawTitleBytes.toString("utf8")) as Record<string, readonly string[]>;
    const frozenLawTitleRows = Object.values(frozenLawTitles).flat();
    const keyVoteReadModel = keyVotes.readModel as {
      readonly snapshot: typeof frozenKeyVotes;
      readonly positions: typeof frozenPositions;
      readonly lawTitles?: unknown;
    };
    const readerMetadata = (entry: typeof frozenKeyVotes.entries[number]): Readonly<Record<string, unknown>> => {
      const {
        house: _house,
        senate: _senate,
        lawSearch: _lawSearch,
        pendingSearch: _pendingSearch,
        senateSearch: _senateSearch,
        ...metadata
      } = entry;
      return metadata;
    };
    assert.equal(Object.keys(frozenLawTitles).length, PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS.frozenLawTitleBills);
    assert.equal(frozenLawTitleRows.length, PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS.frozenLawTitleRows);
    assert.equal(new Set(frozenLawTitleRows).size, PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS.frozenLawTitleUniqueValues);
    assert.deepEqual(
      firstSeedEvidence(keyVotes).fixtures.find(({ path }) => path === "data/votes/law-titles-cache.json"),
      {
        path: "data/votes/law-titles-cache.json",
        sha256: sha256(frozenLawTitleBytes),
        bytes: frozenLawTitleBytes.byteLength,
      },
      "the retired resolver cache survives as exact derivation evidence on the permanent authority",
    );
    assert.equal(keyVoteReadModel.lawTitles, undefined, "resolver working state is not promoted as a second Reader authority");
    const reviewedTransformations: {
      id: string;
      field: string;
      frozen: unknown;
      promoted: unknown;
    }[] = [];
    if (keyVoteReadModel.snapshot.criteria !== frozenKeyVotes.criteria) {
      reviewedTransformations.push({
        id: "CRITERIA",
        field: "criteria",
        frozen: frozenKeyVotes.criteria,
        promoted: keyVoteReadModel.snapshot.criteria,
      });
    }
    for (const frozenEntry of frozenKeyVotes.entries) {
      const promotedEntry = keyVoteReadModel.snapshot.entries.find(({ id }) => id === frozenEntry.id);
      assert.ok(promotedEntry, `serving question ${frozenEntry.id} remains in the reviewed v1 selection`);
      const frozenMetadata = readerMetadata(frozenEntry);
      const promotedMetadata = readerMetadata(promotedEntry);
      for (const field of [...new Set([...Object.keys(frozenMetadata), ...Object.keys(promotedMetadata)])].sort()) {
        if (canonicalCivicDataJson(frozenMetadata[field] ?? null) !== canonicalCivicDataJson(promotedMetadata[field] ?? null)) {
          reviewedTransformations.push({
            id: frozenEntry.id,
            field,
            frozen: frozenMetadata[field] ?? null,
            promoted: promotedMetadata[field] ?? null,
          });
        }
      }
      assert.equal(promotedEntry.title, frozenEntry.title, `${frozenEntry.id} keeps its exact serving title`);
      assert.deepEqual(promotedEntry.house, frozenEntry.house, `${frozenEntry.id} keeps its exact House question(s)`);
      assert.deepEqual(promotedEntry.senate, frozenEntry.senate, `${frozenEntry.id} keeps its exact Senate question(s)`);
    }
    assert.deepEqual(
      reviewedTransformations,
      [
        {
          id: "CRITERIA",
          field: "criteria",
          frozen: "Major legislation that became law (plus one pending measure, marked), and consequential Senate confirmations, since 2020 — chosen before looking at how anyone voted.",
          promoted: "Major legislation that became law (plus one additional selected proposal), and consequential Senate confirmations, since 2020 — chosen before looking at how anyone voted.",
        },
        {
          id: "genius-act",
          field: "explainer",
          frozen: "The first federal rulebook for stablecoins — digital tokens meant to hold a fixed dollar value — requiring issuers to hold real dollar reserves and submit to federal or state supervision.",
          promoted: "The first federal rulebook for stablecoins (cryptocurrency) — digital tokens meant to hold a fixed dollar value — requiring issuers to hold real dollar reserves and submit to federal or state supervision.",
        },
        { id: "stock-trading-ban", field: "pending", frozen: true, promoted: null },
        {
          id: "stock-trading-ban",
          field: "senateNote",
          frozen: "The Senate hasn't voted on this. It passed the House and is waiting.",
          promoted: null,
        },
      ],
      "only the reviewed software-contract transformations are allowed: mutable current-status claims cannot ride a stale trusted import",
    );
    assert.deepEqual(keyVoteReadModel.positions.positions, frozenPositions.positions);
    assert.equal(keyVoteReadModel.snapshot.entries.length, PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS.federalKeyVoteQuestions);
    assert.equal(
      keyVoteReadModel.snapshot.entries.flatMap(({ house, senate }) => [...house, ...senate]).length,
      PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS.federalKeyVoteRollReferences,
    );
    assert.equal(
      Object.keys(keyVoteReadModel.positions.positions).length,
      PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS.federalKeyVotePositionMaps,
    );
    assert.equal(
      keyVoteReadModel.snapshot.misses.length,
      PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS.federalKeyVoteSelectionMisses,
    );
    assert.equal(
      keyVoteReadModel.snapshot.lawMisses?.length ?? 0,
      PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS.federalKeyVoteLawMisses,
    );
    assert.equal(
      Object.keys(keyVoteReadModel.positions.retiredMappings ?? {}).length,
      PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS.federalKeyVoteRetiredPositionMaps,
      "retired wrong-stage maps remain exact historical evidence and never current position members",
    );
    const statements = plan.candidates.find(({ contractId }) => contractId === "officeholder-statements")!.candidate;
    const statementSnapshots = (statements.readModel as { snapshots: SourceSnapshot[] }).snapshots;
    assert.equal(statementSnapshots.length, PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS.promotedOfficeholderStatementSnapshots);
    assert.ok(statementSnapshots.every(({ subjectId }) =>
      officeholderIdentityMayEnterReader(subjectId, null)
    ));
    const frozenStatements = JSON.parse(
      readFileSync(join(frozenRoot, "data", "corpus", "statements.json"), "utf8"),
    ) as { readonly snapshots: readonly SourceSnapshot[] };
    assert.equal(frozenStatements.snapshots.length, PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS.frozenOfficeholderStatementSnapshots);
    const frozenPlural = frozenStatements.snapshots.filter(({ subjectId }) => subjectId.startsWith("plural:"));
    const rekeyedStatements = statementSnapshots.filter((snapshot) =>
      frozenPlural.some((frozen) => frozen.url === snapshot.url && frozen.contentHash === snapshot.contentHash)
    );
    assert.equal(rekeyedStatements.length, PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS.rekeyedOfficeholderStatementSnapshots);
    assert.deepEqual(
      rekeyedStatements.map(({ subjectId }) => subjectId).sort(),
      [
        "ballot-az-pima:state-house-19:diaz-lupe",
        "ballot-az-pima:state-house-19:gowan-david",
        "ballot-az-pima:state-house-20:gonzales-sally-ann",
        "ballot-az-pima:state-house-20:villegas-betty",
        "ballot-az-pima:state-house-20:villegas-betty",
        "ballot-az-pima:state-senate-19:griffin-gail",
        "ballot-az-pima:state-senate-20:hernandez-alma",
        "ballot-nh-merrimack:state-house-merrimack-7:ebel-karen-elizabeth",
        "ballot-nh-merrimack:state-house-merrimack-7:sargent-gregory-m-",
        "ballot-nh-merrimack:state-senate-7:innis-daniel-e-",
      ].sort(),
      "only exact frozen official/candidacy bridge targets replace retired intermediary ids",
    );
    for (const promoted of rekeyedStatements) {
      const frozen = frozenPlural.find((snapshot) =>
        snapshot.url === promoted.url && snapshot.contentHash === promoted.contentHash
      );
      assert.ok(frozen);
      assert.deepEqual(
        { ...promoted, id: frozen.id, subjectId: frozen.subjectId },
        frozen,
        `${frozen.subjectName} keeps every publisher fact while only its exact serving identity changes`,
      );
    }
    const heldStatements = statements.excludedFacts ?? [];
    assert.equal(heldStatements.length, PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS.heldOfficeholderStatementSnapshots);
    assert.deepEqual(
      heldStatements.map((fact) => (fact.record as SourceSnapshot).subjectName).sort(),
      ["Aura Dunn", "Marisa Sweeney", "Tony Bucco"],
      "unmapped intermediary records remain exact held evidence rather than disappearing or attaching by name",
    );
    assert.ok(heldStatements.every((fact) =>
      fact.code === "TRUSTED_LKG_STATEMENT_PERMANENT_IDENTITY_UNRESOLVED" &&
      (fact.record as SourceSnapshot).subjectId.startsWith("plural:")
    ));
    assert.ok(firstSeedEvidence(statements).fixtures.some(({ path }) => path === "lib/funding/official-candidacies.json"));
    const everyday = plan.candidates.find(({ contractId }) => contractId === "everyday-routing")!.candidate;
    const everydayProjection = everyday.readModel as {
      readonly kind: "everyday-routing";
      readonly formatVersion: 1;
      readonly denominator: {
        readonly topics: number;
        readonly zips: number;
        readonly cells: number;
        readonly contactAvailableCells: number;
        readonly unknownContactOwedCells: number;
        readonly contactRecords: number;
        readonly contactSources: number;
      };
      readonly records: readonly {
        readonly id: string;
        readonly kind: "CONTACT" | "CONTACT_OWED";
        readonly topicId: string;
        readonly zip: string;
        readonly contact?: { readonly zips: readonly string[]; readonly sourceUrl: string };
        readonly disposition?: string;
        readonly holdingStatus?: string;
        readonly evidenceSourceUrl?: string;
        readonly reviewedAt?: string;
        readonly reason?: string;
      }[];
    };
    assert.deepEqual(everydayProjection.denominator, {
      topics: PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS.everydayRoutingTopics,
      zips: PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS.everydayRoutingZips,
      cells: PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS.everydayRoutingCells,
      contactAvailableCells: PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS.everydayRoutingContactAvailableCells,
      unknownContactOwedCells: PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS.everydayRoutingContactOwedCells,
      contactRecords: PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS.everydayRoutingContactRecords,
      contactSources: PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS.everydayRoutingContactSources,
    });
    assert.equal(
      everydayProjection.records.length,
      PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS.everydayRoutingContactRecords +
        PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS.everydayRoutingContactOwedCells,
    );
    assert.ok(everydayProjection.records
      .filter((record) => record.kind === "CONTACT")
      .every((record) => record.contact?.zips.length === 1 && record.contact.zips[0] === record.zip));
    assert.ok(everydayProjection.records
      .filter((record) => record.kind === "CONTACT_OWED")
      .every((record) => record.disposition === "UNKNOWN" && record.holdingStatus === "CONTACT_OWED" &&
        /^https:\/\//.test(record.evidenceSourceUrl ?? "") && record.reviewedAt === "2026-08-14" &&
        Boolean(record.reason?.trim())));
    assert.deepEqual(
      firstSeedEvidence(everyday).fixtures.map(({ path }) => path),
      ["lib/routing/everyday.ts"],
      "the first everyday package is derived only from the exact frozen fc67 routing evidence",
    );
    assert.notEqual(
      firstSeedEvidence(everyday).fixtures[0]?.sha256,
      sha256(readFileSync(join(repositoryRoot, "lib", "routing", "everyday.ts"))),
      "the current-worktree typed projection cannot silently replace the divergent frozen evidence",
    );
    const venueProjection = plan.candidates.find(({ contractId }) => contractId === "venue-resolutions")!.candidate
      .readModel as { readonly records: readonly ({ readonly id: string } & VenueEntry)[] };
    assert.equal(venueProjection.records.length, 66, "every exact frozen venue spelling remains represented");
    assert.equal(
      new Set(venueProjection.records.map(({ id }) => id)).size,
      66,
      "exact raw-match content keys keep all frozen venue record ids unique",
    );
    assert.ok(venueProjection.records.every((record) => record.id === venueResolutionRecordId(record)));
    const warnerVariants = venueProjection.records.filter(({ match }) =>
      match === "Town Hall, 5 East Main St. Warner, NH 03278" ||
      match === "Town Hall, 5 East Main St. Warner, NH  03278"
    );
    assert.equal(warnerVariants.length, 2, "both frozen Warner publisher spellings survive independently");
    const projection = venueProjection.records as readonly VenueEntry[];
    const resolvedWarner = warnerVariants.map(({ sourceId, bodyOcdId, match, tenant }) =>
      resolveVenue(sourceId, bodyOcdId, match, tenant ?? null, projection)
    );
    assert.ok(resolvedWarner.every((venue) => venue?.address === "5 East Main Street, Warner, NH 03278"));
    assert.deepEqual(
      resolvedWarner.map((venue) => [venue?.name, venue?.lat, venue?.lng]),
      [
        ["Warner Town Hall", 43.280620022052, -71.815803778788],
        ["Warner Town Hall", 43.280620022052, -71.815803778788],
      ],
      "lookup still normalizes whitespace variants to the same reviewed place",
    );
    const meetingDocuments = plan.candidates
      .filter(({ door }) => door === "MEETING_PARTITION")
      .flatMap(({ candidate }) => (candidate.readModel as MeetingsSnapshot).agendaDocuments);
    const meetingRows = plan.candidates
      .filter(({ door }) => door === "MEETING_PARTITION")
      .flatMap(({ candidate }) => (candidate.readModel as MeetingsSnapshot).meetings);
    const frozenMeetings = JSON.parse(
      readFileSync(join(frozenRoot, "data", "meetings-snapshot.json"), "utf8"),
    ) as MeetingsSnapshot;
    assert.deepEqual(
      [...meetingRows].sort((left, right) => left.id.localeCompare(right.id)),
      [...frozenMeetings.meetings].sort((left, right) => left.id.localeCompare(right.id)),
      "partitioning preserves every field of every one of the 619 frozen civic meeting rows",
    );
    assert.deepEqual(
      [...meetingDocuments].sort((left, right) => left.id.localeCompare(right.id)),
      frozenMeetings.agendaDocuments
        .map(canonicalAgendaDocument)
        .sort((left, right) => left.id.localeCompare(right.id)),
      "partitioning preserves all 196 agenda-document records after the permanent canonical extraction boundary",
    );
    const legacyDocx = meetingDocuments.find(({ id }) => id.includes("00bd2a7b0db7c8323c84768dbc3a1d09b3cb96ff8382540634d0fac9e1e2e616"));
    assert.ok(legacyDocx);
    assert.equal(legacyDocx.text, null);
    assert.equal(legacyDocx.extraction, "failed");
    assert.equal(legacyDocx.contentHash, "00bd2a7b0db7c8323c84768dbc3a1d09b3cb96ff8382540634d0fac9e1e2e616");

    const sourceTarget = plan.candidates[0]!;
    const sourcePointer = {
      key: `${sourceTarget.candidate.recordClass}:${sourceTarget.candidate.scope}`,
      sourceId: sourceTarget.candidate.sourceId,
      recordClass: sourceTarget.candidate.recordClass,
      scope: sourceTarget.candidate.scope,
      versionId: "existing-version",
      lastKnownGoodVersionId: "existing-version",
      promotedAt: IMPORTED_AT,
      payload: sourceTarget.candidate.readModel,
      receipt: {},
    };
    let writesBeforeWrongPointerSource = 0;
    const wrongPointerSourceStore = {
      readPromotion: async (recordClass: string, scope: string) =>
        recordClass === sourceTarget.candidate.recordClass && scope === sourceTarget.candidate.scope
          ? { ...sourcePointer, sourceId: "unexpected-source" }
          : null,
      readCandidate: async () => { throw new Error("candidate read must not precede pointer-source refusal"); },
      create: async () => { writesBeforeWrongPointerSource += 1; },
    } as unknown as RoutineDataStore;
    await assert.rejects(
      executePdcV2TrustedLkgImportPlan(
        wrongPointerSourceStore,
        { ...plan, candidates: [sourceTarget] },
      ),
      /TRUSTED_LKG_EXISTING_POINTER_SOURCE_MISMATCH/,
    );
    assert.equal(writesBeforeWrongPointerSource, 0);

    let writesBeforeWrongCandidateSource = 0;
    const wrongCandidateSourceStore = {
      readPromotion: async (recordClass: string, scope: string) =>
        recordClass === sourceTarget.candidate.recordClass && scope === sourceTarget.candidate.scope
          ? sourcePointer
          : null,
      readCandidate: async () => ({
        candidate: { ...sourceTarget.candidate, sourceId: "unexpected-source" },
        state: "PROMOTED",
        acquisitionSucceeded: true,
        receipt: null,
        promotedVersion: sourcePointer.versionId,
        lastKnownGoodVersion: sourcePointer.versionId,
        failureCode: null,
        failureDetail: null,
      }),
      create: async () => { writesBeforeWrongCandidateSource += 1; },
    } as unknown as RoutineDataStore;
    await assert.rejects(
      executePdcV2TrustedLkgImportPlan(
        wrongCandidateSourceStore,
        { ...plan, candidates: [sourceTarget] },
      ),
      /TRUSTED_LKG_EXISTING_CANDIDATE_SOURCE_MISMATCH/,
    );
    assert.equal(writesBeforeWrongCandidateSource, 0);

    const corruptTarget = plan.candidates.at(-1)!;
    let writesBeforePreflightFailure = 0;
    const corruptStore = {
      readPromotion: async (recordClass: string, scope: string) =>
        recordClass === corruptTarget.candidate.recordClass && scope === corruptTarget.candidate.scope
          ? {
              key: `${recordClass}:${scope}`,
              sourceId: corruptTarget.candidate.sourceId,
              recordClass,
              scope,
              versionId: "missing-existing-version",
              lastKnownGoodVersionId: "missing-existing-version",
              promotedAt: IMPORTED_AT,
              payload: corruptTarget.candidate.readModel,
              receipt: {},
            }
          : null,
      readCandidate: async () => null,
      create: async () => { writesBeforePreflightFailure += 1; },
    } as unknown as RoutineDataStore;
    await assert.rejects(
      executePdcV2TrustedLkgImportPlan(corruptStore, plan),
      /TRUSTED_LKG_CANDIDATE_READBACK_MISSING/,
    );
    assert.equal(writesBeforePreflightFailure, 0, "every existing authority is proved before the first write");

    const legacyNormalizationStore = new CountingMemoryRoutineDataStore();
    const legacyNormalizationId = await seedLegacyMeetingsAggregate(legacyNormalizationStore, plan);
    const legacyNormalizationInternal = legacyNormalizationStore as unknown as {
      candidates: Map<string, CandidateVersionRecord>;
    };
    const legacyNormalizationRow = structuredClone(
      legacyNormalizationInternal.candidates.get(legacyNormalizationId)!,
    );
    const {
      normalizedPayloadHash: legacyNormalizedPayloadHash,
      ...prePayloadHashNormalization
    } = legacyNormalizationRow.candidate.normalization;
    assert.match(legacyNormalizedPayloadHash ?? "", /^[a-f0-9]{64}$/);
    legacyNormalizationInternal.candidates.set(legacyNormalizationId, {
      ...legacyNormalizationRow,
      candidate: {
        ...legacyNormalizationRow.candidate,
        normalization: prePayloadHashNormalization,
      },
    });
    legacyNormalizationStore.createCalls = 0;
    const legacyNormalizationImport = await executePdcV2PermanentCutoverImportPlan(
      legacyNormalizationStore,
      plan,
      CONTRACT_MIGRATION_SQL,
    );
    assert.equal(legacyNormalizationImport.promoted, PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS.totalCandidates);
    assert.equal(
      await legacyNormalizationStore.readPromotion("MEETING", "supported-bodies"),
      null,
      "the exact pre-field legacy aggregate can be proved and retired without weakening permanent candidates",
    );
    releaseMemoryRoutineDataStore(legacyNormalizationStore);

    const forgedLegacyNormalizationStore = new CountingMemoryRoutineDataStore();
    const forgedLegacyNormalizationId = await seedLegacyMeetingsAggregate(forgedLegacyNormalizationStore, plan);
    const forgedLegacyNormalizationInternal = forgedLegacyNormalizationStore as unknown as {
      candidates: Map<string, CandidateVersionRecord>;
    };
    const forgedLegacyNormalizationRow = structuredClone(
      forgedLegacyNormalizationInternal.candidates.get(forgedLegacyNormalizationId)!,
    );
    const {
      normalizedPayloadHash: forgedPayloadHash,
      ...forgedPrePayloadHashNormalization
    } = forgedLegacyNormalizationRow.candidate.normalization;
    assert.match(forgedPayloadHash ?? "", /^[a-f0-9]{64}$/);
    forgedLegacyNormalizationInternal.candidates.set(forgedLegacyNormalizationId, {
      ...forgedLegacyNormalizationRow,
      candidate: {
        ...forgedLegacyNormalizationRow.candidate,
        normalization: forgedPrePayloadHashNormalization,
        normalizedPayload: {
          ...(forgedLegacyNormalizationRow.candidate.normalizedPayload as MeetingsSnapshot),
          meetings: [],
        },
      },
    });
    forgedLegacyNormalizationStore.createCalls = 0;
    await assert.rejects(
      executePdcV2PermanentCutoverImportPlan(
        forgedLegacyNormalizationStore,
        plan,
        CONTRACT_MIGRATION_SQL,
      ),
      /TRUSTED_LKG_LEGACY_MEETINGS_PROOF_INVALID:the candidate normalized evidence does not match its durable payload hash/,
      "a missing historical field cannot excuse changed normalized facts",
    );
    assert.equal(
      forgedLegacyNormalizationStore.createCalls,
      0,
      "the forged old-schema legacy row refuses before the first import write",
    );
    releaseMemoryRoutineDataStore(forgedLegacyNormalizationStore);

    const truncatedTerminalPlan = { ...plan, candidates: plan.candidates.slice(1) };
    assert.match(pdcV2PermanentCutoverPlanIssue(truncatedTerminalPlan) ?? "", /denominator/);
    const truncatedStore = new CountingMemoryRoutineDataStore();
    await assert.rejects(
      executePdcV2PermanentCutoverImportPlan(
        truncatedStore,
        truncatedTerminalPlan,
        CONTRACT_MIGRATION_SQL,
      ),
      /TRUSTED_LKG_PERMANENT_CUTOVER_PLAN_REFUSED/,
    );
    assert.equal(truncatedStore.preContractGateCalls, 0, "the full denominator is checked before opening admission");
    assert.equal(truncatedStore.createCalls, 0);
    releaseMemoryRoutineDataStore(truncatedStore);

    const preContractRefusal = new RefusePreContractStore();
    await seedLegacyMeetingsAggregate(preContractRefusal, plan);
    preContractRefusal.createCalls = 0;
    await assert.rejects(
      executePdcV2PermanentCutoverImportPlan(
        preContractRefusal,
        plan,
        CONTRACT_MIGRATION_SQL,
      ),
      /PLANTED_PRECONTRACT_SCHEMA_REFUSAL/,
    );
    assert.equal(preContractRefusal.createCalls, 0, "0026 presence/partial-DDL refuses before import writes");
    assert.ok(await preContractRefusal.readPromotion("MEETING", "supported-bodies"));
    releaseMemoryRoutineDataStore(preContractRefusal);

    const preImportRefusal = new RefusePreImportIntegrityStore();
    await seedLegacyMeetingsAggregate(preImportRefusal, plan);
    preImportRefusal.createCalls = 0;
    await assert.rejects(
      executePdcV2PermanentCutoverImportPlan(
        preImportRefusal,
        plan,
        CONTRACT_MIGRATION_SQL,
      ),
      /PLANTED_PREIMPORT_GLOBAL_INTEGRITY_REFUSAL/,
    );
    assert.equal(preImportRefusal.createCalls, 0, "global 0026 compatibility is proved before first import write");
    assert.ok(await preImportRefusal.readPromotion("MEETING", "supported-bodies"));
    releaseMemoryRoutineDataStore(preImportRefusal);

    const weakenedMigrationStore = new CountingMemoryRoutineDataStore();
    await seedLegacyMeetingsAggregate(weakenedMigrationStore, plan);
    weakenedMigrationStore.createCalls = 0;
    await assert.rejects(
      executePdcV2PermanentCutoverImportPlan(
        weakenedMigrationStore,
        plan,
        CONTRACT_MIGRATION_SQL.replaceAll("$pdc_authority_transfer$", "$removed_gate$"),
      ),
      /PDC_V2_CONTRACT_MIGRATION_TEXT_INVALID/,
    );
    assert.equal(weakenedMigrationStore.createCalls, 0, "a weakened migration preflight cannot precede a partial import");
    assert.ok(await weakenedMigrationStore.readPromotion("MEETING", "supported-bodies"));
    releaseMemoryRoutineDataStore(weakenedMigrationStore);

    const payloadDriftStore = new DriftLegacyPayloadAtRetirementStore();
    await seedLegacyMeetingsAggregate(payloadDriftStore, plan);
    payloadDriftStore.createCalls = 0;
    await assert.rejects(
      executePdcV2PermanentCutoverImportPlan(
        payloadDriftStore,
        plan,
        CONTRACT_MIGRATION_SQL,
      ),
      /PDC_V2_LEGACY_MEETINGS_PAYLOAD_CHANGED_BEFORE_RETIREMENT/,
      "the legacy fact re-read immediately before deletion must catch a TOCTOU payload change",
    );
    assert.ok(
      await payloadDriftStore.readPromotion("MEETING", "supported-bodies"),
      "a changed legacy payload cannot be deleted",
    );
    const payloadDriftPromotions = (payloadDriftStore as unknown as {
      promotions: Map<string, PromotedProjection>;
    }).promotions;
    const liveLegacyBeforeRetirement = structuredClone(
      payloadDriftPromotions.get("MEETING:supported-bodies")!,
    );
    payloadDriftPromotions.set("MEETING:planted-rogue-legacy-key", {
      ...liveLegacyBeforeRetirement,
      key: "MEETING:planted-rogue-legacy-key",
    });
    assert.ok(payloadDriftStore.lastRetirementInput);
    await assert.rejects(
      payloadDriftStore.retirePdcV2LegacyMeetingsAggregate(payloadDriftStore.lastRetirementInput),
      /PDC_V2_LEGACY_MEETINGS_POINTER_IDENTITY_INVALID:2/,
      "a rogue-key row claiming the legacy class/scope blocks first retirement",
    );
    payloadDriftPromotions.delete("MEETING:planted-rogue-legacy-key");
    releaseMemoryRoutineDataStore(payloadDriftStore);

    const candidateDriftStore = new DriftLegacyCandidateAtRetirementStore();
    await seedLegacyMeetingsAggregate(candidateDriftStore, plan);
    candidateDriftStore.createCalls = 0;
    await assert.rejects(
      executePdcV2PermanentCutoverImportPlan(
        candidateDriftStore,
        plan,
        CONTRACT_MIGRATION_SQL,
      ),
      /PDC_V2_LEGACY_MEETINGS_PAYLOAD_CHANGED_BEFORE_RETIREMENT:live legacy pointer is not the exact retained candidate/,
      "retirement binds the full admitted legacy candidate row, not only its unchanged Reader facts",
    );
    assert.ok(await candidateDriftStore.readPromotion("MEETING", "supported-bodies"));
    releaseMemoryRoutineDataStore(candidateDriftStore);

    const meetingPlansForDrift = plan.candidates.filter(({ door }) =>
      door === "MEETING_PARTITION"
    );
    const divergentPlan = meetingPlansForDrift.find(({ candidate }) => {
      const snapshot = candidate.readModel as MeetingsSnapshot;
      return snapshot.meetings.length > 1 && snapshot.meetings.some((meeting) =>
        !meeting.carried && snapshot.agendaDocuments.some(({ meetingId }) => meetingId === meeting.id)
      );
    });
    assert.ok(divergentPlan, "the frozen denominator has a multi-row partition with a documented fresh meeting");
    const divergentPlanSnapshot = divergentPlan.candidate.readModel as MeetingsSnapshot;
    const divergentMeeting = divergentPlanSnapshot.meetings.find((meeting) =>
      !meeting.carried && divergentPlanSnapshot.agendaDocuments.some(({ meetingId }) => meetingId === meeting.id)
    );
    assert.ok(divergentMeeting);
    const removedDocumentCount = divergentPlanSnapshot.agendaDocuments.filter(
      ({ meetingId }) => meetingId === divergentMeeting.id,
    ).length;
    const divergentStore = new CountingMemoryRoutineDataStore();
    await seedLegacyMeetingsAggregate(
      divergentStore,
      plan,
      (snapshot) => legacySnapshotWithoutMeeting(snapshot, divergentMeeting.id),
    );
    const divergentLegacy = await divergentStore.readPromotion<MeetingsSnapshot>(
      "MEETING",
      "supported-bodies",
    );
    assert.ok(divergentLegacy);
    const divergentLegacyFacts = pdcV2CanonicalMeetingFactEvidence([divergentLegacy.payload]);
    assert.equal(divergentLegacyFacts.meetingRowCount, plan.meetingRows - 1);
    assert.equal(
      divergentLegacyFacts.agendaDocumentRowCount,
      plan.agendaDocumentRows - removedDocumentCount,
    );
    divergentStore.createCalls = 0;
    const divergentImport = await executePdcV2PermanentCutoverImportPlan(
      divergentStore,
      plan,
      CONTRACT_MIGRATION_SQL,
    );
    assert.equal(divergentImport.promoted, PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS.totalCandidates);
    assert.equal(
      divergentImport.legacyMeetingsAggregateRetirement.legacyMeetingFactSha256,
      divergentLegacyFacts.sha256,
      "retirement binds the exact live aggregate instead of the stale fc67 meeting fact set",
    );
    assert.equal(
      divergentImport.legacyMeetingsAggregateRetirement.meetingRowCount,
      divergentLegacyFacts.meetingRowCount,
    );
    assert.equal(
      divergentImport.legacyMeetingsAggregateRetirement.agendaDocumentRowCount,
      divergentLegacyFacts.agendaDocumentRowCount,
    );
    assert.ok(divergentStore.lastRetirementInput);
    const divergentReplacementFacts = pdcV2CanonicalMeetingFactEvidence(
      divergentStore.lastRetirementInput.replacementPointers.map(({ payload }) => payload),
    );
    assert.deepEqual(divergentReplacementFacts, divergentLegacyFacts);
    const divergentRows = await Promise.all(
      divergentStore.lastRetirementInput.replacementPointers.map(({ versionId }) =>
        divergentStore.readCandidate(versionId)
      ),
    );
    const divergentOrigins = divergentRows.map((row) => {
      assert.ok(row);
      const evidence = firstSeedEvidence(row.candidate);
      assert.ok(evidence.legacyMeetingsPartition);
      assert.deepEqual(evidence.fixtures, []);
      return evidence.legacyMeetingsPartition;
    });
    assert.equal(divergentOrigins.length, PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS.meetingPartitionsWithLkg);
    assert.ok(divergentOrigins.every((origin) =>
      origin.legacyMeetingFactSha256 === divergentLegacyFacts.sha256 &&
      origin.legacyMeetingRowCount === divergentLegacyFacts.meetingRowCount &&
      origin.legacyAgendaDocumentRowCount === divergentLegacyFacts.agendaDocumentRowCount &&
      origin.legacyHistoryEventCount === origin.legacyHistoryLastSequence
    ));
    const provenanceCandidate = divergentRows[0]!.candidate;
    const provenanceEvidence = firstSeedEvidence(provenanceCandidate);
    const forgedProvenanceCandidate: RoutineCandidate = {
      ...provenanceCandidate,
      bootstrapImport: {
        ...provenanceEvidence,
        legacyMeetingsPartition: {
          ...provenanceEvidence.legacyMeetingsPartition!,
          partitionFactSha256: "0".repeat(64),
        },
      },
    };
    assert.match(
      trustedLkgImportEvidenceIssue(forgedProvenanceCandidate) ?? "",
      /partition fact digest is invalid/,
      "a syntactically valid but false durable-origin partition digest is refused",
    );
    releaseMemoryRoutineDataStore(divergentStore);

    const toctouStore = new DriftLegacyBeforeFirstWriteStore();
    await seedLegacyMeetingsAggregate(toctouStore, plan);
    toctouStore.createCalls = 0;
    await assert.rejects(
      executePdcV2PermanentCutoverImportPlan(toctouStore, plan, CONTRACT_MIGRATION_SQL),
      /TRUSTED_LKG_LEGACY_MEETINGS_CHANGED_BEFORE_FIRST_WRITE/,
      "the exact legacy witness is re-proved after the global gate and before the first create",
    );
    assert.equal(toctouStore.createCalls, 0);
    assert.ok(await toctouStore.readPromotion("MEETING", "supported-bodies"));
    releaseMemoryRoutineDataStore(toctouStore);

    const sameFactSwapStore = new SwapLegacyVersionAfterFirstWriteStore();
    const admittedLegacyVersionId = await seedLegacyMeetingsAggregate(sameFactSwapStore, plan);
    const admittedLegacyRow = await sameFactSwapStore.readCandidate(admittedLegacyVersionId);
    assert.ok(admittedLegacyRow);
    const {
      changeSet: _legacyChangeSet,
      ...legacySuccessorBase
    } = admittedLegacyRow.candidate;
    const sameFactLegacySuccessor: RoutineCandidate = {
      ...legacySuccessorBase,
      id: "cv-pdc-v2-legacy-meetings-same-fact-successor",
      retrieval: {
        ...legacySuccessorBase.retrieval,
        retrievedAt: "2026-09-09T11:30:00.000Z",
      },
    };
    sameFactSwapStore.configureLegacySuccessor(
      admittedLegacyVersionId,
      sameFactLegacySuccessor,
    );
    sameFactSwapStore.createCalls = 0;
    await assert.rejects(
      executePdcV2PermanentCutoverImportPlan(
        sameFactSwapStore,
        plan,
        CONTRACT_MIGRATION_SQL,
      ),
      /TRUSTED_LKG_LEGACY_MEETINGS_CHANGED_BEFORE_RETIREMENT/,
      "a same-fact legacy successor after the last prewrite witness cannot be retired as the admitted version",
    );
    assert.equal(
      (await sameFactSwapStore.readPromotion("MEETING", "supported-bodies"))?.versionId,
      sameFactLegacySuccessor.id,
      "the non-admitted successor remains authoritative after retirement refusal",
    );
    const createsAfterSameFactRefusal = sameFactSwapStore.createCalls;
    await assert.rejects(
      executePdcV2PermanentCutoverImportPlan(
        sameFactSwapStore,
        plan,
        CONTRACT_MIGRATION_SQL,
      ),
      /TRUSTED_LKG_EXISTING_MEETING_LEGACY_ORIGIN_MISMATCH:/,
      "retry cannot mix already-promoted A-origin partitions with the current B-origin overlay",
    );
    assert.equal(
      sameFactSwapStore.createCalls,
      createsAfterSameFactRefusal,
      "mixed-origin retry refuses before creating another candidate or retiring B",
    );
    assert.equal(
      (await sameFactSwapStore.readPromotion("MEETING", "supported-bodies"))?.versionId,
      sameFactLegacySuccessor.id,
    );

    let dynamicContract: (typeof MEETING_PARTITION_CONTRACTS)[number] | null = null;
    let dynamicPointer: PromotedProjection | null = null;
    let dynamicPredecessor: CandidateVersionRecord | null = null;
    for (const contract of MEETING_PARTITION_CONTRACTS) {
      const pointer = await sameFactSwapStore.readPromotion("MEETING", contract.scope);
      const predecessor = pointer
        ? await sameFactSwapStore.readCandidate(pointer.versionId)
        : null;
      const evidence = predecessor?.candidate.bootstrapImport;
      if (evidence?.kind === "TRUSTED_LKG_IMPORT" && evidence.legacyMeetingsPartition) {
        dynamicContract = contract;
        dynamicPointer = pointer;
        dynamicPredecessor = predecessor;
        break;
      }
    }
    assert.ok(dynamicContract && dynamicPointer && dynamicPredecessor);
    const dynamicImportEvidence = dynamicPredecessor.candidate.bootstrapImport;
    assert.equal(dynamicImportEvidence?.kind, "TRUSTED_LKG_IMPORT");
    if (dynamicImportEvidence?.kind !== "TRUSTED_LKG_IMPORT") {
      assert.fail("the one-level origin test requires a dynamic import predecessor");
    }
    const dynamicReattestationId = "meetings-public-bodies:planted-one-level-reattestation";
    const dynamicReattestationEvidence = {
      contractVersion: 1 as const,
      kind: "TRUSTED_LKG_REATTESTATION" as const,
      authorization: "PDC_V2_FROZEN_LKG_CUTOVER" as const,
      purpose: "RE_ATTEST_EXISTING_DURABLE_LKG_TO_PERMANENT_INTEGRITY_CONTRACT" as const,
      sourceAuthenticated: false as const,
      contractId: dynamicContract.id,
      sourceId: dynamicContract.sourceId,
      recordClass: "MEETING" as const,
      scope: dynamicContract.scope,
      parserVersion: dynamicContract.parserNormalizerVersion,
      sourceVersion: dynamicPredecessor.candidate.temporal.version,
      sourceThrough: dynamicPredecessor.candidate.temporal.sourceThrough,
      sourceRetrievedAt: dynamicPredecessor.candidate.retrieval.retrievedAt,
      reattestedAt: LATER,
      importerCodeSha: IMPORTER_SHA,
      predecessorVersionId: dynamicPredecessor.candidate.id,
      predecessorPromotedAt: dynamicPointer.promotedAt,
      predecessorPointerSha256: sha256(canonicalCivicDataJson(dynamicPointer)),
      predecessorCandidateRecordSha256: trustedLkgPredecessorRecordSha256(dynamicPredecessor),
      predecessorCandidateSha256: sha256(canonicalCivicDataJson(dynamicPredecessor.candidate)),
      predecessorReceiptSha256: sha256(canonicalCivicDataJson(dynamicPredecessor.receipt)),
      predecessorPayloadSha256: sha256(canonicalCivicDataJson(dynamicPointer.payload)),
      predecessorReadModelSha256: dynamicImportEvidence.readModelSha256,
      predecessorNormalizedPayloadSha256: dynamicImportEvidence.normalizedPayloadSha256,
      predecessorLegacyNormalizedHash: dynamicPredecessor.candidate.normalization.normalizedHash!,
      normalizedPayloadSha256: dynamicImportEvidence.normalizedPayloadSha256,
      readModelSha256: dynamicImportEvidence.readModelSha256,
      candidateEnvelopeSha256: "0".repeat(64),
      validatorIds: dynamicImportEvidence.validatorIds,
    };
    assert.equal(
      dynamicReattestationEvidence.predecessorCandidateRecordSha256,
      trustedLkgPredecessorRecordSha256(dynamicPredecessor),
      "the one-level lookup is bound to the exact claimed predecessor record",
    );
    const dynamicReattestationReceipt = {
      ...dynamicPredecessor.receipt!,
      candidateId: dynamicReattestationId,
    };
    const dynamicInternals = sameFactSwapStore as unknown as {
      candidates: Map<string, CandidateVersionRecord>;
      history: Map<string, CandidateEvent[]>;
      promotions: Map<string, PromotedProjection>;
    };
    dynamicInternals.candidates.set(dynamicReattestationId, {
      ...structuredClone(dynamicPredecessor),
      candidate: {
        ...structuredClone(dynamicPredecessor.candidate),
        id: dynamicReattestationId,
        bootstrapImport: dynamicReattestationEvidence,
      },
      receipt: dynamicReattestationReceipt,
      promotedVersion: dynamicReattestationId,
      lastKnownGoodVersion: dynamicReattestationId,
    });
    dynamicInternals.history.set(dynamicReattestationId, []);
    dynamicInternals.promotions.set(dynamicPointer.key, {
      ...structuredClone(dynamicPointer),
      versionId: dynamicReattestationId,
      lastKnownGoodVersionId: dynamicReattestationId,
      receipt: dynamicReattestationReceipt,
    });
    const createsBeforeOneLevelRetry = sameFactSwapStore.createCalls;
    await assert.rejects(
      executePdcV2PermanentCutoverImportPlan(
        sameFactSwapStore,
        plan,
        CONTRACT_MIGRATION_SQL,
      ),
      (error: unknown) => error instanceof Error &&
        error.message === `TRUSTED_LKG_EXISTING_MEETING_LEGACY_ORIGIN_MISMATCH:${dynamicContract.id}`,
      "a hash-proved one-level re-attestation predecessor cannot hide its mismatched A origin",
    );
    assert.equal(
      sameFactSwapStore.createCalls,
      createsBeforeOneLevelRetry,
      "one-level mixed-origin refusal happens before another import write",
    );
    assert.equal(
      (await sameFactSwapStore.readPromotion("MEETING", dynamicContract.scope))?.versionId,
      dynamicReattestationId,
    );
    assert.equal(
      (await sameFactSwapStore.readPromotion("MEETING", "supported-bodies"))?.versionId,
      sameFactLegacySuccessor.id,
    );
    releaseMemoryRoutineDataStore(sameFactSwapStore);

    const allFailedFresh = {
      ...structuredClone(divergentPlanSnapshot),
      sources: divergentPlanSnapshot.sources.map((source) => ({
        ...structuredClone(source),
        ok: false,
        error: source.error ?? "planted all-failed source",
      })),
    };
    assert.throws(
      () => validateSnapshot(allFailedFresh, {
        allowAllSourcesFailedForDurableTransfer: true,
      }),
      /every source failed.*all-carried durable LKG/,
      "the transfer exception never admits fresh rows under an all-failed source envelope",
    );
    const carriedBySource = new Map<string, number>();
    const honestlyCarriedMeetings = divergentPlanSnapshot.meetings.map((meeting) => {
      const source = meeting.id.slice(0, meeting.id.indexOf(":"));
      carriedBySource.set(source, (carriedBySource.get(source) ?? 0) + 1);
      return {
        ...structuredClone(meeting),
        carried: {
          source,
          lastFreshAt: meeting.provenance?.collectedAt ?? divergentPlanSnapshot.generatedAt,
          reason: "SOURCE_UNAVAILABLE" as const,
        },
      };
    });
    const accountedCarriedSources = new Set<string>();
    const honestlyCarriedPartition: MeetingsSnapshot = {
      ...structuredClone(divergentPlanSnapshot),
      counts: {
        fresh: 0,
        carried: honestlyCarriedMeetings.length,
        total: honestlyCarriedMeetings.length,
        duplicatesCollapsed: 0,
      },
      sources: divergentPlanSnapshot.sources.map((source) => {
        const firstReport = !accountedCarriedSources.has(source.source);
        accountedCarriedSources.add(source.source);
        return {
          ...structuredClone(source),
          ok: false,
          error: source.error ?? "planted durable source outage",
          fetched: 0,
          normalized: 0,
          carriedForward: firstReport ? (carriedBySource.get(source.source) ?? 0) : 0,
        };
      }),
      meetings: honestlyCarriedMeetings,
    };
    assert.doesNotThrow(
      () => validateSnapshot(honestlyCarriedPartition, {
        allowAllSourcesFailedForDurableTransfer: true,
      }),
      "a nonempty failed-source/all-carried durable LKG retains its outage evidence",
    );

    const singletonPlan = meetingPlansForDrift.find(({ candidate }) =>
      (candidate.readModel as MeetingsSnapshot).meetings.length === 1
    );
    assert.ok(singletonPlan, "the frozen denominator has a singleton meeting partition");
    const singletonMeetingId = (singletonPlan.candidate.readModel as MeetingsSnapshot).meetings[0]!.id;
    const invalidMembershipStore = new CountingMemoryRoutineDataStore();
    await seedLegacyMeetingsAggregate(
      invalidMembershipStore,
      plan,
      (snapshot) => legacySnapshotWithoutMeeting(snapshot, singletonMeetingId),
    );
    invalidMembershipStore.createCalls = 0;
    await assert.rejects(
      executePdcV2PermanentCutoverImportPlan(
        invalidMembershipStore,
        plan,
        CONTRACT_MIGRATION_SQL,
      ),
      /TRUSTED_LKG_CURRENT_MEETING_PARTITION_DENOMINATOR_MISMATCH:82\/42/,
      "current facts may vary, but the admitted 83/41 partition membership may not",
    );
    assert.equal(invalidMembershipStore.createCalls, 0);
    assert.ok(await invalidMembershipStore.readPromotion("MEETING", "supported-bodies"));
    releaseMemoryRoutineDataStore(invalidMembershipStore);

    const store = new CountingMemoryRoutineDataStore();
    const legacyVersionId = await seedLegacyMeetingsAggregate(store, plan);
    store.createCalls = 0;
    store.terminalOrder.length = 0;
    store.assertRetirementProofReadOnly = true;
    assert.equal(pdcV2PermanentCutoverPlanIssue(plan), null);
    const first = await executePdcV2PermanentCutoverImportPlan(
      store,
      plan,
      CONTRACT_MIGRATION_SQL,
    );
    store.assertRetirementProofReadOnly = false;
    assert.equal(first.promoted, PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS.totalCandidates);
    assert.equal(first.skippedExisting, 0);
    assert.equal(first.zeroMeetingPartitionsRefused, PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS.meetingPartitionsWithoutLkg);
    assert.equal(store.createCalls, PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS.totalCandidates);
    assert.equal(store.preContractGateCalls, 1);
    assert.equal(store.preImportIntegrityGateCalls, 1);
    assert.equal(store.finalMigrationPreflightCalls, 1);
    assert.deepEqual(store.prospectiveReattestationSets, [[]]);
    const firstCreate = store.terminalOrder.indexOf("CREATE");
    assert.ok(store.terminalOrder.indexOf("PRE_CONTRACT_SCHEMA") < firstCreate);
    assert.ok(store.terminalOrder.indexOf("PRE_IMPORT_GLOBAL_INTEGRITY") < firstCreate);
    assert.ok(
      store.terminalOrder.indexOf("POST_IMPORT_GLOBAL_INTEGRITY") >
        store.terminalOrder.lastIndexOf("CREATE"),
    );
    assert.ok(
      store.terminalOrder.indexOf("POST_IMPORT_GLOBAL_INTEGRITY") <
        store.terminalOrder.lastIndexOf("RETIRE_LEGACY_AGGREGATE"),
    );
    assert.equal(first.legacyMeetingsAggregateRetirement.disposition, "RETIRED");
    assert.equal(first.legacyMeetingsAggregateRetirement.legacyVersionId, legacyVersionId);
    const retirementEvidence = JSON.parse(
      first.legacyMeetingsAggregateRetirement.detail.slice(
        PDC_V2_LEGACY_MEETINGS_RETIREMENT_PREFIX.length,
      ),
    ) as { readonly replacementHistoryWitnesses?: readonly {
      readonly historyEventCount?: number;
      readonly historyLastSequence?: number;
    }[] };
    assert.equal(retirementEvidence.replacementHistoryWitnesses?.length, 83);
    assert.ok(retirementEvidence.replacementHistoryWitnesses?.every((witness) =>
      witness.historyEventCount === 5 && witness.historyLastSequence === 5
    ));
    assert.equal(
      await store.readPromotion("MEETING", "supported-bodies"),
      null,
      "the obsolete aggregate authority is deleted only after permanent replacement proof",
    );
    assert.ok(first.dispositions.every(({ disposition, readerReadback }) =>
      disposition === "PROMOTED_ABSENT_POINTER" && readerReadback === "PASS"
    ));
    assert.ok(store.lastRetirementInput);
    const replacementHistoryLengthsAtRetirement = new Map(
      await Promise.all(store.lastRetirementInput.replacementPointers.map(async ({ versionId }) => [
        versionId,
        (await store.events(versionId)).length,
      ] as const)),
    );
    assert.ok([...replacementHistoryLengthsAtRetirement.values()].every((count) => count === 5));
    const registryRead = await readRegistryRuntimeProjection({ store, bypassCache: true, now: IMPORTED_AT });
    const statementRead = await readOfficeholderStatementsProjection({ store, bypassCache: true, now: IMPORTED_AT });
    assert.equal(registryRead.kind, "PROMOTED");
    assert.equal(statementRead.kind, "PROMOTED");
    const karenStatement = readerPositionsFor(
      "roster:merrimack-delegation#5",
      "Hampshire",
      statementRead.value,
    );
    assert.equal(karenStatement.kind, "MATCHED");
    assert.ok(karenStatement.passages.some(({ canonicalSubjectId }) =>
      canonicalSubjectId === "ballot-nh-merrimack:state-house-merrimack-7:ebel-karen-elizabeth"
    ));
    assert.ok(karenStatement.passages.every(({ canonicalSubjectId }) => !canonicalSubjectId.startsWith("plural:")));

    const second = await executePdcV2PermanentCutoverImportPlan(
      store,
      plan,
      CONTRACT_MIGRATION_SQL,
    );
    assert.equal(second.promoted, 0);
    assert.equal(second.skippedExisting, PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS.totalCandidates);
    assert.equal(
      store.createCalls,
      PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS.totalCandidates,
      "a repeated run creates no new candidates while repairing Reader proof",
    );
    assert.equal(second.legacyMeetingsAggregateRetirement.disposition, "ALREADY_RETIRED_PROVEN");
    assert.equal(store.preContractGateCalls, 2);
    assert.equal(store.preImportIntegrityGateCalls, 2);
    assert.equal(store.finalMigrationPreflightCalls, 2);
    assert.ok(second.dispositions.every(({ disposition }) => disposition === "SKIPPED_EXISTING_PROVEN_AUTHORITY"));
    for (const { versionId } of store.lastRetirementInput!.replacementPointers) {
      const history = await store.events(versionId);
      assert.equal(
        history.length,
        replacementHistoryLengthsAtRetirement.get(versionId)! + 1,
        "replay may append one attested Reader PASS after the exact retirement prefix",
      );
      const suffix = parseReaderProjectionReadback(history.at(-1)!.detail);
      assert.equal(suffix?.status, "PASS");
      assert.equal(suffix?.verifierCodeSha, IMPORTER_SHA);
    }

    const provenRetirementInput = store.lastRetirementInput;
    assert.ok(provenRetirementInput);
    await assert.rejects(
      store.retirePdcV2LegacyMeetingsAggregate({
        ...provenRetirementInput,
        allPermanentPartitionScopes: provenRetirementInput.allPermanentPartitionScopes.slice(1),
      }),
      /PDC_V2_LEGACY_MEETINGS_RETIREMENT_INPUT_INVALID/,
      "a caller-supplied subset cannot redefine the permanent meeting denominator",
    );
    const eightyTwoReplacementPointers = provenRetirementInput.replacementPointers.slice(1);
    await assert.rejects(
      store.retirePdcV2LegacyMeetingsAggregate({
        ...provenRetirementInput,
        expected: {
          ...provenRetirementInput.expected,
          replacementPointerSha256: createHash("sha256")
            .update(canonicalCivicDataJson(eightyTwoReplacementPointers))
            .digest("hex"),
          replacementPartitionCount: 82,
          absentPartitionCount: 42,
        },
        replacementPointers: eightyTwoReplacementPointers,
      }),
      /PDC_V2_LEGACY_MEETINGS_RETIREMENT_INPUT_INVALID/,
      "the destructive door itself refuses an internally consistent 82/42 denominator",
    );

    const retirementTarget = provenRetirementInput.replacementPointers[0]!;
    const internalStore = store as unknown as {
      candidates: Map<string, CandidateVersionRecord>;
      history: Map<string, CandidateEvent[]>;
      promotions: Map<string, PromotedProjection>;
    };
    const postBoundaryHistory = await store.events(retirementTarget.versionId);
    const postBoundaryTemplate = parseReaderProjectionReadback(postBoundaryHistory.at(-1)!.detail);
    assert.ok(postBoundaryTemplate);
    await store.appendEvidence(
      retirementTarget.versionId,
      "PROMOTED",
      LATER,
      serializeReaderProjectionReadback({
        ...postBoundaryTemplate,
        observedAt: LATER,
        detail: "Attested Reader PASS appended after the persisted retirement boundary.",
      }),
    );
    const laterReplay = await store.retirePdcV2LegacyMeetingsAggregate({
      ...provenRetirementInput,
      retiredAt: "2026-09-09T14:00:00.000Z",
    });
    assert.equal(laterReplay.disposition, "ALREADY_RETIRED_PROVEN");

    const exactCandidate = structuredClone(internalStore.candidates.get(retirementTarget.versionId)!);
    assert.ok(exactCandidate.receipt);
    internalStore.candidates.set(retirementTarget.versionId, {
      ...exactCandidate,
      receipt: { ...exactCandidate.receipt, candidateId: "planted-wrong-candidate" },
    });
    await assert.rejects(
      store.retirePdcV2LegacyMeetingsAggregate(provenRetirementInput),
      /PDC_V2_LEGACY_MEETINGS_REPLACEMENT_DENOMINATOR_INVALID:candidate/,
      "post-retirement replay must re-prove the exact durable candidate receipt",
    );
    internalStore.candidates.set(retirementTarget.versionId, exactCandidate);

    const exactHistory = structuredClone(internalStore.history.get(retirementTarget.versionId)!);
    internalStore.history.set(
      retirementTarget.versionId,
      exactHistory.filter(({ state }) => state !== "VALIDATED"),
    );
    await assert.rejects(
      store.retirePdcV2LegacyMeetingsAggregate(provenRetirementInput),
      /PDC_V2_LEGACY_MEETINGS_REPLACEMENT_DENOMINATOR_INVALID:candidate/,
      "post-retirement replay must re-prove contiguous VALIDATED-to-PROMOTED history",
    );
    internalStore.history.set(retirementTarget.versionId, exactHistory);

    const replacementHistoryDetailDrift = structuredClone(exactHistory);
    replacementHistoryDetailDrift[0] = {
      ...replacementHistoryDetailDrift[0]!,
      detail: `${replacementHistoryDetailDrift[0]!.detail} planted replay drift`,
    };
    internalStore.history.set(retirementTarget.versionId, replacementHistoryDetailDrift);
    await assert.rejects(
      store.retirePdcV2LegacyMeetingsAggregate(provenRetirementInput),
      /PDC_V2_LEGACY_MEETINGS_REPLACEMENT_DENOMINATOR_INVALID:replacement durable history prefix differs from retirement receipt/,
      "post-retirement replay binds every replacement's exact pre-retirement event details",
    );
    internalStore.history.set(retirementTarget.versionId, exactHistory);

    const exactSuffixEvent = exactHistory.at(-1)!;
    const exactSuffixReceipt = parseReaderProjectionReadback(exactSuffixEvent.detail);
    assert.ok(exactSuffixReceipt);
    const wrongImporterSuffix = structuredClone(exactHistory);
    wrongImporterSuffix[wrongImporterSuffix.length - 1] = {
      ...exactSuffixEvent,
      detail: serializeReaderProjectionReadback({
        ...exactSuffixReceipt,
        verifierCodeSha: "b".repeat(40),
      }),
    };
    internalStore.history.set(retirementTarget.versionId, wrongImporterSuffix);
    await assert.rejects(
      store.retirePdcV2LegacyMeetingsAggregate(provenRetirementInput),
      /PDC_V2_LEGACY_MEETINGS_REPLACEMENT_DENOMINATOR_INVALID:replacement post-retirement history is not an exact importer Reader PASS/,
      "post-retirement Reader evidence must name the attested importer code",
    );

    const failedThenPassingSuffix = structuredClone(exactHistory);
    failedThenPassingSuffix[failedThenPassingSuffix.length - 1] = {
      ...exactSuffixEvent,
      detail: serializeReaderProjectionReadback({
        ...exactSuffixReceipt,
        status: "FAIL",
        detail: "planted failed post-retirement observation",
      }),
    };
    failedThenPassingSuffix.push({
      ...exactSuffixEvent,
      sequence: exactSuffixEvent.sequence + 1,
      detail: serializeReaderProjectionReadback({
        ...exactSuffixReceipt,
        detail: "planted later passing observation",
      }),
    });
    internalStore.history.set(retirementTarget.versionId, failedThenPassingSuffix);
    await assert.rejects(
      store.retirePdcV2LegacyMeetingsAggregate(provenRetirementInput),
      /PDC_V2_LEGACY_MEETINGS_REPLACEMENT_DENOMINATOR_INVALID:replacement post-retirement history is not an exact importer Reader PASS/,
      "a later PASS cannot hide a failed event in the post-retirement suffix",
    );

    const backdatedSuffix = structuredClone(exactHistory);
    const backdatedAt = new Date(Date.parse(provenRetirementInput.retiredAt) - 1).toISOString();
    backdatedSuffix[backdatedSuffix.length - 1] = {
      ...exactSuffixEvent,
      at: backdatedAt,
      detail: serializeReaderProjectionReadback({
        ...exactSuffixReceipt,
        observedAt: backdatedAt,
      }),
    };
    internalStore.history.set(retirementTarget.versionId, backdatedSuffix);
    await assert.rejects(
      store.retirePdcV2LegacyMeetingsAggregate(provenRetirementInput),
      /PDC_V2_LEGACY_MEETINGS_REPLACEMENT_DENOMINATOR_INVALID:candidate .* non-contiguous or invalid durable history/,
      "post-retirement Reader evidence cannot be backdated into the admitted prefix",
    );
    internalStore.history.set(retirementTarget.versionId, exactHistory);

    const exactPointerKey = `MEETING:${retirementTarget.scope}`;
    const exactPointer = structuredClone(internalStore.promotions.get(exactPointerKey)!);
    internalStore.promotions.set("MEETING:planted-rogue-legacy-key", {
      ...exactPointer,
      key: "MEETING:planted-rogue-legacy-key",
      scope: "supported-bodies",
    });
    await assert.rejects(
      store.retirePdcV2LegacyMeetingsAggregate(provenRetirementInput),
      /PDC_V2_LEGACY_MEETINGS_PAYLOAD_CHANGED_BEFORE_RETIREMENT/,
      "a rogue-key row claiming the retired class/scope cannot coexist with replay proof",
    );
    internalStore.promotions.delete("MEETING:planted-rogue-legacy-key");

    internalStore.promotions.set(exactPointerKey, {
      ...exactPointer,
      receipt: { ...exactPointer.receipt, candidateId: "planted-wrong-pointer-receipt" },
    });
    await assert.rejects(
      store.retirePdcV2LegacyMeetingsAggregate(provenRetirementInput),
      /PDC_V2_LEGACY_MEETINGS_REPLACEMENT_DENOMINATOR_INVALID:pointer/,
      "post-retirement replay must re-prove the exact pointer receipt",
    );
    internalStore.promotions.set(exactPointerKey, exactPointer);

    const unexpectedScope = "source:planted:body:unregistered";
    internalStore.promotions.set(`MEETING:${unexpectedScope}`, {
      ...exactPointer,
      key: `MEETING:${unexpectedScope}`,
      scope: unexpectedScope,
    });
    await assert.rejects(
      store.retirePdcV2LegacyMeetingsAggregate(provenRetirementInput),
      /PDC_V2_LEGACY_MEETINGS_REPLACEMENT_DENOMINATOR_INVALID:expected/,
      "an unregistered meeting pointer cannot hide outside the claimed replacement set",
    );
    internalStore.promotions.delete(`MEETING:${unexpectedScope}`);

    await assert.rejects(
      store.retirePdcV2LegacyMeetingsAggregate({
        ...provenRetirementInput,
        expected: {
          ...provenRetirementInput.expected,
          meetingRowCount: provenRetirementInput.expected.meetingRowCount + 1,
        },
      }),
      /PDC_V2_LEGACY_MEETINGS_REPLACEMENT_DENOMINATOR_INVALID:permanent replacement facts/,
      "caller-declared counts cannot replace recomputation from exact retained facts",
    );

    const exactLegacyCandidate = structuredClone(internalStore.candidates.get(legacyVersionId)!);
    internalStore.candidates.set(legacyVersionId, {
      ...exactLegacyCandidate,
      candidate: {
        ...exactLegacyCandidate.candidate,
        readModel: { meetings: [], agendaDocuments: [] },
      },
    });
    await assert.rejects(
      store.retirePdcV2LegacyMeetingsAggregate(provenRetirementInput),
      /PDC_V2_LEGACY_MEETINGS_RETAINED_EVIDENCE_INVALID:retained legacy candidate facts/,
      "replay recomputes the retained legacy fact digest and row counts",
    );
    internalStore.candidates.set(legacyVersionId, exactLegacyCandidate);

    const exactLegacyHistory = structuredClone(internalStore.history.get(legacyVersionId)!);
    const legacyHistoryDetailDrift = structuredClone(exactLegacyHistory);
    legacyHistoryDetailDrift[0] = {
      ...legacyHistoryDetailDrift[0]!,
      detail: `${legacyHistoryDetailDrift[0]!.detail} planted replay drift`,
    };
    internalStore.history.set(legacyVersionId, legacyHistoryDetailDrift);
    await assert.rejects(
      store.retirePdcV2LegacyMeetingsAggregate(provenRetirementInput),
      /PDC_V2_LEGACY_MEETINGS_RETAINED_EVIDENCE_INVALID:retained legacy authority differs from the exact pre-retirement witness/,
      "post-retirement replay binds the exact admitted legacy history rather than same-fact structure",
    );
    internalStore.history.set(legacyVersionId, exactLegacyHistory);

    internalStore.history.set(
      legacyVersionId,
      exactLegacyHistory.filter(({ state }) => state !== "VALIDATED"),
    );
    await assert.rejects(
      store.retirePdcV2LegacyMeetingsAggregate(provenRetirementInput),
      /PDC_V2_LEGACY_MEETINGS_RETAINED_EVIDENCE_INVALID:retained legacy candidate history/,
      "replay recomputes contiguous retained legacy history through the retirement receipt",
    );
    internalStore.history.set(legacyVersionId, exactLegacyHistory);

    const unrelatedPlan = plan.candidates.find(({ door }) => door === "MANUAL")!;
    const unrelatedHistory = structuredClone(internalStore.history.get(unrelatedPlan.candidate.id)!);
    const exactRetirementEvent = exactLegacyHistory.at(-1)!;
    assert.match(exactRetirementEvent.detail, new RegExp(`^${PDC_V2_LEGACY_MEETINGS_RETIREMENT_PREFIX}`));
    const forgedEvidence = JSON.parse(
      exactRetirementEvent.detail.slice(PDC_V2_LEGACY_MEETINGS_RETIREMENT_PREFIX.length),
    ) as Record<string, unknown>;
    forgedEvidence.legacyVersionId = unrelatedPlan.candidate.id;
    internalStore.history.set(legacyVersionId, exactLegacyHistory.slice(0, -1));
    internalStore.history.set(unrelatedPlan.candidate.id, [
      ...unrelatedHistory,
      {
        candidateId: unrelatedPlan.candidate.id,
        sequence: unrelatedHistory.length + 1,
        state: "PROMOTED",
        at: exactRetirementEvent.at,
        detail: `${PDC_V2_LEGACY_MEETINGS_RETIREMENT_PREFIX}${JSON.stringify(forgedEvidence)}`,
      },
    ]);
    await assert.rejects(
      store.retirePdcV2LegacyMeetingsAggregate(provenRetirementInput),
      /PDC_V2_LEGACY_MEETINGS_RETAINED_EVIDENCE_INVALID:retained legacy candidate identity/,
      "a self-consistent retirement detail on an unrelated candidate is not authority evidence",
    );
    internalStore.history.set(legacyVersionId, exactLegacyHistory);
    internalStore.history.set(unrelatedPlan.candidate.id, unrelatedHistory);

    const mutableHistory = (store as unknown as {
      history: Map<string, Array<{
        candidateId: string;
        sequence: number;
        state: "PROMOTED";
        at: string;
        detail: string;
      }>>;
    }).history;
    const legacyHistory = mutableHistory.get(legacyVersionId);
    assert.ok(legacyHistory);
    legacyHistory.push({
      candidateId: legacyVersionId,
      sequence: legacyHistory.length + 1,
      state: "PROMOTED",
      at: LATER,
      detail: `${PDC_V2_LEGACY_MEETINGS_RETIREMENT_PREFIX}{}`,
    });
    await assert.rejects(
      executePdcV2PermanentCutoverImportPlan(store, plan, CONTRACT_MIGRATION_SQL),
      /PDC_V2_LEGACY_MEETINGS_RETIREMENT_RECEIPT_INVALID:2:1/,
      "one exact retirement receipt plus a malformed prefix collision must fail closed",
    );
    legacyHistory.pop();

    const laterPlan = await buildPdcV2TrustedLkgImportPlan({ ...options, importedAt: LATER });

    // Simulate a pointer appearing after the importer's absent-pointer scan.
    // The registered meeting door's expected-null compare refuses overwrite.
    const laterMeeting = laterPlan.candidates.find(({ door }) => door === "MEETING_PARTITION")!;
    const originalPointer = await store.readPromotion(laterMeeting.candidate.recordClass, laterMeeting.candidate.scope);
    const raced = await processRegisteredMeetingPartitionCandidate(
      store,
      laterMeeting.contractId,
      laterMeeting.candidate,
      LATER,
      null,
    );
    assert.equal(raced.promoted, null);
    assert.equal(raced.candidate.failureCode, "PROMOTION_BASE_CHANGED");
    assert.equal(
      (await store.readPromotion(laterMeeting.candidate.recordClass, laterMeeting.candidate.scope))?.versionId,
      originalPointer?.versionId,
    );
    releaseMemoryRoutineDataStore(store);

    // A process can die after some old-invocation pointers are durable. A
    // later invocation has different content-addressed candidate IDs; the
    // terminal receipt must bind the actual mixed pointer set, retain the
    // orphaned evidence, and retire the aggregate exactly once.
    const terminalInterruptedStore = new InterruptAfterCreateStore();
    await seedLegacyMeetingsAggregate(terminalInterruptedStore, plan);
    terminalInterruptedStore.createCalls = 0;
    terminalInterruptedStore.terminalOrder.length = 0;
    await assert.rejects(
      executePdcV2PermanentCutoverImportPlan(
        terminalInterruptedStore,
        plan,
        CONTRACT_MIGRATION_SQL,
      ),
      /SIMULATED_PROCESS_INTERRUPTION_AFTER_DURABLE_CREATE/,
    );
    assert.ok(
      await terminalInterruptedStore.readPromotion("MEETING", "supported-bodies"),
      "interruption before global post-import proof cannot retire the legacy LKG",
    );
    const firstCompletedContract = MEETING_PARTITION_CONTRACTS.find(({ id }) =>
      plan.candidates.some(({ contractId }) => contractId === id)
    );
    assert.ok(firstCompletedContract);
    const firstCompletedPointer = await terminalInterruptedStore.readPromotion(
      firstCompletedContract.recordClass,
      firstCompletedContract.scope,
    );
    assert.ok(firstCompletedPointer);
    const firstCompletedRow = await terminalInterruptedStore.readCandidate(
      firstCompletedPointer.versionId,
    );
    assert.ok(firstCompletedRow);
    assert.ok(
      firstCompletedRow.candidate.bootstrapImport?.kind === "TRUSTED_LKG_IMPORT" &&
      firstCompletedRow.candidate.bootstrapImport.legacyMeetingsPartition,
      "the interrupted pointer is the exact current-legacy overlay, not the stale frozen candidate",
    );
    const mixedCompletion = await executePdcV2PermanentCutoverImportPlan(
      terminalInterruptedStore,
      laterPlan,
      CONTRACT_MIGRATION_SQL,
    );
    assert.equal(mixedCompletion.legacyMeetingsAggregateRetirement.disposition, "RETIRED");
    assert.equal(await terminalInterruptedStore.readPromotion("MEETING", "supported-bodies"), null);
    assert.equal(
      terminalInterruptedStore.createCalls,
      PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS.totalCandidates + 1,
      "one completed old version, one orphan, and every remaining later version remain durable",
    );
    const permanentMeetingPointers = await terminalInterruptedStore.readPromotions(
      "MEETING",
      laterPlan.meetingPartitionIdsWithLkg.map((id) => requiredMeetingPartitionContract(id).scope),
    );
    assert.ok(permanentMeetingPointers.some(({ versionId }) =>
      versionId === firstCompletedPointer.versionId
    ));
    const laterOverlayPointers = await Promise.all(
      permanentMeetingPointers
        .filter(({ versionId }) => versionId !== firstCompletedPointer.versionId)
        .map(({ versionId }) => terminalInterruptedStore.readCandidate(versionId)),
    );
    assert.ok(laterOverlayPointers.some((row) =>
      row?.candidate.bootstrapImport?.kind === "TRUSTED_LKG_IMPORT" &&
      row.candidate.bootstrapImport.importedAt === LATER &&
      row.candidate.bootstrapImport.legacyMeetingsPartition !== undefined
    ));
    const mixedReplay = await executePdcV2PermanentCutoverImportPlan(
      terminalInterruptedStore,
      laterPlan,
      CONTRACT_MIGRATION_SQL,
    );
    assert.equal(mixedReplay.legacyMeetingsAggregateRetirement.disposition, "ALREADY_RETIRED_PROVEN");
    assert.equal(
      terminalInterruptedStore.createCalls,
      PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS.totalCandidates + 1,
    );
    releaseMemoryRoutineDataStore(terminalInterruptedStore);

    const partialContractIds = plan.candidates.slice(0, 3).map(({ contractId }) => contractId);
    const interruptedPlan: PdcV2TrustedLkgImportPlan = { ...plan, candidates: plan.candidates.slice(0, 3) };
    const retryPlan: PdcV2TrustedLkgImportPlan = {
      ...laterPlan,
      candidates: laterPlan.candidates.filter(({ contractId }) => partialContractIds.includes(contractId)),
    };
    const interruptedStore = new InterruptAfterCreateStore();
    await assert.rejects(
      executePdcV2TrustedLkgImportPlan(interruptedStore, interruptedPlan),
      /SIMULATED_PROCESS_INTERRUPTION_AFTER_DURABLE_CREATE/,
    );
    assert.equal(interruptedStore.createCalls, 2, "one authority promoted and the next candidate receipt was durable at interruption");
    const [completedBeforeInterruption, orphanedAtInterruption] = interruptedPlan.candidates;
    assert.ok(await interruptedStore.readPromotion(
      completedBeforeInterruption!.candidate.recordClass,
      completedBeforeInterruption!.candidate.scope,
    ));
    assert.equal(await interruptedStore.readPromotion(
      orphanedAtInterruption!.candidate.recordClass,
      orphanedAtInterruption!.candidate.scope,
    ), null);
    assert.equal(
      (await interruptedStore.readCandidate(orphanedAtInterruption!.candidate.id))?.state,
      "FETCHED",
      "the interrupted candidate remains durable evidence without becoming authority",
    );
    const resumed = await executePdcV2TrustedLkgImportPlan(interruptedStore, retryPlan);
    assert.equal(resumed.skippedExisting, 1);
    assert.equal(resumed.promoted, 2);
    assert.equal(interruptedStore.createCalls, 4, "the orphaned attempt is retained and a new invocation safely finishes missing pointers");
    const resumedReplay = await executePdcV2TrustedLkgImportPlan(interruptedStore, retryPlan);
    assert.equal(resumedReplay.promoted, 0);
    assert.equal(resumedReplay.skippedExisting, 3);
    assert.equal(interruptedStore.createCalls, 4);
    releaseMemoryRoutineDataStore(interruptedStore);

    // Candidate + pointer promotion is atomic, but the typed Reader receipt is
    // necessarily appended next. A process death in that seam leaves valid
    // authority live; replay repairs only its receipt and never rewrites it.
    const readbackPlan: PdcV2TrustedLkgImportPlan = { ...plan, candidates: plan.candidates.slice(0, 1) };
    const readbackInterruptedStore = new InterruptFirstReaderReadbackStore();
    await assert.rejects(
      executePdcV2TrustedLkgImportPlan(readbackInterruptedStore, readbackPlan),
      /SIMULATED_PROCESS_INTERRUPTION_AFTER_POINTER_BEFORE_READER_RECEIPT/,
    );
    const readbackCandidate = readbackPlan.candidates[0]!;
    const promotedBeforeReceipt = await readbackInterruptedStore.readPromotion(
      readbackCandidate.candidate.recordClass,
      readbackCandidate.candidate.scope,
    );
    assert.equal(promotedBeforeReceipt?.versionId, readbackCandidate.candidate.id);
    assert.equal(readbackInterruptedStore.createCalls, 1);
    const repairedReadback = await executePdcV2TrustedLkgImportPlan(readbackInterruptedStore, readbackPlan);
    assert.equal(repairedReadback.promoted, 0);
    assert.equal(repairedReadback.skippedExisting, 1);
    assert.equal(readbackInterruptedStore.createCalls, 1, "receipt repair does not recreate or move authority");
    assert.equal(readbackInterruptedStore.successfulReaderReadbacks, 1);
    const repairedReplay = await executePdcV2TrustedLkgImportPlan(readbackInterruptedStore, readbackPlan);
    assert.equal(repairedReplay.promoted, 0);
    assert.equal(repairedReplay.skippedExisting, 1);
    assert.equal(readbackInterruptedStore.createCalls, 1);
    assert.equal(readbackInterruptedStore.successfulReaderReadbacks, 1, "a current exact-code PASS receipt is idempotent");
    releaseMemoryRoutineDataStore(readbackInterruptedStore);

    // A source-authenticated registered promotion has the same atomic-pointer /
    // appended-Reader-receipt seam. The importer must not label that existing
    // authority PASS based only on an ephemeral read; replay durably repairs it
    // without replacing it with the frozen bootstrap candidate.
    const runtimeTarget = plan.candidates.find(({ door }) => door === "MEETING_PARTITION")!;
    const runtimeContract = requiredMeetingPartitionContract(runtimeTarget.contractId);
    const runtimeSnapshot = runtimeTarget.candidate.readModel as MeetingsSnapshot;
    const runtimeUrl = runtimeSnapshot.meetings[0]?.provenance?.sourceUrl;
    assert.ok(runtimeUrl);
    assert.ok(runtimeTarget.candidate.retrieval.rawHash);
    const runtimeCandidate = meetingsCandidate({
      snapshot: {
        ...runtimeSnapshot,
        sources: runtimeSnapshot.sources.map(({ error, ...source }) => ({
          ...source,
          ...(error ? { error } : {}),
        })),
      },
      partition: {
        sourceName: runtimeContract.meetingSource,
        bodyId: runtimeContract.bodyId,
        scope: runtimeContract.scope,
      },
      requestedUrl: runtimeUrl,
      finalUrl: runtimeUrl,
      retrievedAt: IMPORTED_AT,
      acquisitionRawHash: runtimeTarget.candidate.retrieval.rawHash,
    });
    const runtimeReadbackInterruptedStore = new InterruptFirstReaderReadbackStore();
    await assert.rejects(
      processRegisteredMeetingPartitionCandidate(
        runtimeReadbackInterruptedStore,
        runtimeTarget.contractId,
        runtimeCandidate,
        IMPORTED_AT,
        null,
      ),
      /SIMULATED_PROCESS_INTERRUPTION_AFTER_POINTER_BEFORE_READER_RECEIPT/,
    );
    const runtimePointerBeforeRepair = await runtimeReadbackInterruptedStore.readPromotion(
      runtimeCandidate.recordClass,
      runtimeCandidate.scope,
    );
    assert.equal(runtimePointerBeforeRepair?.versionId, runtimeCandidate.id);
    const repairedRuntimeReadback = await executePdcV2TrustedLkgImportPlan(
      runtimeReadbackInterruptedStore,
      { ...plan, candidates: [runtimeTarget] },
    );
    assert.equal(repairedRuntimeReadback.promoted, 0);
    assert.equal(repairedRuntimeReadback.skippedExisting, 1);
    assert.equal(repairedRuntimeReadback.dispositions[0]?.versionId, runtimeCandidate.id);
    assert.equal(runtimeReadbackInterruptedStore.createCalls, 1, "runtime authority is not rewritten by receipt repair");
    assert.equal(runtimeReadbackInterruptedStore.successfulReaderReadbacks, 1);
    assert.equal(
      (await runtimeReadbackInterruptedStore.readPromotion(runtimeCandidate.recordClass, runtimeCandidate.scope))?.versionId,
      runtimeCandidate.id,
    );
    releaseMemoryRoutineDataStore(runtimeReadbackInterruptedStore);

  });
});

function assertManualReaderMemberCoverage(plan: PdcV2TrustedLkgImportPlan): void {
  assert.equal(AUDITED_MANUAL_READER_COLLECTION_PATHS.length, 30);
  assert.equal(AUDITED_MANUAL_READER_SCALAR_PATHS.length, 12);
  assert.equal(AUDITED_NON_CIVIC_METADATA_PATHS.length, 23);

  const required = (contractId: string): RoutineCandidate => {
    const candidate = plan.candidates.find((row) => row.contractId === contractId)?.candidate;
    assert.ok(candidate, `${contractId} is in the trusted import plan`);
    return candidate;
  };
  const members = (contractId: string) => required(contractId).civicRecords ?? [];
  const member = (contractId: string, key: string): unknown => {
    const found = members(contractId).find((row) => row.key === key);
    assert.ok(found, `${contractId} exposes ${key} to exact Admin deltas`);
    return found.record;
  };
  const prefixCount = (contractId: string, prefix: string): number =>
    members(contractId).filter(({ key }) => key.startsWith(prefix)).length;

  const registry = required("registry-runtime-bindings").readModel as {
    registry: { divisions: readonly unknown[]; bodies: readonly unknown[]; generatedAt: string };
    bodyRosters: readonly unknown[];
    rosterReaderDispositions: readonly unknown[];
    statewideExecutives: readonly unknown[];
    officialCandidacies: { rows: readonly unknown[] };
    officialPhotos: { photos: readonly unknown[] };
    rosterPhotos: Readonly<Record<string, unknown>>;
  };
  assert.equal(prefixCount("registry-runtime-bindings", "division:"), registry.registry.divisions.length);
  assert.equal(prefixCount("registry-runtime-bindings", "body:"), registry.registry.bodies.length);
  assert.equal(prefixCount("registry-runtime-bindings", "body-roster:"), registry.bodyRosters.length);
  assert.equal(prefixCount("registry-runtime-bindings", "roster-disposition:"), registry.rosterReaderDispositions.length);
  assert.equal(prefixCount("registry-runtime-bindings", "statewide-executive:"), registry.statewideExecutives.length);
  assert.equal(prefixCount("registry-runtime-bindings", "official-candidacy:"), registry.officialCandidacies.rows.length);
  assert.equal(prefixCount("registry-runtime-bindings", "official-photo:"), registry.officialPhotos.photos.length);
  assert.equal(prefixCount("registry-runtime-bindings", "roster-photo:"), Object.keys(registry.rosterPhotos).length);
  assert.equal(
    members("registry-runtime-bindings").length,
    registry.registry.divisions.length + registry.registry.bodies.length + registry.bodyRosters.length +
      registry.rosterReaderDispositions.length + registry.statewideExecutives.length +
      registry.officialCandidacies.rows.length + registry.officialPhotos.photos.length + Object.keys(registry.rosterPhotos).length,
  );
  const jsonbReorderedRegistry = structuredClone(registry);
  jsonbReorderedRegistry.rosterPhotos = Object.fromEntries(
    Object.entries(jsonbReorderedRegistry.rosterPhotos).reverse(),
  );
  assert.deepEqual(
    civicRecordsFor("REGISTRY_RUNTIME_BINDING", jsonbReorderedRegistry),
    members("registry-runtime-bindings"),
    "the frozen registry candidate retains exact member order after JSONB object-key reordering",
  );

  const candidateProfiles = required("candidate-profiles").readModel as {
    cards: { cards: Readonly<Record<string, unknown>>; hunts: readonly unknown[] };
    links: { links: Readonly<Record<string, unknown>>; hunts: readonly unknown[] };
  };
  const jsonbReorderedCandidateProfiles = structuredClone(candidateProfiles);
  jsonbReorderedCandidateProfiles.cards.cards = Object.fromEntries(
    Object.entries(jsonbReorderedCandidateProfiles.cards.cards).reverse(),
  );
  jsonbReorderedCandidateProfiles.links.links = Object.fromEntries(
    Object.entries(jsonbReorderedCandidateProfiles.links.links).reverse(),
  );
  assert.deepEqual(
    civicRecordsFor("CANDIDATE_PROFILE", jsonbReorderedCandidateProfiles),
    members("candidate-profiles"),
    "the frozen candidate-profile candidate retains exact member order after JSONB object-key reordering",
  );

  const rolls = required("congress-rollcalls").readModel as {
    snapshot: {
      congress: number;
      session: number;
      generatedAt: string;
      window: unknown;
      identifierMatch: unknown;
      votes: readonly unknown[];
      positions: readonly unknown[];
    };
    billSummaries: { note?: string; summaries: Readonly<Record<string, unknown>>; pending: readonly unknown[] };
  };
  assert.equal(prefixCount("congress-rollcalls", "roll:"), rolls.snapshot.votes.length);
  assert.equal(prefixCount("congress-rollcalls", "position:"), rolls.snapshot.positions.length);
  assert.equal(prefixCount("congress-rollcalls", "bill-summary:http"), Object.keys(rolls.billSummaries.summaries).length);
  assert.equal(prefixCount("congress-rollcalls", "bill-summary-pending:"), rolls.billSummaries.pending.length);
  assert.deepEqual(member("congress-rollcalls", "projection:roll-window"), {
    congress: rolls.snapshot.congress,
    session: rolls.snapshot.session,
    window: rolls.snapshot.window,
    identifierMatch: rolls.snapshot.identifierMatch,
  });
  assert.equal(member("congress-rollcalls", "projection:bill-summary-note"), rolls.billSummaries.note ?? null);
  assert.equal(
    members("congress-rollcalls").length,
    rolls.snapshot.votes.length + rolls.snapshot.positions.length + Object.keys(rolls.billSummaries.summaries).length +
      rolls.billSummaries.pending.length + 2,
  );

  const keyVotes = required("federal-key-votes").readModel as {
    snapshot: { criteria: string; entries: readonly unknown[]; misses: readonly unknown[]; lawMisses?: readonly unknown[] };
    positions: { note?: string; positions: Readonly<Record<string, unknown>>; retiredMappings?: unknown };
  };
  assert.equal(prefixCount("federal-key-votes", "entry:"), keyVotes.snapshot.entries.length);
  assert.equal(prefixCount("federal-key-votes", "selection-miss:"), keyVotes.snapshot.misses.length);
  assert.equal(prefixCount("federal-key-votes", "law-miss:"), keyVotes.snapshot.lawMisses?.length ?? 0);
  assert.equal(prefixCount("federal-key-votes", "positions:"), Object.keys(keyVotes.positions.positions).length);
  assert.equal(member("federal-key-votes", "projection:selection-criteria"), keyVotes.snapshot.criteria);
  assert.equal(member("federal-key-votes", "projection:position-coverage-note"), keyVotes.positions.note ?? null);
  assert.equal(
    members("federal-key-votes").length,
    keyVotes.snapshot.entries.length + keyVotes.snapshot.misses.length + (keyVotes.snapshot.lawMisses?.length ?? 0) +
      Object.keys(keyVotes.positions.positions).length + 2,
  );

  const profiles = required("candidate-profiles").readModel as {
    cards: { cards: Readonly<Record<string, unknown>>; hunts: readonly unknown[] };
    links: { links: Readonly<Record<string, unknown>>; hunts: readonly unknown[] };
  };
  assert.equal(prefixCount("candidate-profiles", "card:"), Object.keys(profiles.cards.cards).length);
  assert.equal(prefixCount("candidate-profiles", "card-hunt:"), profiles.cards.hunts.length);
  assert.equal(prefixCount("candidate-profiles", "links:"), Object.keys(profiles.links.links).length);
  assert.equal(prefixCount("candidate-profiles", "link-hunt:"), profiles.links.hunts.length);
  assert.equal(
    members("candidate-profiles").length,
    Object.keys(profiles.cards.cards).length + profiles.cards.hunts.length +
      Object.keys(profiles.links.links).length + profiles.links.hunts.length,
  );

  const corpus = required("candidate-corpus").readModel as {
    attempted: number;
    documents: readonly unknown[];
    failures: readonly unknown[];
  };
  assert.equal(prefixCount("candidate-corpus", "document:"), corpus.documents.length);
  assert.equal(prefixCount("candidate-corpus", "failure:"), corpus.failures.length);
  assert.equal(member("candidate-corpus", "projection:attempted-candidate-denominator"), corpus.attempted);
  assert.equal(members("candidate-corpus").length, corpus.documents.length + corpus.failures.length + 1);

  const statements = required("officeholder-statements").readModel as { snapshots: readonly unknown[] };
  assert.equal(prefixCount("officeholder-statements", "statement:"), statements.snapshots.length);
  assert.equal(members("officeholder-statements").length, statements.snapshots.length);

  const actions = required("az-official-actions").readModel as {
    note: unknown;
    source: unknown;
    denominator: unknown;
    legislative: { openRoutes?: readonly unknown[] } | null;
    actions: readonly unknown[];
  };
  assert.equal(prefixCount("az-official-actions", "action:"), actions.actions.length);
  assert.equal(member("az-official-actions", "projection:note"), actions.note);
  assert.deepEqual(member("az-official-actions", "projection:source"), actions.source);
  assert.deepEqual(member("az-official-actions", "projection:denominator:executive"), actions.denominator);
  assert.deepEqual(member("az-official-actions", "projection:denominator:legislative"), actions.legislative);
  assert.ok(actions.legislative && Array.isArray(actions.legislative.openRoutes));
  assert.equal(members("az-official-actions").length, actions.actions.length + 4);

  for (const contractId of ["comment-access", "ballot-navigation", "campaign-sites", "venue-resolutions", "everyday-routing"] as const) {
    const payload = required(contractId).readModel as { records: readonly unknown[] };
    assert.equal(prefixCount(contractId, "curated-reader:"), payload.records.length);
    assert.equal(members(contractId).length, payload.records.length);
  }

  const changed = (contractId: string, readModel: unknown) => {
    const candidate = required(contractId);
    return candidateChangeSet({
      ...candidate,
      readModel,
      civicRecords: civicRecordsFor(candidate.recordClass, readModel),
    }, candidate.readModel);
  };
  const asObject = (value: unknown): Record<string, unknown> => {
    assert.ok(value !== null && typeof value === "object" && !Array.isArray(value));
    return value as Record<string, unknown>;
  };

  const rollServing = asObject(structuredClone(required("congress-rollcalls").readModel));
  asObject(rollServing.snapshot).congress = Number(asObject(rollServing.snapshot).congress) + 1;
  assert.deepEqual(changed("congress-rollcalls", rollServing).changed.map(({ key }) => key), ["projection:roll-window"]);
  const rollOperational = asObject(structuredClone(required("congress-rollcalls").readModel));
  asObject(rollOperational.snapshot).generatedAt = LATER;
  assert.equal(changed("congress-rollcalls", rollOperational).outcome, "UNCHANGED");

  const keyServing = asObject(structuredClone(required("federal-key-votes").readModel));
  asObject(keyServing.snapshot).criteria = `${String(asObject(keyServing.snapshot).criteria)} audit`;
  assert.deepEqual(changed("federal-key-votes", keyServing).changed.map(({ key }) => key), ["projection:selection-criteria"]);
  const keyOperational = asObject(structuredClone(required("federal-key-votes").readModel));
  asObject(keyOperational.snapshot).fetchedAt = LATER;
  asObject(keyOperational.positions).fetchedAt = LATER;
  asObject(keyOperational.positions).retiredMappings = { historicalOnly: { "congress:test": "YES" } };
  assert.equal(changed("federal-key-votes", keyOperational).outcome, "UNCHANGED");

  const corpusServing = asObject(structuredClone(required("candidate-corpus").readModel));
  corpusServing.attempted = Number(corpusServing.attempted) + 1;
  assert.deepEqual(changed("candidate-corpus", corpusServing).changed.map(({ key }) => key), ["projection:attempted-candidate-denominator"]);
  const corpusOperational = asObject(structuredClone(required("candidate-corpus").readModel));
  corpusOperational.fetchedAt = LATER;
  assert.equal(changed("candidate-corpus", corpusOperational).outcome, "UNCHANGED");

  const registryOperational = asObject(structuredClone(required("registry-runtime-bindings").readModel));
  asObject(registryOperational.registry).generatedAt = LATER;
  assert.equal(changed("registry-runtime-bindings", registryOperational).outcome, "UNCHANGED");
  const profilesProvenance = asObject(structuredClone(required("candidate-profiles").readModel));
  asObject(profilesProvenance.cards).curatedAt = LATER;
  asObject(profilesProvenance.cards).note = "provenance-only test note";
  asObject(profilesProvenance.links).curatedAt = LATER;
  asObject(profilesProvenance.links).note = "provenance-only test note";
  assert.equal(changed("candidate-profiles", profilesProvenance).outcome, "UNCHANGED");

  const actionServing = asObject(structuredClone(required("az-official-actions").readModel));
  actionServing.note = `${String(actionServing.note)} audit`;
  assert.deepEqual(changed("az-official-actions", actionServing).changed.map(({ key }) => key), ["projection:note"]);
}

function assertPlanDenominator(plan: PdcV2TrustedLkgImportPlan): void {
  assert.equal(plan.frozenBaseSha, PDC_V2_FROZEN_BASE_SHA);
  assert.equal(plan.importerCodeSha, IMPORTER_SHA);
  assert.equal(plan.candidates.length, PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS.totalCandidates);
  assert.equal(
    plan.candidates.filter(({ door }) => door === "MEETING_PARTITION").length,
    PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS.meetingPartitionsWithLkg,
  );
  assert.equal(plan.meetingPartitionIdsWithLkg.length, PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS.meetingPartitionsWithLkg);
  assert.equal(plan.meetingPartitionIdsWithoutLkg.length, PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS.meetingPartitionsWithoutLkg);
  assert.equal(plan.meetingRows, PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS.meetingRows);
  assert.equal(plan.agendaDocumentRows, PDC_V2_TRUSTED_LKG_EXPECTED_COUNTS.meetingAgendaDocumentRows);
  assert.deepEqual(plan.manualContractIds, PDC_V2_TRUSTED_LKG_MANUAL_CONTRACT_IDS);
  assert.equal(new Set(plan.candidates.map(({ contractId }) => contractId)).size, plan.candidates.length);
  assert.equal(
    plan.meetingPartitionIdsWithoutLkg.some((id) => plan.candidates.some(({ contractId }) => contractId === id)),
    false,
    "zero partitions are refused, not installed as source absence",
  );
}
