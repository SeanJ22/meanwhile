import { createHash } from "node:crypto";

import type { JurisdictionRegistry } from "../hunt/jurisdiction-universe.ts";
import { jurisdictionMatchesSubject } from "../hunt/jurisdiction-identity.ts";
import {
  JURISDICTION_REFERENCE_HTTP_SOURCES,
  type JurisdictionReferenceAcquisitionFailure,
  type JurisdictionReferenceSourceReceipt,
} from "./jurisdiction-reference-acquisition.ts";
import { canonicalCivicDataJson } from "./changes.ts";
import {
  CivicDataStoreUnavailableError,
  readPromotedCivicData,
  type CivicDataReadResult,
  type PromotedCivicDataReadOptions,
} from "./read-model.ts";
import {
  hasReviewedRegistry,
  installReviewedRegistryStates,
  JURISDICTION_REFERENCE_STATES,
  type JurisdictionReferenceState,
} from "./reviewed-registry-states.ts";
import { sourceProjectionEvidence, type CivicRecordMember, type RoutineCandidate } from "./types.ts";
import {
  applicableWebsiteCorrections,
  registryIsTheSitesOwn,
  WEBSITE_CORRECTIONS,
  websiteCorrectionReceiptIssue,
  websiteCorrectionRowIssue,
} from "./website-corrections.ts";

export const OPERATIONAL_REFERENCE_RECORD_CLASS = "OPERATIONAL_REFERENCE" as const;
export const JURISDICTION_REFERENCE_SOURCE_ID = "jurisdiction-operational-reference" as const;
export const JURISDICTION_REFERENCE_SCOPE = "US:covered-jurisdiction-routing:v1" as const;
export const AZ_JURISDICTION_REFERENCE_SOURCE_ID = "jurisdiction-operational-reference-az" as const;
export const AZ_JURISDICTION_REFERENCE_SCOPE = "US-AZ:covered-jurisdiction-routing:v1" as const;
export const JURISDICTION_REFERENCE_PARSER_VERSION = "jurisdiction-operational-reference/3" as const;
export const JURISDICTION_REFERENCE_VERSION = "census-2022+reviewed-routing-v1" as const;
export { JURISDICTION_REFERENCE_STATES, type JurisdictionReferenceState };

export interface OperationalReferenceBundle {
  readonly formatVersion: 1;
  readonly sourceVersion: typeof JURISDICTION_REFERENCE_VERSION;
  readonly registries: Readonly<Record<JurisdictionReferenceState, JurisdictionRegistry>> & Readonly<Record<string, JurisdictionRegistry>>;
}
export interface AzOperationalReferenceBundle {
  readonly formatVersion: 1;
  readonly sourceVersion: typeof JURISDICTION_REFERENCE_VERSION;
  readonly registries: Readonly<{ az: JurisdictionRegistry }>;
}

let installedBundle: OperationalReferenceBundle | null = null;
let installedAzBundle: AzOperationalReferenceBundle | null = null;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sourceThrough(registries: Readonly<Partial<Record<JurisdictionReferenceState, JurisdictionRegistry>>>): string {
  const latest = Object.values(registries)
    .map((registry) => registry.generatedOn)
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
    .sort()
    .at(-1);
  return latest ? `${latest}T00:00:00.000Z` : "";
}

