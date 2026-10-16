import { readPromotedCivicData, type CivicDataReadResult, type PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import type { RegistryRuntimeReadModel } from "./runtime-data-plane.ts";
import { stateRegistryRuntimeScope } from "./state-scopes.ts";

export async function readStateRegistryRuntimeProjection(state: string, options: PromotedCivicDataReadOptions = {}): Promise<CivicDataReadResult<RegistryRuntimeReadModel>> {
  return readPromotedCivicData<RegistryRuntimeReadModel>("REGISTRY_RUNTIME_BINDING", stateRegistryRuntimeScope(state), options);
}
