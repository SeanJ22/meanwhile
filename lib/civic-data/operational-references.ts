import { createHash } from "node:crypto";

import type { JurisdictionRegistry } from "../hunt/jurisdiction-universe.ts";
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
import { sourceProjectionEvidence, type CivicRecordMember, type RoutineCandidate } from "./types.ts";

export const OPERATIONAL_REFERENCE_RECORD_CLASS = "OPERATIONAL_REFERENCE" as const;
export const JURISDICTION_REFERENCE_SOURCE_ID = "jurisdiction-operational-reference" as const;
export const JURISDICTION_REFERENCE_SCOPE = "US:covered-jurisdiction-routing:v1" as const;
export const JURISDICTION_REFERENCE_PARSER_VERSION = "jurisdiction-operational-reference/3" as const;
export const JURISDICTION_REFERENCE_VERSION = "census-2022+reviewed-routing-v1" as const;
export const JURISDICTION_REFERENCE_STATES = ["az", "nh", "nj"] as const;

export type JurisdictionReferenceState = (typeof JURISDICTION_REFERENCE_STATES)[number];

export interface OperationalReferenceBundle {
  readonly formatVersion: 1;
  readonly sourceVersion: typeof JURISDICTION_REFERENCE_VERSION;
  readonly registries: Readonly<Record<JurisdictionReferenceState, JurisdictionRegistry>>;
}

let installedBundle: OperationalReferenceBundle | null = null;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sourceThrough(registries: OperationalReferenceBundle["registries"]): string {
  const latest = Object.values(registries)
    .map((registry) => registry.generatedOn)
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
    .sort()
    .at(-1);
  return latest ? `${latest}T00:00:00.000Z` : "";
}

function registryIssues(registries: OperationalReferenceBundle["registries"]): string[] {
  const issues: string[] = [];
  for (const state of JURISDICTION_REFERENCE_STATES) {
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
    if (!JURISDICTION_REFERENCE_HTTP_SOURCES.some((required) => required.id === receipt.sourceId)) {
      issues.push(`UNREGISTERED_SOURCE_RECEIPT:${receipt.sourceId}`);
    }
  }
  return [...new Set(issues)].sort();
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

/** Explicit process initialization; there is no implicit repository-file fallback. */
export function installOperationalReferenceBundle(bundle: OperationalReferenceBundle): void {
  const issues = registryIssues(bundle.registries);
  if (bundle.formatVersion !== 1 || bundle.sourceVersion !== JURISDICTION_REFERENCE_VERSION || issues.length > 0) {
    throw new Error(`OPERATIONAL_REFERENCE_BUNDLE_INVALID:${issues.join(",") || "format/version"}`);
  }
  installedBundle = structuredClone(bundle);
}

export function clearOperationalReferenceBundle(): void {
  installedBundle = null;
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
  const key = state.toLowerCase() as JurisdictionReferenceState;
  if (!JURISDICTION_REFERENCE_STATES.includes(key)) {
    throw new Error(`OPERATIONAL_REFERENCE_STATE_NOT_REGISTERED:${state}`);
  }
  return requiredOperationalReferenceBundle().registries[key];
}

/** Production preload reads only the proof-validated atomic pointer. */
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

/** Build the one durable manual candidate from reviewed source-version inputs. */
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
  const bundle = operationalReferenceBundle(input.registries);
  const receiptIssues = sourceReceiptIssues(input.sourceReceipts);
  const issues = [...registryIssues(input.registries), ...receiptIssues].sort();
  const records: CivicRecordMember[] = JURISDICTION_REFERENCE_STATES.flatMap((state) =>
    input.registries[state].jurisdictions.map((jurisdiction) => ({
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
    id: `cv-${sha256(`${JURISDICTION_REFERENCE_SOURCE_ID}\u001f${JURISDICTION_REFERENCE_SCOPE}\u001f${rawHash ?? "none"}\u001f${input.retrievedAt}`).slice(0, 32)}`,
    sourceId: JURISDICTION_REFERENCE_SOURCE_ID,
    recordClass: OPERATIONAL_REFERENCE_RECORD_CLASS,
    scope: JURISDICTION_REFERENCE_SCOPE,
    sourceProjectionEvidence: sourceProjectionEvidence(
      JURISDICTION_REFERENCE_SOURCE_ID,
      OPERATIONAL_REFERENCE_RECORD_CLASS,
      JURISDICTION_REFERENCE_SCOPE,
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
      query: "every jurisdiction row in the AZ, NH, and NJ reviewed operational-reference version",
      returnedRecords: records.length,
      declaredTotal: records.length,
      paginationComplete: true,
      claimsComplete: true,
    },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [
      {
        consumer: "local-jurisdictions standing obligation provider",
        passed: JURISDICTION_REFERENCE_STATES.every((state) => input.registries[state].jurisdictions.length > 0),
        detail: `${records.length} exact jurisdiction rows across ${JURISDICTION_REFERENCE_STATES.length} registered state projections.`,
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

/**
 * Persistable failed attempt for a source or workbook failure. It deliberately
 * has no read model, so a failure can never replace the promoted LKG pointer.
 */
export function jurisdictionOperationalReferenceFailureCandidate(
  failure: JurisdictionReferenceAcquisitionFailure,
): RoutineCandidate {
  const responseSucceeded = failure.stage === "ARCHIVE" || failure.stage === "WORKBOOK" || failure.stage === "SOURCE_SHAPE";
  const rawHash = failure.rawHash ?? (failure.receipts.length > 0
    ? sha256(canonicalCivicDataJson(failure.receipts))
    : null);
  return {
    id: `cv-${sha256(`${JURISDICTION_REFERENCE_SOURCE_ID}\u001f${JURISDICTION_REFERENCE_SCOPE}\u001ffailed\u001f${failure.stage}\u001f${failure.retrievedAt}\u001f${rawHash ?? "none"}`).slice(0, 32)}`,
    sourceId: JURISDICTION_REFERENCE_SOURCE_ID,
    recordClass: OPERATIONAL_REFERENCE_RECORD_CLASS,
    scope: JURISDICTION_REFERENCE_SCOPE,
    sourceProjectionEvidence: sourceProjectionEvidence(
      JURISDICTION_REFERENCE_SOURCE_ID,
      OPERATIONAL_REFERENCE_RECORD_CLASS,
      JURISDICTION_REFERENCE_SCOPE,
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
      query: "every jurisdiction row in the AZ, NH, and NJ reviewed operational-reference version",
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