function registryIssues(registries: Readonly<Partial<Record<string, JurisdictionRegistry>>>, states: readonly string[] = JURISDICTION_REFERENCE_STATES): string[] {
  const issues: string[] = [];
  for (const state of states) {
    const registry = registries[state];
    if (!registry || registry.formatVersion !== 1) {
      issues.push(`${state}:MISSING_OR_WRONG_FORMAT`);
      continue;
    }
    if (registry.stateCode.toLowerCase() !== state) issues.push(`${state}:STATE_CODE_MISMATCH`);
    if (registry.jurisdictions.length === 0) issues.push(`${state}:ZERO_JURISDICTIONS`);
    const ids = registry.jurisdictions.map(({ id }) => id);
    if (new Set(ids).size !== ids.length) issues.push(`${state}:DUPLICATE_JURISDICTION_ID`);
    for (const jurisdiction of registry.jurisdictions) {
      if (!jurisdiction.id || jurisdiction.stateCode.toLowerCase() !== state) {
        issues.push(`${state}:MALFORMED_JURISDICTION`);
      }
      for (const sourceId of jurisdiction.sourceIds) {
        if (!Object.hasOwn(registry.sourceCatalog, sourceId)) {
          issues.push(`${state}:DANGLING_SOURCE:${jurisdiction.id}:${sourceId}`);
        }
      }
    }
    const counted = Object.values(registry.counts).reduce((sum, count) => sum + count, 0);
    if (counted !== registry.jurisdictions.length) issues.push(`${state}:COUNT_RECONCILIATION`);
  }
  return [...new Set(issues)].sort();
}

function sourceReceiptIssues(receipts: readonly JurisdictionReferenceSourceReceipt[]): string[] {
  const issues: string[] = [];
  const byId = new Map(receipts.map((receipt) => [receipt.sourceId, receipt]));
  if (byId.size !== receipts.length) issues.push("DUPLICATE_SOURCE_RECEIPT");
  for (const required of JURISDICTION_REFERENCE_HTTP_SOURCES) {
    const receipt = byId.get(required.id);
    if (!receipt) {
      issues.push(`SOURCE_RECEIPT_MISSING:${required.id}`);
      continue;
    }
    if (receipt.requestedUrl !== required.url) issues.push(`SOURCE_REQUEST_MISMATCH:${required.id}`);
    let final: URL | null = null;
    try {
      final = new URL(receipt.finalUrl);
    } catch {
      issues.push(`SOURCE_FINAL_URL_INVALID:${required.id}`);
    }
    if (final && (final.protocol !== "https:" || !(required.finalHosts as readonly string[]).includes(final.hostname))) {
      issues.push(`SOURCE_FINAL_AUTHORITY_MISMATCH:${required.id}`);
    }
    if (receipt.httpStatus < 200 || receipt.httpStatus >= 300) issues.push(`SOURCE_HTTP_STATUS:${required.id}`);
    if (!/^[a-f0-9]{64}$/.test(receipt.rawHash)) issues.push(`SOURCE_RAW_HASH_INVALID:${required.id}`);
    if (!Number.isInteger(receipt.byteCount) || receipt.byteCount <= 0) issues.push(`SOURCE_BYTE_COUNT_INVALID:${required.id}`);
    if (!Number.isFinite(Date.parse(receipt.retrievedAt))) issues.push(`SOURCE_RETRIEVED_AT_INVALID:${required.id}`);
  }
  for (const receipt of receipts) {
    if (receipt.sourceId.startsWith("website-correction:")) {
      const issue = websiteCorrectionReceiptIssue(receipt);
      if (issue !== null) issues.push(issue);
      continue;
    }
    if (!JURISDICTION_REFERENCE_HTTP_SOURCES.some((required) => required.id === receipt.sourceId)) {
      issues.push(`UNREGISTERED_SOURCE_RECEIPT:${receipt.sourceId}`);
    }
  }
  return [...new Set(issues)].sort();
}

