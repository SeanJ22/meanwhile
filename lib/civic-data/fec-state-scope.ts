import { REGISTRY_STATES, requireRegistryState } from "./state-scopes.ts";
export const FEC_STATES = REGISTRY_STATES;
export const fecFundingContractId = (state: string) => `fec-funding:${requireRegistryState(state)}`;
export const fecFundingScope = (state: string) => `US-${requireRegistryState(state)}:fec-funding:v1`;
export const fecFundingStateOfScope = (scope: string): string | null => /^US-([A-Z]{2}):fec-funding:v1$/.exec(scope)?.[1] ?? null;
export const fecStateOfTarget = (target: string): string | null => /^(?:fec:)?[HS]\d([A-Z]{2})\d{5}$/.exec(target)?.[1] ?? null;
