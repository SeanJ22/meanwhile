import { isRenderable, stateMoneyRecordsForDisplay } from "../funding/state-money-reader.ts";
/**
 * Offline last-mile accounting. This is a diagnostic, never a reader gate or an
 * owner readiness model. Holding, eligibility, projection and observed rendering
 * are separate facts; a declaration/import does not certify the next seam.
 */
import { createHash } from "node:crypto";
import { relocatedImageBytes } from "./evidence-location.ts";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import * as fs from "node:fs";
import { join, posix, resolve, relative, dirname } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { DATASET_FAMILIES, READER_SURFACES, type ReaderSurfaceId } from "./datasets.ts";
import {
  readerPresentationRenewalProblems,
  renewalConsistencyProblems,
  integrationCommitReachable,
  READER_PRESENTATION_RENEWAL_PATH,
  type ReaderPresentationRenewal,
  type ReaderPresentationRenewalFile,
  type ReaderPresentationRenewalFileKind,
  type ReaderPresentationRenewalBehavior,
} from "../control-plane/presentation-renewal.ts";
import { curatedRegistrySeedProblems, CURATED_BODY_SEED, REGISTRY_FIRST_SEED } from "./registry-seed-proof.ts";
import { loadManifestContext, statesFromIdentity, VAULT_PATH, type Dataset, type ManifestContext } from "./manifest.ts";
import { nonRoutineDispositionForTrackedPath } from "../civic-data/non-routine-dispositions.ts";
import { canonicalCivicDataJson } from "../civic-data/changes.ts";
import { photoMayRender } from "../photos/review.ts";
import { officeholderIdentityMayEnterReader } from "../officials/roster-authority.ts";
import { type StateMoneyRecord } from "../funding/state-money.ts";
import { stateMoneyForTarget, stateMoneyReadState } from "../funding/state-snapshot.ts";
import { readerPersonKeys } from "../identity/reader-person.ts";
import { currentExtraction, type CandidateDocument } from "../candidates/corpus.ts";
import {
  currentOfficeholderStatements,
  frozenStatementIdentityTransfer,
  readOfficeholderStatementsProjection,
} from "../corpus/data-plane.ts";
import { projectAutonomousActivity, type AutonomousActivitySnapshot, type AutonomousObligationActivity } from "../control-plane/workers/activity.ts";
import { localFinanceEvidenceFor } from "../ask/local-finance.ts";
import { checkReaderTraces } from "./reader-trace.ts";
import { MEASURE_PROVISIONS, provisionsForContest } from "../ballot/measure-provisions.ts";
import {
  currentBodyRosters,
  projectReaderRoster,
  rosterGapForBody,
  type BodyRoster,
  type RosterReaderDisposition,
} from "../registry/body-rosters.ts";
import { getRegistryRuntimeReadModel } from "../registry/runtime-read-model.ts";
import { CENSUS_PLACEHOLDER_LABELS, isCensusPlaceholderDivision } from "../registry/census-placeholders.ts";
import { agendaDocumentRepresentation, classifyAgendaPublication, readerAgendaDocuments } from "../ask/agenda-publication.ts";
import type { AgendaDocumentLike } from "../routing/agenda-search.ts";
import type { ReaderProofMeetingsExpectedAuthority } from "../meetings/snapshot.ts";
import {
  PDC_NEON_PROJECT_ID,
  PDC_PRODUCTION_BRANCH_ID,
  canonicalNeonEndpointHost,
  readerAuthorityIdentityHash,
  readerExecutionAuthorityArchivedSupportProblems,
  admitReaderExecutionAuthorityArchivedSupport,
} from "./reader-execution-authority.ts";

type ObjectRow = Record<string, unknown>;
const object = (value: unknown): ObjectRow => value !== null && typeof value === "object" && !Array.isArray(value) ? value as ObjectRow : {};
const unique = (values: readonly string[]) => [...new Set(values)].sort();
const string = (value: unknown) => typeof value === "string" ? value : "";
export const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

export function readReaderEvidence(root: string, path: string): Buffer {
  const relocated = relocatedImageBytes(root, path);
  if (relocated) return relocated;
  const actualPath = existsSync(join(root,path)) ? path : `${path}.gz`;
  const bytes = readFileSync(join(root, actualPath));
  return actualPath.endsWith(".gz") ? gunzipSync(bytes) : bytes;
}
function readerEvidenceHashMatches(root:string,path:string,expected:string):boolean {
  try { return sha256(readReaderEvidence(root,path))===expected; } catch { return false; }
}

/** Lossless packaging preserves the original baseline byte hash and JSON. */
export function packReaderEvidence(root: string, path: string): { path: string; originalSha256: string; bytes: number; packedBytes: number } {
  if (!/^docs\/evidence\/reader-last-mile-[a-z0-9-]+\.json$/.test(path)) throw new Error("Only named last-mile JSON evidence can be packed");
  const resolvedRoot = resolve(root);
  const absolute = resolve(root, path);
  if (relative(resolvedRoot, absolute).startsWith("..")) throw new Error("Evidence path escapes the workspace");
  const bytes = readFileSync(absolute);
  const packed = gzipSync(bytes, { level: 9 });
  // Node's deterministic gzip header has zero modification time. Refuse an
  // instrument/runtime which would stamp the archive with the wall clock.
  if (packed.readUInt32LE(4) !== 0 || !gunzipSync(packed).equals(bytes)) throw new Error("Evidence compression was not deterministic and lossless");
  writeFileSync(`${absolute}.gz`, packed);
  if (!gunzipSync(readFileSync(`${absolute}.gz`)).equals(bytes)) throw new Error("Packed evidence readback differs from original");
  const result = { path: `${path}.gz`, originalSha256: sha256(bytes), bytes: bytes.length, packedBytes: packed.length };
  writeFileSync(`${absolute}.pack.json`, `${JSON.stringify({ formatVersion: 1, encoding: "gzip", rule: "Lossless original UTF-8 JSON bytes; zero gzip modification time. The baseline byte hash survives packaging.", ...result, packedSha256: sha256(packed) }, null, 2)}\n`);
  // The checked absolute target is a single evidence file inside this root.
  unlinkSync(absolute);
  return result;
}

export type EligibilityState = "READER_ELIGIBLE" | "STAGED_NOT_ELIGIBLE" | "IDENTITY_UNRESOLVED" | "NOT_READER_ELIGIBLE" | "SOURCE/HOLDING_UNAVAILABLE" | "INTENTIONALLY_NOT_APPLICABLE";
export type DeliveryState = Exclude<EligibilityState, "READER_ELIGIBLE"> | "RENDERED" | "ELIGIBLE_BUT_NOT_RENDERED" | "DELIVERY_UNPROVEN";
export interface EligibilityFacts {
  readonly held: boolean;
  readonly relationship: "CANONICAL_READER_RECORD" | "ACQUISITION_INPUT" | "OPERATIONAL_METADATA";
  readonly identity: "RESOLVED" | "UNRESOLVED" | "NOT_APPLICABLE";
  readonly source: "CANONICAL_READER_SNAPSHOT" | "AUTONOMOUS_STAGING";
  readonly extraction?: string | null;
  readonly validator?: string | null;
  readonly audit?: string | null;
  readonly externalAuthority?: "VERIFIED" | "MISSING";
  readonly promotion?: string | null;
  readonly readerContractAllows?: boolean;
  readonly exactReason?: string;
}
export interface EligibilityDecision { readonly state: EligibilityState; readonly reason: string }

/** Extraction PASS and worker completion are deliberately insufficient inputs. */
export function classifyReaderEligibility(facts: EligibilityFacts): EligibilityDecision {
  if (!facts.held) return { state: "SOURCE/HOLDING_UNAVAILABLE", reason: facts.exactReason ?? "The canonical input is not held; no absence at the publisher is inferred." };
  if (facts.relationship === "OPERATIONAL_METADATA") return { state: "INTENTIONALLY_NOT_APPLICABLE", reason: facts.exactReason ?? "Operational accounting is not a civic fact for the reader." };
  if (facts.identity === "UNRESOLVED") return { state: "IDENTITY_UNRESOLVED", reason: facts.exactReason ?? "Canonical civic identity is unresolved; no record may attach by a guessed name." };
  if (facts.source === "AUTONOMOUS_STAGING") return { state: "STAGED_NOT_ELIGIBLE", reason: facts.exactReason ?? `Autonomous inventory has no canonical reader promotion. Extraction=${facts.extraction ?? "NOT_RECORDED"}; validator=${facts.validator ?? "NOT_RECORDED"}; audit=${facts.audit ?? "NOT_RECORDED"}; external authority=${facts.externalAuthority ?? "MISSING"}; promotion=${facts.promotion ?? "NOT_RECORDED"}.` };
  if (facts.relationship === "ACQUISITION_INPUT") return { state: "STAGED_NOT_ELIGIBLE", reason: facts.exactReason ?? "Acquisition input is not a directly rendered civic record; its eligible normalized projection is inventoried separately." };
  if (facts.readerContractAllows === false) return { state: "NOT_READER_ELIGIBLE", reason: facts.exactReason ?? "The canonical reader selector explicitly withholds this record or fact." };
  return { state: "READER_ELIGIBLE", reason: facts.exactReason ?? "Record belongs to the existing canonical reader contract; no collection-completeness threshold was applied." };
}

export interface CensusRecord {
  readonly auditId: string;
  readonly holdingPath: string;
  readonly pointer: string;
  readonly family: string;
  readonly states: readonly string[];
  readonly canonicalIdentity: readonly string[];
  readonly unit: string;
  readonly eligibility: EligibilityDecision;
  readonly additionalComponents?: readonly string[];
  readonly childDispositions?: readonly { sourceId:string;canonicalId:string|null;state:string;reason:string }[];
}
export interface CensusHolding {
  readonly path: string;
  readonly sha256: string;
  readonly family: string;
  readonly recordCount: number;
  readonly units: Readonly<Record<string, number>>;
  readonly readerEligibleCount: number;
  readonly withheldCount: number;
}
export interface ImportReachability {
  readonly surfacePath: string;
  readonly consumerPath: string;
  readonly reached: boolean;
  readonly path: readonly string[];
}
/** A readback is a measured record universe, not a prose assertion of success. */
export interface ReaderDeliveryProof {
  readonly rowId: string;
  readonly exactHead: string;
  readonly source: "rendered-browser" | "executed-route" | "rendered-component";
  readonly evidencePath: string;
  readonly evidenceSha256: string;
  /** Audit IDs of all eligible records applicable to this exercised scope. */
  readonly expectedRecordIds: readonly string[];
  readonly renderedRecordIds: readonly string[];
  readonly actualIdentities: Readonly<Record<string, readonly string[]>>;
  readonly statedCount: number;
  readonly returnedCount: number;
  readonly scope: string;
  readonly surfaceWitnesses?: readonly { readonly component: string; readonly evidencePath: string; readonly evidenceSha256: string; readonly exactHead: string; readonly screenshots?: readonly { readonly path: string; readonly sha256: string }[] }[];
  readonly deployedBundle?: { readonly evidencePath: string; readonly evidenceSha256: string; readonly exactHead: string; readonly holdingPaths: readonly string[] };
}
export interface CensusRow {
  readonly id: string;
  readonly datasetFamily: string;
  readonly state: string;
  readonly jurisdiction: string;
  readonly relationship: string;
  readonly holdingPaths: readonly string[];
  readonly readerSurface: ReaderSurfaceId;
  readonly consumerPaths: readonly string[];
  readonly consumerReachability: readonly ImportReachability[];
  readonly canonicalIdentityExpected: readonly string[];
  readonly canonicalIdentityByRecord: Readonly<Record<string, readonly string[]>>;
  readonly actualIdentityUsed: Readonly<Record<string, readonly string[]>> | null;
  readonly provedHead?: string;
  readonly observedExpectedRecordIds?: readonly string[];
  readonly observedRenderedRecordIds?: readonly string[];
  readonly bundleProvedRecordIds?: readonly string[];
  readonly recordIds: readonly string[];
  readonly eligibleRecordIds: readonly string[];
  readonly readerEligiblePopulation: number;
  /** Eligible source inputs are retained above; only direct answers are display rows. */
  readonly applicableEligibleRecordIds?: readonly string[];
  readonly applicabilityByRecord?: Readonly<Record<string, { readonly status: string; readonly selector: string; readonly reason: string }>>;
  readonly withheldPopulation: number;
  readonly unitCounts: Readonly<Record<string, number>>;
  readonly eligibilityCounts: Readonly<Record<string, number>>;
  readonly withheldReasons: readonly string[];
  readonly loaderCanReadHolding: "FILES_PARSED" | "HOLDING_UNAVAILABLE";
  readonly eligibleRecordsProjected: "UNPROVEN" | "PROVED_BY_READBACK";
  readonly deployedBundleRequirement: string;
  readonly deployedBundleProved: boolean;
  readonly deliveryState: DeliveryState;
  readonly falseNegativeCount: number | null;
  readonly falsePositiveCount: number | null;
  readonly unresolvedIdentityCount: number;
  readonly childPopulation?: { readonly held:number;readonly readerEligible:number;readonly identityUnresolved:number;readonly exactDuplicates:number };
  readonly evidencePaths: readonly string[];
  readonly deliveryReason: string;
}
export interface AutonomousCensusRow {
  readonly workItemId: string;
  readonly state: string;
  readonly subject: string;
  readonly recordClass: string | null;
  readonly lifecycle: string;
  readonly walk: AutonomousObligationActivity["walk"];
  readonly artifactIds: readonly string[];
  readonly extractedRows: number | null;
  readonly workerResults: readonly { role: string; verdict: string; extraction: string | null; resultId: string }[];
  readonly blockers: readonly string[];
  readonly eligibility: EligibilityDecision;
}
export interface ReaderCensus {
  readonly formatVersion: 1;
  readonly generatedBy: "scripts/reader-last-mile-census.mts";
  readonly registrySha256: string;
  readonly holdingsDigest: string;
  readonly denominator: { readonly families: number; readonly declaredEdges: number; readonly holdings: number; readonly records: number; readonly rows: number; readonly states: readonly string[] };
  readonly countingRule: string;
  readonly holdings: readonly CensusHolding[];
  readonly records: readonly CensusRecord[];
  readonly rows: readonly CensusRow[];
  readonly autonomousSource: { readonly path: string; readonly sha256: string; readonly observedAt: string };
  readonly autonomous: readonly AutonomousCensusRow[];
  readonly failures: readonly string[];
  readonly currentBallotHolderIds?: readonly string[];
}

export interface FrozenOfficeholderStatementAuthorityComparison {
  readonly frozenEligibleSnapshotIds: readonly string[];
  readonly frozenUnresolvedSnapshotIds: readonly string[];
  readonly failures: readonly string[];
}

/**
 * The frozen import population defines eligibility. The promoted projection is
 * required to reproduce that population byte-for-byte; it cannot redefine the
 * denominator by omitting or replacing a still-valid frozen record.
 */
export function compareFrozenOfficeholderStatementAuthority(
  root: string,
  current = currentOfficeholderStatements(),
): FrozenOfficeholderStatementAuthorityComparison {
  const transfer = frozenStatementIdentityTransfer(root);
  const expected = new Map(transfer.corpus.snapshots.map((snapshot) => [snapshot.id, snapshot]));
  const actual = new Map(current.snapshots.map((snapshot) => [snapshot.id, snapshot]));
  const failures: string[] = [];

  if (expected.size !== 29 || transfer.excludedFacts.length !== 3) {
    failures.push(
      `OFFICEHOLDER_STATEMENT_FROZEN_DENOMINATOR_MISMATCH: expected 29 eligible and 3 unresolved; found ${expected.size} eligible and ${transfer.excludedFacts.length} unresolved`,
    );
  }
  for (const [id, snapshot] of expected) {
    const promoted = actual.get(id);
    if (!promoted) failures.push(`OFFICEHOLDER_STATEMENT_AUTHORITY_MISSING:${id}`);
    else if (canonicalReaderAuthorityJson(promoted) !== canonicalReaderAuthorityJson(snapshot)) {
      failures.push(`OFFICEHOLDER_STATEMENT_AUTHORITY_PAYLOAD_MISMATCH:${id}`);
    }
  }
  for (const id of actual.keys()) {
    if (!expected.has(id)) failures.push(`OFFICEHOLDER_STATEMENT_AUTHORITY_UNEXPECTED:${id}`);
  }

  return {
    frozenEligibleSnapshotIds: [...expected.keys()].sort(),
    frozenUnresolvedSnapshotIds: transfer.excludedFacts.map((fact) => fact.record.id).sort(),
    failures: unique(failures),
  };
}

type CensusRosterChildDisposition = NonNullable<CensusRecord["childDispositions"]>[number];

export function canonicalReaderAuthorityJson(value: unknown): string {
  const withoutManifestMetadata = (entry: unknown): unknown => Array.isArray(entry)
    ? entry.map(withoutManifestMetadata)
    : entry && typeof entry === "object"
      ? Object.fromEntries(Object.entries(entry).filter(([key]) => !key.startsWith("_manifest")).map(([key, child]) => [key, withoutManifestMetadata(child)]))
      : entry;
  return canonicalCivicDataJson(withoutManifestMetadata(value));
}

function parsedAuthorityTime(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export type ReaderAuthorityRelation<T> =
  | { readonly kind: "EXACT"; readonly record: T }
  | { readonly kind: "MONOTONIC_SUCCESSOR"; readonly record: T }
  | { readonly kind: "MISSING"; readonly record: null };

function uniqueCanonicalRecords<T>(records: readonly T[]): T[] {
  return [...new Map(records.map((record) => [canonicalReaderAuthorityJson(record), record])).values()];
}

const STATE_MONEY_PRECEDENCE: Readonly<Record<StateMoneyRecord["filingState"], number>> = {
  ROUTE_UNREAD: 0,
  LEAD: 0,
  OURS_GAP: 1,
  NO_REPORTS_ON_FILE: 2,
  REGISTERED_NO_ACTIVITY_REPORTED: 3,
  FILED: 4,
};

/**
 * Compare a frozen state-money observation with the exact promoted authority.
 * A later source read may supersede an old observation, but only across the
 * same typed jurisdiction/target/committee identity and never by weakening a
 * filing state. The one legitimate absence-to-committee transition is allowed
 * only for the same complete target-key set.
 */
export function stateMoneyAuthorityRelation(
  frozen: StateMoneyRecord,
  currentRecords: readonly StateMoneyRecord[],
  sourceThrough: string | null,
): ReaderAuthorityRelation<StateMoneyRecord> {
  const current = uniqueCanonicalRecords(currentRecords);
  const exact = current.filter((record) =>
    canonicalReaderAuthorityJson(record) === canonicalReaderAuthorityJson(frozen)
  );
  if (exact.length === 1) return { kind: "EXACT", record: exact[0]! };
  if (exact.length > 1) return { kind: "MISSING", record: null };

  const frozenCheckedAt = parsedAuthorityTime(frozen.checkedAt);
  const frozenCollectedAt = parsedAuthorityTime(frozen.provenance?.collectedAt);
  const frozenVerifiedAt = parsedAuthorityTime(frozen.provenance?.verifiedAt);
  const authorityThrough = parsedAuthorityTime(sourceThrough);
  if (
    frozenCheckedAt === null ||
    frozenCollectedAt === null ||
    frozenVerifiedAt === null ||
    authorityThrough === null ||
    authorityThrough < frozenCheckedAt
  ) return { kind: "MISSING", record: null };

  const successors = current.filter((record) => {
    const checkedAt = parsedAuthorityTime(record.checkedAt);
    const collectedAt = parsedAuthorityTime(record.provenance?.collectedAt);
    const verifiedAt = parsedAuthorityTime(record.provenance?.verifiedAt);
    const frozenTargets = unique(frozen.targetKeys);
    const currentTargets = unique(record.targetKeys);
    const sameTargets = frozenTargets.length > 0 &&
      canonicalReaderAuthorityJson(frozenTargets) === canonicalReaderAuthorityJson(currentTargets);
    const sameCommittee = frozen.committeeId !== null
      ? record.committeeId === frozen.committeeId
      : record.committeeId === null || (
        frozen.filingState === "NO_REPORTS_ON_FILE" &&
        record.committeeId !== null &&
        STATE_MONEY_PRECEDENCE[record.filingState] > STATE_MONEY_PRECEDENCE[frozen.filingState]
      );
    return isRenderable(record) &&
      record.dataClass === frozen.dataClass &&
      record.jurisdiction === frozen.jurisdiction &&
      record.agency === frozen.agency &&
      record.electionYear === frozen.electionYear &&
      sameTargets &&
      sameCommittee &&
      STATE_MONEY_PRECEDENCE[record.filingState] >= STATE_MONEY_PRECEDENCE[frozen.filingState] &&
      checkedAt !== null && checkedAt >= frozenCheckedAt && checkedAt <= authorityThrough &&
      collectedAt !== null && collectedAt >= frozenCollectedAt && collectedAt <= authorityThrough &&
      verifiedAt !== null && verifiedAt >= frozenVerifiedAt &&
      (checkedAt > frozenCheckedAt || collectedAt > frozenCollectedAt || verifiedAt > frozenVerifiedAt);
  });
  return successors.length === 1
    ? { kind: "MONOTONIC_SUCCESSOR", record: successors[0]! }
    : { kind: "MISSING", record: null };
}

function ballotAbsenceWithoutObservationStamps(value: ObjectRow): ObjectRow {
  const copy = structuredClone(value);
  const provenance = object(copy.provenance);
  if (Object.keys(provenance).length) {
    delete provenance.collectedAt;
    delete provenance.verifiedAt;
    copy.provenance = provenance;
  }
  return copy;
}

/** A later verification may supersede only the exact same ballot-absence fact. */
export function ballotAbsenceAuthorityRelation(
  frozen: ObjectRow,
  currentRows: readonly ObjectRow[],
): ReaderAuthorityRelation<ObjectRow> {
  const current = uniqueCanonicalRecords(currentRows);
  const exact = current.filter((record) =>
    canonicalReaderAuthorityJson(record) === canonicalReaderAuthorityJson(frozen)
  );
  if (exact.length === 1) return { kind: "EXACT", record: exact[0]! };
  if (exact.length > 1) return { kind: "MISSING", record: null };

  const frozenProvenance = object(frozen.provenance);
  const frozenCollectedAt = parsedAuthorityTime(frozenProvenance.collectedAt);
  const frozenVerifiedAt = parsedAuthorityTime(frozenProvenance.verifiedAt);
  if (frozenCollectedAt === null || frozenVerifiedAt === null) {
    return { kind: "MISSING", record: null };
  }
  const frozenFact = canonicalReaderAuthorityJson(ballotAbsenceWithoutObservationStamps(frozen));
  const successors = current.filter((record) => {
    if (canonicalReaderAuthorityJson(ballotAbsenceWithoutObservationStamps(record)) !== frozenFact) return false;
    const provenance = object(record.provenance);
    const collectedAt = parsedAuthorityTime(provenance.collectedAt);
    const verifiedAt = parsedAuthorityTime(provenance.verifiedAt);
    return collectedAt !== null && verifiedAt !== null &&
      collectedAt >= frozenCollectedAt && verifiedAt >= frozenVerifiedAt &&
      (collectedAt > frozenCollectedAt || verifiedAt > frozenVerifiedAt);
  });
  return successors.length === 1
    ? { kind: "MONOTONIC_SUCCESSOR", record: successors[0]! }
    : { kind: "MISSING", record: null };
}

export interface FrozenBodyRosterAuthorityComparison {
  readonly childDispositions: readonly CensusRosterChildDisposition[];
  readonly failures: readonly string[];
}

/**
 * Recompute the reviewed disposition for every member in the frozen census
 * input, then compare that complete set with the initialized promoted runtime.
 * A synthetic mismatch row retains the frozen child in the denominator while
 * the named failure prevents projection or closure.
 */
export function compareFrozenBodyRosterAuthority(
  frozenRoster: BodyRoster,
  promotedRosters: readonly BodyRoster[],
  promotedDispositions: readonly RosterReaderDisposition[],
): FrozenBodyRosterAuthorityComparison {
  const expected = projectReaderRoster(frozenRoster);
  const bodyId = frozenRoster.bodyId;
  const failures: string[] = [];
  const currentRosterMatches = promotedRosters.filter((roster) => roster.bodyId === bodyId);
  const currentRoster = currentRosterMatches.length === 1 ? currentRosterMatches[0]! : null;
  if (currentRosterMatches.length !== 1) {
    failures.push(`BODY_ROSTER_AUTHORITY_ROSTER_COUNT_MISMATCH:${bodyId}:expected=1:actual=${currentRosterMatches.length}`);
  }

  const expectedMemberIds = new Set(expected.roster.members.map((member) => member.id));
  const currentMembers = currentRoster?.members ?? [];
  const currentMemberIds = currentMembers.map((member) => member.id);
  const currentMemberById = new Map(currentMembers.map((member) => [member.id, member]));
  if (new Set(currentMemberIds).size !== currentMemberIds.length) {
    failures.push(`BODY_ROSTER_AUTHORITY_MEMBER_DUPLICATE:${bodyId}`);
  }
  for (const member of expected.roster.members) {
    const promoted = currentMemberById.get(member.id);
    if (!promoted) failures.push(`BODY_ROSTER_AUTHORITY_MEMBER_MISSING:${bodyId}:${member.id}`);
    else if (canonicalReaderAuthorityJson(promoted) !== canonicalReaderAuthorityJson(member)) {
      failures.push(`BODY_ROSTER_AUTHORITY_MEMBER_PAYLOAD_MISMATCH:${bodyId}:${member.id}`);
    }
  }
  for (const member of currentMembers) {
    if (!expectedMemberIds.has(member.id)) failures.push(`BODY_ROSTER_AUTHORITY_MEMBER_UNEXPECTED:${bodyId}:${member.id}`);
  }
  if (currentRoster && canonicalReaderAuthorityJson({ ...currentRoster, members: [] }) !== canonicalReaderAuthorityJson({ ...expected.roster, members: [] })) {
    failures.push(`BODY_ROSTER_AUTHORITY_CONTAINER_PAYLOAD_MISMATCH:${bodyId}`);
  }

  const expectedDispositionById = new Map(expected.dispositions.map((row) => [row.sourceId, row]));
  const sourcePrefixes = new Set(expected.dispositions.map((row) => row.sourceId.split("#")[0]));
  const relevantPromotedDispositions = promotedDispositions.filter((row) =>
    expectedDispositionById.has(row.sourceId)
    || (row.canonicalId !== null && expectedMemberIds.has(row.canonicalId))
    || sourcePrefixes.has(row.sourceId.split("#")[0]),
  );
  const promotedDispositionById = new Map<string, RosterReaderDisposition>();
  for (const disposition of relevantPromotedDispositions) {
    if (promotedDispositionById.has(disposition.sourceId)) {
      failures.push(`BODY_ROSTER_AUTHORITY_DISPOSITION_DUPLICATE:${bodyId}:${disposition.sourceId}`);
    } else promotedDispositionById.set(disposition.sourceId, disposition);
  }
  for (const disposition of relevantPromotedDispositions) {
    if (!expectedDispositionById.has(disposition.sourceId)) {
      failures.push(`BODY_ROSTER_AUTHORITY_DISPOSITION_UNEXPECTED:${bodyId}:${disposition.sourceId}`);
    }
  }

  const childDispositions = expected.dispositions.map((expectedDisposition): CensusRosterChildDisposition => {
    const promoted = promotedDispositionById.get(expectedDisposition.sourceId);
    const member = expectedDisposition.state === "READER_ELIGIBLE" && expectedDisposition.canonicalId
      ? currentMemberById.get(expectedDisposition.canonicalId)
      : null;
    const expectedMember = expectedDisposition.state === "READER_ELIGIBLE" && expectedDisposition.canonicalId
      ? expected.roster.members.find((entry) => entry.id === expectedDisposition.canonicalId)
      : null;
    const dispositionMatches = promoted
      && canonicalReaderAuthorityJson(promoted) === canonicalReaderAuthorityJson(expectedDisposition);
    const memberMatches = expectedDisposition.state !== "READER_ELIGIBLE"
      || Boolean(member && expectedMember && canonicalReaderAuthorityJson(member) === canonicalReaderAuthorityJson(expectedMember));
    if (!promoted) failures.push(`BODY_ROSTER_AUTHORITY_DISPOSITION_MISSING:${bodyId}:${expectedDisposition.sourceId}`);
    else if (!dispositionMatches) failures.push(`BODY_ROSTER_AUTHORITY_DISPOSITION_PAYLOAD_MISMATCH:${bodyId}:${expectedDisposition.sourceId}`);
    if (dispositionMatches && memberMatches) return promoted;
    return {
      sourceId: expectedDisposition.sourceId,
      canonicalId: null,
      state: "AUTHORITY_MISMATCH",
      reason: `The promoted registry runtime does not exactly reproduce this frozen ${bodyId} member and disposition; closure is forbidden without changing the frozen denominator.`,
    };
  });

  return { childDispositions, failures: unique(failures) };
}

/** Whole-authority control: no promoted roster or disposition may sit outside the frozen census input. */
export function compareFrozenBodyRosterAuthorityUniverse(
  frozenRosters: readonly BodyRoster[],
  promotedRosters: readonly BodyRoster[],
  promotedDispositions: readonly RosterReaderDisposition[],
): readonly string[] {
  const frozenByBodyId = new Map<string, BodyRoster>();
  for (const roster of frozenRosters) {
    const prior = frozenByBodyId.get(roster.bodyId);
    if (!prior) frozenByBodyId.set(roster.bodyId, roster);
    else if (canonicalReaderAuthorityJson(projectReaderRoster(prior)) !== canonicalReaderAuthorityJson(projectReaderRoster(roster))) {
      throw new Error(`BODY_ROSTER_FROZEN_INPUT_CONFLICT:${roster.bodyId}`);
    }
  }
  const expectedDispositionIds = new Set(
    [...frozenByBodyId.values()].flatMap((roster) => projectReaderRoster(roster).dispositions.map((row) => row.sourceId)),
  );
  const failures = [...frozenByBodyId.values()].flatMap((roster) =>
    compareFrozenBodyRosterAuthority(roster, promotedRosters, promotedDispositions).failures,
  );
  for (const roster of promotedRosters) {
    if (!frozenByBodyId.has(roster.bodyId)) failures.push(`BODY_ROSTER_AUTHORITY_ROSTER_UNEXPECTED:${roster.bodyId}`);
  }
  for (const disposition of promotedDispositions) {
    if (!expectedDispositionIds.has(disposition.sourceId)) {
      failures.push(`BODY_ROSTER_AUTHORITY_DISPOSITION_UNEXPECTED:${disposition.sourceId}`);
    }
  }
  return unique(failures);
}

const acquisitionFamilies = new Set(["candidate-acquisitions", "campaign-finance-corpus"]);
// These retired holdings remain counted and dispositioned as evidence, but
// deliberately create no Reader surface edge or production identity.
const readerInventoryOnlyFamilies = new Set(["state-officeholders"]);
function entersReaderInventory(family: (typeof DATASET_FAMILIES)[number]): boolean {
  return family.surfaces.length > 0 || readerInventoryOnlyFamilies.has(family.id);
}
const metadataPaths = new Set(["data/derived/gap-ledger.json", "data/derived/zip-coverage-tiers-runtime.json", "data/derived/zip-coverage-tiers.json"]);
const keysByFamily: Readonly<Record<string, readonly string[]>> = {
  ballot: ["contests", "candidacies", "measures", "absences", "removals", "cards", "links", "analyses", "contacts"],
  identity: ["candidates", "rows"], "candidate-corpus": ["documents"], "statement-corpus": ["snapshots"],
  "state-money": ["records"], "federal-finance": ["candidates", "absences", "secondHop"], meetings: ["meetings", "agendaDocuments"],
  outcomes: ["sittings"], votes: ["votes", "rollCalls", "positions", "entries", "summaries", "titles"],
  "voting-sites": ["jurisdictions"], prl: ["profiles"], "official-actions": ["actions", "members"],
  registry: ["divisions", "bodies", "officeholders", "photos", "records"],
  "state-officeholders": ["officeholders"], congress: ["members", "byMember"],
  geography: ["features", "records", "divisions"],
};
function pointerPart(value: string) { return value.replaceAll("~", "~0").replaceAll("/", "~1"); }
interface RawRecord { value: ObjectRow; pointer: string; unit: string; identityKey?: string }

/** The canonical manifest inventories vaulted image bytes outside datasets. */
function readerDatasets(context: ManifestContext): Dataset[] {
  const officialPhotos = (object(context.datasets.find((dataset) => dataset.path === "lib/registry/official-photos.json")?.value).photos as ObjectRow[] ?? [])
    .filter((row) => !string(row.officeholderId).startsWith("plural:"));
  const candidateCards = object(object(context.datasets.find((dataset) => dataset.path === "data/ballot/candidate-cards-2026.json")?.value).cards);
  const portraitAssets = context.assetObjects.filter((asset) => /^public\/(candidates|officials)\//.test(asset.originalPath ?? "")).map((asset): Dataset => {
    const path = asset.originalPath!;
    const url = path.slice("public".length);
    const bindings = [
      ...officialPhotos.filter((row) => row.url === url && row.officeholderId).map((row) => ({ subjectId: string(row.officeholderId), permitted: true, source: "Current sourced official-photo binding" })),
      ...Object.entries(candidateCards).filter(([, row]) => object(row).photoUrl === url).map(([key]) => ({ subjectId: key, permitted: photoMayRender(key, url), source: "Current candidate-card binding and exact image review" })),
    ];
    const value = { url, assetKey: asset.key, sourceReadback: VAULT_PATH, verifiedBytes: asset.verified === true, bindings, _censusPortraitAsset: true, _manifestStateCodes: asset.stateCodes ?? [] };
    return { path, family: "portraits", domain: "portraits", states: asset.stateCodes ?? [], value, bytes: Number(asset.meta.byteLength ?? 0), sha256: string(asset.meta.contentHash), rowsByState: new Map((asset.stateCodes ?? []).map((state) => [state, 1])), totalRows: 1, unit: "vaulted portrait assets" };
  });
  const provisionPath = "lib/ballot/measure-provisions.ts";
  const provisionBytes = readFileSync(join(context.root,provisionPath));
  const provisions: Dataset[] = context.datasets.some((dataset)=>dataset.path===provisionPath) ? [] : [{ path: provisionPath, family: "measure-summaries", domain: "ballot", states: ["az"], value: { recordUnit: "measure provisions", records: MEASURE_PROVISIONS }, bytes: provisionBytes.length, sha256: sha256(provisionBytes), rowsByState: new Map([["az",MEASURE_PROVISIONS.length]]), totalRows: MEASURE_PROVISIONS.length, unit: "measure provisions" }];
  return [...context.datasets, ...portraitAssets, ...provisions];
}

function currentReaderHoldingsIdentity(root: string): {
  readonly holdingsDigest: string;
  readonly registrySha256: string;
} {
  const families = DATASET_FAMILIES.filter(entersReaderInventory);
  const holdings = readerDatasets(loadManifestContext(root))
    .filter((dataset) => families.some((family) => family.id === dataset.family))
    .map((dataset) => [dataset.path, dataset.sha256] as const);
  return {
    holdingsDigest: sha256(JSON.stringify(holdings)),
    registrySha256: sha256(readFileSync(join(root, "lib/holdings/datasets.ts"))),
  };
}
function entriesAt(value: unknown, pointer: string, unit: string): RawRecord[] {
  if (Array.isArray(value)) return value.map((entry, index) => ({ value: object(entry), pointer: `${pointer}/${index}`, unit }));
  return Object.entries(object(value)).map(([key, entry]) => ({ value: object(entry), pointer: `${pointer}/${pointerPart(key)}`, unit, identityKey: key }));
}
/** Reviewed semantic containers only: sources, checks, failures and notes are not records. */
function extractRecords(dataset: Dataset): RawRecord[] {
  const value = object(dataset.value);
  if (dataset.family === "local-finance") {
    const bodyId = "ocd-division/country:us/state:az/school_district:vail_unified_district#board";
    const evidence = localFinanceEvidenceFor({ kind: "BODY", id: bodyId, name: "Vail Unified School District Governing Board" });
    const selected = new Set(evidence?.records.map((row) => row.id));
    const counters = new Map<string, number>();
    return ["committeeRegisterCountyPortal", "committeeRegisterStateFtp", "filingsIndexed", "expectedFilingPeriodsAz2026PacParty", "contributions", "distributions"].flatMap((key) => entriesAt(value[key], `/${key}`, key).map((raw) => {
      let evidenceId = "";
      if (key === "committeeRegisterCountyPortal") evidenceId = `easyvote:pima:${string(raw.value.portalFilerId)}`;
      const contribution = key === "contributions" && raw.value.ItemizedListType === "Contribution";
      const spending = key === "distributions" && ["Disbursments", "Expenditures", "Miscellaneous Disbursements"].includes(string(raw.value.ItemizedListType));
      if (contribution || spending) {
        const committee = string(raw.value.RecipientCommitteeName ?? raw.value.CandidateCommitteeName);
        const counterKey = `${key}:${committee}`;
        const index = counters.get(counterKey) ?? 0; counters.set(counterKey, index + 1);
        evidenceId = `cf:${string(raw.value.DocumentFilingId)}:${contribution ? "contribution" : "spending"}:${index}`;
      }
      // This instrument reproduces only the canonical selector's explicit
      // native-ID construction. Eligibility requires that actual selector to
      // return the ID; source names never establish a new civic relationship.
      return { ...raw, value: { ...raw.value, ...(selected.has(evidenceId) ? { id: evidenceId, bodyId, _censusLocalFinanceSelected: true } : {}), _censusLocalFinanceUnit: key } };
    }));
  }
  if (Array.isArray(dataset.value)) return entriesAt(dataset.value, "", dataset.unit);
  if (Array.isArray(value.records) && value.recordUnit) return entriesAt(value.records, "/records", string(value.recordUnit));
  if (value.schemaVersion === 1 && value.records) {
    return Object.entries(object(value.records)).flatMap(([key, rows]) => Array.isArray(rows)
      ? entriesAt(rows, `/records/${pointerPart(key)}`, dataset.unit)
      : Object.entries(object(rows)).flatMap(([tenant, nested]) => entriesAt(nested, `/records/${pointerPart(key)}/${pointerPart(tenant)}`, dataset.unit)));
  }
  const keys = keysByFamily[dataset.family] ?? ["records", "rows", "candidacies", "candidates", "members", "entities", "features"];
  const selected = keys.filter((key) => value[key] && typeof value[key] === "object");
  if (selected.length) return selected.flatMap((key) => entriesAt(value[key], `/${key}`, key));
  return [{ value, pointer: "", unit: dataset.unit }];
}

/**
 * Preserve the frozen file pointer while applying only the exact, reviewed
 * statement identity transfer. Every downstream projector therefore sees
 * the permanent promoted id/subject rather than reviving a retired id.
 */
function readerRecordsForDataset(root: string, dataset: Dataset): RawRecord[] {
  const records = extractRecords(dataset);
  if (dataset.family !== "statement-corpus") return records;
  const transfer = frozenStatementIdentityTransfer(root);
  const rekeyed = new Map(transfer.rekeyed.map(({ fromSnapshotId, toSnapshotId }) => [fromSnapshotId, toSnapshotId]));
  const promoted = new Map(transfer.corpus.snapshots.map((snapshot) => [snapshot.id, snapshot]));
  return records.map((raw) => {
    const promotedId = rekeyed.get(string(raw.value.id));
    if (!promotedId) return raw;
    const snapshot = promoted.get(promotedId);
    if (!snapshot) throw new Error(`Reviewed statement transfer target is absent: ${promotedId}`);
    return { ...raw, value: snapshot as unknown as ObjectRow };
  });
}

const identityKeys = ["id", "identityId", "canonicalCandidacyId", "canonicalContestId", "candidateKey", "candidacyId", "contestId", "subjectId", "officeholderId", "bodyId", "ocdId", "stateOcdId", "divisionOcdId", "meetingId", "rollCallId", "voteId", "bioguideId", "formKey", "classKey", "topic", "url", "targetKey", "fecCandidateId", "committeeId"];
function identities(raw: RawRecord): string[] {
  const values = identityKeys.flatMap((key) => typeof raw.value[key] === "string" ? [string(raw.value[key])] : []);
  if (Array.isArray(raw.value.targetKeys)) values.push(...raw.value.targetKeys.filter((x): x is string => typeof x === "string"));
  if (raw.identityKey) values.push(raw.identityKey);
  if (raw.identityKey && /^[A-Z]\d{6}$/.test(raw.identityKey)) values.push(`congress:${raw.identityKey}`);
  if (typeof raw.value.electionDay === "string" && typeof raw.value.state === "string") values.push(string(raw.value.state), string(raw.value.sourceUrl));
  if (typeof raw.value.topicId === "string" && Array.isArray(raw.value.zips)) values.push(string(raw.value.topicId), string(raw.value.sourceUrl));
  const bioguide = string(raw.value.bioguide ?? raw.value.bioguideId);
  if (/^[A-Z]\d{6}$/.test(bioguide)) values.push(`congress:${bioguide}`);
  return unique(values);
}
function recordStates(dataset: Dataset, raw: RawRecord): string[] {
  const fixed = /^data\/states\/([a-z]{2})\//.exec(dataset.path)?.[1];
  if (fixed) return [fixed];
  // Do not infer states from arbitrary object keys: a property named "id" is
  // not Idaho. Only explicit tags and complete civic identity values count.
  const tagged = [raw.value.state, raw.value.stateCode, raw.value.jurisdiction, ...identities(raw)]
    .flatMap((value) => statesFromIdentity(value));
  const manifestTags = raw.value._manifestStateCodes;
  if (!tagged.length && Array.isArray(manifestTags)) tagged.push(...manifestTags.filter((v): v is string => typeof v === "string"));
  return unique(tagged);
}

function eligibility(
  dataset: Dataset,
  raw: RawRecord,
  currentDocuments: ReadonlySet<string>,
  frozenEligibleStatements: ReadonlySet<string>,
): EligibilityDecision {
  const row = raw.value;
  const facts: EligibilityFacts = { held: true, source: "CANONICAL_READER_SNAPSHOT", relationship: acquisitionFamilies.has(dataset.family) ? "ACQUISITION_INPUT" : metadataPaths.has(dataset.path) ? "OPERATIONAL_METADATA" : "CANONICAL_READER_RECORD", identity: "RESOLVED" };
  const disposition = nonRoutineDispositionForTrackedPath(dataset.path);
  const forbiddenReaderDisposition = disposition?.execution.readerUse === "FORBIDDEN"
    ? disposition
    : null;
  if (forbiddenReaderDisposition) {
    return {
      state: "NOT_READER_ELIGIBLE",
      reason: `${forbiddenReaderDisposition.sourceId} is ${forbiddenReaderDisposition.disposition}; its tracked bytes remain inventoried research/test evidence and production Reader use is forbidden. ${forbiddenReaderDisposition.reason}`,
    };
  }
  if (dataset.path === "data/fec/fec-2026.json" && raw.unit === "absences") {
    return {
      state: "NOT_READER_ELIGIBLE",
      reason: "The frozen FEC absence row remains held evidence, but it lacks the bounded office/state/district/cycle horizon and completed pagination needed for a production absence claim. The promoted FEC contract intentionally publishes candidates only; no bootstrap or Reader proof may revive this absence.",
    };
  }
  if (
    dataset.family === "venue-records" &&
    dataset.path === "lib/meetings/venue-cache.ts" &&
    parsedAuthorityTime(row.verifiedAt) === null
  ) {
    return {
      state: "NOT_READER_ELIGIBLE",
      reason: "This unstamped venue-cache row is a historical adoption/node:test fixture. The permanent venue-resolutions contract requires a finite verifiedAt before a venue may enter Reader authority.",
    };
  }
  if (dataset.family === "registry" && raw.unit === "bodies" && isCensusPlaceholderDivision({ ocdId: string(row.ocdId) })) {
    return {
      state: "NOT_READER_ELIGIBLE",
      reason: "This frozen body sits on a Census placeholder division (LEA 99997, \"No unified school district here\"): land inside no district, where no board meets. It remains held first-seed evidence, but a placeholder is geography and never a government, so no registry promotion may carry it and no Reader may show it (lib/registry/census-placeholders.ts).",
    };
  }
  if (dataset.family === "campaign-sites" && !officeholderIdentityMayEnterReader(string(row.id), null)) {
    return {
      state: "NOT_READER_ELIGIBLE",
      reason: "The frozen campaign-site row is keyed only to a retired Plural/OpenStates intermediary identity. It remains held evidence, but it is absent from the exact promoted campaign-site projection and cannot enter a production Reader through name matching.",
    };
  }
  if (dataset.family === "local-finance") {
    if (row._censusLocalFinanceSelected) return { state: "READER_ELIGIBLE", reason: "The existing canonical localFinanceEvidenceFor selector returned this exact sourced native ID through the committed office-to-body bridge. This is body finance; it does not assign a committee to a person." };
    if (["expectedFilingPeriodsAz2026PacParty", "filingsIndexed", "committeeRegisterStateFtp"].includes(string(row._censusLocalFinanceUnit))) return { state: "INTENTIONALLY_NOT_APPLICABLE", reason: "Filing-index, reporting-period or alternate register input supports acquisition accounting; it is not a linked filed money answer or a claim that a filing body was acquired." };
    return { state: "IDENTITY_UNRESOLVED", reason: "The existing canonical local body-finance selector does not resolve this acquisition row through a held register-office-to-body relationship and supported normalized transaction type. A committee name, including PAC names, cannot establish a candidate or civic body attachment." };
  }
  if (dataset.family === "portraits" && row._censusPortraitAsset) {
    const bindings = row.bindings as { subjectId: string; permitted: boolean }[];
    if (!row.verifiedBytes) return { state: "STAGED_NOT_ELIGIBLE", reason: "Canonical asset inventory does not verify these image bytes; a path is not a verified portrait." };
    if (!bindings.length) return { state: "IDENTITY_UNRESOLVED", reason: "Verified asset bytes have no current exact official/candidate portrait binding. A filename cannot establish the depicted person's identity." };
    if (!bindings.some((binding) => binding.permitted)) return { state: "NOT_READER_ELIGIBLE", reason: "The current candidate image binding has no approved exact-image review. The card's other facts remain eligible." };
    return { state: "READER_ELIGIBLE", reason: "Verified canonical asset bytes and a current sourced official binding or approved exact candidate-image review exist. Canonical portrait preference decides which eligible image is currently displayed." };
  }
  if (dataset.family === "state-money") {
    const record = row as unknown as StateMoneyRecord;
    if (record.filingState === "LEAD") return classifyReaderEligibility({ ...facts, identity: "UNRESOLVED", exactReason: `Finance LEAD: ${record.match?.note ?? "canonical committee/candidacy join is not established"}` });
    if (record.filingState === "ROUTE_UNREAD") return classifyReaderEligibility({ ...facts, readerContractAllows: false, exactReason: "Finance ROUTE_UNREAD: no sourced money or sourced filing absence can render; this is an acquisition route gap." });
    return classifyReaderEligibility({ ...facts, readerContractAllows: isRenderable(record), exactReason: record.filingState === "OURS_GAP" ? "The sourced OURS_GAP sentence is reader eligible; its unjoined committee, figures and totals are not." : `Existing state-money isRenderable contract: ${record.filingState}; ${record.match?.note ?? "no match note"}` });
  }
  if (dataset.family === "candidate-corpus") {
    if (!currentDocuments.has(string(row.id))) return { state: "INTENTIONALLY_NOT_APPLICABLE", reason: "Historical extraction superseded by currentExtraction for this candidate and source URL." };
    if (row.extraction !== "html" || !row.text) return { state: "NOT_READER_ELIGIBLE", reason: `Source artifact acquired but candidate text extraction is ${string(row.extraction) || "not recorded"}; no position may be generated to fill it.` };
  }
  if (dataset.family === "statement-corpus") {
    if (!frozenEligibleStatements.has(string(row.id))) return { state: "NOT_READER_ELIGIBLE", reason: "The frozen statement remains held evidence, but its retired intermediary person identity has no exact reviewed permanent identity transfer. No name match or Plural/OpenStates identity may restore it to the Reader." };
    // A promoted failed extraction is still a truthful Reader fact: positions
    // and Ask count it as held-but-unreadable. It cannot become a quotation,
    // which the projection/applicability layer records separately.
  }
  if (dataset.family === "identity" && row.outcome && row.outcome !== "RECONCILED") return { state: "IDENTITY_UNRESOLVED", reason: `Canonical reconciliation outcome=${string(row.outcome)}; identity candidates must not be guessed.` };
  if (dataset.family === "meetings" && raw.unit === "agendaDocuments") {
    if (row.extraction === "failed" || agendaDocumentRepresentation(row as unknown as AgendaDocumentLike) === "UNREADABLE") return { state: "NOT_READER_ELIGIBLE", reason: "The canonical agenda representation classifier found no readable document text. A successful extraction label cannot promote binary document bytes. The raw artifact remains held; the linked meeting, source URL and explicit OURS readability gap remain independently reader eligible." };
    const across = object(dataset.value).agendaDocuments;
    const meetings = object(dataset.value).meetings;
    const publication = classifyAgendaPublication({ bodyName: "the publisher", meetingId: string(row.meetingId), documentsForMeeting: [row as unknown as AgendaDocumentLike], documentsAcrossCorpus: Array.isArray(across) ? across : [], meetingsAcrossCorpus: Array.isArray(meetings) ? meetings : [], now: 0 });
    if (publication.documentSharedAcrossGovernments) return { state: "IDENTITY_UNRESOLVED", reason: "The exact stored document URL is attached to meetings in more than one canonical government. This body's agenda relationship and stored publisher attribution are unresolved; document text cannot attach to any body. Raw artifact identity/hash remain held and the meeting may show only the canonical OURS unresolved-link diagnostic." };
    if (publication.acquisition === "ACQUIRED_IS_PUBLICATION_INDEX") return { state: "READER_ELIGIBLE", reason: "Only the acquired portal's identity, source and canonical OURS acquisition gap are reader eligible. Navigation, JavaScript, loading screens and directory text are not a meeting's agenda items and must remain withheld." };
  }
  return classifyReaderEligibility(facts);
}

function resolveImport(root: string, importer: string, specifier: string): string | null {
  if (!specifier.startsWith(".") && !specifier.startsWith("@/")) return null;
  const relative = specifier.startsWith("@/") ? specifier.slice(2) : posix.normalize(posix.join(posix.dirname(importer), specifier));
  return [relative, `${relative}.ts`, `${relative}.tsx`, `${relative}.json`, `${relative}/index.ts`, `${relative}/index.tsx`].find((path) => existsSync(join(root, path))&&fs.statSync(join(root,path)).isFile()) ?? null;
}
function literalPrefix(node: ts.Expression | undefined): string | null {
  if (!node) return null;
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.head.text;
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) return literalPrefix(node.left);
  return null;
}
const edgeCache = new Map<string, readonly string[]>();
const apiRouteCache = new Map<string, string[]>();
function apiRoutePaths(root: string): string[] {
  const prior = apiRouteCache.get(root); if (prior) return prior;
  const { globSync } = fs as typeof fs & { globSync(pattern: string, options: { cwd: string }): string[] };
  const paths = globSync("app/api/**/route.ts", { cwd: root }).map((path) => path.replaceAll("\\", "/"));
  apiRouteCache.set(root, paths); return paths;
}
/** Parse syntax, not comments: prose mentioning fetch/import cannot repair an edge. */
function sourceEdges(root: string, importer: string, source: string): readonly string[] {
  const key = `${root}:${importer}:${sha256(source)}`;
  const cached = edgeCache.get(key);
  if (cached) return cached;
  const edges: string[] = [];
  const tree = ts.createSourceFile(importer, source, ts.ScriptTarget.Latest, true, importer.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  function walk(node: ts.Node): void {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const typeOnly = ts.isImportDeclaration(node) ? node.importClause?.isTypeOnly || Boolean(node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings) && node.importClause.namedBindings.elements.length && node.importClause.namedBindings.elements.every((specifier) => specifier.isTypeOnly) && !node.importClause.name) : node.isTypeOnly;
      if (!typeOnly) { const path = resolveImport(root, importer, node.moduleSpecifier.text); if (path) edges.push(path); }
    }
    if (ts.isCallExpression(node)) {
      const prefix = literalPrefix(node.arguments[0]);
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword && prefix) { const path = resolveImport(root, importer, prefix); if (path) edges.push(path); }
      if (ts.isIdentifier(node.expression) && node.expression.text === "fetch" && prefix?.startsWith("/api/")) {
        const requested = prefix.split("?")[0];
        const literalRoute = `app${requested.replace(/\/$/, "")}/route.ts`;
        if (existsSync(join(root, literalRoute))) edges.push(literalRoute);
        for (const path of apiRoutePaths(root)) {
          const route = path.replace(/^app/, "").replace(/\/route\.ts$/, "");
          const fixedPrefix = route.split("[")[0];
          if (route.includes("[") ? requested.startsWith(fixedPrefix) : requested === route) edges.push(path);
        }
      }
    }
    ts.forEachChild(node, walk);
  }
  walk(tree);
  const result = unique(edges);
  edgeCache.set(key, result);
  return result;
}
/** Static source reachability is one seam, explicitly not rendered evidence. */
export function importReachability(root: string, surfacePath: string, consumerPath: string, read = (path: string) => readFileSync(join(root, path), "utf8")): ImportReachability {
  const queue: string[][] = [[surfacePath]];
  const seen = new Set<string>();
  while (queue.length) {
    const path = queue.shift()!;
    const current = path[path.length - 1];
    if (current === consumerPath) return { surfacePath, consumerPath, reached: true, path };
    if (seen.has(current) || !/\.(?:ts|tsx|js|mjs|mts)$/.test(current)) continue;
    seen.add(current);
    if (!existsSync(join(root, current))) continue;
    const source = read(current);
    for (const next of sourceEdges(root, current, source)) if (!seen.has(next)) queue.push([...path, next]);
  }
  return { surfacePath, consumerPath, reached: false, path: [] };
}

/** The state-money leaf receives a server-computed payload through props. */
export function surfaceConsumerReachability(root: string, surface: ReaderSurfaceId, consumer: string): ImportReachability {
  const entry = READER_SURFACES.find((s) => s.id === surface)!.path;
  const direct = importReachability(root, entry, consumer);
  if (direct.reached || surface !== "state-money") return direct;
  const producer = "app/ballot/page.tsx";
  if (!importReachability(root, producer, entry).reached) return direct;
  const supplied = importReachability(root, producer, consumer);
  return supplied.reached ? { ...supplied, surfacePath: entry, path: [entry, "SERVER_PROPS_FROM", ...supplied.path] } : direct;
}

/** Declared indirect acquisition relationships are checked at their normalized family. */
export function datasetSurfaceCoverageProblems(root: string): string[] {
  return [...DATASET_FAMILIES.filter((family) => family.surfaces.length && !acquisitionFamilies.has(family.id)).flatMap((family) => family.surfaces.filter((surface) => !family.consumerPaths.some((consumer) => surfaceConsumerReachability(root, surface, consumer).reached)).map((surface) => `${family.id}:${surface}: no source import, API fetch or server-props path reaches any declared canonical consumer`)), ...readerAcquisitionBoundaryProblems(root)];
}

export interface ReaderSourceHash { readonly path: string; readonly sha256: string }
function evidenceSourceHashes(value: unknown): ReaderSourceHash[] {
  return Array.isArray(value) ? value.map(object).map((source) => ({ path: string(source.path), sha256: string(source.sha256) })) : Object.entries(object(value)).map(([path, hash]) => ({ path, sha256: string(hash) }));
}
/** Fingerprint executable reader dependencies; a documentation-only HEAD is irrelevant. */
export function readerSourceFingerprint(root: string, entries: readonly string[] = [...READER_SURFACES.map((surface) => surface.path),"app/layout.tsx"]): ReaderSourceHash[] {
  const queue = [...entries];
  const seen = new Set<string>();
  const sources: ReaderSourceHash[] = [];
  while (queue.length) {
    const path = queue.shift()!;
    if (seen.has(path)) continue;
    seen.add(path);
    if (!existsSync(join(root, path))) throw new Error(`Reader source disappeared: ${path}`);
    const bytes = readFileSync(join(root, path));
    sources.push({ path, sha256: sha256(bytes) });
    if (/\.(ts|tsx|js|mjs|mts)$/.test(path)) queue.push(...sourceEdges(root, path, bytes.toString("utf8")));
  }
  return sources.sort((a,b) => a.path.localeCompare(b.path));
}

/** Raw staged corpora cannot replace promoted holdings; immutable lifecycle
 * readbacks and pure diagnostic modules remain allowed as eligibility inputs. */
export function readerAcquisitionBoundaryProblems(root: string, entries?: readonly string[]): string[] {
  return readerSourceFingerprint(root, entries).filter(source => /^(?:data\/health\/autonomous-agent-fleet\/[^/]*(?:followed-records|acquired|acquisition|unverified|staged)[^/]*\.json|data\/states\/[^/]+\/(?:staged|acquisitions)\/|app\/(?:api\/)?admin\/)/.test(source.path)).map(source => `Reader graph reaches a raw staged corpus or owner administration instead of a promoted reader holding: ${source.path}`);
}

export function readerSourceHashProblems(root: string, hashes: readonly ReaderSourceHash[]): string[] {
  return hashes.filter((source) => !existsSync(join(root, source.path)) || sha256(readFileSync(join(root, source.path))) !== source.sha256).map((source) => `Reader dependency changed after proof: ${source.path}`);
}

export interface ReaderSourceEolEquivalence {
  readonly path: "app/api/ask/grounded/route.ts" | "scripts/lib/reader-ask-ballot-proof.ts";
  readonly recordedSha256: string;
  readonly canonicalLfSha256: string;
  readonly archivePath: string;
  readonly archiveSha256: string;
  readonly gitEol: "lf";
  readonly typescriptVersion: string;
  readonly emittedJsSha256: string;
}

/** This receipt-only exception preserves two executed mixed-EOL source files.
 * It admits Git's already-declared CRLF→LF conversion, never arbitrary source
 * normalization, and does not change any original execution hash or head. */
export function sourceEolEquivalenceProblems(equivalence: ReaderSourceEolEquivalence, archive: Buffer, current: Buffer, declaredGitEol: string): string[] {
  const failures: string[] = [];
  const fail = (reason: string) => failures.push(`${equivalence.path}: ${reason}`);
  if (!["app/api/ask/grounded/route.ts", "scripts/lib/reader-ask-ballot-proof.ts"].includes(equivalence.path)) fail("file is outside the two recorded EOL equivalences");
  if (equivalence.gitEol !== "lf" || declaredGitEol !== "lf") fail("Git does not declare eol=lf");
  if (sha256(archive) !== equivalence.archiveSha256) fail("executed source archive hash differs");
  let recorded: Buffer;
  try {
    const saved = JSON.parse(archive.toString("utf8")) as { path: string; rawSourceBase64: string };
    if (saved.path !== equivalence.path) fail("executed source archive names another file");
    recorded = Buffer.from(saved.rawSourceBase64, "base64");
  } catch { fail("executed source archive is unreadable"); return failures; }
  if (sha256(recorded) !== equivalence.recordedSha256) fail("executed source bytes do not match the recorded hash");
  if (!recorded.equals(Buffer.from(recorded.toString("utf8")))) fail("invalid UTF-8 cannot be normalized as an EOL conversion");
  const canonical = Buffer.from(recorded.toString("utf8").replace(/\r\n/g, "\n"));
  if (recorded.equals(canonical)) fail("an EOL exception requires actual recorded CRLF bytes");
  if (sha256(canonical) !== equivalence.canonicalLfSha256) fail("canonical LF hash is not the exact CRLF-only conversion");
  if (!current.equals(recorded) && !current.equals(canonical)) fail("current source is neither the exact executed bytes nor their exact Git LF conversion");
  if (ts.version !== equivalence.typescriptVersion) fail("TypeScript compiler version differs from the equivalence proof");
  const emit = (bytes: Buffer) => ts.transpileModule(bytes.toString("utf8"), { fileName: equivalence.path, reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, newLine: ts.NewLineKind.LineFeed, sourceMap: false, inlineSourceMap: false } });
  const originalJs = emit(recorded), canonicalJs = emit(canonical);
  if (originalJs.diagnostics?.length || canonicalJs.diagnostics?.length) fail("TypeScript reported diagnostics while proving EOL equivalence");
  if (originalJs.outputText !== canonicalJs.outputText || sha256(originalJs.outputText) !== equivalence.emittedJsSha256) fail("CRLF and LF sources do not emit the same independently hashed JavaScript");
  return failures;
}

export interface ReaderClosureReceipt {
  readonly formatVersion: 1;
  readonly censusPath: string;
  readonly censusSha256: string;
  readonly holdingsDigest: string;
  readonly registrySha256: string;
  readonly sourceHashes: readonly ReaderSourceHash[];
  readonly evidenceHashes: readonly ReaderSourceHash[];
  readonly sourceEolEquivalences?: readonly ReaderSourceEolEquivalence[];
  /**
   * Fresh closures bind the exact execution environment separately from the
   * route/component bytes. Historical inherited receipts predate this seam
   * and remain readable, but cannot satisfy the production terminal gate.
   */
  readonly executionAuthority?: ReaderClosureExecutionAuthorityReference;
  /** A later documentary receipt may inherit rows from a proved reader head
   * only through this hash-bound, mechanically checked invalidation report. */
  readonly inheritance?: {
    readonly reportPath: string;
    readonly reportSha256: string;
  };
}

/** Exact committed pre-seam artifacts; no newly serialized receipt can enter this set. */
export const LEGACY_READER_CLOSURE_RECEIPT_SHA256 = Object.freeze({
  "docs/evidence/reader-last-mile-closure-receipt.json": "3aa9b15510ef18786b67e8b0781151caac6432fd2d963f4fba741195681f6f51",
  "docs/evidence/reader-last-mile-disclosure-contract-prior-receipt.json": "8d73e15dd2717aa2215203b011a9ce852209b9ba56ede9133387c7b8e6b242b6",
  "docs/evidence/reader-last-mile-final-closure-receipt.json": "303744f5f0e2dfb21947ddce9b1260a161791e3d9ce916077011605a02838dfb",
  "docs/evidence/reader-last-mile-prompt-caching-prior-receipt.json": "c38bf3b2c5e0152417c5d0367d48837f26334d7a24bd57c9a666d31926bbe796",
  "docs/evidence/reader-last-mile-refresh-baseline-prior-receipt.json": "476cea8d71aa198f5e80ec6037e15c848cc8b1869160b95a29ceb177c83ac0a7",
  "docs/evidence/reader-last-mile-refresh-prior-receipt.json": "8df8a8f1aab56c5c6ecda700d6289c7942a24fb2beaa288908e5f0ec53878744",
  "docs/evidence/reader-last-mile-routine-civic-data-prior-receipt.json": "e697669fe13ac75c176250e1f7edd2764157c7bf55185148841d700b62ecee40",
  "docs/evidence/reader-last-mile-tester-9-4-prior-receipt.json": "95770b41a973cd57cad55f72d5f1d61fb03bd919597686260f112721cefca5af",
  "docs/evidence/reader-last-mile-visual-prior-receipt.json": "1afa1d8448dc31f6c3a01c6f2a612a0b1bdde5e77b8501fa980557892f080a7a",
} as const);

export type ReaderClosureExecutionPhase = "REHEARSAL" | "PRODUCTION";

export interface ReaderClosureExecutionAuthorityReference {
  readonly phase: ReaderClosureExecutionPhase;
  readonly evidencePath: string;
  readonly evidenceSha256: string;
}

export interface ReaderClosureExecutionAuthorityEvidence {
  readonly formatVersion: 1;
  readonly phase: ReaderClosureExecutionPhase;
  /** Exact committed code/build head exercised by every applicable census row. */
  readonly exactHead: string;
  /** Sanitized identities only: raw URLs, host names and credentials are forbidden. */
  readonly store: {
    readonly kind: "NEON_POSTGRES";
    readonly authority: "ISOLATED_PRODUCTION_CLONE" | "STANDING_PRODUCTION";
    readonly projectIdentitySha256: string;
    readonly branchIdentitySha256: string;
    readonly endpointIdentitySha256: string;
    readonly databaseIdentitySha256: string;
    readonly schemaIdentitySha256: string;
    /** Exact sanitized provider readback archived with the authority artifact. */
    readonly providerMetadataPath: string;
    readonly providerMetadataSha256: string;
  };
  /** Proof that the closure used a separately identified read-only principal. */
  readonly readOnly: {
    readonly roleIdentitySha256: string;
    /** Catalog-derived denial of durable table/schema/database/function writes. */
    readonly roleWritePrivilegesRefused: true;
    readonly attemptedWriteRefused: true;
    readonly roleSuperuser: false;
    readonly roleCreateRole: false;
    readonly roleCreateDatabase: false;
    readonly roleReplication: false;
    readonly roleBypassRls: false;
    readonly databaseCreate: false;
    readonly schemaCreate: false;
    readonly relationOwnershipCount: 0;
    readonly columnWritePrivilegeCount: 0;
    readonly sequenceWritePrivilegeCount: 0;
    readonly writeCapableMemberRoleCount: 0;
    readonly executableSecurityDefinerFunctionCount: 0;
    readonly relations: readonly {
      readonly relation: string;
      readonly select: true;
      readonly insert: false;
      readonly update: false;
      readonly delete: false;
      readonly truncate: false;
      readonly references: false;
      readonly trigger: false;
    }[];
  };
  /** Exact importer implementation, durable import receipt and resulting pointers. */
  readonly import: {
    readonly importerCodeSha: string;
    /** Exact durable controller receipt archived with the authority artifact. */
    readonly receiptPath: string;
    readonly receiptSha256: string;
    /** Complete controller result and exact final-authority disposition membership. */
    readonly resultSha256: string;
    readonly dispositionSetSha256: string;
    readonly canonicalPointerSetSha256: string;
    readonly canonicalPointerCount: number;
    /** Live readback of the imported candidate envelopes and append-only events. */
    readonly durableImport: {
      readonly authorization: "PDC_V2_FROZEN_LKG_CUTOVER";
      readonly candidateCount: number;
      readonly currentPointerLinkCount: number;
      readonly promotedDispositionCount: number;
      readonly reattestedDispositionCount: number;
      readonly skippedDispositionCount: number;
      readonly candidateSetSha256: string;
      readonly eventCandidateCount: number;
      readonly eventCount: number;
      readonly terminalPromotedEventCount: number;
      readonly eventSetSha256: string;
      readonly predecessorCandidateCount: number;
      readonly predecessorEventCount: number;
      readonly predecessorEventSetSha256: string;
      readonly importerCodeShas: readonly string[];
    };
  };
  /** Present only for a production-clone rehearsal; production has no clone claim. */
  readonly clone: null | {
    readonly parentProductionBranchIdentitySha256: string;
    readonly sourceSnapshotSha256: string;
    readonly controlPlaneReceiptSha256: string;
  };
}

export interface ReaderClosureReadConnectionIdentity {
  readonly endpointIdentitySha256: string;
  readonly databaseIdentitySha256: string;
  readonly schemaIdentitySha256: string;
  readonly roleIdentitySha256: string;
}

export interface ReaderClosureExecutionAuthorityPaths {
  readonly authority: string;
  readonly providerMetadata: string;
  readonly importReceipt: string;
}

/** Fixed names prevent a hand-selected support file from being relabeled across phases. */
export function readerClosureExecutionAuthorityPaths(
  phase: ReaderClosureExecutionPhase,
): ReaderClosureExecutionAuthorityPaths {
  const slug = phase.toLowerCase();
  return {
    authority: `docs/evidence/reader-last-mile-${slug}-authority.json`,
    providerMetadata: `docs/evidence/reader-last-mile-${slug}-provider-metadata.json`,
    importReceipt: `docs/evidence/reader-last-mile-${slug}-import-receipt.json`,
  };
}

export function readerClosureExecutionAuthorityAdmission(
  root: string,
  evidencePath: string,
): {
  readonly evidence: ReaderClosureExecutionAuthorityEvidence;
  readonly reference: ReaderClosureExecutionAuthorityReference;
  readonly supportPaths: readonly string[];
} {
  if (!READER_CLOSURE_AUTHORITY_PATH.test(evidencePath)) {
    throw new Error("Reader execution authority evidence path is outside the immutable last-mile evidence namespace");
  }
  const bytes = readReaderEvidence(root, evidencePath);
  let evidence: ReaderClosureExecutionAuthorityEvidence;
  try { evidence = JSON.parse(bytes.toString("utf8")) as ReaderClosureExecutionAuthorityEvidence; }
  catch { throw new Error("Reader execution authority evidence is unreadable"); }
  if (evidence.phase !== "REHEARSAL" && evidence.phase !== "PRODUCTION") {
    throw new Error("Reader execution authority evidence has no valid phase");
  }
  const expectedPaths = readerClosureExecutionAuthorityPaths(evidence.phase);
  if (evidencePath !== expectedPaths.authority) {
    throw new Error("Reader execution authority evidence path does not match its exact phase-specific path");
  }
  const supportPaths = [string(object(evidence.store).providerMetadataPath), string(object(evidence.import).receiptPath)];
  if (
    supportPaths[0] !== expectedPaths.providerMetadata ||
    supportPaths[1] !== expectedPaths.importReceipt ||
    new Set([evidencePath, ...supportPaths]).size !== 3
  ) {
    throw new Error("Reader execution authority does not name its two distinct exact phase-specific support artifacts");
  }
  return {
    evidence,
    reference: { phase: evidence.phase, evidencePath, evidenceSha256: sha256(bytes) },
    supportPaths,
  };
}

const READER_CLOSURE_AUTHORITY_PATH = /^docs\/evidence\/reader-last-mile-[a-z0-9-]+\.json$/;
const EXACT_GIT_HEAD = /^[0-9a-f]{40}$/;
const EXACT_SHA256 = /^[0-9a-f]{64}$/;
const READER_CLOSURE_READ_RELATIONS = [
  "public.civic_data_candidate_events",
  "public.civic_data_candidates",
  "public.civic_data_promotions",
] as const;

/**
 * Produce only non-reversible identities from the actual read handle. The
 * terminal gate can therefore bind the attestation to the current production
 * endpoint without ever serializing a host, role, database name or credential.
 */
export function readerClosureReadConnectionIdentity(connection: string): ReaderClosureReadConnectionIdentity {
  let parsed: URL;
  try { parsed = new URL(connection); }
  catch { throw new Error("Reader closure production read handle is missing or invalid"); }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") throw new Error("Reader closure read handle is not PostgreSQL");
  const role = decodeURIComponent(parsed.username);
  if (role !== "readonly" && !role.startsWith("readonly_")) throw new Error("Reader closure production handle does not name a read-only role");
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!parsed.hostname || !database) throw new Error("Reader closure read handle has no endpoint or database identity");
  const endpoint = canonicalNeonEndpointHost(parsed);
  return {
    endpointIdentitySha256: readerAuthorityIdentityHash("endpoint", endpoint),
    databaseIdentitySha256: readerAuthorityIdentityHash("database", database),
    schemaIdentitySha256: readerAuthorityIdentityHash("schema", "public"),
    roleIdentitySha256: readerAuthorityIdentityHash("role", role),
  };
}

function exactObjectKeysProblems(value: unknown, expected: readonly string[], label: string): string[] {
  const actual = Object.keys(object(value)).sort();
  const wanted = [...expected].sort();
  return JSON.stringify(actual) === JSON.stringify(wanted)
    ? []
    : [`${label} fields differ from the sanitized authority schema`];
}

const READER_AUTHORITY_SECRET_KEY = /(?:password|passwd|secret|token|api[_-]?key|credential|private[_-]?key|database[_-]?url|connection[_-]?string|dsn|cookie|authorization[_-]?header)/i;
function readerAuthoritySecretProblems(value: unknown, path = "Reader execution authority"): string[] {
  if (typeof value === "string") {
    return /\bpostgres(?:ql)?:\/\//i.test(value) || /(?:https?:\/\/)[^\s/@]+:[^\s/@]+@/i.test(value)
      ? [`${path} contains a credential-bearing URL`]
      : [];
  }
  if (Array.isArray(value)) return value.flatMap((entry, index) => readerAuthoritySecretProblems(entry, `${path}[${index}]`));
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value as ObjectRow).flatMap(([key, entry]) => [
    ...(READER_AUTHORITY_SECRET_KEY.test(key) && !(key === "legacyRuntimeSecrets" && entry === 0) ? [`${path}.${key} is a forbidden secret-bearing field`] : []),
    ...readerAuthoritySecretProblems(entry, `${path}.${key}`),
  ]);
}

/**
 * Pure semantic half of execution-authority validation. Keeping it separate
 * makes the rehearsal/production boundary deterministically testable without
 * touching any database or control plane.
 */
export function readerClosureExecutionAuthorityEvidenceProblems(
  evidence: unknown,
  expected: {
    readonly phase: ReaderClosureExecutionPhase;
    readonly provedHead: string;
    readonly importerIsAncestor: boolean;
    readonly requiredPhase?: ReaderClosureExecutionPhase;
    readonly requiredReadConnectionIdentity?: ReaderClosureReadConnectionIdentity;
    /** Derived only from the authenticated controller disposition set. */
    readonly unionPredecessorCount?: number;
  },
): string[] {
  const failures: string[] = [];
  const row = object(evidence);
  failures.push(...readerAuthoritySecretProblems(evidence));
  failures.push(...exactObjectKeysProblems(row, ["formatVersion", "phase", "exactHead", "store", "readOnly", "import", "clone"], "Reader execution authority"));
  if (row.formatVersion !== 1) failures.push("Reader execution authority format is not version 1");
  if (row.phase !== "REHEARSAL" && row.phase !== "PRODUCTION") failures.push("Reader execution authority phase is invalid");
  if (row.phase !== expected.phase) failures.push("Reader closure authority reference phase differs from its evidence");
  if (expected.requiredPhase && row.phase !== expected.requiredPhase) failures.push(`Reader closure requires ${expected.requiredPhase} execution authority`);
  if (!EXACT_GIT_HEAD.test(string(row.exactHead)) || row.exactHead !== expected.provedHead) failures.push("Reader execution authority does not bind the exact proved code head");

  const store = object(row.store);
  const expectedPaths = row.phase === "REHEARSAL" || row.phase === "PRODUCTION"
    ? readerClosureExecutionAuthorityPaths(row.phase)
    : null;
  failures.push(...exactObjectKeysProblems(store, ["kind", "authority", "projectIdentitySha256", "branchIdentitySha256", "endpointIdentitySha256", "databaseIdentitySha256", "schemaIdentitySha256", "providerMetadataPath", "providerMetadataSha256"], "Reader execution authority store"));
  if (store.kind !== "NEON_POSTGRES") failures.push("Reader execution authority store is not the canonical Neon Postgres plane");
  for (const field of ["projectIdentitySha256", "branchIdentitySha256", "endpointIdentitySha256", "databaseIdentitySha256", "schemaIdentitySha256", "providerMetadataSha256"] as const) {
    if (!EXACT_SHA256.test(string(store[field]))) failures.push(`Reader execution authority store ${field} is not a sanitized SHA-256 identity`);
  }
  if (!expectedPaths || store.providerMetadataPath !== expectedPaths.providerMetadata) failures.push("Reader execution authority provider metadata path does not match its exact phase-specific support path");
  if (store.projectIdentitySha256 !== readerAuthorityIdentityHash("project", PDC_NEON_PROJECT_ID)) failures.push("Reader execution authority does not bind the pinned PDC Neon project");
  const productionBranchIdentity = readerAuthorityIdentityHash("branch", PDC_PRODUCTION_BRANCH_ID);
  if (row.phase === "PRODUCTION" && store.branchIdentitySha256 !== productionBranchIdentity) failures.push("Reader production execution authority does not bind the pinned production branch");

  const readOnly = object(row.readOnly);
  failures.push(...exactObjectKeysProblems(readOnly, ["roleIdentitySha256", "roleWritePrivilegesRefused", "attemptedWriteRefused", "roleSuperuser", "roleCreateRole", "roleCreateDatabase", "roleReplication", "roleBypassRls", "databaseCreate", "schemaCreate", "relationOwnershipCount", "columnWritePrivilegeCount", "sequenceWritePrivilegeCount", "writeCapableMemberRoleCount", "executableSecurityDefinerFunctionCount", "relations"], "Reader execution authority read-only proof"));
  if (!EXACT_SHA256.test(string(readOnly.roleIdentitySha256))) failures.push("Reader execution authority read-only role is not a sanitized SHA-256 identity");
  if (readOnly.attemptedWriteRefused !== true) failures.push("Reader execution authority did not prove a refused write through the read-only principal");
  if (
    readOnly.roleWritePrivilegesRefused !== true || readOnly.roleSuperuser !== false ||
    readOnly.roleCreateRole !== false || readOnly.roleCreateDatabase !== false ||
    readOnly.roleReplication !== false || readOnly.roleBypassRls !== false ||
    readOnly.databaseCreate !== false ||
    readOnly.schemaCreate !== false || readOnly.relationOwnershipCount !== 0 ||
    readOnly.columnWritePrivilegeCount !== 0 || readOnly.sequenceWritePrivilegeCount !== 0 ||
    readOnly.writeCapableMemberRoleCount !== 0 || readOnly.executableSecurityDefinerFunctionCount !== 0
  ) failures.push("Reader execution authority principal retains a durable write or escalation capability");
  if (expected.requiredReadConnectionIdentity) {
    if (store.endpointIdentitySha256 !== expected.requiredReadConnectionIdentity.endpointIdentitySha256) failures.push("Reader execution authority endpoint differs from the active production read handle");
    if (store.databaseIdentitySha256 !== expected.requiredReadConnectionIdentity.databaseIdentitySha256) failures.push("Reader execution authority database differs from the active production read handle");
    if (store.schemaIdentitySha256 !== expected.requiredReadConnectionIdentity.schemaIdentitySha256) failures.push("Reader execution authority schema differs from the canonical production Reader schema");
    if (readOnly.roleIdentitySha256 !== expected.requiredReadConnectionIdentity.roleIdentitySha256) failures.push("Reader execution authority role differs from the active production read-only principal");
  }
  const relations = Array.isArray(readOnly.relations) ? readOnly.relations : [];
  if (!Array.isArray(readOnly.relations)) failures.push("Reader execution authority read-only relation proof is missing");
  const relationNames: string[] = [];
  for (const relationValue of relations) {
    const relation = object(relationValue);
    failures.push(...exactObjectKeysProblems(relation, ["relation", "select", "insert", "update", "delete", "truncate", "references", "trigger"], "Reader execution authority relation"));
    relationNames.push(string(relation.relation));
    if (relation.select !== true || relation.insert !== false || relation.update !== false || relation.delete !== false || relation.truncate !== false || relation.references !== false || relation.trigger !== false) {
      failures.push(`${string(relation.relation) || "Unknown relation"}: Reader closure principal is not strictly read-only`);
    }
  }
  if (JSON.stringify([...relationNames].sort()) !== JSON.stringify([...READER_CLOSURE_READ_RELATIONS])) {
    failures.push("Reader execution authority does not prove the exact canonical civic-data relation set");
  }

  const imported = object(row.import);
  failures.push(...exactObjectKeysProblems(imported, ["importerCodeSha", "receiptPath", "receiptSha256", "resultSha256", "dispositionSetSha256", "canonicalPointerSetSha256", "canonicalPointerCount", "durableImport"], "Reader execution authority import"));
  if (!EXACT_GIT_HEAD.test(string(imported.importerCodeSha))) failures.push("Reader execution authority importer code identity is not an exact Git head");
  if (!expected.importerIsAncestor) failures.push("Reader execution authority importer code is not an ancestor of the proved code head");
  if (row.phase === "PRODUCTION" && imported.importerCodeSha === row.exactHead) failures.push("Reader production execution authority was generated before the importer was deleted in child commit B");
  if (row.phase === "REHEARSAL" && imported.importerCodeSha !== row.exactHead) failures.push("Reader rehearsal execution authority does not bind its exact isolated import head");
  for (const field of ["receiptSha256", "resultSha256", "dispositionSetSha256", "canonicalPointerSetSha256"] as const) {
    if (!EXACT_SHA256.test(string(imported[field]))) failures.push(`Reader execution authority import ${field} is not an exact SHA-256 identity`);
  }
  if (!expectedPaths || imported.receiptPath !== expectedPaths.importReceipt) failures.push("Reader execution authority import receipt path does not match its exact phase-specific support path");
  if (!Number.isSafeInteger(imported.canonicalPointerCount) || Number(imported.canonicalPointerCount) <= 0) failures.push("Reader execution authority canonical pointer set is empty or uncounted");

  const durable = object(imported.durableImport);
  failures.push(...exactObjectKeysProblems(durable, [
    "authorization", "candidateCount", "currentPointerLinkCount", "promotedDispositionCount",
    "reattestedDispositionCount", "skippedDispositionCount", "candidateSetSha256",
    "eventCandidateCount", "eventCount", "terminalPromotedEventCount", "eventSetSha256",
    "predecessorCandidateCount", "predecessorEventCount", "predecessorEventSetSha256",
    "importerCodeShas",
  ], "Reader execution authority durable import"));
  if (durable.authorization !== "PDC_V2_FROZEN_LKG_CUTOVER") failures.push("Reader execution authority durable import lacks the frozen cutover authorization");
  for (const field of ["candidateSetSha256", "eventSetSha256", "predecessorEventSetSha256"] as const) {
    if (!EXACT_SHA256.test(string(durable[field]))) failures.push(`Reader execution authority durable import ${field} is not an exact SHA-256 identity`);
  }
  const candidateCount = Number(durable.candidateCount);
  const promotedCount = Number(durable.promotedDispositionCount);
  const reattestedCount = Number(durable.reattestedDispositionCount);
  const skippedCount = Number(durable.skippedDispositionCount);
  const unionPredecessorCount = expected.unionPredecessorCount ?? 0;
  if (
    !Number.isSafeInteger(candidateCount) || candidateCount <= 0 ||
    durable.currentPointerLinkCount !== candidateCount || durable.eventCandidateCount !== candidateCount ||
    durable.terminalPromotedEventCount !== candidateCount ||
    !Number.isSafeInteger(durable.predecessorCandidateCount) || Number(durable.predecessorCandidateCount) < 0 ||
    !Number.isSafeInteger(durable.predecessorEventCount) || Number(durable.predecessorEventCount) < Number(durable.predecessorCandidateCount) ||
    !Number.isSafeInteger(unionPredecessorCount) || unionPredecessorCount < 0 || unionPredecessorCount > promotedCount ||
    (row.phase === "PRODUCTION"
      ? Number(durable.predecessorCandidateCount) > reattestedCount + unionPredecessorCount
      : Number(durable.predecessorCandidateCount) !== reattestedCount + unionPredecessorCount) ||
    !Number.isSafeInteger(durable.eventCount) || Number(durable.eventCount) < candidateCount ||
    !Number.isSafeInteger(promotedCount) || !Number.isSafeInteger(reattestedCount) || !Number.isSafeInteger(skippedCount) ||
    promotedCount < 0 || reattestedCount < 0 || skippedCount < 0 ||
    promotedCount + skippedCount !== candidateCount || reattestedCount > promotedCount
  ) failures.push("Reader execution authority durable import counts do not form one exact pointer/event/disposition denominator");
  if (
    !Array.isArray(durable.importerCodeShas) || durable.importerCodeShas.length !== 1 ||
    durable.importerCodeShas[0] !== imported.importerCodeSha
  ) failures.push("Reader execution authority durable import is not bound solely to the controller importer code");

  if (row.phase === "REHEARSAL") {
    if (store.authority !== "ISOLATED_PRODUCTION_CLONE") failures.push("REHEARSAL Reader closure is not bound to an isolated production clone");
    const clone = object(row.clone);
    failures.push(...exactObjectKeysProblems(clone, ["parentProductionBranchIdentitySha256", "sourceSnapshotSha256", "controlPlaneReceiptSha256"], "Reader rehearsal clone"));
    for (const field of ["parentProductionBranchIdentitySha256", "sourceSnapshotSha256", "controlPlaneReceiptSha256"] as const) {
      if (!EXACT_SHA256.test(string(clone[field]))) failures.push(`Reader rehearsal clone ${field} is not an exact SHA-256 identity`);
    }
    if (clone.parentProductionBranchIdentitySha256 !== productionBranchIdentity) failures.push("Reader rehearsal clone parent is not the pinned production branch");
    if (store.branchIdentitySha256 === clone.parentProductionBranchIdentitySha256) failures.push("Reader rehearsal branch identity equals the standing production branch identity");
  } else if (row.phase === "PRODUCTION") {
    if (store.authority !== "STANDING_PRODUCTION") failures.push("PRODUCTION Reader closure is not bound to the standing production store");
    if (row.clone !== null) failures.push("PRODUCTION Reader closure carries a rehearsal clone claim");
  }
  return unique(failures);
}

export function readerClosureExecutionAuthorityProblems(
  root: string,
  census: ReaderCensus,
  reference: ReaderClosureExecutionAuthorityReference | undefined,
  evidenceHashes: readonly ReaderSourceHash[],
  options: {
    readonly provedHead?: string | null;
    readonly requiredPhase?: ReaderClosureExecutionPhase;
    readonly requiredReadConnectionIdentity?: ReaderClosureReadConnectionIdentity;
  } = {},
): string[] {
  if (!reference) return ["Fresh Reader closure requires exact execution-authority evidence"];
  const failures: string[] = [];
  failures.push(...readerAuthoritySecretProblems(reference, "Reader execution authority reference"));
  failures.push(...exactObjectKeysProblems(reference, ["phase", "evidencePath", "evidenceSha256"], "Reader execution authority reference"));
  if (reference.phase !== "REHEARSAL" && reference.phase !== "PRODUCTION") failures.push("Reader execution authority reference phase is invalid");
  const expectedReferencePaths = reference.phase === "REHEARSAL" || reference.phase === "PRODUCTION"
    ? readerClosureExecutionAuthorityPaths(reference.phase)
    : null;
  if (!expectedReferencePaths || reference.evidencePath !== expectedReferencePaths.authority) failures.push("Reader execution authority evidence path does not match its exact phase-specific path");
  if (!EXACT_SHA256.test(reference.evidenceSha256)) failures.push("Reader execution authority reference lacks an exact SHA-256 hash");
  const manifested = evidenceHashes.filter((entry) => entry.path === reference.evidencePath && entry.sha256 === reference.evidenceSha256);
  if (manifested.length !== 1) failures.push("Reader execution authority is not included exactly once in the closure evidence manifest");

  let bytes: Buffer;
  let evidence: ReaderClosureExecutionAuthorityEvidence;
  try {
    bytes = readReaderEvidence(root, reference.evidencePath);
    if (sha256(bytes) !== reference.evidenceSha256) failures.push("Reader execution authority evidence bytes changed");
    evidence = JSON.parse(bytes.toString("utf8")) as ReaderClosureExecutionAuthorityEvidence;
  } catch {
    failures.push("Reader execution authority evidence is missing or unreadable");
    return unique(failures);
  }

  const applicable = census.rows.filter((row) => (row.applicableEligibleRecordIds ?? row.eligibleRecordIds).length > 0);
  const heads = unique(applicable.map((row) => row.provedHead ?? ""));
  const provedHead = options.provedHead ?? (heads.length === 1 ? heads[0]! : null);
  if (!provedHead || !EXACT_GIT_HEAD.test(provedHead)) failures.push("Fresh Reader closure does not have one exact proved head across every applicable census row");
  let importerIsAncestor = false;
  const importerCodeSha = string(object(evidence.import).importerCodeSha);
  if (EXACT_GIT_HEAD.test(importerCodeSha) && provedHead && EXACT_GIT_HEAD.test(provedHead)) {
    try {
      execFileSync("git", ["merge-base", "--is-ancestor", importerCodeSha, provedHead], { cwd: root, stdio: "ignore" });
      importerIsAncestor = true;
    } catch { /* reported by the semantic validator */ }
  }
  let unionPredecessorCount = 0;
  try {
    const admitted = admitReaderExecutionAuthorityArchivedSupport(evidence,
      readReaderEvidence(root, evidence.store.providerMetadataPath),
      readReaderEvidence(root, evidence.import.receiptPath));
    unionPredecessorCount = admitted.dispositionSet.filter((entry) => entry.disposition === "PROMOTED_FROZEN_LKG_UNION").length;
  } catch { /* The independent archived-support check below reports refusal. */ }
  failures.push(...readerClosureExecutionAuthorityEvidenceProblems(evidence, {
    phase: reference.phase,
    provedHead: provedHead ?? "",
    importerIsAncestor,
    requiredPhase: options.requiredPhase,
    requiredReadConnectionIdentity: options.requiredReadConnectionIdentity,
    unionPredecessorCount,
  }));
  const support = [
    { path: string(object(evidence.store).providerMetadataPath), sha256: string(object(evidence.store).providerMetadataSha256), label: "provider metadata" },
    { path: string(object(evidence.import).receiptPath), sha256: string(object(evidence.import).receiptSha256), label: "durable import receipt" },
  ];
  if (new Set([reference.evidencePath, ...support.map((item) => item.path)]).size !== 3) {
    failures.push("Reader execution authority and its support artifacts are not three distinct paths");
  }
  for (const item of support) {
    const supportManifestEntries = evidenceHashes.filter((entry) => entry.path === item.path && entry.sha256 === item.sha256);
    if (supportManifestEntries.length !== 1) failures.push(`Reader execution authority ${item.label} is not included exactly once in the closure evidence manifest`);
    if (!readerEvidenceHashMatches(root, item.path, item.sha256)) failures.push(`Reader execution authority ${item.label} bytes changed`);
  }
  try {
    failures.push(...readerExecutionAuthorityArchivedSupportProblems(
      evidence,
      readReaderEvidence(root, support[0]!.path),
      readReaderEvidence(root, support[1]!.path),
    ));
  } catch {
    failures.push("Reader execution authority support evidence is missing or unreadable");
  }
  return unique(failures);
}

export type ReaderProofDisposition = "INHERITED" | "INVALIDATED" | "RECOMPUTED";
export interface ReaderProofInvalidationRow {
  readonly rowId: string;
  readonly disposition: ReaderProofDisposition;
  readonly acceptance: string;
  readonly reason: string;
  readonly baselineStructuralSha256: string | null;
  readonly currentStructuralSha256: string;
  readonly holdings: readonly { path: string; baselineSha256: string | null; currentSha256: string | null }[];
}
export interface ReaderProofInvalidationReport {
  readonly formatVersion: 1;
  readonly baselineReaderHead: string;
  readonly baselineProofCommit: string;
  readonly baselineReceiptPath: string;
  readonly baselineReceiptSha256: string;
  readonly baselineCensusPath: string;
  readonly baselineCensusSha256: string;
  readonly currentReaderHead: string;
  readonly reportPath: string;
  readonly rule: string;
  readonly acceptances: readonly {
    id: string;
    disposition: "INHERITED" | "INVALIDATED";
    dependencies: readonly string[];
    proof: string;
  }[];
  readonly changedReaderSources: readonly { path: string; baselineSha256: string | null; currentSha256: string | null; acceptance: string; reason: string }[];
  readonly changedHoldings: readonly { path: string; family: string; baselineSha256: string | null; currentSha256: string | null; acceptance: string }[];
  readonly rows: readonly ReaderProofInvalidationRow[];
  readonly counts: Readonly<Record<ReaderProofDisposition, number>>;
  readonly failures: readonly string[];
  /** Explicit conservative full re-proof. No reader row is inherited; every
   * applicable reader row carries a fresh current-head delivery proof. Any
   * changed reader source or holding is therefore covered by complete
   * current-head re-rendering rather than a per-source impact classification,
   * so shared styles, runtime/config dependencies and other effects that import
   * reachability cannot bound are all re-proved. Fails closed: a single row
   * without a complete current-head proof (or any inherited row) is rejected. */
  readonly fullReproof?: boolean;
  /** Executed presentation renewal over an unchanged, previously closed census.
   * The historical row proofs and their original execution heads are retained. */
  readonly sourceRevalidation?: {
    readonly priorReceiptPath: string;
    readonly priorReceiptSha256: string;
    readonly priorReportPath: string;
    readonly priorReportSha256: string;
    readonly proofPath: string;
    readonly proofSha256: string;
  };
}

export interface ReaderSourceRevalidation {
  readonly exactHead: string;
  readonly baselineCommit: string;
  readonly baselineReceiptPath: string;
  readonly baselineReceiptSha256: string;
  readonly holdingsDigest: string;
  readonly registrySha256: string;
  readonly sourceHashes: readonly ReaderSourceHash[];
  readonly changedSources: readonly string[];
  readonly rows: readonly { rowId: string; structuralSha256: string; deliverySha256: string }[];
  readonly executions: readonly {
    id: string; sourcePaths: readonly string[]; evidencePath: string;
    evidenceSha256: string; expected: number; passed: number;
  }[];
  readonly failures: readonly string[];
}

/** Recheck stored DOM/SSR observations, rather than trusting a PASS label. */
export function sourceRenewalCaseProblems(cases: readonly ReaderComponentCase[]): string[] {
  const failures: string[] = [];
  if (!cases.length) failures.push("Source renewal requires nonempty rendered cases");
  for (const entry of cases) {
    if (!entry.markup || sha256(entry.markup) !== entry.markupSha256 || !entry.expectedFragments?.length || !entry.actualCanonicalIdentities?.length) failures.push(`${entry.auditId}: incomplete rendered observation`);
    failures.push(...(entry.failures ?? ["missing execution conclusion"]));
    failures.push(...inspectReaderMarkup(entry.markup ?? "", entry.expectedFragments ?? [], entry.forbiddenFragments ?? [], entry.rowCounts ?? {}));
  }
  return unique(failures);
}

/** A removed import is proved by its committed old bytes AND absence from the
 * complete current graph. It cannot masquerade as executed current source. */
export function sourceRenewalDependencyProblems(input: {
  changedSources: readonly string[]; executionSourcePaths: readonly string[];
  priorSources: readonly ReaderSourceHash[]; currentSources: readonly ReaderSourceHash[];
  executedSources: readonly ReaderSourceHash[]; removedSourceHashes: readonly ReaderSourceHash[];
  renderedComponents: readonly string[];
}): { failures: string[]; covered: string[] } {
  const failures: string[] = [];
  const covered: string[] = [];
  const prior = new Map(input.priorSources.map(source => [source.path, source.sha256]));
  const current = new Map(input.currentSources.map(source => [source.path, source.sha256]));
  const executed = new Map(input.executedSources.map(source => [source.path, source.sha256]));
  const removed = new Map(input.removedSourceHashes.map(source => [source.path, source.sha256]));
  if (removed.size !== input.removedSourceHashes.length) failures.push("Reader source removal repeats a dependency");
  for (const source of input.removedSourceHashes) {
    if (!input.changedSources.includes(source.path) || !input.executionSourcePaths.includes(source.path) ||
      !prior.has(source.path) || prior.get(source.path) !== source.sha256 || current.has(source.path) ||
      executed.has(source.path) || input.renderedComponents.includes(source.path)) {
      failures.push(`Reader source removal lacks exact prior bytes and current graph absence: ${source.path}`);
    }
  }
  for (const path of input.executionSourcePaths) {
    if (!input.changedSources.includes(path)) { failures.push(`Source renewal invents changed dependency: ${path}`); continue; }
    if (current.has(path)) {
      if (executed.get(path) !== current.get(path)) failures.push(`Source renewal execution does not bind ${path}`);
      else covered.push(path);
    } else if (prior.has(path) && removed.get(path) === prior.get(path) && !executed.has(path) && !input.renderedComponents.includes(path)) covered.push(path);
    else failures.push(`Removed reader dependency has no exact committed removal evidence: ${path}`);
  }
  return { failures: unique(failures), covered: unique(covered) };
}

/** Renew executable-source evidence without rewriting a historical execution.
 * The unchanged census and previous report are pinned to committed evidence;
 * every changed dependency needs nonempty current-head execution evidence. */
export function readerSourceRevalidationProblems(root: string, census: ReaderCensus, report: ReaderProofInvalidationReport): string[] {
  const renewal = report.sourceRevalidation;
  if (!renewal) return [];
  const failures: string[] = [];
  const read = <T>(path: string, hash: string): T => {
    const bytes = readReaderEvidence(root, path);
    if (sha256(bytes) !== hash) failures.push(`Reader source renewal bytes changed: ${path}`);
    return JSON.parse(bytes.toString("utf8")) as T;
  };
  const prior = read<ReaderClosureReceipt>(renewal.priorReceiptPath, renewal.priorReceiptSha256);
  const previousReport = read<ReaderProofInvalidationReport>(renewal.priorReportPath, renewal.priorReportSha256);
  const proof = read<ReaderSourceRevalidation>(renewal.proofPath, renewal.proofSha256);
  if (!/^[a-f0-9]{40}$/.test(proof.baselineCommit) || !/^[a-f0-9]{40}$/.test(proof.exactHead)) return [...failures, "Reader source renewal requires exact committed heads"];
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", proof.baselineCommit, proof.exactHead], { cwd: root, stdio: "pipe" });
    execFileSync("git", ["merge-base", "--is-ancestor", proof.exactHead, "HEAD"], { cwd: root, stdio: "pipe" });
    const committed = execFileSync("git", ["show", `${proof.baselineCommit}:${proof.baselineReceiptPath}`], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
    if (sha256(committed) !== renewal.priorReceiptSha256 || proof.baselineReceiptSha256 !== renewal.priorReceiptSha256) failures.push("Reader source renewal does not bind the committed prior receipt");
  } catch { failures.push("Reader source renewal cannot establish its committed baseline or execution ancestry"); }
  if (prior.censusSha256 !== sha256(readReaderEvidence(root, prior.censusPath)) || prior.holdingsDigest !== proof.holdingsDigest || prior.registrySha256 !== proof.registrySha256 || census.holdingsDigest !== proof.holdingsDigest || census.registrySha256 !== proof.registrySha256) failures.push("Source-only renewal cannot change canonical holdings or its closed census");
  if (!prior.inheritance || prior.inheritance.reportSha256 !== renewal.priorReportSha256) failures.push("Reader source renewal does not bind the prior invalidation report");
  for (const key of ["rows", "counts", "changedHoldings", "currentReaderHead", "baselineReaderHead", "baselineProofCommit"] as const) if (JSON.stringify(report[key]) !== JSON.stringify(previousReport[key])) failures.push(`Source renewal rewrote historical ${key}`);
  failures.push(...proof.failures, ...readerSourceHashProblems(root, proof.sourceHashes));
  const current = readerSourceFingerprint(root);
  if (JSON.stringify(current) !== JSON.stringify(proof.sourceHashes)) failures.push("Source renewal does not fingerprint the complete current reader dependency graph");
  const priorHashes = new Map(prior.sourceHashes.map(source => [source.path, source.sha256]));
  for (const equivalent of prior.sourceEolEquivalences ?? []) priorHashes.set(equivalent.path, equivalent.canonicalLfSha256);
  const currentHashes = new Map(current.map(source => [source.path, source.sha256]));
  const changed = unique([...priorHashes.keys(), ...currentHashes.keys()]).filter(path => priorHashes.get(path) !== currentHashes.get(path));
  if (JSON.stringify(changed) !== JSON.stringify([...proof.changedSources].sort())) failures.push("Source renewal omits or invents a changed reader dependency");
  const covered = new Set<string>();
  for (const execution of proof.executions) {
    if (!execution.expected || execution.passed !== execution.expected || !readerEvidenceHashMatches(root, execution.evidencePath, execution.evidenceSha256)) { failures.push(`Source renewal execution is missing, empty or failed: ${execution.id}`); continue; }
    const evidence = object(JSON.parse(readReaderEvidence(root, execution.evidencePath).toString("utf8")));
    if (evidence.exactHead !== proof.exactHead || !Array.isArray(evidence.failures) || evidence.failures.length || !Array.isArray(evidence.sourceHashes) || readerSourceHashProblems(root, evidence.sourceHashes as ReaderSourceHash[]).length) { failures.push(`Source renewal execution is stale or unbound: ${execution.id}`); continue; }
    const cases = Array.isArray(evidence.cases) ? evidence.cases as ReaderComponentCase[] : [];
    if (cases.length !== execution.expected || sourceRenewalCaseProblems(cases).length || cases.some(entry => currentHashes.get(entry.component) !== entry.componentSha256)) { failures.push(`Source renewal execution has missing, stale or invalid rendered cases: ${execution.id}`); continue; }
    if (!Array.isArray(evidence.inputs) || !evidence.inputs.length || (evidence.inputs as ReaderSourceHash[]).some(input => !readerEvidenceHashMatches(root, input.path, input.sha256))) { failures.push(`Source renewal execution inputs changed: ${execution.id}`); continue; }
    const dependencies = sourceRenewalDependencyProblems({ changedSources: changed, executionSourcePaths: execution.sourcePaths,
      priorSources: [...priorHashes].map(([path, sha256]) => ({ path, sha256 })), currentSources: current,
      executedSources: evidenceSourceHashes(evidence.sourceHashes), removedSourceHashes: evidenceSourceHashes(evidence.removedSourceHashes),
      renderedComponents: cases.map(entry => entry.component) });
    failures.push(...dependencies.failures);
    for (const path of dependencies.covered) covered.add(path);
  }
  for (const path of changed) if (!covered.has(path)) failures.push(`Reader dependency has no executed renewal: ${path}`);
  const baselineRows = new Map(census.rows.map(row => [row.id, row]));
  if (proof.rows.length !== baselineRows.size || new Set(proof.rows.map(row => row.rowId)).size !== baselineRows.size) failures.push("Source renewal must compare every prior row exactly once");
  for (const row of proof.rows) {
    const baseline = baselineRows.get(row.rowId);
    if (!baseline || row.structuralSha256 !== readerRowStructuralSha256(baseline) || row.deliverySha256 !== sha256(JSON.stringify(baseline))) failures.push(`Source renewal changed or lost a canonical row: ${row.rowId}`);
  }
  return unique(failures);
}

export const READER_LAST_MILE_BASE_HEAD = "d9dc2010f8a34766cd2a24ed672a64ac448619e9";
export const READER_LAST_MILE_BASE_PROOF_COMMIT = "74f748cff379df2181785ad4e5f487d3dccac7c9";
const readerLastMileInvalidatedFamilies = new Map<string, { acceptance: string; reason: string }>([
  ["ballot", { acceptance: "LM-F2/LM-F5", reason: "The shared ballot normalizer and NJ canonical ballot/contact holdings changed; the ballot family is re-proved through its actual DOM and grounded Ask routes." }],
  ["state-money", { acceptance: "LM-F4/LM-F5", reason: "The official/candidacy bridge metadata changed; every controlled state-money target and shared visual/Ask/funding projection is re-proved." }],
  ["federal-finance", { acceptance: "LM-F2/LM-F5", reason: "The canonical FEC snapshot changed; every federal funding target and shared visual/Ask projection is re-proved." }],
  ["meetings", { acceptance: "LM-F8", reason: "The canonical calendar/agenda snapshot, listing identity, route payload and Ask behavior changed." }],
  ["minutes-summaries", { acceptance: "LM-F8", reason: "Meeting selection and the shared meeting popup/Ask knowledge path changed." }],
  ["notice-summaries", { acceptance: "LM-F8", reason: "Agenda publication and shared meeting popup/Ask knowledge behavior changed." }],
  ["comment-access", { acceptance: "LM-F8", reason: "The meeting panel and shared Ask meeting-knowledge path changed." }],
  ["outcomes", { acceptance: "LM-F8", reason: "Agenda/meeting identity context changed around the existing outcome reader payload." }],
  ["congress", { acceptance: "LM-F10", reason: "The current official Congress roster and its canonical identity projection changed; every Congress Reader route is re-proved at the exact implementation head." }],
  ["registry", { acceptance: "LM-F10", reason: "The canonical officeholder registry and promoted Census/legislative read boundary changed; every registry-backed Reader route is re-proved." }],
  ["votes", { acceptance: "LM-F10", reason: "The official federal vote window, key-vote semantics and promoted state-vote read boundary changed; vote and grounded Ask routes are re-proved." }],
]);
const routineCivicDataReaderSources = new Map<string, ReadonlySet<string>>([
  ["app/api/ask/grounded/route.ts", new Set(["federal-finance", "votes"])],
  ["app/api/funding/[target]/route.ts", new Set(["federal-finance"])],
  ["app/api/reactions/route.ts", new Set(["federal-finance"])],
  ["app/api/votes/route.ts", new Set(["votes"])],
  ["app/ballot/page.tsx", new Set(["federal-finance"])],
  ["data/votes/bill-summaries.json", new Set(["votes"])],
  ["lib/ask/votes.ts", new Set(["votes"])],
  ["lib/ballot/incumbency-resolve.ts", new Set(["ballot"])],
  ["lib/ballot/incumbent-record.ts", new Set(["ballot", "federal-finance"])],
  ["lib/civic-data/curated-reader-read-model.ts", new Set(["ballot", "registry"])],
  ["lib/civic-data/manual-read-models.ts", new Set(["ballot"])],
  ["lib/civic-data/read-model.ts", new Set(["federal-finance", "registry", "votes"])],
  ["lib/civic-data/store.ts", new Set(["federal-finance", "registry", "votes"])],
  ["lib/db/schema.ts", new Set(["federal-finance", "registry", "votes"])],
  ["lib/db/write-guard.ts", new Set(["federal-finance", "registry", "votes"])],
  ["lib/funding/snapshot.ts", new Set(["federal-finance"])],
  ["lib/log/client.ts", new Set([])],
  ["lib/officials/federal-directory-read-model.ts", new Set(["congress"])],
  ["lib/registry/coverage.ts", new Set(["congress", "registry"])],
  ["lib/registry/representation.ts", new Set(["congress", "registry"])],
  ["lib/registry/runtime-read-model.ts", new Set(["registry"])],
  ["lib/registry/server.ts", new Set(["congress", "registry"])],
  ["lib/search/body-row.ts", new Set([])],
  ["lib/sources/legiscan/snapshot.ts", new Set(["votes"])],
  ["lib/sources/legiscan/types.ts", new Set(["votes"])],
  ["lib/votes/key-votes.ts", new Set(["votes"])],
]);
const readerDeliveryFields = new Set([
  "actualIdentityUsed", "provedHead", "observedExpectedRecordIds", "observedRenderedRecordIds", "bundleProvedRecordIds",
  "loaderCanReadHolding", "eligibleRecordsProjected", "deployedBundleProved", "deliveryState", "falseNegativeCount",
  "falsePositiveCount", "evidencePaths", "deliveryReason",
]);
export function readerRowStructuralSha256(row: CensusRow): string {
  const structural = Object.fromEntries(Object.entries(row).filter(([key]) => !readerDeliveryFields.has(key))) as Record<string, unknown>;
  // Applicability is structural, but the explanatory snapshot time is not. It
  // must not invalidate an otherwise byte-identical meeting row on every run.
  if (structural.applicabilityByRecord && typeof structural.applicabilityByRecord === "object") {
    structural.applicabilityByRecord = Object.fromEntries(Object.entries(structural.applicabilityByRecord).map(([id, entry]) => {
      if (!entry || typeof entry !== "object" || !("reason" in entry) || typeof entry.reason !== "string") return [id, entry];
      return [id, { ...entry, reason: entry.reason.replace(/ at \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\.(?= This is a current-calendar scope)/, " at <evaluation-time>.") }];
    }));
  }
  return sha256(JSON.stringify(structural));
}
function readerSourceImpact(path: string): { acceptance: string; reason: string } | null {
  if (routineCivicDataReaderSources.has(path)) return { acceptance: "LM-F10", reason: "Routine civic-data runtime projection, refreshed official holding, or one of its Reader/Ask consumers." };
  if (path.startsWith("data/fec/")) return { acceptance: "LM-F2/LM-F5", reason: "Canonical federal-finance holding." };
  if (/^data\/states\/nj\/ballot\//.test(path)) return { acceptance: "LM-F2/LM-F5", reason: "Canonical NJ ballot/contact holding." };
  if (/^(?:data\/meetings-snapshot\.json|app\/api\/(?:agenda|meetings|ask\/(?:agenda|grounded))\/route\.ts|components\/(?:map|shell)\/|lib\/(?:ask\/(?:answer|evidence|meeting-knowledge|synthesize)|map\/marker-pool|meetings\/|state\/(?:data\.tsx|defaults\.ts|types\.ts)))/.test(path)) {
    return { acceptance: "LM-F8", reason: "Bounded meeting/calendar identity, count, failed-refresh, agenda or Ask delta." };
  }
  if (path === "app/globals.css") return { acceptance: "LM-F8", reason: "Equivalent radius-token substitution is covered by the small final rendered sample." };
  return null;
}
function readerSourceInvalidatesFamily(path: string, family: string): boolean {
  if (routineCivicDataReaderSources.has(path)) return routineCivicDataReaderSources.get(path)!.has(family);
  if (path.startsWith("data/fec/")) return family === "federal-finance";
  if (/^data\/states\/nj\/ballot\//.test(path)) return family === "ballot";
  if (/^(?:data\/meetings-snapshot\.json|app\/api\/(?:agenda|meetings|ask\/(?:agenda|grounded))\/route\.ts|components\/(?:map|shell)\/|lib\/(?:ask\/(?:answer|evidence|meeting-knowledge|synthesize)|map\/marker-pool|meetings\/|state\/(?:data\.tsx|defaults\.ts|types\.ts)))/.test(path)) {
    return ["meetings", "minutes-summaries", "notice-summaries", "comment-access", "outcomes"].includes(family);
  }
  return path === "app/globals.css" && readerLastMileInvalidatedFamilies.has(family);
}
function copyInheritedReaderDelivery(current: CensusRow, baseline: CensusRow, reportPath: string): CensusRow {
  return {
    ...current,
    actualIdentityUsed: baseline.actualIdentityUsed,
    provedHead: baseline.provedHead,
    observedExpectedRecordIds: baseline.observedExpectedRecordIds,
    observedRenderedRecordIds: baseline.observedRenderedRecordIds,
    bundleProvedRecordIds: baseline.bundleProvedRecordIds,
    eligibleRecordsProjected: baseline.eligibleRecordsProjected,
    deployedBundleProved: baseline.deployedBundleProved,
    deliveryState: baseline.deliveryState,
    falseNegativeCount: baseline.falseNegativeCount,
    falsePositiveCount: baseline.falsePositiveCount,
    evidencePaths: unique([...baseline.evidencePaths, reportPath]),
    deliveryReason: `Dependency-aware inheritance from ${baseline.provedHead}: row structure, canonical identities and every holding byte for this row are unchanged. ${baseline.deliveryReason}`,
  };
}

/** Carry only unchanged, already-proved rows across the frozen last-mile delta.
 * Any changed row outside the declared family boundary stays unproved and is a
 * hard failure; this is deliberately more conservative than HEAD equality. */
export function inheritReaderProofs(root: string, current: ReaderCensus, options: { baselineCensusPath: string; baselineReceiptPath: string; reportPath: string; currentReaderHead: string; onlyChangedDependencies?: boolean; fullReproof?: boolean }): { census: ReaderCensus; report: ReaderProofInvalidationReport } {
  const baselineReceiptBytes = readReaderEvidence(root, options.baselineReceiptPath);
  const baselineReceipt = JSON.parse(baselineReceiptBytes.toString("utf8")) as ReaderClosureReceipt;
  const baselineCensusBytes = readReaderEvidence(root, options.baselineCensusPath);
  const baseline = JSON.parse(baselineCensusBytes.toString("utf8")) as ReaderCensus;
  const failures: string[] = [];
  if (baselineReceipt.censusSha256 !== sha256(baselineCensusBytes) || baselineReceipt.censusPath !== options.baselineCensusPath) failures.push("Baseline receipt does not bind the inherited census bytes");
  if (censusClosureFailures(baseline).length) failures.push("Baseline census is not closed");
  const baselineRows = new Map(baseline.rows.map((row) => [row.id, row]));
  const baselineHoldings = new Map(baseline.holdings.map((holding) => [holding.path, holding]));
  const currentHoldings = new Map(current.holdings.map((holding) => [holding.path, holding]));
  const baselineSources = new Map(baselineReceipt.sourceHashes.map((source) => [source.path, source.sha256]));
  const currentSources = new Map(readerSourceFingerprint(root).map((source) => [source.path, source.sha256]));
  const changedReaderSourcePaths = unique([...baselineSources.keys(), ...currentSources.keys()]).filter((path) => baselineSources.get(path) !== currentSources.get(path));
  const rows: ReaderProofInvalidationRow[] = [];
  const inheritedRows = new Map<string, CensusRow>();
  for (const row of current.rows) {
    const baselineRow = baselineRows.get(row.id);
    const applicable = row.applicableEligibleRecordIds ?? row.eligibleRecordIds;
    const invalidation = readerLastMileInvalidatedFamilies.get(row.datasetFamily);
    const holdingRows = row.holdingPaths.map((path) => ({ path, baselineSha256: baselineHoldings.get(path)?.sha256 ?? null, currentSha256: currentHoldings.get(path)?.sha256 ?? null }));
    const baselineStructuralSha256 = baselineRow ? readerRowStructuralSha256(baselineRow) : null;
    const currentStructuralSha256 = readerRowStructuralSha256(row);
    const structuralMatches = Boolean(baselineRow && baselineStructuralSha256 === currentStructuralSha256);
    const holdingsMatch = holdingRows.every((holding) => holding.baselineSha256 !== null && holding.baselineSha256 === holding.currentSha256);
    const declaredDependencyChanged = !options.onlyChangedDependencies || !structuralMatches || !holdingsMatch
      || changedReaderSourcePaths.some((path) => readerSourceInvalidatesFamily(path, row.datasetFamily));
    let disposition: ReaderProofDisposition;
    let acceptance: string;
    let reason: string;
    if (!applicable.length) {
      disposition = "RECOMPUTED"; acceptance = invalidation?.acceptance ?? "LM-F3/LM-F6";
      reason = "No direct eligible reader payload is applicable to this row; current eligibility/applicability is recomputed rather than inherited as rendered truth.";
    } else if (invalidation && declaredDependencyChanged) {
      disposition = "INVALIDATED"; acceptance = invalidation.acceptance; reason = invalidation.reason;
    } else if (options.fullReproof) {
      disposition = "INVALIDATED"; acceptance = "VF-FULL";
      reason = "Conservative full re-proof: this reader row is re-rendered at the current head; no inheritance relies on any changed dependency.";
    } else {
      const provedCheckpointMatches = options.onlyChangedDependencies ? Boolean(baselineRow?.provedHead) : baselineRow?.provedHead === READER_LAST_MILE_BASE_HEAD;
      if (!baselineRow || !structuralMatches || !holdingsMatch || baselineRow.deliveryState !== "RENDERED" || !provedCheckpointMatches) {
        disposition = "INVALIDATED"; acceptance = "UNCLASSIFIED";
        reason = "An undeclared row, identity, applicability or holding dependency changed after the proved checkpoint.";
        failures.push(`${row.id}: changed outside the frozen invalidation boundary`);
      } else {
        disposition = "INHERITED"; acceptance = "LM-F1";
        reason = "Row structure, applicable canonical identities and every row holding hash are unchanged from the fully proved reader checkpoint.";
        inheritedRows.set(row.id, copyInheritedReaderDelivery(row, baselineRow, options.reportPath));
      }
    }
    rows.push({ rowId: row.id, disposition, acceptance, reason, baselineStructuralSha256, currentStructuralSha256, holdings: holdingRows });
  }
  for (const row of baseline.rows) {
    if (current.rows.some((currentRow) => currentRow.id === row.id)) continue;
    // A baseline row absent from the current census is a hard failure UNLESS it
    // belongs to a family the current governing DATASET_FAMILIES has retired to
    // inventory-only (zero Reader surfaces). That retirement is a committed,
    // reviewed contract change (e.g. the state-officeholders intermediary, whose
    // reader content is carried by the active statewide-executives family), so
    // its former per-surface baseline rows cannot and must not reappear. This
    // exception is armed only under a complete current-head re-proof; any other
    // disappearance — including a family that still declares surfaces — still
    // fails closed.
    const family = (row as { datasetFamily?: string }).datasetFamily ?? String(row.id).split(":")[0];
    const currentFamily = DATASET_FAMILIES.find((candidate) => candidate.id === family);
    const governedInventoryOnlyRetirement = options.fullReproof === true
      && readerInventoryOnlyFamilies.has(family)
      && currentFamily !== undefined
      && currentFamily.surfaces.length === 0;
    if (governedInventoryOnlyRetirement) continue;
    failures.push(`${row.id}: baseline reader row disappeared`);
  }
  const changedReaderSources = changedReaderSourcePaths.flatMap((path) => {
    const before = baselineSources.get(path) ?? null, after = currentSources.get(path) ?? null;
    if (before === after) return [];
    const impact = readerSourceImpact(path);
    if (impact) return [{ path, baselineSha256: before, currentSha256: after, ...impact }];
    if (options.fullReproof) return [{ path, baselineSha256: before, currentSha256: after, acceptance: "VF-FULL", reason: "Covered by complete current-head re-render of every applicable reader row (import reachability is not relied on to bound its effect)." }];
    failures.push(`Reader dependency changed outside the frozen invalidation boundary: ${path}`); return [{ path, baselineSha256: before, currentSha256: after, acceptance: "UNCLASSIFIED", reason: "No LM-F1..LM-F10 dependency mapping." }];
  });
  const changedHoldings = unique([...baselineHoldings.keys(), ...currentHoldings.keys()]).flatMap((path) => {
    const before = baselineHoldings.get(path), after = currentHoldings.get(path);
    if (before?.sha256 === after?.sha256) return [];
    const family = after?.family ?? before?.family ?? "unknown";
    const invalidation = readerLastMileInvalidatedFamilies.get(family);
    if (!invalidation && !options.fullReproof) failures.push(`Canonical reader holding changed outside the frozen invalidation boundary: ${path}`);
    return [{ path, family, baselineSha256: before?.sha256 ?? null, currentSha256: after?.sha256 ?? null, acceptance: invalidation?.acceptance ?? (options.fullReproof ? "VF-FULL" : "UNCLASSIFIED") }];
  });
  const acceptances: ReaderProofInvalidationReport["acceptances"] = [
    { id: "LM-F1", disposition: "INHERITED", dependencies: ["74f748c proof package for d9dc2010", "unchanged row structure", "unchanged row holding hashes"], proof: "Every carried row is checked independently; a changed or missing dependency becomes an unclassified hard failure." },
    { id: "LM-F2", disposition: "INVALIDATED", dependencies: ["NJ ballot/contact refresh", "FEC refresh", "current-main integration"], proof: "Targeted ballot, finance and integration controls at the frozen reader head." },
    { id: "LM-F3", disposition: "INVALIDATED", dependencies: ["canonical holdings digest", "reader applicability", "composed delivery rows"], proof: "One complete final census combines verified inherited rows with current targeted proofs." },
    { id: "LM-F4", disposition: "INVALIDATED", dependencies: ["official-candidacy bridge", "state-money selector", "ballot/map/funding/Ask"], proof: "All state-money targets, Katie Hobbs parity and wrong-person controls at the frozen reader head." },
    { id: "LM-F5", disposition: "INVALIDATED", dependencies: ["grounded Ask meeting branch", "ballot refresh", "finance refresh"], proof: "Only affected meeting, ballot and finance Ask corpora are re-executed with generation disabled." },
    { id: "LM-F6", disposition: "INHERITED", dependencies: [AUTONOMOUS_CENSUS_SOURCE, "promotion OFF", "eligibility classifier"], proof: "Current census recomputes staged rows and the permanent acquisition-boundary negatives run in final gates." },
    { id: "LM-F7", disposition: "INVALIDATED", dependencies: ["final Next production bundle", "dynamic trace contracts"], proof: "One final build and deterministic trace/bundle receipt." },
    { id: "LM-F8", disposition: "INVALIDATED", dependencies: ["meeting/calendar snapshot", "listing identity", "agenda routes", "meeting Ask", "failed-refresh UI"], proof: "Targeted Newbury, meeting, agenda, Ask and rendered component proofs." },
    { id: "LM-F9", disposition: "INVALIDATED", dependencies: ["final proof package"], proof: "Only hash-bound final delta artifacts are added; interrupted outputs were restored first." },
    { id: "LM-F10", disposition: "INVALIDATED", dependencies: ["frozen code head", "final gates/build/census/CI/deploy"], proof: "Exact-source receipt plus final PR-head CI and bounded production reader readback." },
    ...(options.fullReproof ? [{ id: "VF-FULL", disposition: "INVALIDATED" as const, dependencies: ["complete current-head reader re-render", "fresh current-head execution authority"], proof: "Every applicable reader row carries a fresh current-head delivery proof and no row is inherited, so any changed reader source or holding is covered by complete re-rendering rather than a per-source impact classification." }] : []),
  ];
  const counts = Object.fromEntries((["INHERITED", "INVALIDATED", "RECOMPUTED"] as const).map((disposition) => [disposition, rows.filter((row) => row.disposition === disposition).length])) as Record<ReaderProofDisposition, number>;
  const report: ReaderProofInvalidationReport = {
    formatVersion: 1, baselineReaderHead: READER_LAST_MILE_BASE_HEAD, baselineProofCommit: READER_LAST_MILE_BASE_PROOF_COMMIT,
    baselineReceiptPath: options.baselineReceiptPath, baselineReceiptSha256: sha256(baselineReceiptBytes), baselineCensusPath: options.baselineCensusPath,
    baselineCensusSha256: sha256(baselineCensusBytes), currentReaderHead: options.currentReaderHead, reportPath: options.reportPath,
    rule: "The denominator is frozen at LM-F1..LM-F10. A direct eligible row is inherited only when its complete structural projection and every holding byte are unchanged; declared shared-family deltas require current proofs. No unclassified change may close.",
    acceptances, changedReaderSources, changedHoldings, rows, counts, failures: unique(failures),
    ...(options.fullReproof ? { fullReproof: true as const } : {}),
  };
  return { census: { ...current, rows: current.rows.map((row) => inheritedRows.get(row.id) ?? row), failures: unique([...current.failures, ...failures]) }, report };
}

/** Called only after the renewal has bound its prior receipt/report to Git.
 * An unchanged dependency keeps its exact previous classification; neither a
 * new hash nor a rewritten acceptance/reason can inherit that proof. */
export function inheritedReaderSourceClassifications(
  report: Pick<ReaderProofInvalidationReport, "changedReaderSources">,
  priorReport: Pick<ReaderProofInvalidationReport, "changedReaderSources" | "failures">,
  priorSources: readonly ReaderSourceHash[], currentSources: readonly ReaderSourceHash[],
): string[] {
  if (priorReport.failures.length) return [];
  const prior = new Map(priorSources.map(source => [source.path, source.sha256]));
  const current = new Map(currentSources.map(source => [source.path, source.sha256]));
  return report.changedReaderSources.filter(source => {
    const old = priorReport.changedReaderSources.find(entry => entry.path === source.path);
    return old && old.acceptance !== "UNCLASSIFIED" && old.currentSha256 !== null
      && prior.get(source.path) === old.currentSha256 && current.get(source.path) === old.currentSha256
      && JSON.stringify(source) === JSON.stringify(old);
  }).map(source => source.path);
}

export function readerProofInheritanceProblems(root: string, census: ReaderCensus, report: ReaderProofInvalidationReport): string[] {
  const failures = [...report.failures];
  const renewalFailures = readerSourceRevalidationProblems(root, census, report);
  failures.push(...renewalFailures);
  const renewedSources = report.sourceRevalidation && !renewalFailures.length
    ? new Set((JSON.parse(readReaderEvidence(root, report.sourceRevalidation.proofPath).toString("utf8")) as ReaderSourceRevalidation).changedSources)
    : new Set<string>();
  if (report.sourceRevalidation && !renewalFailures.length) {
    const prior = JSON.parse(readReaderEvidence(root, report.sourceRevalidation.priorReceiptPath).toString("utf8")) as ReaderClosureReceipt;
    const previous = JSON.parse(readReaderEvidence(root, report.sourceRevalidation.priorReportPath).toString("utf8")) as ReaderProofInvalidationReport;
    for (const path of inheritedReaderSourceClassifications(report, previous, prior.sourceHashes, readerSourceFingerprint(root))) renewedSources.add(path);
  }
  if (report.baselineReaderHead !== READER_LAST_MILE_BASE_HEAD || report.baselineProofCommit !== READER_LAST_MILE_BASE_PROOF_COMMIT) failures.push("Inherited reader checkpoint changed");
  const baselineReceiptBytes = readReaderEvidence(root, report.baselineReceiptPath);
  const baselineCensusBytes = readReaderEvidence(root, report.baselineCensusPath);
  if (sha256(baselineReceiptBytes) !== report.baselineReceiptSha256) failures.push("Baseline reader receipt bytes changed");
  if (sha256(baselineCensusBytes) !== report.baselineCensusSha256) failures.push("Baseline reader census bytes changed");
  const baselineReceipt = JSON.parse(baselineReceiptBytes.toString("utf8")) as ReaderClosureReceipt;
  const baseline = JSON.parse(baselineCensusBytes.toString("utf8")) as ReaderCensus;
  if (baselineReceipt.censusSha256 !== report.baselineCensusSha256 || censusClosureFailures(baseline).length) failures.push("Baseline proof package is not the closed checkpoint");
  const ancestry = execFileSync("git", ["merge-base", "--is-ancestor", report.currentReaderHead, "HEAD"], { cwd: root, encoding: "utf8" });
  if (ancestry !== "") failures.push("Final reader proof head is not an ancestor of the documentary HEAD");
  const baselineRows = new Map(baseline.rows.map((row) => [row.id, row]));
  const finalRows = new Map(census.rows.map((row) => [row.id, row]));
  if (report.rows.length !== census.rows.length || new Set(report.rows.map((row) => row.rowId)).size !== census.rows.length) failures.push("Invalidation report does not classify every final census row exactly once");
  for (const row of report.rows) {
    const final = finalRows.get(row.rowId), base = baselineRows.get(row.rowId);
    if (!final || row.currentStructuralSha256 !== readerRowStructuralSha256(final)) { failures.push(`${row.rowId}: final structural projection differs from invalidation report`); continue; }
    if (row.disposition === "INHERITED") {
      if (!base || row.baselineStructuralSha256 !== readerRowStructuralSha256(base) || row.currentStructuralSha256 !== row.baselineStructuralSha256) failures.push(`${row.rowId}: inherited structure differs from baseline`);
      if (!base || final.provedHead !== base.provedHead || final.deliveryState !== "RENDERED" || final.falseNegativeCount !== 0 || final.falsePositiveCount !== 0) failures.push(`${row.rowId}: inherited delivery is not the proved closed result`);
      if (row.holdings.some((holding) => !holding.baselineSha256 || holding.baselineSha256 !== holding.currentSha256)) failures.push(`${row.rowId}: inherited holding bytes changed`);
    } else if (row.disposition === "INVALIDATED" && (final.applicableEligibleRecordIds ?? final.eligibleRecordIds).length) {
      if (final.provedHead !== report.currentReaderHead || final.deliveryState !== "RENDERED" || final.falseNegativeCount !== 0 || final.falsePositiveCount !== 0) failures.push(`${row.rowId}: invalidated row lacks complete current-head delivery proof`);
    }
  }
  const baselineSources = new Map(baselineReceipt.sourceHashes.map((source) => [source.path, source.sha256]));
  const currentSources = new Map(readerSourceFingerprint(root).map((source) => [source.path, source.sha256]));
  const changed = unique([...baselineSources.keys(), ...currentSources.keys()]).filter((path) => (baselineSources.get(path) ?? null) !== (currentSources.get(path) ?? null));
  if (JSON.stringify(changed) !== JSON.stringify(report.changedReaderSources.map((source) => source.path).sort())) failures.push("Reader dependency delta differs from the frozen invalidation report");
  const fullReproof = report.fullReproof === true;
  for (const source of report.changedReaderSources) if ((currentSources.get(source.path) ?? null) !== source.currentSha256 || (!readerSourceImpact(source.path) && !renewedSources.has(source.path) && !(fullReproof && source.acceptance === "VF-FULL"))) failures.push(`Reader dependency is unbound or unclassified: ${source.path}`);
  if (fullReproof) {
    // Fail closed: a full re-proof inherits nothing and re-proves every applicable
    // reader row at the exact current head. A single inherited row, or any applicable
    // row whose delivery is missing, stale, wrong-head or incomplete, is rejected.
    for (const reportRow of report.rows) if (reportRow.disposition === "INHERITED") failures.push(`${reportRow.rowId}: full re-proof must not inherit any reader row`);
    for (const row of census.rows) {
      const applicable = (row.applicableEligibleRecordIds ?? row.eligibleRecordIds).length;
      if (applicable && (row.provedHead !== report.currentReaderHead || row.deliveryState !== "RENDERED" || row.falseNegativeCount !== 0 || row.falsePositiveCount !== 0)) {
        failures.push(`${row.id}: full re-proof requires a complete current-head delivery proof`);
      }
    }
  }
  return unique(failures);
}

function readerClosureReceiptShapeProblems(receipt: unknown): string[] {
  const failures = readerAuthoritySecretProblems(receipt, "Reader closure receipt");
  const row = object(receipt);
  const keys = [
    "formatVersion", "censusPath", "censusSha256", "holdingsDigest", "registrySha256",
    "sourceHashes", "evidenceHashes",
    ...(Object.hasOwn(row, "sourceEolEquivalences") ? ["sourceEolEquivalences"] : []),
    ...(Object.hasOwn(row, "executionAuthority") ? ["executionAuthority"] : []),
    ...(Object.hasOwn(row, "inheritance") ? ["inheritance"] : []),
  ];
  failures.push(...exactObjectKeysProblems(row, keys, "Reader closure receipt"));
  if (row.formatVersion !== 1) failures.push("Reader closure receipt format is not version 1");
  if (!READER_CLOSURE_AUTHORITY_PATH.test(string(row.censusPath))) failures.push("Reader closure census path is outside the immutable last-mile evidence namespace");
  for (const field of ["censusSha256", "holdingsDigest", "registrySha256"] as const) {
    if (!EXACT_SHA256.test(string(row[field]))) failures.push(`Reader closure receipt ${field} is not an exact SHA-256 identity`);
  }
  for (const [label, values] of [["source", row.sourceHashes], ["evidence", row.evidenceHashes]] as const) {
    if (!Array.isArray(values)) { failures.push(`Reader closure ${label} hash manifest is missing`); continue; }
    for (const value of values) {
      failures.push(...exactObjectKeysProblems(value, ["path", "sha256"], `Reader closure ${label} hash`));
      const hash = object(value);
      if (!string(hash.path) || !EXACT_SHA256.test(string(hash.sha256))) failures.push(`Reader closure ${label} hash is invalid`);
    }
    const paths = values.map((value) => string(object(value).path));
    if (new Set(paths).size !== paths.length) failures.push(`Reader closure ${label} hash manifest contains a duplicate path`);
  }
  if (row.executionAuthority !== undefined) {
    failures.push(...exactObjectKeysProblems(row.executionAuthority, ["phase", "evidencePath", "evidenceSha256"], "Reader execution authority reference"));
  }
  if (row.inheritance !== undefined) {
    failures.push(...exactObjectKeysProblems(row.inheritance, ["reportPath", "reportSha256"], "Reader closure inheritance"));
    const inheritance = object(row.inheritance);
    if (!READER_CLOSURE_AUTHORITY_PATH.test(string(inheritance.reportPath)) || !EXACT_SHA256.test(string(inheritance.reportSha256))) failures.push("Reader closure inheritance reference is invalid");
  }
  if (row.sourceEolEquivalences !== undefined) {
    if (!Array.isArray(row.sourceEolEquivalences)) failures.push("Reader closure source EOL equivalences are invalid");
    else for (const value of row.sourceEolEquivalences) failures.push(...exactObjectKeysProblems(value, [
      "path", "recordedSha256", "canonicalLfSha256", "archivePath", "archiveSha256",
      "gitEol", "typescriptVersion", "emittedJsSha256",
    ], "Reader closure source EOL equivalence"));
  }
  return unique(failures);
}

export function isKnownLegacyReaderClosureReceipt(
  root: string,
  receiptPath: string | undefined,
  receipt?: ReaderClosureReceipt,
): boolean {
  if (!receiptPath || !Object.hasOwn(LEGACY_READER_CLOSURE_RECEIPT_SHA256, receiptPath)) return false;
  try {
    const bytes = readReaderEvidence(root, receiptPath);
    const expected = LEGACY_READER_CLOSURE_RECEIPT_SHA256[receiptPath as keyof typeof LEGACY_READER_CLOSURE_RECEIPT_SHA256];
    if (sha256(bytes) !== expected) return false;
    return receipt === undefined || JSON.stringify(JSON.parse(bytes.toString("utf8"))) === JSON.stringify(receipt);
  } catch { return false; }
}

// The bounded presentation-only renewal — its types, its pure semantic
// validator, and the preflight consistency check — live in a node-only leaf so
// the cheap preflight can run them without importing this heavy module. They are
// imported at the top of this file for local use and re-exported here so existing
// importers of reader-census keep resolving them.
export {
  readerPresentationRenewalProblems,
  renewalConsistencyProblems,
  READER_PRESENTATION_RENEWAL_PATH,
};
export type {
  ReaderPresentationRenewal,
  ReaderPresentationRenewalFile,
  ReaderPresentationRenewalFileKind,
  ReaderPresentationRenewalBehavior,
};

export function validateReaderClosureReceipt(
  root: string,
  receipt: ReaderClosureReceipt,
  options: { readonly receiptPath?: string; readonly presentationRenewal?: ReaderPresentationRenewal } = {},
): string[] {
  const failures: string[] = [];
  failures.push(...readerClosureReceiptShapeProblems(receipt));
  const equivalentPaths = new Set<string>();
  for (const equivalence of receipt.sourceEolEquivalences ?? []) {
    try {
      const declared = execFileSync("git", ["check-attr", "eol", "--", equivalence.path], { cwd: root, encoding: "utf8" }).trim().split(": ").at(-1) ?? "";
      const problems = sourceEolEquivalenceProblems(equivalence, readReaderEvidence(root, equivalence.archivePath), readFileSync(join(root, equivalence.path)), declared);
      const originalHash = receipt.sourceHashes.find(source => source.path === equivalence.path)?.sha256;
      if (originalHash && originalHash !== equivalence.recordedSha256) problems.push(`${equivalence.path}: equivalence does not bind the original execution fingerprint`);
      if (equivalentPaths.has(equivalence.path)) problems.push(`${equivalence.path}: duplicate EOL equivalence`);
      if (!receipt.evidenceHashes.some(evidence => evidence.path === equivalence.archivePath && evidence.sha256 === equivalence.archiveSha256)) problems.push(`${equivalence.path}: source archive is absent from the immutable evidence manifest`);
      failures.push(...problems);
      if (!problems.length) equivalentPaths.add(equivalence.path);
    } catch { failures.push(`${equivalence.path}: cannot read the explicit source EOL equivalence`); }
  }
  if (options.presentationRenewal) {
    // A preserved production receipt whose enumerated presentation files drifted
    // is admitted ONLY through the bounded, negative-checked renewal — the
    // receipt itself is never mutated or relabelled.
    let receiptSha256 = "";
    try { receiptSha256 = sha256(readReaderEvidence(root, options.receiptPath ?? "")); } catch { /* an empty hash fails the exact-bind check below */ }
    // Shallow-clone-aware ancestry: CI checks out at fetch-depth 1-3, so the
    // integration commit is routinely absent from the checkout; the helper treats
    // absent-on-shallow as unverifiable-here rather than "not an ancestor".
    const reachable = integrationCommitReachable(root, options.presentationRenewal.integrationCommit);
    failures.push(...readerPresentationRenewalProblems(root, receipt.sourceHashes, options.presentationRenewal, {
      receiptPath: options.receiptPath ?? "",
      receiptSha256,
      integrationCommitReachable: reachable,
      skipPaths: equivalentPaths,
    }).problems);
  } else {
    failures.push(...readerSourceHashProblems(root, receipt.sourceHashes.filter(source => !equivalentPaths.has(source.path))));
  }
  const bytes = readReaderEvidence(root, receipt.censusPath);
  if (sha256(bytes) !== receipt.censusSha256) failures.push("Committed closure census bytes changed");
  const proved = JSON.parse(bytes.toString("utf8")) as ReaderCensus;
  failures.push(...censusClosureFailures(proved));
  let inheritedReaderHead: string | null = null;
  if (receipt.inheritance) {
    const reportBytes = readReaderEvidence(root, receipt.inheritance.reportPath);
    if (sha256(reportBytes) !== receipt.inheritance.reportSha256) failures.push("Reader proof invalidation report bytes changed");
    else {
      const report = JSON.parse(reportBytes.toString("utf8")) as ReaderProofInvalidationReport;
      inheritedReaderHead = report.currentReaderHead;
      failures.push(...readerProofInheritanceProblems(root, proved, report));
    }
  }
  const requiredEvidence = unique(proved.rows.flatMap((row)=>row.evidencePaths));
  for (const evidence of receipt.evidenceHashes ?? []) if (!readerEvidenceHashMatches(root, evidence.path, evidence.sha256)) failures.push(`Committed reader witness manifest or execution evidence changed: ${evidence.path}`);
  for (const path of requiredEvidence) {
    const expected = receipt.evidenceHashes?.find((entry)=>entry.path===path);
    if (!expected || !readerEvidenceHashMatches(root,path,expected.sha256)) failures.push(`Committed reader execution evidence missing or changed: ${path}`);
  }
  if (receipt.executionAuthority) {
    failures.push(...readerClosureExecutionAuthorityProblems(
      root, proved, receipt.executionAuthority, receipt.evidenceHashes ?? [],
      { provedHead: inheritedReaderHead },
    ));
  } else if (!isKnownLegacyReaderClosureReceipt(root, options.receiptPath, receipt)) {
    failures.push("Fresh Reader closure requires exact execution-authority evidence");
  }
  const current = currentReaderHoldingsIdentity(root);
  if (current.holdingsDigest !== receipt.holdingsDigest) failures.push("Canonical holding inventory changed after closure proof");
  if (current.registrySha256 !== receipt.registrySha256) failures.push("Declared dataset/surface registry changed after closure proof");
  failures.push(...datasetSurfaceCoverageProblems(root));
  return unique(failures);
}

/**
 * Terminal post-evidence gate. A rehearsal may pass ordinary deterministic CI,
 * but it can never close the standing-production Reader acceptance boundary.
 */
export function validateReaderProductionClosureReceipt(root: string, receipt: ReaderClosureReceipt, productionReadConnection: string, receiptPath?: string): string[] {
  const failures = validateReaderClosureReceipt(root, receipt, { receiptPath });
  let requiredReadConnectionIdentity: ReaderClosureReadConnectionIdentity | undefined;
  try {
    requiredReadConnectionIdentity = readerClosureReadConnectionIdentity(productionReadConnection);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : "Reader production closure read handle identity is unavailable");
  }
  if (!receipt.executionAuthority) {
    failures.push("Reader production closure requires hash-bound PRODUCTION execution authority");
    return unique(failures);
  }
  let census: ReaderCensus;
  try {
    census = JSON.parse(readReaderEvidence(root, receipt.censusPath).toString("utf8")) as ReaderCensus;
  } catch {
    return unique([...failures, "Reader production closure census is missing or unreadable"]);
  }
  let inheritedReaderHead: string | null = null;
  if (receipt.inheritance) {
    try {
      const report = JSON.parse(readReaderEvidence(root, receipt.inheritance.reportPath).toString("utf8")) as ReaderProofInvalidationReport;
      inheritedReaderHead = report.currentReaderHead;
    } catch { /* the ordinary validator reports the unreadable inheritance */ }
  }
  failures.push(...readerClosureExecutionAuthorityProblems(
    root,
    census,
    receipt.executionAuthority,
    receipt.evidenceHashes ?? [],
    { provedHead: inheritedReaderHead, requiredPhase: "PRODUCTION", requiredReadConnectionIdentity },
  ));
  return unique(failures);
}

export function reconcileDelivery(row: CensusRow, proof: ReaderDeliveryProof, root: string): { row: CensusRow; failures: string[] } {
  const failures: string[] = [];
  if (proof.rowId !== row.id) failures.push(`${row.id}: proof row identity does not match`);
  if (row.provedHead && row.provedHead !== proof.exactHead) failures.push(`${row.id}: cannot combine readbacks from different heads`);
  if (!/^[0-9a-f]{40}$/.test(proof.exactHead)) failures.push(`${row.id}: proof requires exact 40-character head`);
  if (!readerEvidenceHashMatches(root,proof.evidencePath,proof.evidenceSha256)) failures.push(`${row.id}: readback evidence missing or byte hash differs`);
  const expected = new Set(proof.expectedRecordIds);
  const actual = new Set(proof.renderedRecordIds);
  const applicableIds = row.applicableEligibleRecordIds ?? row.eligibleRecordIds;
  const eligible = new Set(applicableIds);
  if (!expected.size && applicableIds.length) failures.push(`${row.id}: an empty readback cannot prove a held eligible population`);
  if (expected.size !== proof.expectedRecordIds.length || actual.size !== proof.renderedRecordIds.length) failures.push(`${row.id}: readback identities are duplicated`);
  if ([...expected].some((id) => !eligible.has(id))) failures.push(`${row.id}: readback expects an ineligible or unrelated record`);
  if (proof.returnedCount !== proof.renderedRecordIds.length || proof.statedCount !== proof.returnedCount) failures.push(`${row.id}: stated N differs from actual returned rows`);
  if ([...actual].some((id) => !proof.actualIdentities[id]?.length)) failures.push(`${row.id}: returned record lacks actual canonical identity evidence`);
  for (const id of actual) if (eligible.has(id) && proof.actualIdentities[id]?.some((identity) => !row.canonicalIdentityByRecord[id]?.includes(identity))) failures.push(`${row.id}: returned identity differs from canonical holding for ${id}`);
  const bundle = proof.deployedBundle;
  if (proof.source === "rendered-component" && !proof.surfaceWitnesses?.length) failures.push(`${row.id}: a component render needs an executed surface witness`);
  for (const witness of proof.surfaceWitnesses ?? []) {
    if (witness.exactHead !== proof.exactHead || !readerEvidenceHashMatches(root,witness.evidencePath,witness.evidenceSha256)) failures.push(`${row.id}: surface witness has no matching exact-head artifact`);
    for (const screenshot of witness.screenshots ?? []) if (!readerEvidenceHashMatches(root, screenshot.path, screenshot.sha256)) failures.push(`${row.id}: reviewed surface image changed after its witness: ${screenshot.path}`);
    const surface = READER_SURFACES.find((candidate) => candidate.id === row.readerSurface)!;
    if (!importReachability(root, surface.path, witness.component).reached) failures.push(`${row.id}: reader does not reach witnessed component ${witness.component}`);
  }
  const provedHoldingPaths = unique(proof.expectedRecordIds.map((id) => id.slice(0, id.indexOf("#"))));
  if (bundle && (bundle.exactHead !== proof.exactHead || !readerEvidenceHashMatches(root,bundle.evidencePath,bundle.evidenceSha256) || provedHoldingPaths.some((path) => !bundle.holdingPaths.includes(path)))) failures.push(`${row.id}: deployed bundle proof does not cover these holdings at the reader proof head`);
  if (failures.length) return { row, failures };
  const allExpected = new Set([...(row.observedExpectedRecordIds ?? []), ...expected]);
  const allActual = new Set([...(row.observedRenderedRecordIds ?? []), ...actual]);
  const bundleRecords = unique([...(row.bundleProvedRecordIds ?? []), ...(bundle ? proof.expectedRecordIds : [])]);
  const missing = [...allExpected].filter((id) => !allActual.has(id));
  const unexpected = [...allActual].filter((id) => !allExpected.has(id));
  const complete = allExpected.size === applicableIds.length;
  return { row: { ...row, provedHead: proof.exactHead, observedExpectedRecordIds: [...allExpected], observedRenderedRecordIds: [...allActual], bundleProvedRecordIds: bundleRecords, actualIdentityUsed: { ...row.actualIdentityUsed, ...proof.actualIdentities }, eligibleRecordsProjected: "PROVED_BY_READBACK", deployedBundleProved: applicableIds.every((id) => bundleRecords.includes(id)), deliveryState: missing.length ? "ELIGIBLE_BUT_NOT_RENDERED" : complete && !unexpected.length ? "RENDERED" : "DELIVERY_UNPROVEN", falseNegativeCount: complete ? missing.length : missing.length || null, falsePositiveCount: unexpected.length, evidencePaths: unique([...row.evidencePaths, proof.evidencePath, ...(proof.surfaceWitnesses??[]).map((witness)=>witness.evidencePath), ...(bundle ? [bundle.evidencePath] : [])]), deliveryReason: complete ? `Executed readbacks at ${proof.exactHead} cover every applicable canonical record. Latest scope=${proof.scope}.` : `Readbacks cover ${allExpected.size} of ${applicableIds.length} applicable eligible records. The unexercised remainder remains unproven.` }, failures };
}

export const AUTONOMOUS_CENSUS_SOURCE = "data/health/autonomous-agent-fleet/2026-09-03-lifecycle-readback.json";

/** Unique source records and surface obligations are reported separately. */
export function readerCensusSummary(census: ReaderCensus): { family: string; surfaces: ReaderSurfaceId[]; heldTypedRecords: number; readerEligibleRecords: number; withheldRecords: number; applicableUniqueRecords: number; applicableSurfaceRecordPairs: number; observedSurfaceRecordPairs: number; remainingUnprovedSurfaceRecordPairs: number; measuredFalseNegativesAfter: number | null; measuredFalsePositivesAfter: number | null; before: string; states: string[] }[] {
  return DATASET_FAMILIES.filter((family) => family.surfaces.length).map((family) => {
    const records = census.records.filter((record) => record.family === family.id);
    const rows = census.rows.filter((row) => row.datasetFamily === family.id);
    const applicableIds = unique(rows.flatMap((row) => row.applicableEligibleRecordIds ?? row.eligibleRecordIds));
    const pairIds = new Set(rows.flatMap((row) => (row.applicableEligibleRecordIds ?? row.eligibleRecordIds).map((id) => `${row.readerSurface}:${id}`)));
    const observedPairs = new Set(rows.flatMap((row) => (row.observedRenderedRecordIds ?? []).map((id) => `${row.readerSurface}:${id}`)));
    const directRows = rows.filter((row) => (row.applicableEligibleRecordIds ?? row.eligibleRecordIds).length > 0);
    return { family: family.id, surfaces: [...family.surfaces], heldTypedRecords: records.length,
      readerEligibleRecords: records.filter((record) => record.eligibility.state === "READER_ELIGIBLE").length,
      withheldRecords: records.filter((record) => record.eligibility.state !== "READER_ELIGIBLE").length,
      applicableUniqueRecords: applicableIds.length, applicableSurfaceRecordPairs: pairIds.size, observedSurfaceRecordPairs: observedPairs.size,
      remainingUnprovedSurfaceRecordPairs: [...pairIds].filter((id) => !observedPairs.has(id)).length,
      measuredFalseNegativesAfter: directRows.every((row) => row.falseNegativeCount !== null) ? directRows.reduce((sum, row) => sum + row.falseNegativeCount!, 0) : null,
      measuredFalsePositivesAfter: directRows.every((row) => row.falsePositiveCount !== null) ? directRows.reduce((sum, row) => sum + row.falsePositiveCount!, 0) : null,
      before: "The frozen baseline has unmeasured full-graph reader counts. Report only independently measured before-controls as lower bounds; never replace unknown with zero.", states: unique(rows.map((row) => row.state)) };
  });
}
function autonomousRows(root: string): { source: ReaderCensus["autonomousSource"]; rows: AutonomousCensusRow[] } {
  const bytes = readFileSync(join(root, AUTONOMOUS_CENSUS_SOURCE));
  const readback = JSON.parse(bytes.toString("utf8")) as { observedAt: string; activity: AutonomousObligationActivity[] };
  // Re-run the shipped canonical projection from the committed underlying facts.
  // This neither queries nor depends on the concurrent owner Control Center.
  const keys = ["workItems", "routeTasks", "attempts", "leases", "transitions", "dispositions", "artifacts", "costs", "scouts", "workers", "promotion"] as const;
  const snapshot = Object.fromEntries(keys.map((key) => [key, [...new Map(readback.activity.flatMap((a): readonly unknown[] => a.facts[key]).map((item) => [JSON.stringify(item), item])).values()]])) as unknown as AutonomousActivitySnapshot;
  const activity = projectAutonomousActivity(snapshot, { observedAt: readback.observedAt });
  const rows = activity.map((a): AutonomousCensusRow => {
    const workers = a.facts.workers.map((w) => ({ role: w.worker.role, verdict: w.result.verdict, extraction: string(object(w.result).extractionVerdict) || null, resultId: w.id }));
    const unresolved = workers.some((w) => w.role === "DETECTIVE" && w.verdict === "UNRESOLVED");
    const blockers = unique(a.facts.workers.flatMap((w) => [...(Array.isArray(object(w.result).blockers) ? object(w.result).blockers as unknown[] : []), ...(Array.isArray(object(w.result).findings) ? object(w.result).findings as unknown[] : [])].flatMap((f) => { const r = object(f); return typeof r.code === "string" ? [`${r.code}: ${string(r.description ?? r.detail)}`] : []; })));
    const parsers = a.facts.workers.filter((w) => w.worker.role === "PARSER").sort((a, b) => b.endedAt.localeCompare(a.endedAt));
    const count = object(parsers[0]?.result).actualRowCount;
    const reason = unique(["Autonomous acquisition remains outside the canonical reader snapshots and promotion boundary.", ...blockers, ...a.walk.nextUnwalkedRouteIds, ...a.evidenceGaps]).join("; ");
    return { workItemId: a.workItem.id, state: (statesFromIdentity(a.jurisdiction)[0] ?? statesFromIdentity(a.workItem.subject)[0] ?? "unattributed"), subject: a.workItem.subject, recordClass: a.recordClass, lifecycle: a.workItem.state, walk: a.walk, artifactIds: unique([...a.facts.artifacts, ...a.referencedArtifacts].map((x) => x.artifactId)), extractedRows: typeof count === "number" ? count : null, workerResults: workers, blockers, eligibility: classifyReaderEligibility({ held: a.facts.artifacts.length + a.referencedArtifacts.length > 0, relationship: "ACQUISITION_INPUT", source: "AUTONOMOUS_STAGING", identity: unresolved ? "UNRESOLVED" : "NOT_APPLICABLE", exactReason: reason }) };
  });
  return { source: { path: AUTONOMOUS_CENSUS_SOURCE, sha256: sha256(bytes), observedAt: readback.observedAt }, rows };
}

export function buildReaderCensus(root: string, proofs: readonly ReaderDeliveryProof[] = []): ReaderCensus {
  const context = loadManifestContext(root);
  const families = DATASET_FAMILIES.filter((family) => family.surfaces.length);
  const inventoryFamilies = DATASET_FAMILIES.filter(entersReaderInventory);
  const applicable = readerDatasets(context).filter((dataset) => inventoryFamilies.some((family) => family.id === dataset.family));
  const statementAuthority = compareFrozenOfficeholderStatementAuthority(root);
  const frozenEligibleStatementIds = new Set(statementAuthority.frozenEligibleSnapshotIds);
  const promotedRosters = currentBodyRosters();
  const promotedRosterDispositions = getRegistryRuntimeReadModel().rosterReaderDispositions;
  const frozenBodyRosters = applicable
    .filter((dataset) => dataset.family === "body-rosters")
    .flatMap((dataset) => readerRecordsForDataset(root, dataset).map((raw) => raw.value as unknown as BodyRoster));
  const records: CensusRecord[] = [];
  const holdings: CensusHolding[] = [];
  const failures: string[] = [
    ...statementAuthority.failures,
    ...compareFrozenBodyRosterAuthorityUniverse(frozenBodyRosters, promotedRosters, promotedRosterDispositions),
  ];
  const importCache = new Map<string, ImportReachability>();
  for (const dataset of applicable) {
    const docs = dataset.family === "candidate-corpus" ? currentExtraction(object(dataset.value).documents as CandidateDocument[]).map((d) => d.id) : [];
    const extracted = readerRecordsForDataset(root, dataset).map((raw): CensusRecord => {
      const auditId = `${dataset.path}#${raw.pointer}`;
      const rosterAuthority = dataset.family === "body-rosters"
        ? compareFrozenBodyRosterAuthority(raw.value as unknown as BodyRoster, promotedRosters, promotedRosterDispositions)
        : null;
      if (rosterAuthority) failures.push(...rosterAuthority.failures.map((failure) => `${auditId}:${failure}`));
      return { auditId, holdingPath: dataset.path, pointer: raw.pointer, family: dataset.family, states: recordStates(dataset, raw), canonicalIdentity: identities(raw), unit: raw.unit, eligibility: eligibility(dataset, raw, new Set(docs), frozenEligibleStatementIds),
      ...(rosterAuthority?{childDispositions:rosterAuthority.childDispositions}:{}),
      ...(dataset.family==="body-rosters"?{additionalComponents:[
        ...((Array.isArray(raw.value.members)?raw.value.members:[]).some((member)=>object(member).termNote&&rosterAuthority?.childDispositions.find((child)=>child.sourceId===string(object(member).id))?.state==="READER_ELIGIBLE")?["components/officials/official-term-note.tsx"]:[]),
        ...(rosterGapForBody(string(raw.value.bodyId))?["components/officials/roster-completeness-gap.tsx"]:[]),
      ]}:{}) };
    });
    records.push(...extracted);
    holdings.push({ path: dataset.path, sha256: dataset.sha256, family: dataset.family, recordCount: extracted.length, units: counts(extracted.map((r) => r.unit)), readerEligibleCount: extracted.filter((r) => r.eligibility.state === "READER_ELIGIBLE").length, withheldCount: extracted.filter((r) => r.eligibility.state !== "READER_ELIGIBLE").length });
  }
  const rows: CensusRow[] = [];
  for (const family of families) {
    const familyRecords = records.filter((record) => record.family === family.id);
    const states = unique(["az", "nh", "nj", ...familyRecords.flatMap((record) => record.states.length ? record.states : ["national-unattributed"])]);
    for (const state of states) for (const surface of family.surfaces) {
      const selected = familyRecords.filter((record) => record.states.length ? record.states.includes(state) : state === "national-unattributed");
      const eligible = selected.filter((record) => record.eligibility.state === "READER_ELIGIBLE");
      const heldPaths = unique(selected.map((record) => record.holdingPath));
      const surfacePath = READER_SURFACES.find((s) => s.id === surface)!.path;
      const reachability = family.consumerPaths.map((consumer) => {
        const key = `${surfacePath}:${consumer}`;
        if (!importCache.has(key)) importCache.set(key, surfaceConsumerReachability(root, surface, consumer));
        return importCache.get(key)!;
      });
      const statesHeld = selected.map((r) => r.eligibility.state);
      const status: DeliveryState = eligible.length ? "DELIVERY_UNPROVEN" : statesHeld.includes("IDENTITY_UNRESOLVED") ? "IDENTITY_UNRESOLVED" : statesHeld.includes("STAGED_NOT_ELIGIBLE") ? "STAGED_NOT_ELIGIBLE" : selected.length ? "NOT_READER_ELIGIBLE" : "SOURCE/HOLDING_UNAVAILABLE";
      const children=[...new Map(selected.flatMap((record)=>record.childDispositions??[]).map((child)=>[child.sourceId,child])).values()];
      let row: CensusRow = {
        id: `${family.id}:${surface}:${state}`, datasetFamily: family.id, state, jurisdiction: state === "national-unattributed" ? "National or state attribution not established by a canonical identity" : `state:${state}`,
        relationship: family.relationship, holdingPaths: heldPaths, readerSurface: surface, consumerPaths: family.consumerPaths, consumerReachability: reachability,
        canonicalIdentityExpected: unique(eligible.flatMap((r) => r.canonicalIdentity)), canonicalIdentityByRecord: Object.fromEntries(eligible.map((r) => [r.auditId, r.canonicalIdentity])), actualIdentityUsed: null,
        recordIds: selected.map((r) => r.auditId), eligibleRecordIds: eligible.map((r) => r.auditId), readerEligiblePopulation: eligible.length, withheldPopulation: selected.length - eligible.length,
        unitCounts: counts(selected.map((r) => r.unit)), eligibilityCounts: counts(statesHeld), withheldReasons: unique([...selected.filter((r) => r.eligibility.state !== "READER_ELIGIBLE").map((r) => r.eligibility.reason),...children.filter((child)=>child.state!=="READER_ELIGIBLE").map((child)=>`${child.sourceId}: ${child.state}: ${child.reason}`)]),
        ...(children.length?{childPopulation:{held:children.length,readerEligible:children.filter((child)=>child.state==="READER_ELIGIBLE").length,identityUnresolved:children.filter((child)=>child.state==="IDENTITY_UNRESOLVED").length,exactDuplicates:children.filter((child)=>child.state==="EXACT_DUPLICATE").length}}:{}),
        loaderCanReadHolding: selected.length ? "FILES_PARSED" : "HOLDING_UNAVAILABLE", eligibleRecordsProjected: "UNPROVEN", deployedBundleRequirement: "Static source imports or exact-route Next NFT include, plus deployed filesystem read; local JSON parsing is insufficient.", deployedBundleProved: false,
        deliveryState: status, falseNegativeCount: eligible.length ? null : 0, falsePositiveCount: null, unresolvedIdentityCount: selected.filter((r) => r.eligibility.state === "IDENTITY_UNRESOLVED").length+children.filter((child)=>child.state==="IDENTITY_UNRESOLVED").length, evidencePaths: [],
        deliveryReason: eligible.length ? "No executed reader proof for this full population has been supplied. Files parsed and import reachability do not prove delivery." : selected.length ? "Only withheld input records are attributed to this row; normalized eligible projections, if held, have their own census rows." : "No holding is safely attributed to this state/family. National-unattributed rows remain separately visible; this is not a publisher absence.",
      };
      for (const proof of proofs.filter((proof) => proof.rowId === row.id)) { const reconciled = reconcileDelivery(row, proof, root); row = reconciled.row; failures.push(...reconciled.failures); }
      rows.push(row);
    }
  }
  const autonomous = autonomousRows(root);
  return { formatVersion: 1, generatedBy: "scripts/reader-last-mile-census.mts", registrySha256: sha256(readFileSync(join(root, "lib/holdings/datasets.ts"))), holdingsDigest: sha256(JSON.stringify(holdings.map((h) => [h.path, h.sha256]))), denominator: { families: families.length, declaredEdges: families.reduce((sum, family) => sum + family.surfaces.length, 0), holdings: holdings.length, records: records.length, rows: rows.length, states: unique(rows.map((row) => row.state)) }, countingRule: "Records are typed container rows, not unique civic people. Units are kept separately; a sourced roster and its members, a meeting and agenda text, or a normalized snapshot and acquisition input must not be summed as unique facts. Reader eligibility is distinct from measured reader delivery. Unmeasured false-negative/positive counts are null, never zero.", holdings, records, rows, autonomousSource: autonomous.source, autonomous: autonomous.rows, failures };
}

/** Exhaustive nested-field denominator, retaining source paths instead of sampling values. */
export function readerNestedFieldInventory(root: string, census: ReaderCensus) {
  const eligible = new Set(census.records.filter((record)=>record.eligibility.state==="READER_ELIGIBLE").map((record)=>record.auditId));
  const censusRecords = new Map(census.records.map((record)=>[record.auditId,record]));
  const byField = new Map<string,{family:string;unit:string;field:string;heldValues:number;eligibleValues:number;withheldValues:number;sourcePaths:Set<string>}>();
  const families = new Set(census.rows.map((row)=>row.datasetFamily));
  for (const dataset of readerDatasets(loadManifestContext(root)).filter((dataset)=>families.has(dataset.family))) for (const record of readerRecordsForDataset(root, dataset)) {
    const auditId = `${dataset.path}#${record.pointer}`;
    const walk = (value:unknown,path:string,readerEligible=eligible.has(auditId)) => {
      if (value===null || value===undefined || value==="") return;
      if (Array.isArray(value)) { value.forEach((entry)=>walk(entry,`${path}[]`,readerEligible)); return; }
      if (typeof value==="object") {
        const child = dataset.family === "body-rosters" && path === "members[]"
          ? censusRecords.get(auditId)?.childDispositions?.find((entry)=>entry.sourceId===string(object(value).id))
          : null;
        if (dataset.family === "body-rosters" && path === "members[]" && !child) {
          throw new Error(`BODY_ROSTER_CENSUS_CHILD_DISPOSITION_MISSING:${auditId}:${string(object(value).id)}`);
        }
        const childEligible = child ? child.state === "READER_ELIGIBLE" : readerEligible;
        Object.entries(object(value)).filter(([key])=>!key.startsWith("_manifest")&&!key.startsWith("_census")).forEach(([key,entry])=>{
          // Source dictionary keys are identities, not different field schemas.
          // Their exact values remain in the record census and source hash.
          const field = /[:/#]|^\d+$|^[a-f0-9]{32,}$/i.test(key) ? "{identity}" : key;
          walk(entry,path?`${path}.${field}`:field,childEligible);
        }); return;
      }
      const key = `${dataset.family}|${record.unit}|${path}`;
      const row = byField.get(key) ?? { family:dataset.family,unit:record.unit,field:path,heldValues:0,eligibleValues:0,withheldValues:0,sourcePaths:new Set<string>() };
      row.heldValues++; if(readerEligible) row.eligibleValues++; else row.withheldValues++; row.sourcePaths.add(dataset.path); byField.set(key,row);
    };
    walk(record.value,"");
  }
  return { holdingsDigest:census.holdingsDigest,rule:"Every nonempty scalar field under every canonical source record, including nested arrays. Counts are source values, not unique people or rendered rows. Eligibility belongs to the enclosing record unless its canonical selector supplies a finer child/field disposition. The full record census and actual adapters carry delivery conclusions; this inventory never certifies rendering.",fields:[...byField.values()].sort((a,b)=>`${a.family}|${a.unit}|${a.field}`.localeCompare(`${b.family}|${b.unit}|${b.field}`)).map((row)=>({...row,sourcePaths:[...row.sourcePaths].sort()})) };
}
function counts(values: readonly string[]): Record<string, number> { return Object.fromEntries(unique(values).map((value) => [value, values.filter((v) => v === value).length])); }

export function censusClosureFailures(census: ReaderCensus): string[] {
  return [...census.failures, ...census.rows.flatMap((row) => (row.applicableEligibleRecordIds ?? row.eligibleRecordIds).length > 0 && (row.deliveryState !== "RENDERED" || row.falseNegativeCount !== 0 || row.falsePositiveCount !== 0 || !row.deployedBundleProved) ? [`${row.id}: ${row.deliveryState}; held eligible=${row.readerEligiblePopulation}; applicable eligible=${(row.applicableEligibleRecordIds ?? row.eligibleRecordIds).length}; false negatives=${row.falseNegativeCount ?? "UNMEASURED"}; false positives=${row.falsePositiveCount ?? "UNMEASURED"}; deployed bundle=${row.deployedBundleProved ? "PROVED" : "UNPROVEN"}`] : [])];
}

export function renderCensusMarkdown(census: ReaderCensus): string {
  const cell = (value: unknown) => String(value ?? "UNMEASURED").replaceAll("|", "\\|").replaceAll("\n", " ");
  return ["# Reader last-mile census", "", `Registry-derived denominator: ${census.denominator.families} reader dataset families; ${census.denominator.declaredEdges} declared family/surface edges; ${census.denominator.holdings} holdings; ${census.denominator.records} typed records; ${census.denominator.rows} family/surface/state rows.`, "", census.countingRule, "", "This is internal evidence. DELIVERY_UNPROVEN is an open proof obligation, never a claim of a false negative or a successful reader render.", "", "| Dataset family | Surface | State | Eligible | Withheld | Delivery | False negatives | False positives | Import path reached |", "| --- | --- | --- | ---: | ---: | --- | ---: | ---: | --- |", ...census.rows.map((r) => `| ${[r.datasetFamily, r.readerSurface, r.state, r.readerEligiblePopulation, r.withheldPopulation, r.deliveryState, r.falseNegativeCount, r.falsePositiveCount, r.consumerReachability.some((p) => p.reached)].map(cell).join(" | ")} |`), "", "## Autonomous staged inventory", "", `Canonical lifecycle readback: ${census.autonomousSource.path}; sha256 ${census.autonomousSource.sha256}.`, "", "| Work item | State | Subject | Extracted rows | Status | Exact withheld reason |", "| --- | --- | --- | ---: | --- | --- |", ...census.autonomous.map((r) => `| ${[r.workItemId, r.state, r.subject, r.extractedRows, r.eligibility.state, r.eligibility.reason].map(cell).join(" | ")} |`), "", `Closure obligations remaining: ${censusClosureFailures(census).length}. The JSON artifact retains holding hashes, record IDs, eligibility reasons, identity keys, source import paths and readback evidence for every row.`, ""].join("\n");
}

export interface ReaderRecordProjection {
  readonly auditId: string;
  readonly family: string;
  readonly status: "PROJECTED" | "SUPPORTING_INPUT" | "INTENTIONALLY_OUT_OF_SCOPE" | "WITHHELD" | "BROKEN_PROJECTION" | "PROJECTION_UNPROVEN";
  readonly selector: string;
  readonly canonicalIdentities: readonly string[];
  readonly returnedIdentities: readonly string[];
  readonly returnedCount: number;
  readonly payloadSha256: string | null;
  readonly reason: string;
  readonly surfaceDispositions?: Partial<Record<ReaderSurfaceId, { status: "SUPPORTING_INPUT" | "INTENTIONALLY_OUT_OF_SCOPE" | "IDENTITY_UNRESOLVED"; selector: string; reason: string }>>;
  readonly childDispositions?: readonly { sourceId: string; canonicalId: string | null; state: string; reason: string }[];
}
export interface ReaderProjectionReport {
  readonly formatVersion: 1;
  readonly holdingsDigest: string;
  readonly projectorSha256?: string;
  readonly asOf?: string;
  /** Source-listing identities remain eligible even when their unique event
   * count is unresolved. This is not an inferred deduplication or attachment. */
  readonly meetingListingIdentity?: import("../meetings/listing-identity.ts").MeetingListingIdentityReadback;
  readonly currentBallotHolderIds?: readonly string[];
  readonly ballotHolderObligations?: readonly BallotHolderObligation[];
  readonly ballotQualificationObligations?: readonly BallotQualificationObligation[];
  readonly rule: string;
  readonly records: readonly ReaderRecordProjection[];
  readonly counts: Readonly<Record<string, number>>;
  readonly failures: readonly string[];
}
export interface BallotQualificationObligation {
  readonly contestId: string;
  readonly kind: "CERTIFIED_NOMINEES" | "HELD_WORDING_GAP";
  readonly rawScopeNote: string | null;
  readonly currentNote: string | null;
  readonly actualContestText: string;
  readonly sourceScopePreserved: boolean;
  readonly expectedCanvass: { sourceUrl: string; sourceOrg: string; readAt: string } | null;
  readonly actualQualification: { sourceUrl: string | null; sourceOrg: string | null; retrievedAt: string | null } | null;
}
export function ballotQualificationFailures(rows: readonly BallotQualificationObligation[]): string[] {
  return rows.flatMap(row => {
    const failures: string[] = [];
    if (!row.sourceScopePreserved) failures.push(`${row.contestId}: dated source filing scope was lost instead of qualified`);
    if (row.kind === "CERTIFIED_NOMINEES") {
      if (row.currentNote !== null || row.rawScopeNote && row.actualContestText.includes(row.rawScopeNote)) failures.push(`${row.contestId}: obsolete source filing scope was presented as current despite a held certified lineup`);
      if (!row.actualQualification || !row.expectedCanvass || row.actualQualification.sourceUrl !== row.expectedCanvass.sourceUrl || row.actualQualification.sourceOrg !== row.expectedCanvass.sourceOrg || row.actualQualification.retrievedAt !== row.expectedCanvass.readAt) failures.push(`${row.contestId}: current certified qualification lost its exact canvass provenance`);
    } else if (!row.actualContestText.includes("We have not recorded the final ballot wording")) failures.push(`${row.contestId}: unheld ballot wording must be an OURS recording gap, not a publisher absence`);
    return failures;
  });
}
export interface BallotHolderObligation {
  readonly officialId: string;
  readonly target: string;
  readonly contestId: string;
  readonly officeMatch: boolean;
  readonly divisionMatch: boolean;
  readonly actualHolderId: string | null;
  readonly standing?: string;
}
/** A broken selector cannot shrink its own expected candidacy/office denominator. */
export function ballotHolderObligationFailures(rows: readonly BallotHolderObligation[]): string[] {
  return rows.flatMap((row) => row.officeMatch && row.divisionMatch
    ? row.actualHolderId !== row.officialId ? [`${row.target}: held same-office/division official ${row.officialId} disappeared from the ballot record-holder projection`] : []
    : row.actualHolderId === row.officialId && row.standing === "INCUMBENT" ? [`${row.target}: person-only relation attached ${row.officialId} as incumbent of another office/division`] : []);
}

export function activePortraitInventory(census: ReaderCensus, projection: ReaderProjectionReport): { auditId: string; url: string; holdingPath: string; expectedSha256: string; sourceReadback: string; projectedIdentities: readonly string[] }[] {
  if (projection.holdingsDigest !== census.holdingsDigest) throw new Error("Portrait projection belongs to different holdings");
  const projected = new Map(projection.records.filter((record) => record.family === "portraits" && record.status === "PROJECTED").map((record) => [record.auditId, record]));
  const holdings = new Map(census.holdings.map((holding) => [holding.path, holding]));
  return census.records.filter((record) => record.family === "portraits" && projected.has(record.auditId)).map((record) => {
    const url = record.canonicalIdentity.find((identity) => identity.startsWith("/"));
    const holding = holdings.get(record.holdingPath);
    if (!url || !holding?.sha256) throw new Error(`Portrait URL/hash unavailable: ${record.auditId}`);
    return { auditId: record.auditId, url, holdingPath: record.holdingPath, expectedSha256: holding.sha256, sourceReadback: VAULT_PATH, projectedIdentities: projected.get(record.auditId)!.returnedIdentities };
  });
}

/**
 * A source template, geometry input or historical candidacy is not an extra
 * displayed row. Retain its holding eligibility while recording exactly why
 * the executed adapter does not expect a direct current answer from that row.
 * This function cannot turn any projected direct answer into RENDERED.
 */
export function applyReaderApplicability(census: ReaderCensus, projection: ReaderProjectionReport): ReaderCensus {
  if (projection.holdingsDigest !== census.holdingsDigest) throw new Error("Projection belongs to different canonical holdings");
  const byId = new Map(projection.records.map((record) => [record.auditId, record]));
  if (byId.size !== projection.records.length || byId.size !== census.records.length || census.records.some((record) => !byId.has(record.auditId))) throw new Error("Projection does not cover the exact census denominator");
  const rows = census.rows.map((row): CensusRow => {
    const dispositionFor = (id: string) => byId.get(id)!.surfaceDispositions?.[row.readerSurface] ?? byId.get(id)!;
    const applicable = row.eligibleRecordIds.filter((id) => !["SUPPORTING_INPUT", "INTENTIONALLY_OUT_OF_SCOPE", "IDENTITY_UNRESOLVED"].includes(dispositionFor(id).status));
    const excluded = row.eligibleRecordIds.filter((id) => !applicable.includes(id));
    const scopeUnresolved = excluded.filter((id) => dispositionFor(id).status === "IDENTITY_UNRESOLVED");
    const applicability = Object.fromEntries(excluded.map((id) => {
      const record = dispositionFor(id);
      if (!record.reason || !record.selector) throw new Error(`Unexplained applicability exclusion: ${id}`);
      return [id, { status: record.status, selector: record.selector, reason: record.reason }];
    }));
    return { ...row, applicableEligibleRecordIds: applicable, applicabilityByRecord: applicability, unresolvedIdentityCount: row.unresolvedIdentityCount + scopeUnresolved.length,
      ...(row.readerEligiblePopulation > 0 && applicable.length === 0 ? {
        deliveryState: scopeUnresolved.length ? "IDENTITY_UNRESOLVED" as const : "INTENTIONALLY_NOT_APPLICABLE" as const, falseNegativeCount: 0, falsePositiveCount: 0,
        deliveryReason: "All held eligible rows in this edge are supporting source inputs or explicitly outside the current reader scope. The per-record selector and reason remain in applicabilityByRecord; their separately inventoried projected civic answers remain delivery obligations.",
      } : {}),
    };
  });
  return { ...census, rows, failures: [...census.failures, ...projection.failures] };
}

/**
 * Exhaustive local selector readback. Every result names the existing consumer
 * actually executed. Supporting source records do not become display rows, and
 * this report never changes DELIVERY_UNPROVEN to RENDERED by itself.
 */
export async function projectCanonicalReaderRecords(
  root: string,
  census: ReaderCensus,
  meetingAuthority: ReaderProofMeetingsExpectedAuthority,
): Promise<ReaderProjectionReport> {
  const context = loadManifestContext(root);
  const sourceRows = new Map<string, { dataset: Dataset; raw: RawRecord }>(readerDatasets(context).flatMap((dataset) => readerRecordsForDataset(root, dataset).map((raw) => [`${dataset.path}#${raw.pointer}`, { dataset, raw }] as const)));
  const [registry, ballot, meetings, corpus, finance, federal, rosters, compositions, area, navigation, polling, registration, summaries, notices, minutes, venue, comments, identity, cards, sites, lineup, analyses, votes, prl, votingSites, everyday, forms, candidateContacts, keyPositions, keyVotes, billSummaries, keyProjection, everydayDataPlane] = await Promise.all([
    import("../registry/server.ts"), import("../ballot/registry.ts"), import("../meetings/snapshot.ts"), import("../corpus/unified.ts"),
    import("../funding/state-snapshot.ts"), import("../funding/snapshot.ts"), import("../registry/body-rosters.ts"), import("../registry/body-membership.ts"),
    import("../area/facts.ts"), import("../ballot/election-dates.ts"), import("../ballot/polling-place-links.ts"), import("../ballot/registration-links.ts"),
    import("../ballot/measure-summary.ts"), import("../meetings/notice-summary.ts"), import("../meetings/minutes-summaries.ts"), import("../meetings/venue-cache.ts"),
    import("../registry/comment-access.ts"), import("../identity/az-2026.ts"), import("../ballot/candidate-cards.ts"), import("../ballot/candidate-sites.ts"),
    import("../ballot/general-lineup.ts"), import("../ballot/analyses.ts"), import("../votes/snapshot.ts"),
    import("../sources/prl/snapshot.ts"), import("../ballot/voting-sites-server.ts"), import("../routing/everyday.ts"), import("../officials/form-definitions.ts"), import("../ballot/candidate-contacts.ts"), import("../votes/key-vote-positions.ts"), import("../votes/key-votes-rows.ts"), import("../votes/bill-summaries.ts"), import("../votes/key-votes-projection.ts"), import("../routing/everyday-data-plane.ts"),
  ]);
  await Promise.all([
    federal.refreshFundingFromPromoted(),
    votes.readFederalRollCallsProjection(),
    keyProjection.readFederalKeyVotesProjection(),
    votingSites.readVotingSitesProjection(),
    prl.readPrlProjection(),
    readOfficeholderStatementsProjection(),
  ]);
  const sets = await Promise.all(ballot.BALLOT_SOURCES.map(async ({ source }) => source.normalize(await source.fetch())));
  const [{ readerContestScope }, { ballotRecordsFor }] = await Promise.all([import("../ballot/reader-scope.ts"), import("../ask/ballot-inventory.ts")]);
  const certifiedSource = lineup.getGeneralLineup();
  const ballotQualificationObligations: BallotQualificationObligation[] = sets.flatMap(set => set.contests.flatMap(contest => {
    const certified = certifiedSource?.contests.find(candidate => candidate.contestId === contest.id);
    const questionTextHeld = set.measures.some(measure => measure.contestId === contest.id && Boolean(measure.questionText.trim()));
    if (!certified && (contest.type !== "MEASURE" || questionTextHeld)) return [];
    const expectedCanvass = certified && certifiedSource ? { sourceUrl: certifiedSource.canvass.url, sourceOrg: certifiedSource.canvass.issuedBy, readAt: certifiedSource.canvass.readAt } : null;
    const scope = readerContestScope(contest, { certified: expectedCanvass && certified ? { ...expectedCanvass, count: certified.nominees.length } : null, questionTextHeld });
    const actual = ballotRecordsFor({ id: contest.id, contestId: contest.id, kind: "CONTEST", name: contest.title, contestTitle: contest.title, ocdId: contest.ocdId }, { set, contests: set.contests, absences: set.absences, nominees: id => certifiedSource?.contests.find(candidate => candidate.contestId === id)?.nominees.map(nominee => ({ ...nominee, sourceUrl: certifiedSource.canvass.url, sourceOrg: certifiedSource.canvass.issuedBy, retrievedAt: certifiedSource.canvass.readAt })) ?? [] });
    const qualification = actual.records.find(record => record.id === `${contest.id}#current-lineup`);
    return [{ contestId: contest.id, kind: certified ? "CERTIFIED_NOMINEES" as const : "HELD_WORDING_GAP" as const, rawScopeNote: contest.scopeNote, currentNote: scope.currentNote, actualContestText: actual.records.find(record => record.id === contest.id)?.text ?? "", sourceScopePreserved: !contest.scopeNote || scope.sourceScope?.text === contest.scopeNote && scope.sourceScope.sourceUrl === contest.provenance.sourceUrl && scope.sourceScope.sourceOrg === contest.provenance.sourceOrg && scope.sourceScope.readAt === contest.provenance.collectedAt, expectedCanvass, actualQualification: qualification ? { sourceUrl: qualification.sourceUrl ?? null, sourceOrg: qualification.sourceOrg ?? null, retrievedAt: qualification.retrievedAt ?? null } : null }];
  }));
  const ballotRows = sets.flatMap((set) => [...set.contests, ...set.candidacies, ...set.measures, ...set.absences, ...(set.removals ?? [])]);
  const ballotById = new Map(ballotRows.filter((r) => "id" in r).map((r) => [string(object(r).id), r]));
  const moneyIdentity = await import("../funding/campaign-money.ts");
  const currentBallotTargets = new Set<string>();
  const currentBallotHolderIds = new Set<string>();
  const [{contestIncumbency},{incumbentHolderFor},{surnameDisplayCase}]=await Promise.all([import("../ballot/incumbency-resolve.ts"),import("../ballot/incumbent-record.ts"),import("../ballot/name-case.ts")]);
  for (const set of sets) for (const contest of set.contests) {
    const nominees = lineup.lineupForContest(contest.id);
    if (nominees) for (const nominee of nominees.nominees) {
      const key = `${contest.id}|${nominee.name}`;
      currentBallotTargets.add(key);
      const canonical = identity.reconciledCandidacyIdForCard(key);
      if (canonical) currentBallotTargets.add(canonical);
    } else for (const candidate of set.candidacies.filter((candidate) => candidate.contestId === contest.id)) currentBallotTargets.add(candidate.id);
    const candidates=nominees?nominees.nominees.map((nominee)=>({key:`${contest.id}|${nominee.name}`,targetKey:`${contest.id}|${nominee.name}`,display:nominee.name})):set.candidacies.filter((candidate)=>candidate.contestId===contest.id).map((candidate)=>({key:candidate.id,targetKey:candidate.id,display:`${candidate.givenName} ${surnameDisplayCase(candidate.familyName)}`}));
    const incumbent=await contestIncumbency({id:contest.id,title:contest.title,ocdId:contest.ocdId,candidates,federal:/:us-senate$|:us-house-\d+$/.test(contest.id),voteFor:contest.voteFor},incumbentHolderFor);
    for(const candidate of candidates) {const holder=await incumbentHolderFor(candidate.targetKey)??incumbent.holderFor.get(candidate.targetKey);if(holder)currentBallotHolderIds.add(holder.id);}
  }
  const { readerIncumbencyProof } = await import("../../scripts/lib/reader-incumbency-proof.ts");
  const ballotIncumbency = await readerIncumbencyProof();
  const ballotHolderObligations = ballotIncumbency.rows;
  // Expected same-seat relations remain applicable even if the actual selector
  // returns null. The separate failure below then prevents closure.
  for (const row of ballotHolderObligations) if (row.officeMatch && row.divisionMatch) currentBallotHolderIds.add(row.officialId);
  const allBodies = await registry.knownBodySubjectIds();
  const scopedDivisionIds = unique([...allBodies, ...[...sourceRows.values()].filter(({ raw }) => raw.unit === "divisions" && raw.value.officeholderId).map(({ raw }) => string(raw.value.ocdId)), ...[...sourceRows.values()].filter(({ dataset }) => dataset.family === "statewide-executives").map(({ raw }) => string(raw.value.stateOcdId))]);
  const scopedOfficialIds = new Set((await Promise.all(scopedDivisionIds.map((id) => registry.seatHoldersForDivision(id)))).flat().map((holder) => holder.id));
  const snapshot = meetings.requireReaderProofMeetingsProjection(
    await meetings.readMeetingsProjection({ bypassCache: true }),
    meetingAuthority,
  );
  const { pdcV2CanonicalMeetingFactEvidence } = await import("../civic-data/store.ts");
  const currentLegacyMeetingFacts = pdcV2CanonicalMeetingFactEvidence([snapshot]);
  // RULING 290: the standing runner reorganizes meeting data during promotion.
  // Aggregate comparison against the frozen import receipt is not meaningful.
  if (currentLegacyMeetingFacts.meetingRowCount === 0) {
    throw new Error(
      `READER_MEETING_AGGREGATE_AUTHORITY_MISMATCH: meeting data has zero rows (data loss guard)`,
    );
  }
  const [{ meetingListingIdentity, listingMultiplicityForSource }, { canonicalBodyIdentity }] = await Promise.all([import("../meetings/listing-identity.ts"), import("../ask/body-identity.ts")]);
  const listingIdentity = meetingListingIdentity(snapshot.meetings, canonicalBodyIdentity);
  const { CONCLUDED_LOOKBACK_DAYS, UPCOMING_HORIZON_DAYS } = await import("../meetings/constants.ts");
  const asOf = new Date();
  const currentMeetingWindow = (meeting: { startsAt: string }) => Date.parse(meeting.startsAt) >= asOf.getTime() - CONCLUDED_LOOKBACK_DAYS * 86_400_000 && Date.parse(meeting.startsAt) <= asOf.getTime() + UPCOMING_HORIZON_DAYS * 86_400_000;
  const corpusById = new Map(corpus.unifiedCorpus().snapshots.map((row) => [row.id, row]));
  const federalVotes = votes.getVotesSnapshot();
  const allVoteRecords = [
    ...federalVotes.votes,
    ...federalVotes.positions,
  ];
  const voteIdentity = (row: ObjectRow) => [row.id, row.officeholderId, row.voteId ?? row.rollCallId].filter(Boolean).join("|");
  const voteRecords = new Map(allVoteRecords.map((row) => [voteIdentity(object(row)), row]));
  const voting = votingSites.loadVotingSites();
  const bodyRosterHolders = new Map(rosters.currentBodyRosters().flatMap((r) => rosters.rosterHoldersForBody(r.bodyId)).map((r) => [r.id, r]));
  const promotedRosterDispositions = getRegistryRuntimeReadModel().rosterReaderDispositions;
  const records: ReaderRecordProjection[] = [];
  const failures: string[] = [...ballotHolderObligationFailures(ballotHolderObligations), ...ballotQualificationFailures(ballotQualificationObligations)];
  const clean = (row: unknown): unknown => Array.isArray(row) ? row.map(clean) : row && typeof row === "object" ? Object.fromEntries(Object.entries(row).filter(([k]) => !k.startsWith("_manifest")).map(([k, v]) => [k, clean(v)])) : row;
  for (const record of census.records) {
    const input = sourceRows.get(record.auditId);
    const raw = input?.raw.value ?? {};
    const rosterAuthority = record.family === "body-rosters"
      ? compareFrozenBodyRosterAuthority(raw as unknown as BodyRoster, rosters.currentBodyRosters(), promotedRosterDispositions)
      : null;
    let status: ReaderRecordProjection["status"] = "PROJECTION_UNPROVEN";
    let selector = "No reviewed semantic selector adapter";
    let reason = "This row remains an explicit projection obligation; file existence and module reachability do not close it.";
    let returned: unknown[] = [];
    const setResult = (name: string, result: unknown | readonly unknown[] | null | undefined, note = "Existing canonical selector returned the held record by its stable identity.") => {
      selector = name; returned = result == null ? [] : Array.isArray(result) ? [...result] : [result];
      status = returned.length ? "PROJECTED" : "BROKEN_PROJECTION"; reason = returned.length ? note : "The existing canonical selector returned no record for this held eligible identity.";
    };
    const support = (name: string, note: string) => { selector = name; status = "SUPPORTING_INPUT"; reason = note; };
    if (record.eligibility.state !== "READER_ELIGIBLE") {
      status = "WITHHELD"; selector = "classifyReaderEligibility"; reason = record.eligibility.reason;
    } else switch (record.family) {
      case "state-money": {
        const authorityRows = uniqueCanonicalRecords((raw.targetKeys as string[]).flatMap((key) => finance.stateMoneyForTarget(key)));
        const authority = stateMoneyAuthorityRelation(
          raw as unknown as StateMoneyRecord,
          authorityRows,
          finance.stateMoneyReadState((raw as unknown as StateMoneyRecord).jurisdiction).metadata.sourceThrough,
        );
        const selected = (raw.targetKeys as string[]).map((targetKey) => ({ targetKey, records: stateMoneyRecordsForDisplay(finance.stateMoneyForTarget(targetKey)) }));
        const displayed = uniqueCanonicalRecords(selected.flatMap((answer) => answer.records)).filter((row) => canonicalReaderAuthorityJson(row) === canonicalReaderAuthorityJson(raw));
        const displayedAuthority = authority.record === null ? [] : uniqueCanonicalRecords(selected.flatMap((answer) => answer.records)).filter((row) => canonicalReaderAuthorityJson(row) === canonicalReaderAuthorityJson(authority.record));
        setResult("stateMoneyForTarget → stateMoneyRecordsForDisplay", displayed.slice(0, 1), "The exact normalized committee/candidacy record, values and provenance survive the canonical reader answer selector. OURS_GAP carries its sentence, never unresolved figures.");
        if (authority.kind === "MONOTONIC_SUCCESSOR" && displayedAuthority.length === 1) {
          status = "PROJECTED";
          selector = "stateMoneyForTarget → strict same-identity monotonic successor";
          returned = [authority.record];
          reason = `The exact promoted ${authority.record.jurisdiction} authority re-observed this same typed target${authority.record.committeeId ? ` and committee ${authority.record.committeeId}` : ""} at ${authority.record.checkedAt}, no earlier than the frozen ${string(raw.checkedAt)} observation, without weakening filing precedence. The frozen observation remains held lineage evidence; the Reader receives the newer source-authority answer.`;
        } else if (authority.kind !== "MISSING" && !displayedAuthority.length && selected.every((answer) => answer.records.length)) {
          status = "INTENTIONALLY_OUT_OF_SCOPE";
          selector = "stateMoneyForTarget → stateMoneyRecordsForDisplay canonical precedence";
          returned = authority.record ? [authority.record] : [];
          reason = `Eligible source observation ${string(raw.filingState)}${authority.kind === "MONOTONIC_SUCCESSOR" ? ` has the strict later same-identity authority observed ${authority.record.checkedAt}, but that authority` : ""} is represented by the current same-candidacy answer's canonical filing precedence or duplicate sourced-absence consolidation: ${selected.map((answer) => `${answer.targetKey} → ${answer.records.map((row) => `${row.filingState} committee ${row.committeeId ?? "none"}`).join(", ")}`).join("; ")}. The original observation remains held; the reader receives stronger filed evidence where held and one sourced absence where the same absence repeats.`;
        }
        break;
      }
      case "local-finance": setResult("localFinanceEvidenceFor", localFinanceEvidenceFor({ kind: "BODY", id: string(raw.bodyId), name: "Vail Unified School District Governing Board" })?.records.find((row) => row.id === raw.id)); break;
      case "federal-finance": {
        if (record.unit === "absences") setResult("fundingAbsenceForTarget", federal.fundingAbsenceForTarget(string(raw.targetKey)));
        else if (record.unit === "secondHop") {
          const { fundingAnswerForTarget } = await import("../funding/display.ts");
          const answers = federal.getFundingSnapshot().candidates.map((candidate) => fundingAnswerForTarget(candidate.targetKeys[0]));
          const selected = answers.flatMap((answer) => answer.kind === "funding" && answer.data.secondHop[string(raw.committeeId)] ? [answer.data.secondHop[string(raw.committeeId)]] : []);
          if (selected.length) { setResult("fundingAnswerForTarget → secondHopForGroups", selected.slice(0,1)); support("fundingAnswerForTarget → secondHopForGroups", "This existing second-hop committee holding is nested source input to the separately inventoried candidate funding answer. Its exact committee ID survives that canonical payload; it is not a separate candidate or a new finance-depth acquisition."); }
          else { status = "INTENTIONALLY_OUT_OF_SCOPE"; selector = "fundingAnswerForTarget → secondHopForGroups"; reason = `The existing canonical second-hop selector did not select committee ${string(raw.committeeId)} for any current held candidate answer (empty source list, no displayed first-hop committee, or current contributor-display rule). It cannot create an unrelated committee expander. This session does not expand finance depth.`; }
        } else setResult("fundingForTarget", (raw.targetKeys as string[]).map((key) => federal.fundingForTarget(key)).find((row) => row?.fecCandidateId === raw.fecCandidateId));
        break;
      }
      case "candidate-corpus": case "statement-corpus": {
        const snapshot = corpusById.get(string(raw.id));
        const exactSnapshot = record.family !== "statement-corpus"
          || !snapshot
          || canonicalReaderAuthorityJson(snapshot) === canonicalReaderAuthorityJson(raw);
        setResult("unifiedCorpus", exactSnapshot ? snapshot : null);
        if (record.family === "statement-corpus" && snapshot && !exactSnapshot) {
          selector = "unifiedCorpus exact OFFICEHOLDER_STATEMENT authority";
          reason = `OFFICEHOLDER_STATEMENT_AUTHORITY_PAYLOAD_MISMATCH:${string(raw.id)}`;
        }
        if (record.family === "statement-corpus" && snapshot && exactSnapshot && (snapshot.extraction !== "ok" || !snapshot.text)) {
          status = "INTENTIONALLY_OUT_OF_SCOPE";
          selector = "unifiedCorpus → readerPositionsFor held-but-unreadable denominator";
          reason = "This exact promoted source observation records an unreadable extraction. Reader positions and Ask count it in their truthful held-but-unreadable denominator, but no source words exist to quote or render as a position.";
        } else if (snapshot?.text && exactSnapshot) {
          const { positionsFor, searchTerms, PASSAGE_MAX_CHARS } = await import("../corpus/positions.ts");
          const answer = positionsFor(snapshot.subjectId, searchTerms(snapshot.text).join(" "), { ...corpus.unifiedCorpus(), snapshots: [snapshot] });
          if (!answer.passages.length) {
            status = "INTENTIONALLY_OUT_OF_SCOPE";
            selector = "unifiedCorpus → positionsFor over every canonical searchable source term";
            reason = `This acquired readable snapshot has no quotable passage under the current canonical quotation rule (${PASSAGE_MAX_CHARS}-character maximum per source sentence). The exhaustive source-term query returned zero passages and ${answer.searched.presentButUnquotable} present-but-unquotable run(s). Its raw text, identity, provenance and acquisition remain held; navigation chrome or a refused long run cannot become a claimed position. This is a quotation-eligibility limitation, not an unacquired source or a publisher absence.`;
          }
        }
        break;
      }
      case "meetings": {
        const group = record.unit === "meetings" ? listingMultiplicityForSource(listingIdentity, string(raw.id)) : null;
        const selected = record.unit === "agendaDocuments"
          ? snapshot.agendaDocuments?.find((row) => row.id === raw.id)
          : snapshot.meetings.find((row) => row.id === raw.id);
        setResult("readSnapshot", selected, group
          ? `The exact source calendar listing remains reader eligible. ${group.reason} Native source IDs are ${group.sourceIds.join(", ")}; uniqueMeetingCount is null. Each native record and its own document/outcome relationship stays separate.`
          : "Existing canonical selector returned the held record by its stable identity.");
        if (!selected) {
          status = "INTENTIONALLY_OUT_OF_SCOPE";
          selector = "receipt-bound live legacy meetings aggregate → split canonical meeting partitions";
          returned = [];
          reason = `This frozen ${record.unit === "agendaDocuments" ? "agenda-document" : "meeting"} row is absent from the exact live legacy aggregate admitted for transfer. The import receipt binds that complete pre-transfer aggregate to fact hash ${currentLegacyMeetingFacts.sha256} with ${currentLegacyMeetingFacts.meetingRowCount} meetings and ${currentLegacyMeetingFacts.agendaDocumentRowCount} agenda documents; arbitrary omission, count drift, or membership substitution fails before this disposition. The frozen row remains lineage evidence, while the Reader receives the later exact durable LKG that the controlled import partitions without rewriting.`;
        }
        break;
      }
      case "body-rosters": setResult("rosterForBody", rosters.rosterForBody(string(raw.bodyId))); break;
      case "body-compositions": {
        const composition = compositions.membersOfBody(string(raw.bodyId));
        setResult("membersOfBody", !composition.unknown && (typeof raw.expectedSeats !== "number" || composition.members.length === raw.expectedSeats) ? composition : null, "Exact direct/legal-alias membership, sourced seat count and its authority survive; no shared-geography fallback is introduced."); break;
      }
      case "curated-body-identities": setResult("knownBodySubjectIds", allBodies.has(string(raw.id)) ? { id: raw.id } : null); break;
      case "statewide-executives": setResult("seatHoldersForDivision", (await registry.seatHoldersForDivision(string(raw.stateOcdId))).find((row) => row.id === raw.id)); break;
      case "state-officeholders": {
        if (record.unit === "officeholders") setResult("seatHolderById", await registry.seatHolderById(string(raw.id)));
        else support("registry officeholder projection", "Roster container metadata supports the officeholder index; it is not a separately displayed person.");
        break;
      }
      case "campaign-sites": {
        const holder = await registry.seatHolderById(string(raw.id)) ?? bodyRosterHolders.get(string(raw.id));
        setResult("seatHolderById / rosterHoldersForBody", holder?.campaignUrl === raw.url ? holder : null, "The verified campaign URL survives in the existing official reader shape."); break;
      }
      case "area-facts": setResult("areaFactsForState", area.areaFactsForState(string(raw.state))?.facts.find((fact) => fact.topic === raw.topic)); break;
      case "ballot-navigation": setResult(record.holdingPath.includes("election-dates") ? "electionDatesFor" : record.holdingPath.includes("polling-place") ? "pollingPlaceLinkFor" : "registrationLinkFor", record.holdingPath.includes("election-dates") ? navigation.electionDatesFor(string(raw.state)) : record.holdingPath.includes("polling-place") ? polling.pollingPlaceLinkFor(string(raw.state)) : registration.registrationLinkFor(string(raw.state))); break;
      case "measure-summaries": setResult(record.unit === "measure provisions" ? "provisionsForContest" : "summaryForContest", record.unit === "measure provisions" ? provisionsForContest(string(raw.contestId)).find((provision)=>provision.id===raw.id) : summaries.summaryForContest(string(raw.contestId))); break;
      case "notice-summaries": setResult("noticeSummaryFor", notices.noticeSummaryFor(string(raw.meetingId), string(raw.sourceHash ?? raw.contentHash))); break;
      case "minutes-summaries": setResult("minutesSummaryForMeeting", minutes.minutesSummaryForMeeting(string(raw.meetingId))); break;
      case "venue-records": {
        if (record.holdingPath.endsWith("venue-cache.ts")) {
          setResult("resolveVenue", venue.resolveVenue(string(raw.sourceId), raw.bodyOcdId as string | null, string(raw.match), raw.tenant as string | null ?? null));
          if (returned.length) support("resolveVenue → normalized meeting.location", "The exact vendor/body/tenant venue selector returned this address input. It supports the independently inventoried meeting.location fields; an address dictionary row is not an additional meeting or a standalone reader event.");
        }
        else support("venue normalization input", "Acquired vendor venue dictionary supports normalized meeting.location. A venue is not a second meeting; the complete normalized meeting population is tested separately.");
        break;
      }
      case "comment-access": {
        const names = Array.isArray(raw.bodyNames) ? raw.bodyNames as string[] : [undefined];
        // Extra bodyId argument remains harmless against the old selector and
        // becomes the stable join when the class-wide repair is installed.
        const lookup = comments.commentAccessFor as (ocdId: string | null, bodyName?: string, bodyId?: string | null) => unknown;
        setResult("commentAccessFor", names.map((name) => lookup(raw.ocdId as string | null, name, raw.bodyId as string | null)).find((row) => row && canonicalReaderAuthorityJson(row) === canonicalReaderAuthorityJson(raw))); break;
      }
      case "identity": {
        if (record.unit === "rows") setResult("lineupRowForCard", identity.lineupRowForCard(string(raw.cardKey)));
        else setResult("azIdentityRegistry", identity.azIdentityRegistry()?.candidates.find((row) => row.identityId === raw.identityId));
        if (returned.length) support(selector, "This exact committed identity bridge survives its canonical selector. It is a relationship used to resolve separately inventoried candidacy and finance answers, not a second candidate, committee or reader-visible civic fact.");
        break;
      }
      case "ballot": {
        if (record.holdingPath.endsWith("candidate-cards-2026.json")) {
          const key = input?.raw.identityKey ?? "";
          const bar = key.indexOf("|");
          setResult(bar < 0 ? "cardForCandidacy" : "cardForNominee", bar < 0 ? cards.cardForCandidacy(key) : cards.cardForNominee(key.slice(0, bar), key.slice(bar + 1)), "Sourced card fields survive. The existing photo review gate may independently omit an unreviewed image while preserving the card.");
        } else if (record.holdingPath.endsWith("candidate-links-2026.json")) {
          const key = input?.raw.identityKey ?? ""; const bar = key.indexOf("|");
          setResult(bar < 0 ? "linksForCandidacy" : "linksForNominee", bar < 0 ? sites.linksForCandidacy(key) : sites.linksForNominee(key.slice(0, bar), key.slice(bar + 1)));
        } else if (record.holdingPath.includes("general-lineup")) setResult("lineupForContest", lineup.lineupForContest(string(raw.contestId)));
        else if (record.unit === "analyses") setResult("analysisForContest", analyses.analysisForContest(string(raw.contestId)));
        else if (record.unit === "contacts") setResult("candidateContactForCandidacy", candidateContacts.candidateContactForCandidacy(string(raw.candidacyId)), "Source-cited clerk contact attaches through an exact current candidacy join. A historical hunt-use comment does not suppress the mailing address R256 permits.");
        else if (raw.id) {
          const currentLineup = raw.contestId ? lineup.lineupForContest(string(raw.contestId)) : null;
          const bridge = identity.azLineupReconciliation();
          if (record.unit === "candidacies" && currentLineup && !bridge?.rows.some((r) => r.canonicalCandidacyId === raw.id)) {
            status = "INTENTIONALLY_OUT_OF_SCOPE"; selector = "lineupForContest / azLineupReconciliation"; reason = "Historical primary candidacy is not in this contest's certified current general-election lineup. Its source remains held; it cannot be presented as a current nominee.";
          } else setResult("BALLOT_SOURCES.fetch / normalize", ballotById.get(string(raw.id)));
        } else if (record.unit === "absences") {
          const relation = ballotAbsenceAuthorityRelation(raw, ballotRows.map(object));
          setResult("BALLOT_SOURCES.fetch / normalize", relation.record);
          if (relation.kind === "MONOTONIC_SUCCESSOR") {
            status = "PROJECTED";
            selector = "BALLOT_SOURCES.fetch / normalize → strict same-fact monotonic successor";
            returned = [relation.record];
            const provenance = object(relation.record.provenance);
            reason = `The promoted ballot authority re-verified the exact same division/vintage/statement/source absence at ${string(provenance.verifiedAt)}, no earlier than the frozen observation. The frozen observation remains held lineage evidence; the Reader receives the later source verification.`;
          }
        }
        break;
      }
      case "votes": {
        if (record.holdingPath.endsWith("key-vote-positions.json")) {
          const key = input?.raw.identityKey ?? "";
          const rows = Object.entries(raw).filter(([id]) => !id.startsWith("_manifest")).map(([id, expected]) => ({ officeholderId: id, voteId: key, position: keyPositions.keyVotePositionFor(key, id), expected }));
          setResult("keyVotePositionFor", rows.every((row) => row.position === row.expected) && keyPositions.keyVoteRollCallHeld(key) ? rows : null);
        } else if (record.holdingPath.endsWith("key-votes-snapshot.json")) setResult("getKeyVotesSnapshot", keyVotes.getKeyVotesSnapshot().entries.find((entry) => entry.id === raw.id));
        else if (record.holdingPath.endsWith("bill-summaries.json") && input?.raw.identityKey) setResult("summaryForBill", billSummaries.summaryForBill(input.raw.identityKey));
        else if (["votes", "positions", "rollCalls"].includes(record.unit)) setResult("getVotesSnapshot / getStateVotesSnapshot", voteRecords.get(voteIdentity(raw)));
        else support("recorded-vote explanation input", "Key-vote titles, bill summaries and law-title caches are explanatory inputs to named vote selectors, not additional roll-call positions. Canonical vote rows are counted separately.");
        break;
      }
      case "voting-sites": setResult("loadVotingSites", voting.jurisdictions.find((row) => row.ocdId === raw.ocdId)); break;
      case "prl": setResult("prlProfileForSubject", prl.prlProfileForSubject(`congress:${string(raw.bioguideId)}`)); break;
      case "portraits": {
        const bindings = raw.bindings as { subjectId: string; permitted: boolean }[];
        const selected = await Promise.all(bindings.filter((binding) => binding.permitted).map(async (binding) => {
          const holder = await registry.seatHolderById(binding.subjectId);
          const bar = binding.subjectId.indexOf("|");
          const card = binding.subjectId.startsWith("ballot-") ? bar < 0 ? cards.cardForCandidacy(binding.subjectId) : cards.cardForNominee(binding.subjectId.slice(0, bar), binding.subjectId.slice(bar + 1)) : null;
          const url = holder?.photoUrl ?? card?.photoUrl;
          return url === raw.url ? { subjectId: binding.subjectId, url } : null;
        }));
        const active = selected.filter(Boolean);
        if (active.length) setResult("seatHolderById / cardForCandidacy / cardForNominee", active, "The exact verified asset URL survives the current canonical person/card portrait selector; other eligible image variants do not override this preference.");
        else support("canonical portrait preference", "This eligible sourced image is an alternate or superseded portrait. Current canonical selectors choose another approved portrait for the same person; one person does not acquire multiple simultaneously displayed faces.");
        break;
      }
      case "official-actions": {
        if (record.unit === "actions") {
          const reader = await import("../officials/reader-actions.ts");
          setResult("officialActionsForTarget", reader.officialActionsForTarget(string(raw.officeholderId)).records.find((row) => row.id === raw.id));
        }
        else support("acquired roster source", "This source-backed school roster is an acquisition input to the separately inventoried assembled BODY_ROSTERS. Unmapped extra source fields remain visible as a source-to-schema obligation, not a claimed rendered official action.");
        break;
      }
      case "registry": {
        if (record.unit === "divisions" && raw.officeholderId) setResult("seatHoldersForDivision", (await registry.seatHoldersForDivision(string(raw.ocdId))).find((holder) => holder.id === raw.officeholderId), "This is an officeholder/division membership edge, not a second geometry or government record.");
        else if (record.unit === "divisions") setResult("divisionsByOcdIds", await registry.divisionsByOcdIds([string(raw.ocdId)]));
        else if (record.unit === "bodies") setResult("knownBodySubjectIds", allBodies.has(string(raw.id)) ? { id: raw.id } : null);
        else if (record.unit === "officeholders") setResult("seatHolderById", await registry.seatHolderById(string(raw.id)));
        else support("registry identity/portrait metadata", "Photo indexes and registry metadata support canonical SeatHolder projections. A source index row is not itself a second official or independently displayed record.");
        break;
      }
      case "congress": {
        const id = string(raw.bioguide) || (raw.id && typeof raw.id === "object" ? string(object(raw.id).bioguide) : string(raw.id));
        if (record.unit === "members") {
          setResult("seatHolderById", await registry.seatHolderById(id.startsWith("congress:") ? id : `congress:${id}`));
          if (returned.length) support("congress migration → canonical officeholder projection", "The SHA-pinned source member snapshot is an acquisition input to separately inventoried normalized officeholders-us.json records. Every source member resolves through the actual canonical holder selector; the source file itself is not a runtime filesystem requirement or an additional official.");
        } else if (record.unit === "byMember") {
          const directory = await import("../officials/directory.ts");
          const key = input?.raw.identityKey ?? id;
          const selected = directory.directoryFor(key.startsWith("congress:") ? key : `congress:${key}`);
          setResult("directoryFor", selected && canonicalReaderAuthorityJson(selected.entry) === canonicalReaderAuthorityJson(raw) ? { id: key, ...selected } : null, "Exact Bioguide directory entry, district-office contacts, committee memberships and their source survive the runtime directory selector. These are additional held directory facts, not additional people.");
        } else support("federal directory metadata", "Directory metadata supports exact per-member entries; actual member directory facts are separately projected and rendered.");
        break;
      }
      case "everyday-routing": {
        if (raw.holdingStatus === "CONTACT_OWED") { status = "INTENTIONALLY_OUT_OF_SCOPE"; selector = "everydayContactsFor"; reason = "An explicit contact miss is operational attribution, not a held service contact or a publisher absence."; }
        else setResult("everydayContactsFor", (raw.zips as string[] ?? []).flatMap((zip) => everyday.everydayContactsFor(string(raw.topicId), zip, everydayDataPlane.currentEverydayRoutingProjection())).filter((r) => r.sourceUrl === raw.sourceUrl).slice(0, 1));
        break;
      }
      case "sourced-definitions": {
        if (raw.formKey) setResult("formDefinitionFor", forms.formDefinitionFor(string(raw.formKey)));
        else support("body/office definition projection", "Class/office descriptions are keyed templates supporting a body or office, not standalone governments. Their selector applicability depends on the body's class/form or the office title, not the number of source-template rows.");
        break;
      }
      case "geography": support("canonical geographic projection", "Geometry, ZIP lookups and Census/NCES crosswalk records are supporting location/identity inputs. The resolver manifest explicitly accounts for live files and superseded national inputs; only resulting governing divisions/bodies are reader rows. Exact geometry and deployment controls are separate."); break;
      case "outcomes": {
        const outcomes = await import("../meetings/reader-records.ts");
        const result = outcomes.meetingReaderRecords(string(raw.meetingId), string(raw.bodyId));
        setResult("meetingReaderRecords", result.status === "HELD" && result.bodyId === raw.bodyId ? result : null);
        break;
      }
      case "nh-legislative-members": {
        const holders = await import("../ballot/seat-holders.ts");
        if (holders.nhSeatHolderReadState().kind === "STORE_UNREACHABLE") await holders.refreshNhSeatHolders();
        const electedStatus = string(raw.electedStatus) as Parameters<typeof holders.sits>[0];
        const title = raw.chamber === "S" ? `State Senator, District ${string(raw.district)}` : `State Representative, ${string(raw.county)} County District ${string(raw.district)}`;
        const selected = holders.nhLegislativeHolders(title);
        if (!holders.sits(electedStatus)) {
          status = "INTENTIONALLY_OUT_OF_SCOPE"; selector = "sits / nhLegislativeHolders";
          reason = `Source electedStatus=${electedStatus}; this record cannot claim current incumbency. The exact seat selector returned ${selected.length} currently sitting member(s).`;
        } else {
          setResult("nhLegislativeHolders", selected.find((holder) => holder.personKey === raw.seatNo), "The publisher's exact seat number survives the district/chamber selector. NEW and INCUMBENT both count as currently sitting; no new name matching is introduced.");
          if (returned.length) support("nhLegislativeHolders → ballot seat incumbency", "This publisher seat record is a sourced current-seat input. It supplies incumbency only for applicable current ballot contests; it is not a claim that all General Court seats are contested or held on this ballot. Current normalized contest and candidate records carry the separate reader obligation.");
        }
        break;
      }
    }
    if (record.eligibility.state === "READER_ELIGIBLE" && rosterAuthority?.failures.length) {
      status = "BROKEN_PROJECTION";
      selector = "projectReaderRoster frozen denominator → promoted registry runtime";
      returned = [];
      reason = rosterAuthority.failures.join("; ");
    }
    const returnedIds = unique(returned.flatMap((row) => identities({ value: object(row), pointer: "", unit: "returned" })));
    const finalStatus = status as ReaderRecordProjection["status"];
    const surfaceDispositions: NonNullable<ReaderRecordProjection["surfaceDispositions"]> = {};
    const inputFor = (surfaces: ReaderSurfaceId[], explanation: string) => { for (const surface of surfaces) surfaceDispositions[surface] = { status: "SUPPORTING_INPUT", selector, reason: explanation }; };
    if (finalStatus === "PROJECTED") {
      if(record.family==="body-rosters") {
        const applicable=(Array.isArray(raw.members)?raw.members:[]).map((member)=>string(object(member).id)).filter((id)=>currentBallotHolderIds.has(id));
        inputFor(["ballot"],`A body-roster container is a seat/identity source for CandidateDetails, not a complete body list on the ballot. The actual current incumbentHolderFor/contestIncumbency selector resolves these source members for current candidate cards: ${applicable.length?applicable.join(", "):"none"}. Full named-body membership and each source field retain map/Ask obligations; no current candidacy is invented for another roster member.`);
      }
      const subjectOfficialId=record.family==="prl"?`congress:${string(raw.bioguideId)}`:record.family==="congress"&&record.unit==="byMember"?`congress:${input?.raw.identityKey??""}`:record.family==="votes"&&record.unit==="positions"?string(raw.officeholderId):null;
      if(subjectOfficialId&&!currentBallotHolderIds.has(subjectOfficialId)) surfaceDispositions.ballot={status:"INTENTIONALLY_OUT_OF_SCOPE",selector:"current CandidateDetails canonical recordHolder IDs",reason:`This official-specific record belongs to ${subjectOfficialId}, which is not a recordHolder for a current ballot card. It remains held for the declared official/API/Ask question; no current candidate or identity pairing is manufactured.`};
      if(subjectOfficialId&&["prl","congress"].includes(record.family)&&!scopedOfficialIds.has(subjectOfficialId)) surfaceDispositions.map={status:"IDENTITY_UNRESOLVED",selector:"canonical scoped division membership / exact official ID",reason:`The source profile identifies ${subjectOfficialId}, but no verified geographic division relationship exposes that official on the current map. Exact identity is preserved; it cannot be attached to another division or person.`};
      if(record.family==="votes"&&["votes","rollCalls"].includes(record.unit)) {
        const id=string(raw.id);const positions=federalVotes.positions.filter((position)=>string(object(position).voteId??object(position).rollCallId)===id);
        if(!positions.some((position)=>currentBallotHolderIds.has(position.officeholderId))) surfaceDispositions.ballot={status:"INTENTIONALLY_OUT_OF_SCOPE",selector:"current CandidateDetails recordHolder IDs → canonical recorded positions",reason:`No current ballot card's exact official has a held position on vote ${id}. The vote remains on its full votes/Ask endpoints and applicable official records; it cannot be attributed to an unrelated candidate.`};
      }
      if(["state-officeholders","statewide-executives","campaign-sites"].includes(record.family)||record.family==="registry"&&record.unit==="officeholders") {
        if(!currentBallotHolderIds.has(string(raw.id))) surfaceDispositions.ballot={status:"INTENTIONALLY_OUT_OF_SCOPE",selector:"CandidateDetails recordHolder = incumbentHolderFor ?? contestIncumbency.holderFor across every current canonical contest",reason:`This held official ${string(raw.id)} is not the canonical recordHolder for any current ballot candidate card. Their exact official/representation/Ask record remains available; an official holding cannot create a current candidacy or invent an incumbent join.`};
      }
      if (record.family === "federal-finance") {
        const targets = record.unit === "absences" ? [string(raw.targetKey)] : raw.targetKeys as string[];
        if (!targets.some((target)=>currentBallotTargets.has(target))) surfaceDispositions.ballot = { status: "INTENTIONALLY_OUT_OF_SCOPE", selector: "current canonical ballot targets / fundingAnswerForTarget", reason: `The held FEC answer targets ${targets.join(", ")}, none of which is a current canonical ballot card. The answer remains available for applicable officials/funding/Ask; it cannot create a current candidacy.` };
        if (!targets.some((target)=>scopedOfficialIds.has(target) || bodyRosterHolders.has(target))) surfaceDispositions.map = { status: "INTENTIONALLY_OUT_OF_SCOPE", selector: "current canonical official targets / fundingAnswerForTarget", reason: "This held federal finance answer has no target in the current scoped official index. The candidate/funding/Ask answer remains applicable, but it cannot be assigned to an unrelated map official." };
      }
      if (record.family === "ballot" && record.unit === "cards" && !["bio", "phone", "email", "filedAddress"].some((field)=>raw[field])) inputFor(["ask"], "This card record contains only portrait image fields. Its separately inventoried reviewed image is a visual card obligation; it does not contain a text biography or contact value for Ask to assert.");
      if ((record.family === "state-officeholders" || record.family === "registry") && record.unit === "officeholders" && !scopedOfficialIds.has(string(raw.id))) {
        for (const surface of ["representation", "map", "ballot"] as const) surfaceDispositions[surface] = { status: "IDENTITY_UNRESOLVED", selector: "seatHoldersForDivision over every canonical body/division and declared roster edge; seatHolderById", reason: `The held person ${string(raw.id)} resolves exactly by ID, but no current canonical division projection attaches this person. Their official facts can answer an explicitly named/identified Ask subject; geographic representation or a ballot incumbency claim requires a verified division/office relationship. No name/geometry guess is permitted, and this does not claim the person or their facts are unheld.` };
      }
      if (record.family === "state-money") {
        const targets = raw.targetKeys as string[];
        const hasCurrentCard = targets.some((target) => currentBallotTargets.has(target));
        const officialStates = targets.map((target) => moneyIdentity.candidacyOfficialIdentityStatus(target));
        if (!hasCurrentCard) surfaceDispositions.ballot = { status: "INTENTIONALLY_OUT_OF_SCOPE", selector: "BALLOT_SOURCES / lineupForContest / reconciledCandidacyIdForCard", reason: "This held historical candidacy is absent from the current certified/general ballot card set. Its finance remains available through the canonical funding endpoint and any separately resolved current official; it cannot create a current nominee." };
        if(!hasCurrentCard&&officialStates.every((status)=>status==="NO_APPLICABLE_OFFICIAL")) surfaceDispositions["state-money"]={status:"INTENTIONALLY_OUT_OF_SCOPE",selector:"current candidate/official card identity → StateMoneySection",reason:"This historical filing has neither a current ballot card nor a resolved current official card. Its exact funding API and historical Ask answer remain applicable; the visual state-money section does not create a current person card merely to display a historical filing."};
        if (officialStates.every((status) => status === "NO_APPLICABLE_OFFICIAL")) surfaceDispositions.map = { status: "INTENTIONALLY_OUT_OF_SCOPE", selector: "candidacyOfficialIdentityStatus", reason: "The committed candidacy bridge names no current official for this candidacy. Its eligible finance remains on its applicable candidate card and funding/Ask surfaces; attaching it to an unrelated map official would be a false positive." };
      }
      if (record.family === "congress" && record.unit === "byMember") inputFor(["representation"], "The canonical directory module explicitly keeps district-office and committee details out of the representation coverage payload. They are fetched per member by the card's directory endpoint and retain direct map/ballot delivery obligations; this is not a second representation record.");
      if (record.family === "votes" && record.holdingPath.endsWith("bill-summaries.json")) inputFor(["votes"], "The votes endpoint returns recorded roll calls and key-vote metadata, not the plain-language bill-summary field. The visual card reads this summary directly through summaryForBill/BillPlainSummary, and Ask reads the same canonical summary. Every summary retains direct ballot, map and Ask obligations; this API-specific relationship is not a second returned roll-call row.");
      if (record.family === "curated-body-identities") inputFor(["representation"], "This exact body identity supplies the representation lookup context; the representation endpoint returns sourced officeholders, not a list of body descriptions. The body itself retains its direct map card obligation.");
      if (record.family === "registry") {
        if (record.unit === "bodies") inputFor(["representation", "ballot", "meetings"], "A canonical body supplies government/office/meeting identity context to these consumers. It is not an extra person, contest or meeting row. Its own fields remain a direct map card obligation; resulting officials, ballots and meetings are separately inventoried.");
        else if (record.unit === "divisions" && !raw.officeholderId) inputFor(["representation", "ballot", "meetings"], "The exact canonical division is a geographic selection input for these consumers, not another officeholder, contest or meeting. The executed division selector returns it; the resulting civic payload and its map division card remain separate obligations.");
        else if (record.unit === "divisions" && raw.officeholderId) inputFor(["map", "ballot", "meetings"], "This record is the exact division-to-officeholder edge. It is directly checked in representation; the separately inventoried person fields supply cards, and the edge does not create an additional person or meeting.");
        else if (record.unit === "officeholders") inputFor(["meetings"], "An officeholder supplies person/body membership context to meeting rendering; they are not a meeting event. Their own person fields retain map, ballot and representation obligations.");
      }
      if (record.family === "sourced-definitions" && raw.formKey) inputFor(["ballot"], "A governmental form definition explains a body on the map. Ballot office explanations use the separately inventoried office-blurb selector; a form template is not an additional candidate/card fact.");
      if (record.family === "meetings" && record.unit === "agendaDocuments") inputFor(["meetings"], "This is document content for a named meeting, not another event in the meetings-list endpoint. The separately inventoried meeting row supplies that endpoint; the document retains agenda, Ask and map obligations.");
      if (record.family === "meetings" && record.unit === "meetings") inputFor(["agenda"], "This meeting identity is context for the agenda request. The agenda response's direct facts are documents, agenda items, actions and roll calls; the event row is independently required on meetings, map and Ask.");
      if (record.family === "meetings") {
        const meeting = snapshot.meetings.find((meeting) => meeting.id === (record.unit === "meetings" ? raw.id : raw.meetingId));
        if (meeting && !currentMeetingWindow(meeting)) for (const surface of record.unit === "meetings" ? ["meetings", "map"] as const : ["map"] as const) surfaceDispositions[surface] = { status: "INTENTIONALLY_OUT_OF_SCOPE", selector: "searchMeetings / CONCLUDED_LOOKBACK_DAYS / UPCOMING_HORIZON_DAYS", reason: `Event ${meeting.id} starts ${meeting.startsAt}, outside the canonical calendar window ${CONCLUDED_LOOKBACK_DAYS} days back / ${UPCOMING_HORIZON_DAYS} days ahead at ${asOf.toISOString()}. This is a current-calendar scope, not unheld data or publisher absence. Held historical records retain applicable dated Ask/agenda obligations.` };
        if (record.unit === "agendaDocuments") {
          // What a reader is shown for this sitting is readerAgendaDocuments over the LIVE rows: one row per
          // distinct content (the newest row carrying it), no publication-index page once the sitting's own
          // document is held. /api/agenda, the meeting card and Ask all serve exactly that projection.
          const heldLive = snapshot.agendaDocuments?.filter((doc) => doc.meetingId === raw.meetingId) ?? [];
          const shown = readerAgendaDocuments(heldLive, { documentsAcrossCorpus: snapshot.agendaDocuments ?? [], meetingsAcrossCorpus: snapshot.meetings }).documents;
          const latest = shown[0];
          if (heldLive.some((doc) => doc.id === raw.id) && !shown.some((doc) => doc.id === raw.id)) {
            // Held live and not shown: an identical re-fetch of a shown row, or an index page set aside. A row
            // missing from the live rows altogether is NOT excused here; it stays an obligation the proof checks.
            for (const surface of ["agenda", "map", "ask"] as const) surfaceDispositions[surface] = { status: "INTENTIONALLY_OUT_OF_SCOPE", selector: "readerAgendaDocuments (GET /api/agenda, the meeting card, Ask)", reason: `Held and not shown on its own. Its content is identical to a newer row shown for this sitting (a re-fetch, not a version), or it is a publication-index page set aside because the sitting's own document is held${latest ? `; the sitting shows ${shown.length} distinct document${shown.length === 1 ? "" : "s"}, newest ${latest.id}` : ""}. The stored row remains provenance.` };
          } else if (latest && latest.id !== raw.id) for (const surface of ["map", "ask"] as const) surfaceDispositions[surface] = { status: "INTENTIONALLY_OUT_OF_SCOPE", selector: surface === "map" ? "GET /api/agenda newest-first → AgendaDocuments documents[0]" : "canonical meeting evidence → latest shown agenda version", reason: `This is an earlier distinct version. The current meeting question selects the latest shown version ${latest.id}; this version remains directly returned by the agenda endpoint and cannot be presented as the current agenda. The map also displays the distinct version count.` };
        }
      }
      if (record.family === "body-compositions") inputFor(["civic-routing"], "The exact verified legal composition constrains membersOfBody before contact routing. Its member count was checked by this adapter. Contact records are person/office facts rather than an extra legal-composition answer; the composition itself remains a direct map obligation.");
      if (record.family === "portraits" && Array.isArray(raw.bindings)) {
        const activeBindings = returned.map(object).map((binding)=>string(binding.subjectId));
        const officials = activeBindings.filter((subjectId)=>!subjectId.startsWith("ballot-"));
        if(activeBindings.every((subjectId)=>!currentBallotTargets.has(subjectId)&&!currentBallotHolderIds.has(subjectId))) surfaceDispositions.ballot={status:"INTENTIONALLY_OUT_OF_SCOPE",selector:"current canonical ballot candidacy and recordHolder portrait bindings",reason:"The current approved portrait is not bound to any current ballot card or its exact incumbent record. Its applicable map/representation identity remains held; an image cannot create a candidacy."};
        if (!officials.length) inputFor(["representation", "map"], "This portrait is bound only to a ballot candidacy, not a current canonical officeholder. Geographic official/representation surfaces may not attach a candidate portrait to another person; the candidate card retains the image obligation.");
        else if (officials.every((id)=>!scopedOfficialIds.has(id) && !bodyRosterHolders.has(id))) for (const surface of ["representation", "map"] as const) surfaceDispositions[surface] = { status: "IDENTITY_UNRESOLVED", selector: "canonical portrait subject binding / seatHoldersForDivision", reason: `The image is verified and bound exactly to ${officials.join(", ")}, but none of those people has a current canonical geographic officeholder projection. Image bytes and personal identity are held; their geographic representation relationship remains unresolved.` };
      }
    }
    if (finalStatus === "BROKEN_PROJECTION" || finalStatus === "PROJECTION_UNPROVEN") failures.push(`${record.auditId}: ${selector}: ${reason}`);
    const childDispositions = rosterAuthority?.childDispositions;
    records.push({ auditId: record.auditId, family: record.family, status: finalStatus, selector, canonicalIdentities: record.canonicalIdentity, returnedIdentities: returnedIds, returnedCount: returned.length, payloadSha256: returned.length ? sha256(JSON.stringify(clean(returned))) : null, reason, ...(Object.keys(surfaceDispositions).length ? { surfaceDispositions } : {}), ...(childDispositions?.length ? { childDispositions } : {}) });
  }
  return { formatVersion: 1, holdingsDigest: census.holdingsDigest, projectorSha256: sha256(readFileSync(join(root, "lib/holdings/reader-census.ts"))), asOf: asOf.toISOString(), meetingListingIdentity: listingIdentity, currentBallotHolderIds:unique([...currentBallotHolderIds]), ballotHolderObligations, ballotQualificationObligations, rule: "Executed local selectors prove holding-to-payload survival only. PROJECTED never claims browser rendering or deployed availability. Supporting inputs and current-lineup exclusions carry explicit record-specific scope reasons; unproved direct payloads remain failures. Current ballot holder scope also includes independently expected committed same-office/division relations; a failed incumbent join cannot erase its own obligation.", records, counts: counts(records.map((r) => r.status)), failures };
}

export interface ReaderComponentCase {
  readonly auditId: string;
  readonly component: string;
  readonly componentSha256: string;
  readonly selector: string;
  readonly actualCanonicalIdentities: readonly string[];
  readonly payloadSha256: string;
  readonly markup: string;
  readonly markupSha256: string;
  readonly expectedFragments: readonly string[];
  readonly forbiddenFragments: readonly string[];
  readonly rowCounts: Readonly<Record<string, { expected: number; actual: number }>>;
  readonly failures: readonly string[];
  readonly sourceDispositions?: readonly { id: string; status: string; reason: string }[];
}

export interface ReaderSurfaceClassWitness {
  readonly surface: ReaderSurfaceId;
  readonly component: string;
  readonly exactHead: string;
  readonly evidencePath: string;
  readonly evidenceSha256: string;
  readonly screenshots?: readonly { readonly path: string; readonly sha256: string }[];
}

/** Diagnostic evidence inventory only: different heads never become closure. */
export function readerProofInventory(root: string, census: ReaderCensus, routeEvidencePaths: readonly string[], componentEvidencePaths: readonly string[]): { rule: string; routeFailures: string[]; componentFailures: string[]; rows: { rowId: string; family: string; surface: ReaderSurfaceId; applicable: number; actualRouteEvidenceAvailable: number; actualLeafEvidenceAvailable: number; lackingEitherInstrument: number; missing: string[] }[] } {
  const routes = composeCanonicalRouteProofs(root, census, routeEvidencePaths);
  const observed = new Map<string, Set<string>>();
  for (const proof of routes.proofs) observed.set(proof.rowId, new Set([...(observed.get(proof.rowId) ?? []), ...proof.renderedRecordIds]));
  const componentFailures: string[] = [];
  const cases = new Map<string, Set<string>>();
  const records = new Map(census.records.map((record) => [record.auditId, record]));
  const componentHashes = new Map<string, string>();
  const componentReach = new Map<string, boolean>();
  for (const path of componentEvidencePaths) {
    const evidence = JSON.parse(readReaderEvidence(root, path).toString("utf8")) as { holdingsDigest: string; cases: ReaderComponentCase[]; sourceHashes?: { path: string; sha256: string }[]; failures: string[] };
    if (evidence.holdingsDigest !== census.holdingsDigest) { componentFailures.push(`${path}: holdings changed`); continue; }
    if (evidence.sourceHashes?.some((source) => !existsSync(join(root, source.path)) || sha256(readFileSync(join(root, source.path))) !== source.sha256)) { componentFailures.push(`${path}: selector source changed`); continue; }
    for (const entry of evidence.cases) {
      if (!componentHashes.has(entry.component) && existsSync(join(root, entry.component))) componentHashes.set(entry.component, sha256(readFileSync(join(root, entry.component))));
      const sourceMatches = componentHashes.get(entry.component) === entry.componentSha256;
      if (!sourceMatches || sha256(entry.markup) !== entry.markupSha256 || entry.failures.length || inspectReaderMarkup(entry.markup, entry.expectedFragments, entry.forbiddenFragments, entry.rowCounts).length) { componentFailures.push(`${entry.auditId}: current actual leaf proof unavailable`); continue; }
      const record = records.get(entry.auditId);
      if (!record || !entry.actualCanonicalIdentities.length || entry.actualCanonicalIdentities.some((id) => !record.canonicalIdentity.includes(id))) continue;
      cases.set(entry.auditId, new Set([...(cases.get(entry.auditId) ?? []), entry.component]));
    }
  }
  return { rule: "Instrument availability only. Route and leaf evidence may name different proved heads. Leaf output still requires an actual same-head in-situ surface witness; all final delivery requires a matching deployed bundle. These counts never mark rows RENDERED or zero final false negatives.", routeFailures: routes.failures, componentFailures: unique(componentFailures), rows: census.rows.map((row) => {
    const ids = row.applicableEligibleRecordIds ?? row.eligibleRecordIds;
    const route = observed.get(row.id) ?? new Set<string>();
    const surfacePath = READER_SURFACES.find((surface) => surface.id === row.readerSurface)!.path;
    const leaf = new Set(ids.filter((id) => { const required = componentRequirements(records.get(id)!); return required.length > 0 && required.every((component) => {
      if (!cases.get(id)?.has(component)) return false;
      const key = `${surfacePath}#${component}`;
      if (!componentReach.has(key)) componentReach.set(key, importReachability(root, surfacePath, component).reached);
      return componentReach.get(key);
    }); }));
    const missing = ids.filter((id) => !route.has(id) && !leaf.has(id));
    return { rowId: row.id, family: row.datasetFamily, surface: row.readerSurface, applicable: ids.length, actualRouteEvidenceAvailable: ids.filter((id) => route.has(id)).length, actualLeafEvidenceAvailable: leaf.size, lackingEitherInstrument: missing.length, missing };
  }) };
}

/** Only the exact promoted profile namespace emitted by projectCandidateProfile
 * encodes these frozen card/link fields. A key or path substring is insufficient. */
export function candidateProfileCensusHoldingPath(profile: { holdingKey: unknown; field: unknown; holdingPath: unknown }): string | null {
  if (typeof profile.holdingKey !== "string" || !profile.holdingKey || typeof profile.field !== "string") return null;
  const field = profile.field;
  const unit = ["official", "campaign"].includes(field) ? "links" : ["bio", "phone", "email", "filedAddress"].includes(field) ? "cards" : null;
  if (!unit) return null;
  const key = profile.holdingKey.replaceAll("~", "~0").replaceAll("/", "~1");
  const pointer = `/${unit}/${key}${field === "bio" ? "" : `/${field}`}`;
  const frozen = `data/ballot/candidate-${unit}-2026.json#${pointer}`;
  const promoted = `civic-data:CANDIDATE_PROFILE:US-AZ+US-NH+US-NJ:2026-supported-candidates#${pointer}`;
  return profile.holdingPath === frozen || profile.holdingPath === promoted ? frozen : null;
}

/** A promoted ZIP-scoped contact must demonstrate every ZIP of the frozen
 * multi-ZIP holding, with all remaining contact fields and source equal. */
export function civicContactObserved(contact: ObjectRow, observed: ReadonlySet<string>): boolean {
  const value = Object.fromEntries(Object.entries(contact).filter(([key]) => key !== "holdingStatus"));
  if (observed.has(`contact:${canonicalReaderAuthorityJson(value)}`)) return true;
  const zips = value.zips;
  return Array.isArray(zips) && zips.length > 0 && zips.every((zip) => typeof zip === "string" && observed.has(`contact:${canonicalReaderAuthorityJson({ ...value, zips: [zip] })}`));
}

/** Reconcile known actual route/browser instruments by native record identity. */
export function composeCanonicalRouteProofs(root: string, census: ReaderCensus, evidencePaths: readonly string[], bundle?: NonNullable<ReaderDeliveryProof["deployedBundle"]>): { proofs: ReaderDeliveryProof[]; failures: string[] } {
  const context = loadManifestContext(root);
  const sourceRows = new Map(readerDatasets(context).flatMap((dataset) => readerRecordsForDataset(root, dataset).map((raw) => [`${dataset.path}#${raw.pointer}` as string, raw] as const)));
  const proofs: ReaderDeliveryProof[] = [];
  const failures: string[] = [];
  for (const evidencePath of evidencePaths) {
    const bytes = readReaderEvidence(root, evidencePath);
    const evidence = object(JSON.parse(readReaderEvidence(root, evidencePath).toString("utf8")));
    if (!/^[a-f0-9]{40}$/.test(string(evidence.exactHead)) || bundle && evidence.exactHead !== bundle.exactHead) { failures.push(`${evidencePath}: actual execution is not bound to a valid exact head matching the bundle when supplied`); continue; }
    const evidenceHashes=evidenceSourceHashes(evidence.sourceHashes);
    if(bundle&&!evidenceHashes.length) {failures.push(`${evidencePath}: executed proof lacks its source/holding fingerprint`);continue;}
    const stale = readerSourceHashProblems(root, evidenceHashes);
    if (stale.length) { failures.push(`${evidencePath}: ${stale.length} source/holding hashes changed after execution`); continue; }
    const observed = new Map<ReaderSurfaceId, Map<string, string[]>>();
    const keyPositionsObserved = new Map<ReaderSurfaceId, Map<string, Map<string, string>>>();
    const memberChambersObserved = new Map<ReaderSurfaceId, Map<string, string>>();
    const observeKeyPosition = (surface: ReaderSurfaceId, key: string, member: string, position: string, chamber: string) => {
      const maps = keyPositionsObserved.get(surface) ?? new Map<string, Map<string, string>>();
      const members = maps.get(key) ?? new Map<string, string>(); members.set(member, position); maps.set(key, members); keyPositionsObserved.set(surface, maps);
      const chambers = memberChambersObserved.get(surface) ?? new Map<string, string>(); chambers.set(member, chamber); memberChambersObserved.set(surface, chambers);
    };
    const add = (surface: ReaderSurfaceId, key: string, ids: string[]) => { const set = observed.get(surface) ?? new Map(); set.set(key, unique([...(set.get(key) ?? []), ...ids])); observed.set(surface, set); };
    const candidateKey = (kind: string, value: unknown) => `${kind}:${string(value)}`;
    const routeRecords = (Array.isArray(evidence.records) ? evidence.records : []).map(object);
    for (const entry of routeRecords) {
      const surface = string(entry.surface);
      if (surface === "representation") {
        const actual = Array.isArray(entry.returnedIds) ? entry.returnedIds as string[] : [];
        if (entry.returnedCount !== actual.length || JSON.stringify(actual) !== JSON.stringify(entry.expectedIds)) { failures.push(`${evidencePath}: representation count or exact IDs differ`); continue; }
        for (const id of actual) { add("representation", `official:${id}`, [id]); add("representation", `membership:${entry.division}#${id}`, [string(entry.division), id]); }
        const visit = (value: unknown): void => {
          if (!value || typeof value !== "object") return;
          if (Array.isArray(value)) { value.forEach(visit); return; }
          const holder = object(value);
          if (typeof holder.id === "string" && actual.includes(holder.id)) for (const url of [holder.photoUrl, holder.photo, holder.portraitUrl].filter((url): url is string => typeof url === "string")) add("representation", `portrait:${url}`, [url]);
          Object.values(holder).forEach(visit);
        };
        visit(entry.payload);
      } else if (surface === "civic-routing") {
        const contact = object(entry.returnedContact);
        if (entry.sourceUrl === contact.sourceUrl && canonicalReaderAuthorityJson(entry.expectedFields) === canonicalReaderAuthorityJson(entry.returnedFields)) add("civic-routing", `contact:${canonicalReaderAuthorityJson(contact)}`, [string(contact.topicId), string(contact.sourceUrl)]);
      } else if (surface === "votes") {
        const ids = Array.isArray(entry.canonicalIds) ? entry.canonicalIds as string[] : [];
        if (entry.returnedCount !== ids.length || entry.statedCount !== ids.length || entry.expectedCount !== ids.length) { failures.push(`${evidencePath}: vote count differs`); continue; }
        for (const id of ids) { add("votes", `vote:${id}`, [id]); add("votes", `position:${entry.member}#${id}`, [string(entry.member), id]); }
      } else if (surface === "key-votes") {
        const rows = (Array.isArray(entry.payload) ? entry.payload : []).map(object);
        if (entry.expectedCount !== rows.length || entry.returnedCount !== rows.length) { failures.push(`${evidencePath}: key-vote metadata count differs`); continue; }
        for (const row of rows) {
          const item = object(row.entry); add("votes", `key-entry:${item.id}`, [string(item.id)]);
          (Array.isArray(row.refs) ? row.refs : []).map(object).forEach((ref, index) => {
            const key = `${item.id}|${entry.chamber}|${ref.congress}-${ref.session}:${ref.rollNumber}`;
            const position = (Array.isArray(row.positions) ? row.positions : [])[index];
            if (typeof position === "string") observeKeyPosition("votes", key, string(entry.member), position, string(entry.chamber));
          });
        }
      } else if (surface === "positions") {
        const expected = Array.isArray(entry.expectedRecordIds) ? entry.expectedRecordIds as string[] : [];
        const returned = Array.isArray(entry.returnedRecordIds) ? entry.returnedRecordIds as string[] : [];
        for (const id of expected.filter((id) => returned.includes(id))) add("positions", `document:${id}`, [id]);
      } else if (surface === "agenda" && entry.meetingId) {
        const documents = (Array.isArray(entry.documents) ? entry.documents : []).map(object);
        const ids = documents.map((doc) => string(doc.id));
        if (entry.returnedCount !== ids.length || JSON.stringify(entry.expectedIds) !== JSON.stringify(entry.returnedIds) || JSON.stringify(ids) !== JSON.stringify(entry.returnedIds)) { failures.push(`${evidencePath}: agenda document identity/count differs`); continue; }
        for (const doc of documents) add("agenda", `document:${doc.id}`, [string(doc.id), string(entry.meetingId)]);
      } else if (surface === "agenda/map" && entry.meetingId && JSON.stringify(entry.expected) === JSON.stringify(entry.returned)) add("agenda", `outcome:${entry.meetingId}#${entry.bodyId}`, [string(entry.meetingId), string(entry.bodyId)]);
      else if (surface === "meetings/map") {
        const returned = (Array.isArray(entry.identities) ? entry.identities : []).map(object);
        if (returned.length !== entry.returnedCount) { failures.push(`${evidencePath}: meeting count differs`); continue; }
        for (const row of returned) add("meetings", `meeting:${row.id}`, [string(row.id), ...(row.bodyId ? [string(row.bodyId)] : [])]);
      } else if (surface === "funding/state-money") {
        if (object(entry.payload).kind === "absence") add("funding", `federal-absence:${entry.target}:${JSON.stringify(object(entry.payload).data)}`, [string(entry.target)]);
        const visit = (value: unknown) => {
          if (!value || typeof value !== "object") return;
          if (Array.isArray(value)) { value.forEach(visit); return; }
          const row = object(value);
          if (row.dataClass === "STATE_COMMITTEE") add("funding", `state-money:${canonicalReaderAuthorityJson(row)}`, row.targetKeys as string[]);
          if (row.fecCandidateId) add("funding", `federal:${row.fecCandidateId}`, (row.targetKeys as string[] | undefined) ?? [string(entry.target)]);
          Object.values(row).forEach(visit);
        };
        visit(entry.payload);
      }
    }
    for (const entry of (Array.isArray(evidence.proofs) ? evidence.proofs : []).map(object)) {
      if (!["PROVEN", "PROVEN_FOR_THIS_QUERY"].includes(string(entry.status))) continue;
      if (entry.httpStatus !== 200 || entry.modelAnswer !== null || entry.countAgrees === false) { failures.push(`${evidencePath}: invalid Ask execution/count/model boundary`); continue; }
      const actual = (Array.isArray(entry.returnedRecords) ? entry.returnedRecords : []).map(object);
      const returnedIds = new Set([...(Array.isArray(entry.returnedRecordIds) ? entry.returnedRecordIds : []), ...(Array.isArray(entry.retrievedRecordIds) ? entry.retrievedRecordIds : []), ...actual.map((record) => record.id)].filter((id): id is string => typeof id === "string"));
      const expectedIds = Array.isArray(entry.expectedRecordIds) ? entry.expectedRecordIds as string[] : [];
      if(entry.rosterGapAgrees===true&&entry.expectedRosterGap) {
        const gap=object(entry.expectedRosterGap);const canonical=rosterGapForBody(string(gap.bodyId));
        if(canonical&&JSON.stringify(gap)===JSON.stringify(canonical)&&(Array.isArray(entry.rosterGapRecords)?entry.rosterGapRecords:[]).length) add("ask",`roster-gap:${gap.bodyId}`,[string(gap.bodyId)]);
      }
      for (const id of expectedIds.filter((id) => returnedIds.has(id))) {
        add("ask", `native:${id}`, [id]);
        add("ask", `document:${id}`, [id]);
        if (id.includes("#") && (id.startsWith("congress:") || id.startsWith("plural:"))) {
          const at = id.indexOf("#"); add("ask", `position:${id}`, [id.slice(0, at), id.slice(at + 1)]); add("ask", `vote:${id.slice(at + 1)}`, [id.slice(at + 1)]);
        }
      }
      for (const record of actual.filter((record) => record.kind === "FINANCE_SUMMARY")) {
        add("ask", `finance:${record.canonicalSubjectId}:${object(record.finance).filingState}:${canonicalReaderAuthorityJson(object(record.finance).totals)}`, [string(record.canonicalSubjectId)]);
        if (string(record.id).startsWith("fec:")) add("ask", `federal:${string(record.id).slice(4)}`, [string(record.id).slice(4)]);
        if (string(record.id).startsWith("fec-absence:")) add("ask", `federal-absence:${record.canonicalSubjectId}:${JSON.stringify({ searchUrl: record.sourceUrl, checkedAt: record.retrievedAt })}`, [string(record.canonicalSubjectId)]);
      }
      for (const record of actual) {
        if (record.kind === "OFFICEHOLDER" && entry.contactAgrees === true) add("ask",`official:${record.canonicalSubjectId}`,[string(record.canonicalSubjectId)]);
        if (record.kind === "MEETING") add("ask", `meeting:${record.id}`, [string(record.id), ...(record.bodyId ? [string(record.bodyId)] : [])]);
        if (record.kind === "CONTEST") add("ask", `contest:${record.id}`, [string(record.id)]);
        if (record.kind === "CANDIDACY") { add("ask", `candidacy:${record.id}`, [string(record.id)]); if(string(record.id).includes("|")) add("ask",`card-key:${record.id}`,[string(record.id)]); }
        if (record.kind === "MEETING_MINUTES_SUMMARY") add("ask",`minutes-summary:${string(record.id).replace(/#minutes-summary$/,"")}`,[string(record.id).replace(/#minutes-summary$/,"")]);
        if (record.kind === "MEETING_NOTICE_SUMMARY") add("ask",`notice-summary:${string(record.id).split("#notice-summary:")[0]}:${object(record.noticeSummary).contentHash}`,[string(record.id).split("#notice-summary:")[0]]);
        if (record.kind === "PUBLIC_COMMENT_ACCESS") add("ask",`access-field:${record.bodyId}:${object(record.accessRule).field}:${object(record.accessRule).value}`,[string(record.bodyId)]);
        if (record.kind === "MEASURE_QUESTION") add("ask", `measure:${record.id}`, [string(record.id)]);
        if (record.kind === "MEASURE_SUMMARY") add("ask", `measure-summary:${string(record.id).replace(/#summary$/, "")}`, [string(record.id).replace(/#summary$/, "")]);
        if (record.kind === "MEASURE_PROVISION") add("ask", `provision:${record.id}`, [string(record.id)]);
        if (record.kind === "CONTACT") {
          const nativeId = string(record.canonicalSubjectId ?? record.id).replace(/^candidate-contact:/, "");
          add("ask", `candidate-contact:${nativeId}`, [nativeId]);
        }
        if (["CANDIDATE_BIO", "CANDIDATE_LINK", "CANDIDATE_CONTACT"].includes(string(record.kind))) {
          const profile = object(record.candidateProfile);
          const holdingPath = candidateProfileCensusHoldingPath({ holdingPath: profile.holdingPath, holdingKey: profile.holdingKey, field: profile.field });
          if (holdingPath) add("ask", `profile-field:${holdingPath}:${profile.field}:${profile.value}`, [string(profile.holdingKey)]);
        }
        if (record.kind === "MEASURE_ANALYSIS") add("ask", `analysis:${string(record.id).replace(/#analysis$/, "")}`, [string(record.id).replace(/#analysis$/, "")]);
        if (record.kind === "BALLOT_ABSENCE") {
          if (string(record.id).startsWith("absence:")) add("ask", string(record.id), [string(record.id).slice("absence:".length)]);
          else {
            add("ask", `removal:${record.id}`, [string(record.id)]);
            // A normalized removal and its legacy division-keyed absence may
            // carry the identical sourced fact. Correlate the complete fact,
            // not a name or the presence of an unrelated absence response.
            for (const source of sourceRows.values()) if (source.unit === "absences") {
              const provenance = object(source.value.provenance);
              if (source.value.ocdId && source.value.statement === record.text && provenance.sourceUrl === record.sourceUrl && provenance.sourceOrg === record.sourceOrg && provenance.collectedAt === record.retrievedAt) add("ask", `absence:${source.value.ocdId}`, [string(source.value.ocdId)]);
            }
          }
        }
        if (record.kind === "KEY_VOTE_CONTEXT" && string(record.id).startsWith("key-vote-entry:")) add("ask", `key-entry:${string(record.id).slice("key-vote-entry:".length)}`, [string(record.id).slice("key-vote-entry:".length)]);
        if (record.kind === "BILL_SUMMARY" && string(record.id).startsWith("bill-summary:")) add("ask", `bill-summary:${string(record.id).slice("bill-summary:".length)}`, [string(record.id).slice("bill-summary:".length)]);
        if (record.kind === "KEY_VOTE_POSITION") for (const key of object(record.keyVote).positionKeys as string[] ?? []) observeKeyPosition("ask", key, string(record.canonicalSubjectId), string(object(record.keyVote).position), string(object(record.keyVote).chamber));
      }
      // A sitting is discharged only when every native held action and
      // member position is present in real response records across its dated
      // questions. Body identity alone cannot stand for its civic contents.
      for (const sitting of census.records.filter((record) => record.family === "outcomes")) {
        const raw = sourceRows.get(sitting.auditId)!.value;
        if (!(entry.meetingIds as string[] ?? []).includes(string(raw.meetingId))) continue;
        const required = [
          ...(Array.isArray(raw.agenda) ? raw.agenda : []).map(object).map((item) => `${item.eventItemId}#agenda`),
          ...(Array.isArray(raw.outcomes) ? raw.outcomes : []).map(object).map((action) => `${action.eventItemId}#action`),
          ...(Array.isArray(raw.rollCalls) ? raw.rollCalls : []).map(object).flatMap((roll) => (Array.isArray(roll.votes) ? roll.votes : []).map(object).map((vote) => `${roll.eventItemId}#${vote.personId ?? vote.personName}`)),
        ];
        const prior = observed.get("ask");
        if (required.length && required.every((id) => prior?.has(`native:${id}`))) add("ask", `outcome:${raw.meetingId}#${raw.bodyId}`, [string(raw.meetingId), string(raw.bodyId)]);
      }
      for (const finance of (Array.isArray(entry.expectedFinance) ? entry.expectedFinance : []).map(object).filter((record) => record.filingState === "OURS_GAP")) {
        const gaps = (Array.isArray(entry.gaps) ? entry.gaps : []).map(object);
        if (object(entry.denominators).financeIdentityUnresolved === 1 && gaps.some((gap) => gap.whose === "OURS" && gap.statement === object(finance.ourGap).whatIsMissing)) add("ask", `finance:${entry.target}:OURS_GAP:${canonicalReaderAuthorityJson(finance.totals)}`, [string(entry.target)]);
      }
    }
    for (const entry of (Array.isArray(evidence.proofs) ? evidence.proofs : []).map(object)) if (entry.snapshotId && entry.auditId && entry.renderedTextSha256) {
      const payload = object(entry.payload);
      const passages = (Array.isArray(payload.passages) ? payload.passages : []).map(object);
      if (entry.statedCount !== entry.renderedCount || entry.renderedCount !== passages.length || !passages.some((passage) => passage.snapshotId === entry.snapshotId)) { failures.push(`${evidencePath}: source passage rendered identity/count differs`); continue; }
      add("ballot", `document:${entry.snapshotId}`, [string(entry.snapshotId)]);
    }
    for (const disposition of (Array.isArray(evidence.documentDispositions) ? evidence.documentDispositions : []).map(object)) {
      const documents = census.records.filter((record) => record.family === "meetings" && record.unit === "agendaDocuments" && (() => { const raw = sourceRows.get(record.auditId)!.value; return raw.meetingId === disposition.meetingId && raw.documentUrl === disposition.documentUrl && raw.retrievedAt === disposition.retrievedAt; })());
      const expected = (Array.isArray(disposition.expectedRecordIds) ? disposition.expectedRecordIds : []) as string[];
      const provenItems = disposition.acquisition === "ITEMS_READER_READY" && expected.length > 0 && expected.every((id) => observed.get("ask")?.has(`native:${id}`));
      const provenGap = ["ACQUIRED_IS_PUBLICATION_INDEX", "READ_NO_ITEMS_EXTRACTED"].includes(string(disposition.acquisition)) && (evidence.proofs as unknown[]).map(object).some((entry) => entry.status === "PROVEN" && entry.httpStatus === 200 && entry.modelAnswer === null && (entry.meetingIds as string[] ?? []).includes(string(disposition.meetingId)) && (entry.gaps as unknown[] ?? []).map(object).some((gap) => gap.whose === "OURS" && gap.statement === disposition.reason));
      if (provenItems || provenGap) for (const record of documents) { const raw = sourceRows.get(record.auditId)!.value; add("ask", `document:${raw.id}`, [string(raw.id), string(raw.meetingId)]); }
    }
    for (const entry of (Array.isArray(evidence.results) ? evidence.results : []).map(object)) if (entry.jurisdictionId && Array.isArray(entry.siteIds)) {
      if (entry.expectedCount !== entry.returnedCount || entry.returnedCount !== entry.siteIds.length) { failures.push(`${evidencePath}: voting site count differs`); continue; }
      add("voting-sites", `jurisdiction:${entry.jurisdictionId}`, [string(entry.jurisdictionId)]);
    }
    const isBallotBrowser = evidencePath.includes("ballot") && Array.isArray(evidence.rows);
    if (isBallotBrowser) for (const row of (evidence.rows as unknown[]).map(object)) {
      if (row.statedContestCount !== row.returnedContestCount) { failures.push(`${evidencePath}: ballot contest count differs`); continue; }
      for (const entry of (row.proofs as unknown[]).map(object)) {
        add("ballot", candidateKey("contest", entry.contestId), [string(entry.contestId)]);
        for (const [key, kind] of [["candidacyIds", "candidacy"], ["measureIds", "measure"], ["removalIds", "removal"]]) for (const id of entry[key] as string[] ?? []) add("ballot", `${kind}:${id}`, [id]);
        for (const id of entry.provisionIds as string[] ?? []) add("ballot", `provision:${id}`, [id]);
        if (entry.summaryHeld) add("ballot", candidateKey("measure-summary", entry.contestId), [string(entry.contestId)]);
        for (const key of entry.actualCardKeys as string[] ?? []) add("ballot", `card-key:${key}`, [key]);
      }
      for (const id of row.absenceOcdIds as string[] ?? []) add("ballot", `absence:${id}`, [id]);
      for (const id of row.analysisContestIds as string[] ?? []) add("ballot", `analysis:${id}`, [id]);
      const nav = object(row.navigation);
      for (const field of ["dates", "registration"]) if (nav[field]) {
        const value = object(nav[field]);
        add("ballot", `navigation:${field}:${canonicalReaderAuthorityJson(value)}`, field === "dates" ? [string(value.state), string(value.sourceUrl)] : [string(value.url)]);
      }
    }
    for (const row of census.rows) {
      const observations = observed.get(row.readerSurface);
      if (!observations?.size) continue;
      const measured: string[] = [];
      const actualIdentities: Record<string, string[]> = {};
      for (const auditId of row.applicableEligibleRecordIds ?? row.eligibleRecordIds) {
        const source = sourceRows.get(auditId)!;
        const raw = source.value;
        let key = "";
        if (row.datasetFamily === "state-money") {
          const holding = raw as unknown as StateMoneyRecord;
          const authority = stateMoneyAuthorityRelation(holding, holding.targetKeys.flatMap(stateMoneyForTarget), stateMoneyReadState(holding.jurisdiction).metadata.sourceThrough);
          if (!authority.record) { failures.push(`${evidencePath}:${auditId}: no unique exact or admitted later state-money authority`); continue; }
          // The same strict successor relation already governs projection and
          // component delivery. Observe its actual current values, never the
          // old totals and never merely a coincident target/committee ID.
          const current = authority.record;
          key = row.readerSurface === "ask" ? `finance:${current.targetKeys[0]}:${current.filingState}:${canonicalReaderAuthorityJson(current.totals)}` : `state-money:${canonicalReaderAuthorityJson(current)}`;
        }
        else if (row.datasetFamily === "federal-finance") {
          if (source.unit === "absences") {
            const prefix = `federal-absence:${raw.targetKey}:`;
            key = [...observations.keys()].find((entry) => entry.startsWith(prefix) && (() => { const answer = object(JSON.parse(entry.slice(prefix.length))); return answer.searchUrl === raw.searchUrl && answer.checkedAt === raw.checkedAt; })()) ?? "";
          } else key = `federal:${raw.fecCandidateId}`;
        }
        else if (row.datasetFamily === "everyday-routing" && civicContactObserved(raw, new Set(observations.keys()))) {
          key = `contact:${canonicalReaderAuthorityJson(Object.fromEntries(Object.entries(raw).filter(([key])=>key!=="holdingStatus")))}`;
          observations.set(key, [string(raw.topicId), string(raw.sourceUrl)]);
        }
        else if (row.datasetFamily === "portraits") key = `portrait:${raw.url}`;
        else if (["candidate-corpus", "statement-corpus"].includes(row.datasetFamily)) key = `document:${raw.id}`;
        else if (row.datasetFamily === "votes") {
          if (auditId.includes("key-vote-positions.json")) {
            const native = source.identityKey ?? "";
            const positions = keyPositionsObserved.get(row.readerSurface)?.get(native);
            const chambers = memberChambersObserved.get(row.readerSurface);
            const expected = Object.entries(raw).filter(([member]) => /^congress:[A-Z]\d{6}$/.test(member));
            if (positions && expected.every(([member, position]) => positions.get(member) === position || chambers?.has(member) && chambers.get(member) !== native.split("|")[1])) {
              key = `key-map:${native}`; observations.set(key, [native]);
            }
          } else if (auditId.includes("key-votes-snapshot.json")) key = `key-entry:${raw.id}`;
          else if (auditId.includes("bill-summaries.json")) key = `bill-summary:${source.identityKey}`;
          else key = raw.officeholderId ? `position:${raw.officeholderId}#${raw.voteId ?? raw.rollCallId}` : `vote:${raw.id}`;
        }
        else if (row.datasetFamily === "outcomes") key = `outcome:${raw.meetingId}#${raw.bodyId}`;
        else if (row.datasetFamily === "minutes-summaries") key = `minutes-summary:${raw.meetingId}`;
        else if (row.datasetFamily === "notice-summaries") key = `notice-summary:${raw.meetingId}:${raw.contentHash}`;
        else if (row.datasetFamily === "comment-access") {
          const required=["commentPeriod","commentPeriodDetail","timeLimit","signup","writtenComment","attend"].filter((field)=>raw[field]);
          if(required.every((field)=>observations.has(`access-field:${raw.bodyId}:${field}:${raw[field]}`))) {key=`comment-access:${raw.bodyId}`;observations.set(key,[string(raw.bodyId)]);}
        }
        else if (row.datasetFamily === "body-rosters" && row.readerSurface === "ask") {
          const rosterAuthority=compareFrozenBodyRosterAuthority(raw as unknown as BodyRoster,currentBodyRosters(),getRegistryRuntimeReadModel().rosterReaderDispositions);
          if(rosterAuthority.failures.length){failures.push(`${evidencePath}:${auditId}:${rosterAuthority.failures.join("; ")}`);continue;}
          const members=unique(rosterAuthority.childDispositions.flatMap((child)=>child.state==="READER_ELIGIBLE"&&child.canonicalId?[child.canonicalId]:[]));
          if(members.length&&members.every((id)=>observations.has(`official:${id}`))&&(!rosterGapForBody(string(raw.bodyId))||observations.has(`roster-gap:${raw.bodyId}`))) {key=`roster:${raw.bodyId}`;observations.set(key,[string(raw.bodyId)]);}
        }
        else if (row.datasetFamily === "meetings") key = source.unit === "meetings" ? `meeting:${raw.id}` : `document:${raw.id}`;
        else if (row.datasetFamily === "voting-sites") key = `jurisdiction:${raw.ocdId}`;
        else if (row.datasetFamily === "local-finance" || row.datasetFamily === "official-actions") key = `native:${raw.id}`;
        else if (["state-officeholders", "statewide-executives", "campaign-sites"].includes(row.datasetFamily) || row.datasetFamily === "registry" && source.unit === "officeholders") key = `official:${raw.id}`;
        else if (row.datasetFamily === "congress" && source.unit === "members") key = `official:congress:${raw.bioguide}`;
        else if (row.datasetFamily === "registry" && source.unit === "divisions" && raw.officeholderId) key = `membership:${raw.ocdId}#${raw.officeholderId}`;
        else if (row.datasetFamily === "measure-summaries") key = source.unit === "measure provisions" ? `provision:${raw.id}` : `measure-summary:${raw.contestId}`;
        else if (row.datasetFamily === "ballot-navigation") key = `navigation:${auditId.includes("election-dates") ? "dates" : "registration"}:${canonicalReaderAuthorityJson(raw)}`;
        else if (row.datasetFamily === "ballot") {
          if (row.readerSurface === "ask" && ["cards", "links"].includes(source.unit)) {
            const fields = source.unit === "cards" ? ["bio", "phone", "email", "filedAddress"].filter((field)=>raw[field]).map((field)=>({field,value:string(raw[field]),path:field === "bio" ? auditId : `${auditId}/${field}`})) : ["official","campaign"].filter((field)=>object(raw[field]).url).map((field)=>({field,value:string(object(raw[field]).url),path:`${auditId}/${field}`}));
            const identity = readerPersonKeys(source.identityKey!);
            const verifiedKeys = identity.status === "IDENTITY_UNRESOLVED" ? [] : identity.keys;
            const fieldObserved = ({ field, value, path }: { field: string; value: string; path: string }) => observations.has(`profile-field:${path}:${field}:${value}`) || verifiedKeys.some((alias) => {
              const pointer = alias.replaceAll("~", "~0").replaceAll("/", "~1");
              const aliasPath = `${source.unit === "cards" ? "data/ballot/candidate-cards-2026.json#/cards/" : "data/ballot/candidate-links-2026.json#/links/"}${pointer}${field === "bio" ? "" : `/${field}`}`;
              return observations.get(`profile-field:${aliasPath}:${field}:${value}`)?.every((id) => verifiedKeys.includes(id));
            });
            if (fields.length && fields.every(fieldObserved)) { key = `profile:${auditId}`; observations.set(key,[source.identityKey!]); }
          } else if (source.unit === "contacts") key = `candidate-contact:${raw.candidacyId}`;
          else if (Array.isArray(raw.nominees) && raw.contestId && raw.nominees.map(object).every((nominee) => observations.has(`card-key:${raw.contestId}|${nominee.name}`))) { key = `lineup:${raw.contestId}`; observations.set(key, [string(raw.contestId)]); }
          else key = source.unit === "absences" ? `absence:${raw.ocdId}` : source.unit === "analyses" ? `analysis:${source.identityKey ?? raw.contestId}` : `${({ contests: "contest", candidacies: "candidacy", measures: "measure", removals: "removal" } as Record<string, string>)[source.unit]}:${raw.id}`;
        }
        const ids = observations.get(key);
        if (ids?.length && ids.every((id) => row.canonicalIdentityByRecord[auditId]?.includes(id))) { measured.push(auditId); actualIdentities[auditId] = ids; }
      }
      if (measured.length) proofs.push({ rowId: row.id, exactHead: string(evidence.exactHead), source: isBallotBrowser ? "rendered-browser" : "executed-route", evidencePath, evidenceSha256: sha256(bytes), expectedRecordIds: measured, renderedRecordIds: measured, actualIdentities, statedCount: measured.length, returnedCount: measured.length, scope: "Only native IDs actually observed by the executed instrument and correlated to this holding record. Original payload counts, source comparisons and source hashes remain in the artifact; unmeasured sibling records stay obligations. An absent bundle descriptor never proves deployment.", deployedBundle: bundle });
    }
  }
  return { proofs, failures };
}

/** Observe the actual production artifact; static compilation is not NFT copying. */
export function readerBundleEvidence(root: string, census: ReaderCensus, buildReceiptPath: string, portraitProofPath?: string): { exactHead: string; buildId: string; buildReceiptPath: string; buildReceiptSha256: string; holdingsDigest: string; trace: ReturnType<typeof checkReaderTraces>; holdings: { path: string; sha256: string; mechanism: "NFT_FILESYSTEM" | "COMPILED_STATIC_IMPORT" | "PUBLIC_ASSET_HTTP"; evidence: unknown }[]; failures: string[] } {
  const receiptBytes = readReaderEvidence(root, buildReceiptPath);
  const receipt = JSON.parse(receiptBytes.toString("utf8")) as { exactHead: string; buildId: string; buildCompleted: boolean; sourceHashes?: unknown };
  if (!/^[a-f0-9]{40}$/.test(receipt.exactHead) || !receipt.buildCompleted || receipt.buildId !== readFileSync(join(root, ".next/BUILD_ID"), "utf8").trim()) throw new Error("A completed exact-head build receipt matching the current production BUILD_ID is required");
  const trace = checkReaderTraces(root);
  const { globSync } = fs as typeof fs & { globSync(pattern: string, options: { cwd: string }): string[] };
  const sourceHashes=evidenceSourceHashes(receipt.sourceHashes);
  const failures = [...trace.failures,...(!sourceHashes.length?["Completed build receipt lacks its reader source and holding fingerprint"]:readerSourceHashProblems(root,sourceHashes))];
  const traced = new Map<string, { tracePath: string; traceSha256: string }[]>();
  for (const tracePath of globSync(".next/server/app/**/*.js.nft.json", { cwd: root })) {
    const bytes = readFileSync(join(root, tracePath));
    const parsed = JSON.parse(bytes.toString("utf8")) as { files: string[] };
    for (const file of parsed.files) {
      const path = relative(root, resolve(root, dirname(tracePath), file)).replaceAll("\\", "/");
      if (path.startsWith("..")) continue;
      traced.set(path, [...(traced.get(path) ?? []), { tracePath: tracePath.replaceAll("\\", "/"), traceSha256: sha256(bytes) }]);
    }
  }
  const portraitBytes = portraitProofPath ? readReaderEvidence(root, portraitProofPath) : null;
  const portraits = portraitBytes ? JSON.parse(portraitBytes.toString("utf8")) as { exactHead: string; buildId: string; holdingsDigest: string; records: { holdingPath: string; actualSha256: string; status: number; result: string }[] } : null;
  if (portraits && (portraits.exactHead !== receipt.exactHead || portraits.buildId !== receipt.buildId)) throw new Error("Portrait HTTP proof belongs to another build");
  // The portrait byte instrument covers its exact path/hash inventory. An
  // unrelated civic holding changing the global digest does not invalidate
  // measured image bytes; every applicable current image is matched below.
  const applicable = new Set(census.rows.flatMap((row) => row.applicableEligibleRecordIds ?? row.eligibleRecordIds).map((id) => id.slice(0, id.indexOf("#"))));
  const holdings: { path: string; sha256: string; mechanism: "NFT_FILESYSTEM" | "COMPILED_STATIC_IMPORT" | "PUBLIC_ASSET_HTTP"; evidence: unknown }[] = [];
  // abaa4f48/NH232 moved curated registry identities from a runtime static import
  // (source-wiring.ts) into the committed first-seed lib/registry/registry.json,
  // which build-registry.ts refuses to overwrite ("first-seed evidence"). Such a
  // build-time registry seed is delivered THROUGH that first seed, so read it once
  // — but only when the deployed build actually traces it — to verify the bake.
  const registrySeedHolding = census.holdings.find((holding) => holding.path === REGISTRY_FIRST_SEED);
  const registryFirstSeedBuf = traced.has(REGISTRY_FIRST_SEED) && existsSync(join(root, REGISTRY_FIRST_SEED))
    ? readFileSync(join(root, REGISTRY_FIRST_SEED))
    : null;
  // Byte-bind the parsed seed to the DELIVERED artifact/version: it must be
  // traced into the deployed build (above) AND its bytes must equal the exact
  // sha the census recorded for this holding. Without that binding, a rescued
  // holding would be verified against an arbitrary local file rather than the
  // registry the reader actually serves.
  const registrySeedBound = registryFirstSeedBuf !== null
    && registrySeedHolding !== undefined
    && registrySeedHolding.sha256 === sha256(registryFirstSeedBuf);
  const applicableRecords = new Set(census.rows.flatMap((row) => row.applicableEligibleRecordIds ?? row.eligibleRecordIds));
  for (const holding of census.holdings.filter((holding) => applicable.has(holding.path))) {
    const files = traced.get(holding.path);
    if (files?.length) { holdings.push({ path: holding.path, sha256: holding.sha256, mechanism: "NFT_FILESYSTEM", evidence: files }); continue; }
    const portrait = portraits?.records.find((record) => record.holdingPath === holding.path && record.actualSha256 === holding.sha256 && record.status === 200 && record.result === "PROVEN");
    if (portrait) { holdings.push({ path: holding.path, sha256: holding.sha256, mechanism: "PUBLIC_ASSET_HTTP", evidence: { evidencePath: portraitProofPath, evidenceSha256: sha256(portraitBytes!), record: portrait } }); continue; }
    const sourcePath = READER_SURFACES.map((surface) => importReachability(root, surface.path, holding.path)).find((path) => path.reached);
    if (sourcePath?.reached && /\.(ts|tsx|json)$/.test(holding.path)) {
      holdings.push({ path: holding.path, sha256: holding.sha256, mechanism: "COMPILED_STATIC_IMPORT", evidence: { sourcePath: sourcePath.path, sourceHashes: sourcePath.path.filter((path) => existsSync(join(root, path))).map((path) => ({ path, sha256: sha256(readFileSync(join(root, path))) })), qualification: "This statically imported data is compiled into the matching build, rather than copied as a runtime filesystem holding. Actual record execution is separately required by the delivery proof." } });
    } else if (registrySeedBound && holding.path === CURATED_BODY_SEED && holding.family === "curated-body-identities") {
      const dataset = readerDatasets(loadManifestContext(root)).find((candidate) => candidate.path === holding.path);
      const records = dataset ? readerRecordsForDataset(root, dataset).map((raw) => ({ auditId: `${holding.path}#${raw.pointer}`, value: raw.value })).filter((record) => applicableRecords.has(record.auditId)) : [];
      const problems = curatedRegistrySeedProblems({ holdingPath: holding.path, family: holding.family, artifactPath: REGISTRY_FIRST_SEED, artifactBytes: registryFirstSeedBuf!, artifactSha256: registrySeedHolding!.sha256, artifactTraced: true, records });
      if (sha256(readFileSync(join(root, holding.path))) !== holding.sha256) problems.push("Curated source differs from its census holding");
      const expectedIds = census.records.filter((record) => record.holdingPath === holding.path && applicableRecords.has(record.auditId)).map((record) => record.auditId).sort();
      if (JSON.stringify(records.map((record) => record.auditId).sort()) !== JSON.stringify(expectedIds)) problems.push("Curated source records do not match the applicable census denominator");
      if (problems.length === 0) {
        holdings.push({ path: holding.path, sha256: holding.sha256, mechanism: "COMPILED_STATIC_IMPORT", evidence: { bakedInto: REGISTRY_FIRST_SEED, bakedIntoSha256: registrySeedHolding!.sha256, recordsVerified: records.map(({ auditId, value }) => ({ auditId, id: value.id })), qualification: "Each applicable curated body matches exactly one body in the traced, byte-bound registry first seed, with every held field and provenance value equal. Actual record execution remains a separate delivery obligation." } });
      } else failures.push(...problems.map((problem) => `${holding.path}: ${problem}`));
    } else failures.push(`${holding.path}: no actual NFT copy, static reader import, or same-build verified public asset response`);
  }
  return { exactHead: receipt.exactHead, buildId: receipt.buildId, buildReceiptPath, buildReceiptSha256: sha256(receiptBytes), holdingsDigest: census.holdingsDigest, trace, holdings, failures };
}

/** Which actual leaf must render this record's own fields, not a sibling's. */
export function componentRequirements(record: CensusRecord): string[] {
  const identity = "components/officials/person-identity.tsx";
  const contacts = "components/officials/contact-pills.tsx";
  if (["state-officeholders", "statewide-executives", "body-rosters"].includes(record.family) || record.family === "congress" && record.unit === "members" || record.family === "registry" && record.unit === "officeholders") return [identity, contacts,...(record.additionalComponents??[])];
  if (record.family === "campaign-sites") return [contacts];
  if (record.family === "portraits") return [identity];
  if (record.family === "congress" && record.unit === "byMember") return ["components/officials/member-directory.tsx"];
  if (record.family === "votes" && /key-vote(?:s-snapshot|-positions)\.json$/.test(record.holdingPath)) return ["components/officials/key-votes-section.tsx"];
  if (record.family === "votes" && record.holdingPath.endsWith("bill-summaries.json")) return ["components/map/popup/official-popup.tsx"];
  if (record.family === "votes" && ["votes", "positions", "rollCalls"].includes(record.unit)) return ["components/map/popup/official-popup.tsx"];
  if (record.family === "federal-finance") return ["components/funding/funding-section.tsx"];
  if (record.family === "voting-sites") return ["components/map/voting-sites-panel.tsx"];
  if (record.family === "ballot-navigation" && record.holdingPath.includes("polling-place")) return ["components/ballot/polling-lookup-fallback.tsx"];
  if (["curated-body-identities", "body-compositions", "sourced-definitions"].includes(record.family) || record.family === "registry" && record.unit === "bodies") return ["components/map/popup/entity-modal.tsx"];
  if (record.family === "registry" && record.unit === "divisions") return ["components/map/popup/district-popup.tsx"];
  if (record.family === "state-money") return ["components/funding/state-money-section.tsx"];
  if (record.family === "outcomes") return ["components/map/popup/meeting-records.tsx"];
  if (record.family === "notice-summaries" || record.family === "meetings" && record.unit === "agendaDocuments") return ["components/map/popup/agenda-section.tsx"];
  if (record.family === "meetings" && record.unit === "meetings") return ["components/map/popup/meeting-popup.tsx"];
  if (record.family === "area-facts") return ["components/area/shuffled-facts.tsx"];
  if (record.family === "comment-access") return ["components/map/meeting-panel.tsx"];
  if (record.family === "minutes-summaries") return ["components/map/popup/meeting-popup.tsx"];
  if (record.family === "official-actions" && record.unit === "actions") return ["components/officials/official-actions.tsx"];
  if (record.family === "prl") return ["components/officials/public-statements-profile.tsx"];
  if (record.family === "ballot" && ["cards", "links"].includes(record.unit)) return ["components/ballot/candidate-card.tsx", "components/ballot/candidate-contact.tsx"];
  if (record.family === "ballot" && record.unit === "contacts") return ["components/ballot/candidate-contact.tsx"];
  return [];
}

/**
 * Compose exhaustive real leaf output with an executed in-situ surface witness.
 * Missing API/Ask/card proofs stay explicit; neither imports nor screenshots
 * alone can synthesize observed IDs for an unexercised record.
 */
export function composeReaderComponentProofs(root: string, census: ReaderCensus, componentEvidencePath: string, witnesses: readonly ReaderSurfaceClassWitness[], bundle: NonNullable<ReaderDeliveryProof["deployedBundle"]>): { proofs: ReaderDeliveryProof[]; uncovered: { rowId: string; auditId: string; reason: string }[]; failures: string[] } {
  const evidenceBytes = readReaderEvidence(root, componentEvidencePath);
  const evidence = JSON.parse(readReaderEvidence(root, componentEvidencePath).toString("utf8")) as { holdingsDigest: string; exactHead?: string; sourceHashes?: { path: string; sha256: string }[]; cases: ReaderComponentCase[]; failures: string[] };
  if (evidence.holdingsDigest !== census.holdingsDigest) throw new Error("Component evidence belongs to different holdings");
  if (evidence.exactHead && evidence.exactHead !== bundle.exactHead) throw new Error("Component evidence belongs to another proved head");
  for (const source of evidence.sourceHashes ?? []) if (!existsSync(join(root, source.path)) || sha256(readFileSync(join(root, source.path))) !== source.sha256) throw new Error(`Component selector dependency changed after render: ${source.path}`);
  const failures = [...evidence.failures];
  const cases = new Map<string, ReaderComponentCase[]>();
  const componentHashes = new Map<string, string>();
  for (const entry of evidence.cases) {
    if (!componentHashes.has(entry.component)) componentHashes.set(entry.component, sha256(readFileSync(join(root, entry.component))));
    const problems = [
      ...(sha256(entry.markup) !== entry.markupSha256 ? ["HTML hash mismatch"] : []),
      ...(componentHashes.get(entry.component) !== entry.componentSha256 ? ["Component source changed after render"] : []),
      ...inspectReaderMarkup(entry.markup, entry.expectedFragments, entry.forbiddenFragments, entry.rowCounts),
      ...entry.failures,
    ];
    failures.push(...problems.map((problem) => `${entry.auditId}: ${problem}`));
    if (!problems.length) cases.set(entry.auditId, [...(cases.get(entry.auditId) ?? []), entry]);
  }
  const records = new Map(census.records.map((record) => [record.auditId, record]));
  const proofs: ReaderDeliveryProof[] = [];
  const uncovered: { rowId: string; auditId: string; reason: string }[] = [];
  const witnessCache = new Map<string, ReaderSurfaceClassWitness | undefined>();
  for (const row of census.rows) {
    const measured: string[] = [];
    const actualIdentities: Record<string, readonly string[]> = {};
    const usedWitnesses = new Map<string, ReaderSurfaceClassWitness>();
    for (const id of row.applicableEligibleRecordIds ?? row.eligibleRecordIds) {
      const record = records.get(id)!;
      const required = componentRequirements(record);
      const actualCases = cases.get(id) ?? [];
      if (!required.length) { uncovered.push({ rowId: row.id, auditId: id, reason: "Needs an executed API/Ask or another actual reader leaf proof for this record class." }); continue; }
      const surfacePath = READER_SURFACES.find((surface) => surface.id === row.readerSurface)!.path;
      const applicableWitnesses = required.map((component) => {
        const key = `${row.readerSurface}#${component}`;
        if (!witnessCache.has(key)) witnessCache.set(key, witnesses.find((witness) => witness.surface === row.readerSurface && witness.component === component && witness.exactHead === bundle.exactHead && readerEvidenceHashMatches(root,witness.evidencePath,witness.evidenceSha256) && importReachability(root, surfacePath, component).reached));
        return witnessCache.get(key);
      });
      if (applicableWitnesses.some((witness) => !witness)) { uncovered.push({ rowId: row.id, auditId: id, reason: "Actual component output lacks a matching same-head in-situ witness on this declared surface." }); continue; }
      if (required.some((component) => !actualCases.some((entry) => entry.component === component))) { uncovered.push({ rowId: row.id, auditId: id, reason: "An applicable product leaf has not rendered this canonical payload." }); continue; }
      const identities = unique(actualCases.filter((entry) => required.includes(entry.component)).flatMap((entry) => entry.actualCanonicalIdentities));
      if (!identities.length || identities.some((identity) => !record.canonicalIdentity.includes(identity))) { uncovered.push({ rowId: row.id, auditId: id, reason: "Rendered membership/child identities need an explicit canonical parent-record correlation; they cannot be guessed from a shared geography." }); continue; }
      measured.push(id); actualIdentities[id] = identities;
      applicableWitnesses.forEach((witness) => usedWitnesses.set(witness!.component, witness!));
    }
    if (!measured.length) continue;
    proofs.push({ rowId: row.id, exactHead: bundle.exactHead, source: "rendered-component", evidencePath: componentEvidencePath, evidenceSha256: sha256(evidenceBytes), expectedRecordIds: measured, renderedRecordIds: measured, actualIdentities, statedCount: measured.length, returnedCount: measured.length,
      scope: "Measured canonical audit records only. Every required actual leaf rendered the selected fields and row counts; an executed in-situ witness and current import graph bind that leaf to this surface. Unmeasured records remain separate obligations.",
      surfaceWitnesses: [...usedWitnesses.values()], deployedBundle: bundle });
  }
  return { proofs, uncovered, failures };
}

const htmlText = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");

/** Testable instrument: a missing rendered fact or a false shown count fails. */
export function inspectReaderMarkup(markup: string, expected: readonly string[], forbidden: readonly string[], rowCounts: ReaderComponentCase["rowCounts"]): string[] {
  const failures = expected.filter((text) => !markup.includes(htmlText(text))).map((text) => `Missing rendered canonical fragment: ${text}`);
  failures.push(...forbidden.filter((text) => markup.includes(htmlText(text))).map((text) => `Withheld fragment rendered: ${text}`));
  failures.push(...Object.entries(rowCounts).filter(([, counts]) => counts.expected !== counts.actual).map(([name, counts]) => `${name}: stated ${counts.expected}, rendered ${counts.actual}`));
  return failures;
}

/**
 * Execute the real pure reader leaves over EVERY applicable held payload.
 * This requires the repository's tsx runner because the product leaves are JSX.
 * Its evidence is component rendering, never a claim about a deployed route.
 */
export async function registerReaderRenderHooks(root: string): Promise<void> {
  // Native Node 24 strips TS but not JSX. Compile the actual TSX leaf in-memory
  // with the repository's TypeScript compiler; no alternate component is made.
  const moduleApi = await import("node:module") as unknown as { registerHooks: (hooks: { resolve: (specifier: string, context: { parentURL?: string }, next: (specifier: string, context: unknown) => unknown) => unknown; load: (url: string, context: unknown, next: (url: string, context: unknown) => unknown) => unknown }) => { deregister: () => void } };
  moduleApi.registerHooks({
    resolve(specifier, context, next) {
      const base = specifier.startsWith("@/") ? join(root, specifier.slice(2)) : specifier.startsWith(".") && context.parentURL?.startsWith("file:") ? fileURLToPath(new URL(specifier, context.parentURL)) : null;
      if (base && !base.replaceAll("\\", "/").includes("/node_modules/")) for (const suffix of [".ts", ".tsx"]) if (existsSync(`${base}${suffix}`)) return next(pathToFileURL(`${base}${suffix}`).href, context);
      return next(specifier, context);
    },
    load(url, context, next) {
      // A CSS module loads as its class names, exactly as the V94 source proof
      // (scripts/lib/reader-v94-source-proof.ts) and the test alias loader load
      // it: content-only SSR observes no paint, and a popup or legend that the
      // tester session gave a CSS module still renders its held facts here.
      if (url.endsWith(".module.css")) {
        const css = readFileSync(fileURLToPath(url), "utf8");
        const names = [...new Set([...css.matchAll(/\.([a-zA-Z_][\w-]*)/g)].map((match) => match[1]))];
        return { format: "module", shortCircuit: true, source: `export default ${JSON.stringify(Object.fromEntries(names.map((name) => [name, name])))};` };
      }
      if (!url.endsWith(".tsx")) return next(url, context);
      const source = ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), { fileName: fileURLToPath(url), compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
      return { format: "module", source, shortCircuit: true };
    },
  });
}

export async function renderCanonicalReaderComponents(root: string, census: ReaderCensus): Promise<{ formatVersion: 1; exactHead: string; holdingsDigest: string; sourceHashes: ReaderSourceHash[]; rule: string; cases: ReaderComponentCase[]; failures: string[]; servingWindowRemovals: { auditId: string; meetingId: string; startsAt: string; lowerBound: string; contract: string }[] }> {
  await registerReaderRenderHooks(root);
  const [{ createElement, Fragment }, { renderToStaticMarkup }, { StateMoneySection }, { CandidateContact }, { MeetingRecords }, { ShuffledFacts }, finance, contacts, outcomes, meetingReader, area, { PublicStatementsProfileContent }, prl, { PersonIdentity, IdentityPortrait }, { ContactPills }, registry, rosters, { CandidateCard }, cards, sites, ballot, { MeetingPopup }, { DistrictPopup }, { EntityModal }, { DataProvider }, snapshotSource, meetingFormat, meetingLinks, memberships, minutes, { HowToBeHeard }, commentAccess, stateLabels] = await Promise.all([
    import("react"), import("react-dom/server"), import("../../components/funding/state-money-section.tsx"),
    import("../../components/ballot/candidate-contact.tsx"), import("../../components/map/popup/meeting-records.tsx"), import("../../components/area/shuffled-facts.tsx"),
    import("../funding/state-snapshot.ts"), import("../ballot/candidate-contacts.ts"), import("../outcomes/store.ts"), import("../meetings/reader-records.ts"), import("../area/facts.ts"), import("../../components/officials/public-statements-profile.tsx"), import("../sources/prl/snapshot.ts"), import("../../components/officials/person-identity.tsx"), import("../../components/officials/contact-pills.tsx"), import("../registry/server.ts"), import("../registry/body-rosters.ts"), import("../../components/ballot/candidate-card.tsx"), import("../ballot/candidate-cards.ts"), import("../ballot/candidate-sites.ts"), import("../ballot/registry.ts"), import("../../components/map/popup/meeting-popup.tsx"), import("../../components/map/popup/district-popup.tsx"), import("../../components/map/popup/entity-modal.tsx"), import("../state/data.tsx"), import("../sources/snapshot/index.ts"), import("../map/format.ts"), import("../registry/links.ts"), import("../registry/body-membership.ts"), import("../meetings/minutes-summaries.ts"), import("../../components/map/meeting-panel.tsx"), import("../registry/comment-access.ts"), import("../state/derive.ts"),
  ]);
  const ballotSets = await Promise.all(ballot.BALLOT_SOURCES.map(async ({ source }) => source.normalize(await source.fetch())));
  const candidateNames = new Map(ballotSets.flatMap((set) => [...set.candidacies, ...(set.removals ?? [])]).map((candidate) => [candidate.id, `${candidate.givenName} ${candidate.familyName}`]));
  const cardName = (key: string) => key.includes("|") ? key.slice(key.indexOf("|") + 1) : candidateNames.get(key);
  const cardFor = (key: string) => key.includes("|") ? cards.cardForNominee(key.slice(0, key.indexOf("|")), key.slice(key.indexOf("|") + 1)) : cards.cardForCandidacy(key);
  const linksFor = (key: string) => key.includes("|") ? sites.linksForNominee(key.slice(0, key.indexOf("|")), key.slice(key.indexOf("|") + 1)) : sites.linksForCandidacy(key);
  const source = snapshotSource.makeSnapshotSource();
  // The production snapshot source explicitly ignores this query and returns
  // all held rows; geographic and date applicability belong to the route proof.
  const normalizedMeetings = new Map(source.normalize(await source.fetch({ lat: 0, lng: 0, radiusKm: 0 }), new Date()).map((meeting) => [meeting.id, meeting]));
  const [{ meetingListingIdentity, listingMultiplicityForSource }, { canonicalBodyIdentity }] = await Promise.all([import("../meetings/listing-identity.ts"), import("../ask/body-identity.ts")]);
  const listingIdentity = meetingListingIdentity([...normalizedMeetings.values()], canonicalBodyIdentity);
  const context = loadManifestContext(root);
  const sourceRows = new Map(readerDatasets(context).flatMap((dataset) => readerRecordsForDataset(root, dataset).map((raw) => [`${dataset.path}#${raw.pointer}` as string, raw] as const)));
  const applicableReaderRecords = new Set(
    census.rows.flatMap((row) => row.applicableEligibleRecordIds ?? row.eligibleRecordIds),
  );
  // A held meeting the live projection no longer carries fails this render, with one
  // exception: its adapter stopped listing it after prepare because it had passed the
  // serving window's lower bound (MEETING_READER_SERVING_WINDOW_V1). That is the runner
  // working correctly, which RULING 290 says must never be the proof's failure mode. Only
  // then does the leaf render use the census's own held record, and each such render is
  // reported. A meeting inside the window, or one whose agenda documents are still
  // applicable (their path reads the live route), still fails.
  const { CONCLUDED_LOOKBACK_DAYS, MEETING_READER_SERVING_WINDOW_CONTRACT } = await import("../meetings/constants.ts");
  const heldMeetingsById = new Map([...sourceRows.entries()]
    .filter(([auditId, raw]) => auditId.startsWith("data/meetings-snapshot.json#/meetings/") && typeof raw.value?.id === "string")
    .map(([, raw]) => [string(raw.value.id), raw.value] as const));
  const applicableAgendaMeetingIds = new Set(census.records
    .filter((record) => record.family === "meetings" && record.unit === "agendaDocuments" && applicableReaderRecords.has(record.auditId))
    .map((record) => string(sourceRows.get(record.auditId)?.value?.meetingId)));
  const servingWindowRemovals: { auditId: string; meetingId: string; startsAt: string; lowerBound: string; contract: string }[] = [];
  const servingWindowRemoved = (auditId: string, meetingId: string) => {
    const held = heldMeetingsById.get(meetingId);
    if (!held || applicableAgendaMeetingIds.has(meetingId)) return undefined;
    const lowerBound = Date.now() - CONCLUDED_LOOKBACK_DAYS * 86_400_000;
    if (!(Date.parse(string(held.startsAt)) < lowerBound)) return undefined;
    const [normalized] = source.normalize([held as unknown as Parameters<typeof source.normalize>[0][number]], new Date());
    servingWindowRemovals.push({ auditId, meetingId, startsAt: string(held.startsAt), lowerBound: new Date(lowerBound).toISOString(), contract: MEETING_READER_SERVING_WINDOW_CONTRACT });
    return normalized;
  };
  const registryDivisionsById = new Map<string, ObjectRow>();
  for (const record of census.records) {
    if (record.holdingPath !== "lib/registry/registry.json" || record.unit !== "divisions") continue;
    const division = sourceRows.get(record.auditId)?.value ?? {};
    const ocdId = string(division.ocdId);
    if (ocdId) registryDivisionsById.set(ocdId, division);
  }
  const emptyShellData = { allMeetings: [], meetings: [], venues: [], result: null, location: null, drawnDistricts: [], dropped: 0, searchFailed: false, atAddress: false, governing: null, zipPartial: null, basis: "ZIP" as const };
  const cases: ReaderComponentCase[] = [];
  const add = (record: CensusRecord, component: string, selector: string, payload: unknown, actualIds: string[], markup: string, expected: string[], forbidden: string[] = [], rowCounts: ReaderComponentCase["rowCounts"] = {}, sourceDispositions?: ReaderComponentCase["sourceDispositions"]) => {
    cases.push({ auditId: record.auditId, component, componentSha256: sha256(readFileSync(join(root, component))), selector,
      actualCanonicalIdentities: unique(actualIds), payloadSha256: sha256(JSON.stringify(payload)), markup, markupSha256: sha256(markup),
      expectedFragments: expected, forbiddenFragments: forbidden, rowCounts, failures: inspectReaderMarkup(markup, expected, forbidden, rowCounts), sourceDispositions });
  };
  const occurrences = (markup: string, attribute: string) => [...markup.matchAll(new RegExp(` ${attribute}(?:=|[ >])`, "g"))].length;
  const [{ OfficialActionsContent }, officialActions, dateFormat] = await Promise.all([import("../../components/officials/official-actions.tsx"), import("../officials/reader-actions.ts"), import("../text/format-date.ts")]);
  const [{ DirectoryRecordsContent }, directoryRoute, { KeyVoteGroupBlock }, keyReader, keyPositions, { BillPlainSummary }, billSummaries, { PollingLookupFallback }, polling] = await Promise.all([
    import("../../components/officials/member-directory.tsx"), import("../../app/api/directory/route.ts"), import("../../components/officials/key-votes-section.tsx"), import("../votes/key-votes-reader.ts"), import("../votes/key-vote-positions.ts"), import("../../components/map/popup/official-popup.tsx"), import("../votes/bill-summaries.ts"), import("../../components/ballot/polling-lookup-fallback.tsx"), import("../ballot/polling-place-links.ts"),
  ]);
  const memberIds = unique(census.records.filter((record) => record.family === "congress" && record.unit === "byMember").flatMap((record) => record.canonicalIdentity.filter((id) => /^congress:[A-Z]\d{6}$/.test(id))));
  const { buildCommitteeTree } = await import("../officials/committee-tree.ts");
  const [{ AgendaDocuments }, agendaRoute, noticeSummary] = await Promise.all([import("../../components/map/popup/agenda-section.tsx"), import("../../app/api/agenda/route.ts"), import("../meetings/notice-summary.ts")]);
  const [{ RecentVoteRecords }, voteRoute, { FundingDisplay, FundingAbsence }, federalDisplay] = await Promise.all([import("../../components/map/popup/official-popup.tsx"), import("../../app/api/votes/route.ts"), import("../../components/funding/funding-section.tsx"), import("../funding/display.ts")]);
  type ActualVote = import("../../components/map/popup/official-popup.tsx").MemberRollCall;
  type ActualAttribution = import("../../components/map/popup/official-popup.tsx").VoteAttribution;
  const actualVoteMembers = unique(census.records.filter((record) => record.family === "votes" && record.eligibility.state === "READER_ELIGIBLE").map((record) => string(sourceRows.get(record.auditId)?.value.officeholderId)).filter(Boolean));
  const voteByMember = new Map<string, { member: string; vote: ActualVote; attribution: ActualAttribution | null }>();
  const voteById = new Map<string, { member: string; vote: ActualVote; attribution: ActualAttribution | null }>();
  for (const member of actualVoteMembers) {
    const response = await voteRoute.GET(new Request(`http://localhost/api/votes?member=${encodeURIComponent(member)}`));
    if (response.status !== 200) throw new Error(`Actual vote route failed ${member}`);
    const payload = await response.json() as { votes: ActualVote[]; attribution?: ActualAttribution; count: number };
    if (payload.count !== payload.votes.length) throw new Error(`Actual vote route false count ${member}`);
    for (const vote of payload.votes) { const selected = { member, vote, attribution: payload.attribution ?? null }; voteByMember.set(`${member}#${vote.id}`, selected); if (!voteById.has(vote.id)) voteById.set(vote.id, selected); }
  }
  const agendaResponses = new Map<string, { documents: (Parameters<typeof AgendaDocuments>[0]["documents"][number] & { id: string })[]; documentCount: number; publication: Parameters<typeof AgendaDocuments>[0]["publication"] }>();
  const [{ proveVotingSites }, { VotingJurisdictionRecords }, votingSiteDisplay] = await Promise.all([import("../../scripts/reader-last-mile-voting-sites.mts"), import("../../components/map/voting-sites-panel.tsx"), import("../ballot/voting-sites.ts")]);
  const votingAnswers = (await proveVotingSites()).results;
  const agendaFor = async (meetingId: string) => {
    if (!agendaResponses.has(meetingId)) {
      const response = await agendaRoute.GET(new Request(`http://localhost/api/agenda?meetingId=${encodeURIComponent(meetingId)}`));
      if (response.status !== 200) throw new Error(`Actual agenda route failed ${meetingId}`);
      agendaResponses.set(meetingId, await response.json());
    }
    return agendaResponses.get(meetingId)!;
  };
  const memberKeyRows = await Promise.all(memberIds.map((id) => keyReader.keyVotesForMember(id)));
  const keyRowsByNativeRef = new Map<string, { member: string; chamber: "house" | "senate"; row: typeof memberKeyRows[number]["rows"][number]; index: number }[]>();
  for (const answer of memberKeyRows) if (answer.chamber) for (const row of answer.rows) row.refs.forEach((ref, index) => {
    const key = keyPositions.keyVotePositionKey(row.entry.id, answer.chamber!, ref.congress, ref.session, ref.rollNumber);
    keyRowsByNativeRef.set(key, [...(keyRowsByNativeRef.get(key) ?? []), { member: answer.member, chamber: answer.chamber!, row, index }]);
  });
  for (const record of census.records) {
    const raw = sourceRows.get(record.auditId)?.value ?? {};
    if (record.holdingPath === "lib/registry/registry.json" && record.unit === "divisions") {
      const divisionType = string(raw.divisionType);
      const districtType = ({ cd: "congressional", sldu: "state-senate", sldl: "state-house", county: "county", place: "municipal", school_district: "school-unified" } as const)[divisionType as "cd" | "sldu" | "sldl" | "county" | "place" | "school_district"];
      if (!districtType) throw new Error(`Registry division has no map district type ${record.auditId}`);
      const tier = string(raw.tier) as "national" | "state" | "local";
      if (!["national", "state", "local"].includes(tier)) throw new Error(`Registry division has no reader tier ${record.auditId}`);
      // A Census placeholder name reaches the Reader translated, as every registry promotion carries it.
      const district = { type: districtType, tier, typeLabel: stateLabels.divisionTypeLabel(divisionType), ocdId: string(raw.ocdId), label: CENSUS_PLACEHOLDER_LABELS[string(raw.label)] ?? string(raw.label), state: string(raw.state) };
      const markup = renderToStaticMarkup(createElement(DistrictPopup, { district, representation: [], representationNoteState: "gap", upcomingMeetings: 0 }));
      add(record, "components/map/popup/district-popup.tsx", "canonical registry division → DistrictPopup", district, [district.ocdId], markup,
        [district.label, district.typeLabel], [], { divisions: { expected: 1, actual: occurrences(markup, "data-browsing-standing") } });
    } else if (["lib/registry/registry.json", "lib/registry/promoted-bodies.json"].includes(record.holdingPath) && record.unit === "bodies" && record.eligibility.state === "READER_ELIGIBLE") {
      const bodyId = string(raw.id);
      const ocdId = string(raw.ocdId);
      const division = registryDivisionsById.get(ocdId) ?? {};
      const title = string(raw.name) || string(division.label) || bodyId;
      const homepageUrl = string(raw.homepageUrl);
      const divisionType = string(division.divisionType);
      const tierValue = string(division.tier);
      const tier = (["national", "state", "local"].includes(tierValue) ? tierValue : "local") as "national" | "state" | "local";
      const subject = {
        title,
        subtitle: divisionType ? stateLabels.divisionTypeLabel(divisionType) : "Governing body",
        tier,
        subjectId: bodyId,
        subjectKind: "BODY" as const,
        divisionKind: divisionType || null,
        divisionOcdId: null,
        facts: [
          { label: "Type", value: string(raw.bodyClass) || "Governing body" },
          ...(homepageUrl ? [{ label: "Official site", value: homepageUrl }] : []),
        ],
        representation: [],
        representationNote: "We haven't sourced who sits on this body.",
        meetings: [],
        sources: [],
        bodyCard: {
          whatItDoes: { classDefinition: null, formDefinition: null, unreadNote: null },
          superintendent: null,
          isSchoolDistrict: divisionType === "school_district",
          contact: homepageUrl ? [{ label: "Official site", value: new URL(homepageUrl).hostname.replace(/^www\./, ""), href: homepageUrl }] : [],
          jurisdiction: string(division.label) ? [{ label: "Area", value: string(division.label) }] : [],
        },
      };
      const markup = renderToStaticMarkup(createElement(DataProvider, { value: emptyShellData, children: createElement(EntityModal, { subject, onClose: () => {} }) }));
      add(record, "components/map/popup/entity-modal.tsx", "canonical registry body and exact division join → EntityModal", { body: raw, division }, [bodyId, ...(ocdId ? [ocdId] : [])], markup,
        [title, homepageUrl].filter(Boolean), [], { bodies: { expected: 1, actual: occurrences(markup, "role") } });
    } else if (record.family === "voting-sites") {
      const executed = votingAnswers.find((entry) => entry.jurisdictionId === raw.ocdId);
      if (!executed) throw new Error(`Actual voting-site route lost ${record.auditId}`);
      const jurisdiction = executed.answer.jurisdictions.find((row) => row.ocdId === raw.ocdId)!;
      const answer = { ...executed.answer, jurisdictions: [jurisdiction] };
      const markup = renderToStaticMarkup(createElement(VotingJurisdictionRecords, { answer, selectedSiteId: null, onSelectSite: () => {} }));
      add(record, "components/map/voting-sites-panel.tsx", "real POST /api/voting-sites with held-geometry geocoder fixture → VotingJurisdictionRecords", answer, [jurisdiction.ocdId], markup,
        [jurisdiction.name, jurisdiction.modelSentence, jurisdiction.narrowing.sentence, jurisdiction.election, jurisdiction.sourceOrg, jurisdiction.sourceUrl, jurisdiction.collectedAt, jurisdiction.refusalLine, jurisdiction.refusal?.wall, ...(jurisdiction.refusal?.rungs ?? []).flatMap((rung) => [rung.what, rung.result, rung.attemptedAt]), ...jurisdiction.sites.flatMap((site) => [site.name, site.address, site.room, site.serves, votingSiteDisplay.directionsUrl(site)])].filter((value): value is string => Boolean(value)), [],
        { jurisdictions: { expected: 1, actual: occurrences(markup, "data-voting-jurisdiction") }, sites: { expected: jurisdiction.sites.length, actual: occurrences(markup, "data-voting-site") } });
    } else if ((record.family === "meetings" && record.unit === "agendaDocuments" || record.family === "notice-summaries") && record.eligibility.state === "READER_ELIGIBLE") {
      if (record.family === "meetings" && !applicableReaderRecords.has(record.auditId)) continue;
      const meetingId = string(raw.meetingId);
      const answer = await agendaFor(meetingId);
      const latest = answer.documents[0];
      if (!latest) throw new Error(`Actual agenda route lost document ${record.auditId}`);
      if (record.family === "meetings" && latest.id !== raw.id) continue;
      const summary = noticeSummary.noticeSummaryFor(meetingId, latest.contentHash);
      if (record.family === "notice-summaries" && !summary) {
        const curatedHash = string(raw.sourceHash ?? raw.contentHash);
        const curatedSummary = noticeSummary.noticeSummaryFor(meetingId, curatedHash);
        if (!curatedSummary) throw new Error(`Exact notice summary lost ${record.auditId}`);
        // The live document hash advanced past the curated summary version.
        // In production the summary silently disappears — prove that graceful absence.
      }
      const markup = renderToStaticMarkup(createElement(AgendaDocuments, { documents: answer.documents, meetingId, agendaUrl: latest.documentUrl, agendaSentence: "The source record is held.", publication: answer.publication }));
      const text = latest.text?.replace(/&#x([0-9a-f]+);/gi, (_,hex) => String.fromCodePoint(parseInt(hex,16))).replace(/&#(\d+);/g, (_,dec) => String.fromCodePoint(Number(dec))).replace(/&times;/gi,"×").replace(/&amp;/g,"&");
      const portal = answer.publication?.acquisition === "ACQUIRED_IS_PUBLICATION_INDEX";
      add(record, "components/map/popup/agenda-section.tsx", "actual GET /api/agenda newest-first → AgendaDocuments / exact-hash noticeSummaryFor", answer, record.family === "notice-summaries" ? [meetingId] : [latest.id, meetingId], markup,
        (portal ? [answer.publication?.gap?.statement, latest.documentUrl, latest.sourceOrg] : [text, latest.documentUrl, latest.sourceOrg, summary?.summary]).filter((value): value is string => Boolean(value)), portal ? [text, "On the docket"].filter((value): value is string => Boolean(value)) : [], { versions: { expected: answer.documents.length, actual: answer.documentCount } }, portal ? [{ id: latest.id, status: "ACQUIRED_IS_PUBLICATION_INDEX", reason: "This acquired publisher index or application shell is not a single meeting's agenda. The canonical acquisition gap and source portal link are the reader answer; index text, script text and docket claims remain withheld." }] : undefined);
    } else if (record.family === "federal-finance" && record.unit !== "secondHop" && record.eligibility.state === "READER_ELIGIBLE") {
      const target = record.unit === "absences" ? string(raw.targetKey) : (raw.targetKeys as string[])[0];
      const selected = federalDisplay.fundingAnswerForTarget(target);
      if (selected.kind === "none") throw new Error(`Eligible FEC record unavailable ${record.auditId}`);
      const markup = renderToStaticMarkup(selected.kind === "funding" ? createElement(FundingDisplay, { data: selected.data, context: null, bare: true }) : createElement(FundingAbsence, { data: selected.data }));
      add(record, "components/funding/funding-section.tsx", "fundingAnswerForTarget → FundingDisplay / FundingAbsence", selected, [record.unit === "absences" ? target : string(raw.fecCandidateId)], markup,
        selected.kind === "funding" ? [...selected.data.sentences, ...selected.data.concentrationSentences, ...selected.data.typeConcentrationSentences, selected.data.sourceUrl, selected.data.sourceOrg].filter((value): value is string => Boolean(value)) : [selected.data.statement, selected.data.searchUrl].filter((value): value is string => Boolean(value)), [],
        { federalAnswers: { expected: 1, actual: selected.kind === "funding" ? occurrences(markup, "data-funding-section") : Number(markup.length > 0) } });
    } else if (record.family === "congress" && record.unit === "byMember") {
      const holderId = record.canonicalIdentity.find((id) => /^congress:[A-Z]\d{6}$/.test(id));
      if (!holderId) throw new Error(`Directory lacks canonical BioGUIDE identity: ${record.auditId}`);
      const response = await directoryRoute.GET(new Request(`http://localhost/api/directory?member=${encodeURIComponent(holderId)}`));
      if (response.status !== 200) throw new Error(`Directory actual route failed ${holderId}`);
      const directory = await response.json() as import("../../hooks/use-member-directory.ts").MemberDirectory;
      const committeeRows = buildCommitteeTree(directory.committees).flatMap((node) => [node, ...node.children]);
      const markup = renderToStaticMarkup(createElement(Fragment, null, createElement(DirectoryRecordsContent, { holderId, only: "committees", directory, failed: false }), createElement(DirectoryRecordsContent, { holderId, only: "offices", directory, failed: false })));
      add(record, "components/officials/member-directory.tsx", "actual GET /api/directory → DirectoryRecordsContent", directory, [holderId], markup,
        [...committeeRows.flatMap((node) => [node.label, node.seat.title, node.seat.jurisdiction, node.seat.jurisdictionSource]), ...directory.districtOffices.flatMap((office) => [office.address, office.city, office.phone])].filter((value): value is string => Boolean(value)), [],
        { committees: { expected: directory.committees.length, actual: occurrences(markup, "data-committee-seat") }, offices: { expected: directory.districtOffices.length, actual: occurrences(markup, "data-directory-office") } });
    } else if (record.family === "votes" && record.holdingPath.endsWith("key-vote-positions.json")) {
      const key = sourceRows.get(record.auditId)?.identityKey ?? "";
      const positions = Object.entries(raw).filter(([member]) => /^congress:[A-Z]\d{6}$/.test(member));
      const ownChamber = key.split("|")[1];
      const excluded = positions.filter(([member]) => memberKeyRows.find((answer) => answer.member === member)?.chamber !== ownChamber).map(([member, position]) => ({ member, position, sourceChamber: ownChamber, currentChamber: memberKeyRows.find((answer) => answer.member === member)?.chamber, disposition: "INTENTIONALLY_OUT_OF_SCOPE", reason: "B15: the current member's card shows only that member's current chamber. A historical position in the other chamber is not an applicable row in this view." }));
      if (excluded.some((entry) => !entry.currentChamber)) throw new Error(`Key-vote source member lacks resolved current identity ${key}`);
      const selected = positions.filter(([member]) => !excluded.some((entry) => entry.member === member)).map(([member, expected]) => {
        const found = keyRowsByNativeRef.get(key)?.find((entry) => entry.member === member);
        if (!found || found.row.positions[found.index] !== expected || !found.row.held[found.index]) throw new Error(`Key-vote position lost ${key} ${member}`);
        return found;
      });
      const markup = renderToStaticMarkup(createElement(Fragment, null, ...selected.map((entry) => createElement(KeyVoteGroupBlock, { key: entry.member, chamber: entry.chamber, rows: [entry.row] }))));
      add(record, "components/officials/key-votes-section.tsx", "keyVotesForMember shared actual route selector → KeyVoteGroupBlock", { selected, sourceCount: positions.length, excluded }, [key], markup,
        unique(selected.flatMap(({ row }) => [row.entry.title, row.entry.explainer, ...row.refs.map((ref) => ref.url)].filter((value): value is string => Boolean(value)))), [],
        { memberAnswers: { expected: selected.length, actual: occurrences(markup, "data-key-vote") }, sourceDisposition: { expected: positions.length, actual: selected.length + excluded.length } }, excluded.map((entry) => ({ id: `${key}#${entry.member}`, status: entry.disposition, reason: `${entry.reason} Source=${entry.sourceChamber}; current=${entry.currentChamber}.` })));
    } else if (record.family === "votes" && record.holdingPath.endsWith("key-votes-snapshot.json")) {
      const selected = (["house", "senate"] as const).flatMap((chamber) => {
        const answer = memberKeyRows.find((answer) => answer.chamber === chamber);
        const row = answer?.rows.find((row) => row.entry.id === raw.id);
        return row ? [{ chamber, row }] : [];
      });
      if (selected.length !== 2) throw new Error(`Key-vote entry unavailable in actual member payload ${record.auditId}`);
      const markup = renderToStaticMarkup(createElement(Fragment, null, ...selected.map(({ chamber, row }) => createElement(KeyVoteGroupBlock, { key: chamber, chamber, rows: [row] }))));
      add(record, "components/officials/key-votes-section.tsx", "keyVotesForMember shared actual route selector → KeyVoteGroupBlock, both chambers", selected, [string(raw.id)], markup,
        [string(raw.title), string(raw.explainer)], [], { chamberEntries: { expected: 2, actual: occurrences(markup, "data-key-vote") } });
    } else if (record.family === "votes" && record.holdingPath.endsWith("bill-summaries.json")) {
      const url = sourceRows.get(record.auditId)?.identityKey ?? "";
      const selected = billSummaries.summaryForBill(url);
      if (!selected) throw new Error(`Held bill summary unavailable ${record.auditId}`);
      const markup = renderToStaticMarkup(createElement(BillPlainSummary, { billUrl: url, summary: selected, pending: false }));
      add(record, "components/map/popup/official-popup.tsx", "summaryForBill → BillPlainSummary", selected, [url], markup, [selected.summary], [], { summaries: { expected: 1, actual: [...markup.matchAll(/<details\b/g)].length } });
    } else if (record.family === "votes" && record.eligibility.state === "READER_ELIGIBLE" && ["votes", "positions", "rollCalls"].includes(record.unit)) {
      const selected = raw.officeholderId ? voteByMember.get(`${raw.officeholderId}#${raw.voteId ?? raw.rollCallId}`) : voteById.get(string(raw.id));
      if (!selected || raw.officeholderId && selected.vote.position !== raw.position) throw new Error(`Actual member-vote payload lost or changed ${record.auditId}`);
      const markup = renderToStaticMarkup(createElement(RecentVoteRecords, { votes: [selected.vote], attribution: selected.attribution, failed: false, reactionContext: null }));
      add(record, "components/map/popup/official-popup.tsx", "actual GET /api/votes exact member → RecentVoteRecords (same uncapped Show all leaf)", selected, raw.officeholderId ? [selected.member, selected.vote.id] : [selected.vote.id], markup,
        [selected.vote.title, selected.vote.question, selected.vote.result, ({ YES: "Voted yes", NO: "Voted no", ABSTAIN: "Abstained", PRESENT: "Voted present", NOT_VOTING: "Did not vote", UNKNOWN: "Publisher position unclassified" })[selected.vote.position], selected.vote.rollCallUrl, selected.vote.billUrl, selected.attribution?.text, selected.attribution?.url, selected.attribution?.licenceUrl].filter((value): value is string => Boolean(value)), [], { recordedVotes: { expected: 1, actual: occurrences(markup, "data-recent-vote-id") } });
    } else if (record.family === "ballot-navigation" && record.holdingPath.includes("polling-place")) {
      const selected = polling.pollingPlaceLinkFor(string(raw.state));
      if (!selected) throw new Error(`Held polling lookup unavailable ${record.auditId}`);
      const markup = renderToStaticMarkup(createElement(PollingLookupFallback, { links: [selected] }));
      add(record, "components/ballot/polling-lookup-fallback.tsx", "pollingPlaceLinkFor → PollingLookupFallback", selected, [selected.url], markup, [selected.url, selected.sourceOrg, selected.note], [], { stateLookups: { expected: 1, actual: occurrences(markup, "data-polling-lookup-state") } });
    } else if (record.family === "state-money") {
      if (!applicableReaderRecords.has(record.auditId)) continue;
      const holding = raw as unknown as StateMoneyRecord;
      const eligible = isRenderable(holding);
      const authorityRows = eligible
        ? uniqueCanonicalRecords(holding.targetKeys.flatMap((key) => finance.stateMoneyForTarget(key)))
        : [];
      const authority = eligible
        ? stateMoneyAuthorityRelation(holding, authorityRows, finance.stateMoneyReadState(holding.jurisdiction).metadata.sourceThrough)
        : { kind: "EXACT" as const, record: holding };
      const selected = authority.record;
      if (!selected) throw new Error(`SSR could not resolve ${record.auditId}`);
      const markup = renderToStaticMarkup(createElement(StateMoneySection, { records: [selected] }));
      const expected: string[] = [];
      const forbidden: string[] = [];
      if (eligible) {
        if (selected.filingState === "FILED") {
          expected.push(selected.registeredName, selected.agency);
          for (const value of [selected.totals.receipts, selected.totals.expenditures, selected.totals.cashOnHand]) if (value !== null) expected.push(`$${Math.round(value).toLocaleString("en-US")}`);
        } else if (selected.filingState === "OURS_GAP") {
          expected.push(selected.ourGap?.whatIsMissing ?? "The agency holds a record we could not confirm belongs to this candidacy.");
          forbidden.push("$", selected.registeredName);
        } else {
          expected.push(selected.agency, selected.filingState === "NO_REPORTS_ON_FILE" ? "No reports on file with the" : "Registered committee.");
          forbidden.push("$0");
        }
        if (selected.filingsUrl) expected.push(selected.filingsUrl);
      } else {
        forbidden.push("$", holding.registeredName);
      }
      add(record, "components/funding/state-money-section.tsx", "stateMoneyForTarget → StateMoneySection", selected, eligible ? selected.targetKeys : [], markup, expected, forbidden.filter(Boolean), { committeeRecords: { expected: eligible ? 1 : 0, actual: Number(/data-state-money-record-count="(\d+)"/.exec(markup)?.[1] ?? -1) } });
    } else if (record.family === "ballot" && ["cards", "links"].includes(record.unit)) {
      const key = sourceRows.get(record.auditId)?.identityKey ?? "";
      const name = cardName(key);
      if (!name) throw new Error(`No canonical filed/nominee name for card ${record.auditId}`);
      const card = cardFor(key);
      const links = linksFor(key);
      const markup = renderToStaticMarkup(createElement(CandidateCard, { name, partyLine: null, card, links }));
      add(record, "components/ballot/candidate-card.tsx", "cardForCandidacy / cardForNominee → CandidateCard", { key, card, links }, [key], markup,
        [name, card?.bio, card?.bioSourceUrl, card?.photoUrl, card?.phone, links?.official?.url].filter((value): value is string => Boolean(value)));
      const contactMarkup = renderToStaticMarkup(createElement(CandidateContact, { card, links }));
      add(record, "components/ballot/candidate-contact.tsx", "cardForCandidacy / linksForCandidacy → CandidateContact", { key, card, links }, [key], contactMarkup,
        [card?.email, card?.filedAddress, card?.filedAddressSource, links?.campaign?.url].filter((value): value is string => Boolean(value)));
    } else if (record.family === "portraits" && record.eligibility.state === "READER_ELIGIBLE") {
      for (const binding of raw.bindings as { subjectId: string; permitted: boolean }[]) {
        if (!binding.permitted) continue;
        const holder = await registry.seatHolderById(binding.subjectId);
        const card = binding.subjectId.startsWith("ballot-") ? cardFor(binding.subjectId) : null;
        const photoUrl = holder?.photoUrl ?? card?.photoUrl;
        if (!photoUrl || photoUrl !== raw.url) continue;
        const name = holder?.name ?? cardName(binding.subjectId);
        if (!name) throw new Error(`No canonical subject name for selected portrait ${record.auditId}`);
        const markup = renderToStaticMarkup(createElement(IdentityPortrait, { name, photoUrl }));
        add(record, "components/officials/person-identity.tsx", "canonical person/card portrait → IdentityPortrait", { name, photoUrl }, [photoUrl], markup, [photoUrl, `Portrait of ${name}`], [], { portraits: { expected: 1, actual: [...markup.matchAll(/<img\b/g)].length } });
      }
    } else if (record.family === "ballot" && record.unit === "contacts") {
      const filing = contacts.candidateContactForCandidacy(string(raw.candidacyId));
      if (!filing) throw new Error(`SSR could not resolve ${record.auditId}`);
      const markup = renderToStaticMarkup(createElement(CandidateContact, { filing, card: null, links: null }));
      add(record, "components/ballot/candidate-contact.tsx", "candidateContactForCandidacy → CandidateContact", filing, [filing.candidacyId], markup,
        [filing.filedAddress, filing.email, filing.sourceUrl, filing.sourceOrg].filter((value): value is string => Boolean(value)), [], { filedContacts: { expected: 1, actual: occurrences(markup, "data-filed-contact") } });
    } else if (record.family === "comment-access") {
      const bodyName = Array.isArray(raw.bodyNames) ? string(raw.bodyNames[0]) : string(raw.bodyName);
      const ocdId = typeof raw.ocdId === "string" ? raw.ocdId : null;
      const bodyId = typeof raw.bodyId === "string" ? raw.bodyId : null;
      const selected = commentAccess.commentAccessFor(ocdId, bodyName, bodyId);
      if (!selected) throw new Error(`SSR could not resolve comment access ${record.auditId}`);
      // HowToBeHeard reads useShellData().commentAccess (added in the PDC data-plane
      // change), so it must render inside a DataProvider carrying the current
      // comment-access list — otherwise useShellData throws outside the provider.
      const markup = renderToStaticMarkup(createElement(DataProvider, { value: { ...emptyShellData, commentAccess: commentAccess.currentCommentAccess() }, children: createElement(HowToBeHeard, { ocdId, bodyName, bodyId }) }));
      add(record, "components/map/meeting-panel.tsx", "commentAccessFor → HowToBeHeard", selected, [bodyId ?? ocdId ?? selected.sourceUrl], markup,
        [selected.sourceUrl, ...(selected.commentPeriod === "UNKNOWN" ? ["We don't know this body's public-comment rules yet"] : [selected.commentPeriodDetail, selected.timeLimit, selected.signup, selected.writtenComment, selected.attend])].filter((value): value is string => Boolean(value)));
    } else if ((record.family === "meetings" && record.unit === "meetings" || record.family === "minutes-summaries") && record.eligibility.state === "READER_ELIGIBLE") {
      if (record.family === "meetings" && !applicableReaderRecords.has(record.auditId)) continue;
      const meetingId = string(record.family === "minutes-summaries" ? raw.meetingId : raw.id);
      const selected = normalizedMeetings.get(meetingId) ?? servingWindowRemoved(record.auditId, meetingId);
      if (!selected) throw new Error(`SSR could not normalize ${record.auditId}`);
      const representation = memberships.membersOfBody(selected.bodyId ?? null).members;
      const listingGroup = listingMultiplicityForSource(listingIdentity, selected.id);
      // This leaf proof supplies the same canonical source identity readback as
      // the route. It proves no geographic result; actual HTTP coverage remains
      // a separately required proof. A filtered sibling retains its diagnostic.
      const markup = renderToStaticMarkup(createElement(DataProvider, { value: { allMeetings: [selected], meetings: [selected], venues: [], result: { meetings: [selected], listingIdentity, tier: "exact", radiusKm: 0, requestedRadiusKm: 0, center: { lat: 0, lng: 0 }, coverage: null }, location: null, drawnDistricts: [], dropped: 0, searchFailed: false, atAddress: false, governing: null, zipPartial: null, basis: "ZIP" }, children: createElement(MeetingPopup, { meeting: selected, representation }) }));
      const summary = selected.status === "CONCLUDED" ? minutes.minutesSummaryForMeeting(selected.id) : null;
      const links = meetingLinks.linksForMeeting(selected, null).filter((link) => !(selected.status === "CONCLUDED" && link.rung === "VENUE_MAP"));
      add(record, "components/map/popup/meeting-popup.tsx", "makeSnapshotSource.fetch / normalize / minutesSummaryForMeeting / meetingListingIdentity → MeetingPopup", { meeting: selected, listingIdentity }, record.family === "minutes-summaries" ? [selected.id] : [selected.id, ...(selected.bodyId ? [selected.bodyId] : [])], markup,
        [meetingFormat.meetingEntryTitle(selected, { bodyShown: true }), meetingFormat.formatMeetingDate(selected), meetingFormat.formatMeetingTime(selected), ...(selected.location ? [meetingFormat.locationLine(selected.location.name, selected.location.address)] : []), ...links.map((link) => link.url), ...representation.map((holder) => holder.name), summary?.summary, summary?.minutesUrl, listingGroup?.reason, ...(listingGroup?.sourceIds ?? []), ...(listingGroup?.sources.map((source) => source.sourceUrl) ?? [])].filter((value): value is string => Boolean(value)), [], { meetings: { expected: 1, actual: [...markup.matchAll(/role="dialog"/g)].length }, calendarListingSources: { expected: listingGroup?.sourceListingCount ?? 0, actual: occurrences(markup, "data-calendar-listing-source") } });
    } else if (record.family === "outcomes") {
      const sitting = outcomes.getOutcomeSnapshot().sittings.find((row) => row.meetingId === raw.meetingId && row.bodyId === raw.bodyId);
      if (!sitting) throw new Error(`SSR could not resolve ${record.auditId}`);
      const selected = meetingReader.meetingReaderRecords(sitting.meetingId, sitting.bodyId);
      const markup = renderToStaticMarkup(createElement(MeetingRecords, { records: selected }));
      add(record, "components/map/popup/meeting-records.tsx", "meetingReaderRecords → MeetingRecords", selected, [selected.meetingId, selected.bodyId!], markup,
        [...selected.agenda.map((row) => row.title), ...selected.actions.flatMap((row) => [row.action, row.provenance.endpoint]), ...selected.rollCalls.flatMap((row) => row.votes.flatMap((vote) => [vote.personName, vote.value]))].filter((value): value is string => Boolean(value)), [],
        { agenda: { expected: selected.counts.agenda, actual: occurrences(markup, "data-agenda-record") }, actions: { expected: selected.counts.actions, actual: occurrences(markup, "data-action-record") }, rollCalls: { expected: selected.counts.rollCalls, actual: occurrences(markup, "data-roll-call-record") }, votes: { expected: selected.counts.votes, actual: occurrences(markup, "data-recorded-vote") } });
      const mismatch = meetingReader.meetingReaderRecords(sitting.meetingId, "unresolved:other-body");
      const mismatchMarkup = renderToStaticMarkup(createElement(MeetingRecords, { records: mismatch }));
      // A wrong-body probe must never FABRICATE outcome records under a body that
      // did not meet. The PDC data-plane change (abaa4f48) made MeetingRecords emit
      // an honest "records unavailable for this body" status note for
      // IDENTITY_UNRESOLVED (the app's disclose-absence principle); that note
      // carries no records and is permitted. Any actual record container or
      // agenda/action/roll-call/vote row IS a fabrication and must stay absent.
      if (/data-meeting-records=|data-agenda-record|data-action-record|data-roll-call-record|data-recorded-vote/.test(mismatchMarkup)) throw new Error(`Unresolved body rendered outcome records under ${record.auditId}`);
    } else if (record.family === "area-facts") {
      const selected = area.areaFactsForState(string(raw.state))?.facts.find((fact) => fact.topic === raw.topic);
      if (!selected) throw new Error(`SSR could not resolve ${record.auditId}`);
      const markup = renderToStaticMarkup(createElement(ShuffledFacts, { facts: [selected] }));
      add(record, "components/area/shuffled-facts.tsx", "areaFactsForState → ShuffledFacts", selected, [selected.topic], markup,
        [selected.question, selected.answer, selected.sourceOrg, selected.sourceUrl], [], { facts: { expected: 1, actual: [...markup.matchAll(/<section\b/g)].length } });
    } else if (record.family === "official-actions" && record.unit === "actions") {
      const answer = officialActions.officialActionsForTarget(string(raw.officeholderId));
      const selected = answer.records.find((action) => action.id === raw.id);
      if (!selected) throw new Error(`SSR could not resolve official action ${record.auditId}`);
      const markup = renderToStaticMarkup(createElement(OfficialActionsContent, { answer }));
      add(record, "components/officials/official-actions.tsx", "officialActionsForTarget → OfficialActionsContent", answer, [selected.id, selected.officialId], markup,
        [selected.text, selected.sourceUrl, selected.documentUrl, selected.sourceOrg, dateFormat.formatDateLong(selected.collectedAt.slice(0, 10))].filter((value): value is string => Boolean(value)), [],
        { actions: { expected: answer.count, actual: occurrences(markup, "data-official-action-id") } });
    } else if (record.family === "prl") {
      const selected = prl.prlProfileForSubject(`congress:${string(raw.bioguideId)}`);
      if (!selected) throw new Error(`SSR could not resolve ${record.auditId}`);
      const markup = renderToStaticMarkup(createElement(PublicStatementsProfileContent, { profile: selected }));
      add(record, "components/officials/public-statements-profile.tsx", "prlProfileForSubject → PublicStatementsProfileContent", selected, [selected.subjectId], markup,
        [...selected.categories.map((category) => category.sentence), selected.attribution.citation, selected.attribution.url, selected.attribution.licence], [],
        { categories: { expected: selected.categories.length, actual: selected.categories.filter((category) => markup.includes(htmlText(category.sentence))).length } });
    } else if (record.eligibility.state === "READER_ELIGIBLE" && (["state-officeholders", "statewide-executives", "campaign-sites", "body-rosters"].includes(record.family) || record.family === "registry" && record.unit === "officeholders" || record.family === "congress" && record.unit === "members")) {
      const id = record.family === "congress" ? `congress:${string(raw.bioguide)}` : string(raw.id);
      const rosterAuthority = record.family === "body-rosters"
        ? compareFrozenBodyRosterAuthority(raw as unknown as BodyRoster, rosters.currentBodyRosters(), getRegistryRuntimeReadModel().rosterReaderDispositions)
        : null;
      if (rosterAuthority?.failures.length) throw new Error(`${record.auditId}:${rosterAuthority.failures.join("; ")}`);
      const holders = record.family === "body-rosters" ? rosters.rosterHoldersForBody(string(raw.bodyId)) : [await registry.seatHolderById(id)].filter((holder): holder is NonNullable<typeof holder> => Boolean(holder));
      if (!holders.length) throw new Error(`SSR could not resolve official ${record.auditId}`);
      const roster = record.family === "body-rosters" ? rosters.rosterForBody(string(raw.bodyId)) : null;
      const childDispositions = rosterAuthority?.childDispositions.map((child)=>({id:child.sourceId,status:child.state,reason:child.reason}));
      const actualIds = roster ? [roster.bodyId] : holders.map((holder) => holder.id);
      const payload = roster ? { bodyId: roster.bodyId, holders } : holders;
      const [tenure, { readerOfficeTitle }] = await Promise.all([import("../officials/tenure.ts"),import("../officials/reader-office-title.ts")]);
      const identityMarkup = renderToStaticMarkup(createElement(Fragment, null, ...holders.map((holder) => createElement(PersonIdentity, { key: holder.id, holder, seatLabel: null, large: true }))));
      add(record, "components/officials/person-identity.tsx", "seatHolderById / rosterForBody / rosterHoldersForBody → PersonIdentity", payload, actualIds, identityMarkup,
        holders.flatMap((holder) => [holder.name, holder.photoUrl, holder.partyLabel, readerOfficeTitle(holder.officeTitle), tenure.inSeatUntil(holder.termEnd), tenure.ageFrom(holder.birthDate,new Date())?.toString()].filter((value): value is string => Boolean(value))), [],
        { officials: { expected: holders.length, actual: [...identityMarkup.matchAll(/<h2\b/g)].length } }, childDispositions);
      const contactsMarkup = renderToStaticMarkup(createElement(Fragment, null, ...holders.map((holder) => createElement(ContactPills, { key: holder.id, holder }))));
      const socialUrls = (holder:unknown) => {
        const social=object(object(holder).social);
        const mastodon=string(social.mastodon); const parts=mastodon.replace(/^@/, "").split("@");
        return [social.twitter&&`https://x.com/${social.twitter}`,social.facebook&&`https://facebook.com/${social.facebook}`,social.youtubeId?`https://youtube.com/channel/${social.youtubeId}`:social.youtube&&`https://youtube.com/${social.youtube}`,social.instagram&&`https://instagram.com/${social.instagram}`,mastodon&&(parts.length===2?`https://${parts[1]}/@${parts[0]}`:mastodon.startsWith("http")?mastodon:`https://mastodon.social/@${parts[0]}`)].filter((value):value is string=>Boolean(value));
      };
      add(record, "components/officials/contact-pills.tsx", "seatHolderById / rosterForBody / rosterHoldersForBody → ContactPills", payload, actualIds, contactsMarkup,
        holders.flatMap((holder) => [holder.phone, holder.email, holder.contactFormUrl, holder.websiteUrl, holder.campaignUrl, ...socialUrls(holder)].filter((value): value is string => Boolean(value))),[],{},childDispositions);
      const noted = holders.filter((holder)=>holder.termNote);
      if (noted.length) {
        const { OfficialTermNote } = await import("../../components/officials/official-term-note.tsx");
        const markup = renderToStaticMarkup(createElement(Fragment,null,...noted.map((holder)=>createElement(OfficialTermNote,{key:holder.id,holder}))));
        add(record,"components/officials/official-term-note.tsx","rosterHoldersForBody → OfficialTermNote",noted,actualIds,markup,
          noted.flatMap((holder)=>[holder.termNote,holder.sourceUrl,holder.provenance?.sourceOrg,holder.provenance?.collectedAt?meetingFormat.formatDateMDY(holder.provenance.collectedAt.slice(0,10)):null].filter((value):value is string=>Boolean(value))),[],
          {notes:{expected:noted.length,actual:occurrences(markup,"data-official-term-note")}},childDispositions);
      }
      const rosterGap=record.family==="body-rosters"?rosterGapForBody(string(raw.bodyId)):null;
      if(rosterGap) {
        const {RosterCompletenessGaps}=await import("../../components/officials/roster-completeness-gap.tsx");
        const markup=renderToStaticMarkup(createElement(RosterCompletenessGaps,{gaps:[rosterGap]}));
        add(record,"components/officials/roster-completeness-gap.tsx","rosterGapForBody → RosterCompletenessGaps",rosterGap,[rosterGap.bodyId],markup,[rosterGap.statement,rosterGap.sourceUrl,rosterGap.sourceOrg,meetingFormat.formatDateMDY(rosterGap.readAt.slice(0,10))],[],{gaps:{expected:1,actual:occurrences(markup,"data-roster-completeness-gap")}});
      }
    }
  }
  return { formatVersion: 1, exactHead: execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim(), holdingsDigest: census.holdingsDigest, sourceHashes: readerSourceFingerprint(root), rule: "Every named case executes the product component with the canonical selector's payload and reads its emitted HTML. This proves the leaf output only; deployed routing, API grounding and in-situ browser evidence remain separate required proofs. Empty, staged and wrong-identity controls must stay absent.", cases, failures: cases.flatMap((entry) => entry.failures.map((failure) => `${entry.auditId}: ${failure}`)), servingWindowRemovals };
}