function websiteCorrectionIssues(
  registries: Readonly<Partial<Record<string, JurisdictionRegistry>>>,
  receipts: readonly JurisdictionReferenceSourceReceipt[],
  states: readonly string[] = JURISDICTION_REFERENCE_STATES,
): string[] {
  const issues: string[] = [];
  const read = new Set(receipts.map((receipt) => receipt.sourceId));
  const reviewed = applicableWebsiteCorrections(WEBSITE_CORRECTIONS);
  for (const state of states) {
    for (const row of registries[state]?.jurisdictions ?? []) {
      const issue = websiteCorrectionRowIssue(row);
      if (issue !== null) issues.push(`WEBSITE_CORRECTION_ROW:${issue}`);
      const correction = reviewed.get(row.id);
      if (row.ownWebAddressCorrection?.reading !== "APPLIED_VERIFIED" || correction === undefined) continue;
      if (correction.homepage !== null && !read.has(`website-correction:${row.id}:homepage`)) {
        issues.push(`WEBSITE_CORRECTION_UNRECEIPTED:${row.id}:homepage`);
      }
      if (registryIsTheSitesOwn(correction) && !read.has("website-correction:dotgov-registry")) {
        issues.push(`WEBSITE_CORRECTION_UNRECEIPTED:${row.id}:dotgov-registry`);
      }
    }
  }
  return issues;
}

export function operationalReferenceBundle(
  registries: Readonly<Record<JurisdictionReferenceState, JurisdictionRegistry>>,
): OperationalReferenceBundle {
  return {
    formatVersion: 1,
    sourceVersion: JURISDICTION_REFERENCE_VERSION,
    registries,
  };
}

export function installOperationalReferenceBundle(bundle: OperationalReferenceBundle): void {
  const states = [...new Set([...JURISDICTION_REFERENCE_STATES, ...Object.keys(bundle.registries ?? {}).map((state) => state.toLowerCase())])];
  const issues = registryIssues(bundle.registries, states);
  if (bundle.formatVersion !== 1 || bundle.sourceVersion !== JURISDICTION_REFERENCE_VERSION || issues.length > 0) {
    throw new Error(`OPERATIONAL_REFERENCE_BUNDLE_INVALID:${issues.join(",") || "format/version"}`);
  }
  installedBundle = structuredClone(bundle);
  installReviewedRegistryStates(states);
    /* The reviewed registry wins: a state read from registration earlier in this process steps aside. */
  for (const state of states) {
    installedRegistration.delete(state);
    refusedRegistration.delete(state);
  }
}

export function clearOperationalReferenceBundle(): void {
  installedBundle = null;
  installedAzBundle = null;
  installReviewedRegistryStates([]);
}

/** A planner installs one reviewed state while enumerating it, retaining only the reviewed state names globally. */
export function installOperationalReferenceState(registry: JurisdictionRegistry, reviewedStates: readonly string[]): void {
  const state = registry.stateCode.toLowerCase(), issues = registryIssues({ [state]: registry }, [state]);
  if (issues.length) throw new Error(`OPERATIONAL_REFERENCE_STATE_INVALID:${issues.join(",")}`);
  installState(registry, reviewedStates);
}

/** A task's view can contain no reviewed row when its registered body is the canonical subject. */
export function installOperationalReferenceSubjects(registry: JurisdictionRegistry, reviewedStates: readonly string[], subjectIds: readonly string[]): void {
  const state = registry.stateCode.toLowerCase(), subjects = new Set(subjectIds);
  const issues = registryIssues({ [state]: registry }, [state]).filter(issue => issue !== `${state}:ZERO_JURISDICTIONS`);
  if (!subjects.size || registry.jurisdictions.some(row => !subjectIds.some(id => jurisdictionMatchesSubject(row, id)))) issues.push(`${state}:SUBJECT_SCOPE_MISMATCH`);
  if (issues.length) throw new Error(`OPERATIONAL_REFERENCE_SUBJECTS_INVALID:${issues.join(",")}`);
  installState(registry, reviewedStates);
}

function installState(registry: JurisdictionRegistry, reviewedStates: readonly string[]): void {
  const state = registry.stateCode.toLowerCase();
  installedBundle = { formatVersion: 1, sourceVersion: JURISDICTION_REFERENCE_VERSION,
    registries: { [state]: structuredClone(registry) } as OperationalReferenceBundle["registries"] };
  installedAzBundle = null;
  installReviewedRegistryStates(reviewedStates);
  installedRegistration.delete(state); refusedRegistration.delete(state);
}

