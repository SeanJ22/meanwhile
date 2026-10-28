import { REGISTRY_STATES, requireRegistryState } from "../civic-data/state-scopes.ts";

/** Contract identity is also read by admission, before any packages are installed. */
export const FEDERAL_DIRECTORY_SOURCE_ID = "congress-directory-project" as const;
export type FederalDirectoryState = typeof REGISTRY_STATES[number];
export const FEDERAL_DIRECTORY_STATES: readonly FederalDirectoryState[] = REGISTRY_STATES;
export const federalDirectoryScope = (state: string) => `US-${requireRegistryState(state)}:current-congress-directory`;
export type FederalDirectoryContractId = `congress-bulk-roster:${FederalDirectoryState}`;
export const federalDirectoryContractId = (state: string): FederalDirectoryContractId => `congress-bulk-roster:${requireRegistryState(state)}`;
export function federalDirectoryStateOf(contractId: string): FederalDirectoryState | null {
  const state = /^congress-bulk-roster:([A-Z]{2})$/.exec(contractId)?.[1];
  return FEDERAL_DIRECTORY_STATES.find(place => place === state) ?? null;
}
export const FEDERAL_DIRECTORY_PARSER_VERSION = "congress-directory/5" as const;
