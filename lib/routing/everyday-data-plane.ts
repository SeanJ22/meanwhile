import { civicDataReadNotInitialized, mayUseTestFixture, readPromotedCivicData, type CivicDataReadResult, type PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { requiredManualProductionContract } from "../civic-data/manual-contracts.ts";
import {
  manualProjectionCandidate,
  type ManualProjectionCandidateOptions,
  type ManualProjectionPackage,
} from "../civic-data/manual-projections.ts";
import type { ManualSourceSetReceipt, RoutineCandidate } from "../civic-data/types.ts";
import {
  buildEverydayRoutingProjection,
  everydayRoutingProjectionProblems,
  type EverydayRoutingProjection,
} from "./everyday.ts";

export const EVERYDAY_ROUTING_CONTRACT_ID = "everyday-routing" as const;
const CONTRACT = requiredManualProductionContract(EVERYDAY_ROUTING_CONTRACT_ID);
export const EVERYDAY_ROUTING_POINTER = { recordClass: CONTRACT.recordClass, scope: CONTRACT.scope };

export interface EverydayRoutingImportInput {
  readonly version: string;
  readonly sourceThrough: string;
  readonly sourceReceipt: ManualSourceSetReceipt;
  /** Omit only for the exact tracked first-seed import. */
  readonly projection?: EverydayRoutingProjection;
}

/**
 * Builds the import package without writing Git or the store. Exact-byte receipts are caller supplied;
 * constructing the seed cannot manufacture acquisition proof.
 */
export function everydayRoutingImportPackage(
  input: EverydayRoutingImportInput,
): ManualProjectionPackage {
  return {
    contractId: EVERYDAY_ROUTING_CONTRACT_ID,
    version: input.version,
    sourceThrough: input.sourceThrough,
    sourceReceipt: input.sourceReceipt,
    payload: input.projection ?? buildEverydayRoutingProjection(),
  };
}

/** Pure candidate construction; the shared promoter performs writes. */
export function everydayRoutingImportCandidate(
  input: EverydayRoutingImportInput,
  options: ManualProjectionCandidateOptions = {},
): RoutineCandidate {
  return manualProjectionCandidate(everydayRoutingImportPackage(input), options);
}

let state: CivicDataReadResult<EverydayRoutingProjection> = civicDataReadNotInitialized(
  CONTRACT.recordClass,
  CONTRACT.scope,
  "The everyday-routing canonical pointer has not been read for this process.",
);

function validateProjection(value: EverydayRoutingProjection, version: string): void {
  const problems = everydayRoutingProjectionProblems(value);
  if (problems.length > 0) {
    throw new Error(`Everyday routing projection ${version} is invalid: ${problems.join(" | ")}`);
  }
}

/** Production read: canonical pointer only, with no tracked-data fallback. */
export async function readEverydayRoutingProjection(
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<EverydayRoutingProjection>> {
  const result = await readPromotedCivicData<EverydayRoutingProjection>(
    CONTRACT.recordClass,
    CONTRACT.scope,
    options,
  );
  if (result.kind === "PROMOTED") {
    validateProjection(result.value, result.metadata.versionId ?? "unknown");
  }
  state = result;
  return result;
}

export function currentEverydayRoutingProjection(): EverydayRoutingProjection {
  if (state.kind === "PROMOTED") return state.value;
  if (mayUseTestFixture()) {
    return buildEverydayRoutingProjection();
  }
  throw new Error(
    `Everyday routing projection is ${state.kind}; initialize its canonical read before using the Reader projection.`,
  );
}