/** Release native rows after the state's pass; reviewed-state metadata still prevents a registration fallback. */
export function releaseOperationalReferenceState(): void { installedBundle = null; installedAzBundle = null; }

export function installedOperationalReferenceStateCodes(): readonly string[] {
  return [...new Set([...Object.keys(installedBundle?.registries ?? {}), ...Object.keys(installedAzBundle?.registries ?? {})])].sort();
}

export function installAzOperationalReferenceBundle(bundle: AzOperationalReferenceBundle): void {
  const issues = registryIssues(bundle.registries, ["az"]);
  if (bundle.formatVersion !== 1 || bundle.sourceVersion !== JURISDICTION_REFERENCE_VERSION ||
    Object.keys(bundle.registries).join(",") !== "az" || issues.length > 0) {
    throw new Error(`AZ_OPERATIONAL_REFERENCE_BUNDLE_INVALID:${issues.join(",") || "format/version/state"}`);
  }
  installedAzBundle = structuredClone(bundle);
}

export function installedOperationalReferenceRegistries(states?: Iterable<string>): Readonly<Record<string, JurisdictionRegistry>> {
  const held = { ...installedBundle?.registries, ...installedAzBundle?.registries };
  const wanted = states ? new Set([...states].map(state => state.toLowerCase())) : null;
  return structuredClone(Object.fromEntries(Object.entries(held).filter(([state]) => !wanted || wanted.has(state))));
}

export function requiredOperationalReferenceBundle(): OperationalReferenceBundle {
  if (installedBundle === null) {
    throw new Error(
      "OPERATIONAL_REFERENCE_READ_NOT_INITIALIZED: preload the canonical promoted jurisdiction reference before building standing obligations.",
    );
  }
  return structuredClone(installedBundle);
}

export function requiredOperationalJurisdictionRegistry(state: string): JurisdictionRegistry {
  const key = state.toLowerCase();
  if (!hasReviewedRegistry(key)) {
    throw new Error(`OPERATIONAL_REFERENCE_STATE_NOT_REGISTERED:${state}`);
  }
  const registry = installedOperationalReferenceRegistries([key])[key];
  if (!registry) throw new Error(`OPERATIONAL_REFERENCE_STATE_NOT_PROMOTED:${state}`);
  return registry;
}

let installedRegistration = new Map<string, JurisdictionRegistry>();
let refusedRegistration = new Map<string, string>();

export function installRegistrationJurisdictionRegistries(
  registries: ReadonlyMap<string, JurisdictionRegistry>,
  refused: ReadonlyMap<string, string> = new Map(),
): void {
  const next = new Map(installedRegistration);
  const nextRefused = new Map(refusedRegistration);
  for (const [state, registry] of registries) {
    const key = state.toLowerCase();
    if (hasReviewedRegistry(key)) {
      throw new Error(`REGISTRATION_REGISTRY_FOR_REVIEWED_STATE:${key}: the reviewed registry wins wherever it exists`);
    }
    if (registry.registration?.kind !== "REGISTRATION" || registry.stateCode.toLowerCase() !== key || registry.jurisdictions.length === 0) {
      throw new Error(`REGISTRATION_REGISTRY_INVALID:${key}`);
    }
    next.set(key, structuredClone(registry));
    nextRefused.delete(key);
  }
  for (const [state, why] of refused) {
    const key = state.toLowerCase();
    if (hasReviewedRegistry(key) || next.has(key)) continue;
    nextRefused.set(key, why);
  }
  installedRegistration = next;
  refusedRegistration = nextRefused;
}

export function clearRegistrationJurisdictionRegistries(): void {
  installedRegistration = new Map();
  refusedRegistration = new Map();
}

export function installedRegistrationJurisdictionRegistries(): {
  readonly registries: ReadonlyMap<string, JurisdictionRegistry>;
  readonly refused: ReadonlyMap<string, string>;
} {
  return { registries: new Map(installedRegistration), refused: new Map(refusedRegistration) };
}

