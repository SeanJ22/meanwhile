import { BALLOT_STATES } from "../ballot/state-scopes.ts";

export const REGISTRY_STATES = [...BALLOT_STATES, "PR", "VI", "AS", "GU", "MP"] as const;
type RegistryState = (typeof REGISTRY_STATES)[number];
export type StateRegistryContractId = `registry-runtime:${RegistryState}`;

export function requireRegistryState(value: string): RegistryState {
  const state = value.toUpperCase();
  if (!REGISTRY_STATES.includes(state as RegistryState)) throw new Error(`REGISTRY_STATE_INVALID:${value}`);
  return state as RegistryState;
}

export const stateRegistryRuntimeScope = (state: string): string => `US-${requireRegistryState(state)}:reader-registry-runtime`;
export const stateRegistryRuntimeContractId = (state: string): StateRegistryContractId => `registry-runtime:${requireRegistryState(state)}`;

export function stateFromRegistryRuntimeScope(scope: string): RegistryState | null {
  const match = /^US-([A-Z]{2}):reader-registry-runtime$/.exec(scope);
  return match && REGISTRY_STATES.includes(match[1] as RegistryState) ? match[1] as RegistryState : null;
}

export function stateFromRegistryRuntimeContractId(id: string): RegistryState | null {
  const match = /^registry-runtime:([A-Z]{2})$/.exec(id);
  return match && REGISTRY_STATES.includes(match[1] as RegistryState) ? match[1] as RegistryState : null;
}

export function registryJurisdictions(value: unknown): string[] {
  if (typeof value !== "string") return [];
  const state = /(?:\/(?:state|district|territory):|^US-|^(?:ballot-|curated:)?)([a-z]{2})(?=[-:/]|$)/i.exec(value)?.[1]?.toUpperCase();
  return state && REGISTRY_STATES.includes(state as typeof REGISTRY_STATES[number]) ? [state] : [];
}
