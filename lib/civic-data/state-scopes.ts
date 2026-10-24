export const REGISTRY_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "PR", "VI", "AS", "GU", "MP",
] as const;
export type BallotState = typeof REGISTRY_STATES[number];
export const STATE_BALLOT_FAMILIES = ["ballot-contests", "candidate-profiles", "candidate-corpus", "voting-sites", "candidate-campaign-sites-derived"] as const;
export type StateBallotFamily = typeof STATE_BALLOT_FAMILIES[number];
export type StateBallotContractId<F extends StateBallotFamily = StateBallotFamily> = `${F}:${BallotState}`;

const states = new Set<string>(REGISTRY_STATES);
const scopeNames: Record<StateBallotFamily, string> = {
  "ballot-contests": "state-election-ballots", "candidate-profiles": "candidate-profiles",
  "candidate-corpus": "candidate-publications", "voting-sites": "voting-sites",
  "candidate-campaign-sites-derived": "candidate-campaign-sites-derived",
};

export function requireBallotState(value: string): BallotState {
  const state = value.toUpperCase();
  if (!states.has(state)) throw new Error(`BALLOT_STATE_INVALID:${value}`);
  return state as BallotState;
}

export function stateBallotContractId<F extends StateBallotFamily>(family: F, state: string): StateBallotContractId<F> {
  return `${family}:${requireBallotState(state)}`;
}

export function stateBallotScope(family: StateBallotFamily, state: string): string {
  return `US-${requireBallotState(state)}:${scopeNames[family]}`;
}

export function parseStateBallotContractId(id: string): { family: StateBallotFamily; state: BallotState } | null {
  const [family, state, extra] = id.split(":");
  return extra === undefined && STATE_BALLOT_FAMILIES.includes(family as StateBallotFamily) && states.has(state)
    ? { family: family as StateBallotFamily, state: state as BallotState } : null;
}

export function stateFromBallotScope(scope: string, family: StateBallotFamily): BallotState | null {
  const match = /^US-([A-Z]{2}):(.+)$/.exec(scope);
  return match && states.has(match[1]) && match[2] === scopeNames[family] ? match[1] as BallotState : null;
}


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
  const state = /(?:\/(?:state|district|territory):|^(?:government:)?US-|^(?:ballot-|curated:|roster:)?)([a-z]{2})(?=[-:/]|$)/i.exec(value)?.[1]?.toUpperCase();
  return state && REGISTRY_STATES.includes(state as typeof REGISTRY_STATES[number]) ? [state] : [];
}

export function statesForRegistryDivisions(divisions: readonly string[]): string[] {
  return [...new Set(divisions.flatMap(registryJurisdictions))].sort();
}