/** The reviewed registry, else the one installed from registration; otherwise throws by name, never an empty registry. */
export function requiredJurisdictionRegistry(state: string): JurisdictionRegistry {
  const key = state.toLowerCase();
  if (hasReviewedRegistry(key)) return requiredOperationalJurisdictionRegistry(key);
  const registry = installedRegistration.get(key);
  if (registry !== undefined) return registry;
  const why = refusedRegistration.get(key);
  throw new Error(
    why === undefined
      ? `JURISDICTION_REGISTRY_NOT_READ:${state}: no reviewed registry, and its registration was not read by this process`
      : `REGISTRATION_NOT_READ:${state}: ${why}`,
  );
}

export async function preloadOperationalReferenceBundle(
  options: PromotedCivicDataReadOptions = {},
): Promise<Extract<CivicDataReadResult<OperationalReferenceBundle>, { kind: "PROMOTED" }>> {
  const result = await readPromotedCivicData<OperationalReferenceBundle>(
    OPERATIONAL_REFERENCE_RECORD_CLASS,
    JURISDICTION_REFERENCE_SCOPE,
    options,
  );
  if (result.kind === "STORE_UNREACHABLE") throw new CivicDataStoreUnavailableError(result);
  if (result.kind !== "PROMOTED") {
    throw new Error(
      `OPERATIONAL_REFERENCE_NOT_PROMOTED:${result.kind}: ${result.detail} ` +
        "Run the explicit owner promotion; a tracked jurisdiction file is not a production fallback.",
    );
  }
  installOperationalReferenceBundle(result.value);
  return result;
}

export async function preloadAzOperationalReferenceBundle(
  options: PromotedCivicDataReadOptions = {},
): Promise<Extract<CivicDataReadResult<AzOperationalReferenceBundle>, { kind: "PROMOTED" }>> {
  const result = await readPromotedCivicData<AzOperationalReferenceBundle>(
    OPERATIONAL_REFERENCE_RECORD_CLASS, AZ_JURISDICTION_REFERENCE_SCOPE, options,
  );
  if (result.kind === "STORE_UNREACHABLE") throw new CivicDataStoreUnavailableError(result);
  if (result.kind !== "PROMOTED") {
    throw new Error(`AZ_OPERATIONAL_REFERENCE_NOT_PROMOTED:${result.kind}: ${result.detail}`);
  }
  installAzOperationalReferenceBundle(result.value);
  return result;
}

export function jurisdictionOperationalReferenceCandidate(input: {
  readonly registries: Readonly<Record<JurisdictionReferenceState, JurisdictionRegistry>>;
  readonly sourceReceipts: readonly JurisdictionReferenceSourceReceipt[];
  readonly workbook: {
    readonly member: "Govt_Units_2022_Final.xlsx";
    readonly rawHash: string;
    readonly byteCount: number;
  };
  readonly retrievedAt: string;
}): RoutineCandidate {
  return buildOperationalReferenceCandidate(input, JURISDICTION_REFERENCE_STATES, JURISDICTION_REFERENCE_SOURCE_ID, JURISDICTION_REFERENCE_SCOPE);
}

export function azJurisdictionOperationalReferenceCandidate(input: {
  readonly registries: Readonly<{ az: JurisdictionRegistry }>;
  readonly sourceReceipts: readonly JurisdictionReferenceSourceReceipt[];
  readonly workbook: { readonly member: "Govt_Units_2022_Final.xlsx"; readonly rawHash: string; readonly byteCount: number };
  readonly retrievedAt: string;
}): RoutineCandidate {
  return buildOperationalReferenceCandidate(input, ["az"], AZ_JURISDICTION_REFERENCE_SOURCE_ID, AZ_JURISDICTION_REFERENCE_SCOPE);
}

