import { observableRoutineContracts } from "./meeting-partitions.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "./manual-contracts.ts";

export type ReadinessAuthorityDisposition =
  | "CANONICAL_ADMIN_READER_PROJECTION"
  | "CANONICAL_READINESS_INPUT"
  | "CANONICAL_NON_READER";

export interface ReadinessAuthorityCoverage {
  readonly contractId: string;
  readonly sourceId: string;
  readonly recordClass: string;
  readonly scope: string;
  readonly execution: "STANDING" | "MANUAL";
  readonly disposition: ReadinessAuthorityDisposition;
  readonly projectionId: string | null;
  readonly legacyTrackedBootstrap: "FORBIDDEN";
  readonly reason: string;
}

/**
 * The one exceptional canonical input still consumed by the older state
 * readiness derivation. It is read through its promoted projection; its
 * bundled JSON is never a production fallback or a second readiness clock.
 */
const CANONICAL_READINESS_INPUTS = new Set(["jurisdiction-operational-reference"]);

/**
 * Complete terminal boundary between the canonical civic-data plane and the
 * older state-readiness snapshot.
 *
 * Every production contract appears exactly once. A Reader contract is shown
 * by the canonical Admin outcome projection, not reconstructed from a tracked
 * bootstrap. The one non-Reader contract remains observable there without a
 * fabricated Reader-delivery claim. The jurisdiction reference is the only
 * contract whose promoted value is also a legitimate readiness input.
 */
export const READINESS_AUTHORITY_COVERAGE: readonly ReadinessAuthorityCoverage[] = [
  ...observableRoutineContracts().map((contract) => ({ contract, execution: "STANDING" as const })),
  ...MANUAL_PRODUCTION_SOURCE_CONTRACTS.map((contract) => ({ contract, execution: "MANUAL" as const })),
].map(({ contract, execution }) => {
  if (CANONICAL_READINESS_INPUTS.has(contract.id)) {
    return {
      contractId: contract.id,
      sourceId: contract.sourceId,
      recordClass: contract.recordClass,
      scope: contract.scope,
      execution,
      disposition: "CANONICAL_READINESS_INPUT",
      projectionId: contract.readerProjection?.id ?? null,
      legacyTrackedBootstrap: "FORBIDDEN",
      reason: "State readiness may consume only the promoted jurisdiction projection; Admin attempt, promotion, LKG, and delivery truth stays in the canonical outcome view.",
    };
  }
  if (contract.readerProjection === null) {
    return {
      contractId: contract.id,
      sourceId: contract.sourceId,
      recordClass: contract.recordClass,
      scope: contract.scope,
      execution,
      disposition: "CANONICAL_NON_READER",
      projectionId: null,
      legacyTrackedBootstrap: "FORBIDDEN",
      reason: "The contract is operationally observable from canonical receipts but has no Reader projection, so readiness must not invent a delivery.",
    };
  }
  return {
    contractId: contract.id,
    sourceId: contract.sourceId,
    recordClass: contract.recordClass,
    scope: contract.scope,
    execution,
    disposition: "CANONICAL_ADMIN_READER_PROJECTION",
    projectionId: contract.readerProjection.id,
    legacyTrackedBootstrap: "FORBIDDEN",
    reason: "Reader delivery and readiness are proved by the canonical promotion/read model and Admin outcome projection, never by a tracked bootstrap holding.",
  };
});

export interface StaticReadinessReference {
  readonly id: string;
  readonly disposition: "STATIC_VERSIONED_REFERENCE";
  readonly inputs: readonly string[];
  readonly mayAssertRuntimeFreshness: false;
  readonly mayAssertProductionContractDelivery: false;
  readonly reason: string;
}

/**
 * Tracked inputs which remain lawful because readiness uses only their adopted
 * static identity/geometry facts. They cannot assert acquisition freshness,
 * promotion, LKG, or Reader delivery for any production contract.
 */
export const STATIC_READINESS_REFERENCES: readonly StaticReadinessReference[] = [
  {
    id: "registry-division-identities",
    disposition: "STATIC_VERSIONED_REFERENCE",
    inputs: ["lib/registry/registry.json#divisions"],
    mayAssertRuntimeFreshness: false,
    mayAssertProductionContractDelivery: false,
    reason: "Only reviewed division identities and labels are used; bodies, rosters, people, and runtime bindings remain canonical-store data.",
  },
  {
    id: "census-gis-geography",
    disposition: "STATIC_VERSIONED_REFERENCE",
    inputs: ["data/derived/zip-divisions/*.json", "data/states/*/geo/cd119-*.geojson"],
    mayAssertRuntimeFreshness: false,
    mayAssertProductionContractDelivery: false,
    reason: "Adopted geography vintages supply static scope and labels, not source-run or Reader-delivery outcomes.",
  },
] as const;

export function readinessAuthorityCoverageIssues(
  coverage: readonly ReadinessAuthorityCoverage[] = READINESS_AUTHORITY_COVERAGE,
): string[] {
  const expected = [...observableRoutineContracts(), ...MANUAL_PRODUCTION_SOURCE_CONTRACTS];
  const issues: string[] = [];
  const ids = new Set<string>();
  for (const row of coverage) {
    if (ids.has(row.contractId)) issues.push(`duplicate readiness authority coverage for ${row.contractId}`);
    ids.add(row.contractId);
    if (row.legacyTrackedBootstrap !== "FORBIDDEN") issues.push(`${row.contractId} permits a tracked bootstrap readiness authority`);
  }
  for (const contract of expected) {
    const row = coverage.find((entry) => entry.contractId === contract.id);
    if (!row) {
      issues.push(`missing readiness authority coverage for ${contract.id}`);
      continue;
    }
    if (row.sourceId !== contract.sourceId || row.recordClass !== contract.recordClass || row.scope !== contract.scope) {
      issues.push(`readiness authority coverage for ${contract.id} does not match its production contract`);
    }
    const expectedDisposition: ReadinessAuthorityDisposition = CANONICAL_READINESS_INPUTS.has(contract.id)
      ? "CANONICAL_READINESS_INPUT"
      : contract.readerProjection === null
        ? "CANONICAL_NON_READER"
        : "CANONICAL_ADMIN_READER_PROJECTION";
    if (row.disposition !== expectedDisposition) issues.push(`${contract.id} must be classified ${expectedDisposition}, not ${row.disposition}`);
    const expectedProjectionId = contract.readerProjection?.id ?? null;
    if (row.projectionId !== expectedProjectionId) issues.push(`${contract.id} names the wrong Reader projection`);
  }
  for (const row of coverage) {
    if (!expected.some((contract) => contract.id === row.contractId)) issues.push(`unknown readiness authority coverage ${row.contractId}`);
  }
  return issues;
}
