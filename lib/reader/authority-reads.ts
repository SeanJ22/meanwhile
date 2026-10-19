import type { PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { currentReaderAuthorityEdge } from "../registry/runtime-edge.ts";
import { refreshRegistryRuntimeFromPromoted as refreshRegistry } from "../registry/runtime-read-model.ts";
import { readFederalDirectoryProjection as readFederal, refreshFederalDirectoryFromPromoted as refreshFederal } from "../officials/federal-directory-read-model.ts";
import { readStatePackage } from "./state.ts";

const registryState = async (state: string) => (await readStatePackage(state)).registryRead;
const federalState = async (state: string) => (await readStatePackage(state)).federalRead;
const useStatePackage = (options: PromotedCivicDataReadOptions) => !options.store && !currentReaderAuthorityEdge();

/** Reader adapters keep state-package loading out of the shared publication readers. */
export function refreshRegistryRuntimeFromPromoted(states: readonly string[], options: PromotedCivicDataReadOptions = {}) {
  return refreshRegistry(states, options, useStatePackage(options) ? registryState : undefined);
}

export function readFederalDirectoryProjection(states: readonly string[], options: PromotedCivicDataReadOptions = {}) {
  return readFederal(states, options, useStatePackage(options) ? federalState : undefined);
}

export function refreshFederalDirectoryFromPromoted(states: readonly string[], options: PromotedCivicDataReadOptions = {}) {
  return refreshFederal(states, options, useStatePackage(options) ? federalState : undefined);
}