function buildOperationalReferenceCandidate(input: {
  readonly registries: Readonly<Partial<Record<JurisdictionReferenceState, JurisdictionRegistry>>>;
  readonly sourceReceipts: readonly JurisdictionReferenceSourceReceipt[];
  readonly workbook: { readonly member: "Govt_Units_2022_Final.xlsx"; readonly rawHash: string; readonly byteCount: number };
  readonly retrievedAt: string;
}, states: readonly JurisdictionReferenceState[], sourceId: string, scope: string): RoutineCandidate {
  const bundle = { formatVersion: 1 as const, sourceVersion: JURISDICTION_REFERENCE_VERSION, registries: input.registries };
  const receiptIssues = sourceReceiptIssues(input.sourceReceipts);
  const issues = [...registryIssues(input.registries, states), ...receiptIssues, ...websiteCorrectionIssues(input.registries, input.sourceReceipts, states)].sort();
  const records: CivicRecordMember[] = states.flatMap((state) =>
    (input.registries[state]?.jurisdictions ?? []).map((jurisdiction) => ({
      key: `jurisdiction:${jurisdiction.id}`,
      record: jurisdiction,
    })),
  );
  const rawHash = input.sourceReceipts.length > 0
    ? sha256(canonicalCivicDataJson(input.sourceReceipts))
    : null;
  const normalizedPayload = {
    sourceInputs: input.sourceReceipts,
    workbook: input.workbook,
    bundle,
  };
  const normalizedHash = sha256(canonicalCivicDataJson(bundle));
  const normalizedPayloadHash = sha256(canonicalCivicDataJson(normalizedPayload));
  const primary = input.sourceReceipts.find(({ sourceId }) => sourceId === "census-government-units-2022");
  const through = sourceThrough(input.registries);
  return {
    id: `cv-${sha256(`${sourceId}\u001f${scope}\u001f${rawHash ?? "none"}\u001f${input.retrievedAt}`).slice(0, 32)}`,
    sourceId,
    recordClass: OPERATIONAL_REFERENCE_RECORD_CLASS,
    scope,
    sourceProjectionEvidence: sourceProjectionEvidence(
      sourceId,
      OPERATIONAL_REFERENCE_RECORD_CLASS,
      scope,
    ),
    retrieval: {
      succeeded: rawHash !== null && receiptIssues.length === 0,
      requestedUrl: primary?.requestedUrl ?? "https://www2.census.gov/programs-surveys/gus/datasets/2022/govt_units_2022.ZIP",
      finalUrl: primary?.finalUrl ?? null,
      httpStatus: primary?.httpStatus ?? null,
      retrievedAt: input.retrievedAt,
      rawHash,
      failureDetail: rawHash === null
        ? "No authoritative jurisdiction-reference response receipts were supplied."
        : issues.length > 0
          ? issues.join(", ")
          : undefined,
    },
    normalization: {
      succeeded: true,
      parserVersion: JURISDICTION_REFERENCE_PARSER_VERSION,
      schemaVersion: JURISDICTION_REFERENCE_VERSION,
      normalizedHash,
      normalizedPayloadHash,
      inputRecords: records.length,
      outputRecords: records.length,
      droppedRecords: 0,
      missingRequiredFields: through ? [] : ["registry.generatedOn"],
    },
    identities: records.map(({ key, record }) => {
      const jurisdiction = record as JurisdictionRegistry["jurisdictions"][number];
      return {
        subjectId: key.slice("jurisdiction:".length),
        jurisdiction: `US-${jurisdiction.stateCode.toUpperCase()}`,
        identifiers: { jurisdiction_id: jurisdiction.id },
        matchBasis: "EXACT_SCOPED_ID" as const,
        ambiguous: false,
      };
    }),
    temporal: {
      version: JURISDICTION_REFERENCE_VERSION,
      expectedVersion: JURISDICTION_REFERENCE_VERSION,
      sourceThrough: through,
      staleAtRetrieval: false,
    },
    semantics: {
      factKind: "reviewed operational jurisdiction and official-route inventory derived from named source vintages",
      violations: issues,
    },
    horizon: {
      kind: "BOUNDED",
      query: `every jurisdiction row in the ${states.map(state => state.toUpperCase()).join(", ")} reviewed operational-reference version`,
      returnedRecords: records.length,
      declaredTotal: records.length,
      paginationComplete: true,
      claimsComplete: true,
    },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [
      {
        consumer: "local-jurisdictions standing obligation provider",
        passed: states.every((state) => (input.registries[state]?.jurisdictions.length ?? 0) > 0),
        detail: `${records.length} exact jurisdiction rows across ${states.length} registered state projections.`,
      },
      {
        consumer: "readiness/Admin jurisdiction denominator",
        passed: issues.length === 0,
        detail: issues.length === 0 ? "Every count, state identity, and source-catalog reference reconciles." : issues.join(", "),
      },
    ],
    normalizedPayload,
    readModel: bundle,
    civicRecords: records,
  };
}

/** Has no read model, so a failure can never replace the promoted LKG pointer. */
export function jurisdictionOperationalReferenceFailureCandidate(
  failure: JurisdictionReferenceAcquisitionFailure,
  azOnly = false,
): RoutineCandidate {
  const sourceId = azOnly ? AZ_JURISDICTION_REFERENCE_SOURCE_ID : JURISDICTION_REFERENCE_SOURCE_ID;
  const scope = azOnly ? AZ_JURISDICTION_REFERENCE_SCOPE : JURISDICTION_REFERENCE_SCOPE;
  const responseSucceeded = failure.stage === "ARCHIVE" || failure.stage === "WORKBOOK" || failure.stage === "SOURCE_SHAPE";
  const rawHash = failure.rawHash ?? (failure.receipts.length > 0
    ? sha256(canonicalCivicDataJson(failure.receipts))
    : null);
  return {
    id: `cv-${sha256(`${sourceId}\u001f${scope}\u001ffailed\u001f${failure.stage}\u001f${failure.retrievedAt}\u001f${rawHash ?? "none"}`).slice(0, 32)}`,
    sourceId,
    recordClass: OPERATIONAL_REFERENCE_RECORD_CLASS,
    scope,
    sourceProjectionEvidence: sourceProjectionEvidence(
      sourceId,
      OPERATIONAL_REFERENCE_RECORD_CLASS,
      scope,
    ),
    retrieval: {
      succeeded: responseSucceeded,
      requestedUrl: failure.requestedUrl,
      finalUrl: failure.finalUrl,
      httpStatus: failure.httpStatus,
      retrievedAt: failure.retrievedAt,
      rawHash,
      failureDetail: responseSucceeded ? undefined : failure.detail,
    },
    normalization: {
      succeeded: false,
      parserVersion: JURISDICTION_REFERENCE_PARSER_VERSION,
      schemaVersion: JURISDICTION_REFERENCE_VERSION,
      normalizedHash: null,
      inputRecords: 0,
      outputRecords: 0,
      droppedRecords: 0,
      missingRequiredFields: [],
      failureDetail: failure.detail,
    },
    identities: [],
    temporal: {
      version: JURISDICTION_REFERENCE_VERSION,
      expectedVersion: JURISDICTION_REFERENCE_VERSION,
      sourceThrough: failure.retrievedAt,
      staleAtRetrieval: false,
    },
    semantics: { factKind: "failed operational-jurisdiction reference acquisition", violations: [] },
    horizon: {
      kind: "BOUNDED",
      query: azOnly ? "every jurisdiction row in the AZ reviewed operational-reference version" : "every jurisdiction row in the AZ, NH, and NJ reviewed operational-reference version",
      returnedRecords: 0,
      declaredTotal: null,
      paginationComplete: false,
      claimsComplete: false,
    },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [{
      consumer: "operational-reference projection",
      passed: false,
      detail: failure.detail,
    }],
    normalizedPayload: { sourceInputs: failure.receipts, failure: { stage: failure.stage, detail: failure.detail } },
    readModel: null,
    civicRecords: [],
  };
}
