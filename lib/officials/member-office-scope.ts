import { REGISTRY_STATES, requireRegistryState, type BallotState } from "../civic-data/state-scopes.ts";

export const MEMBER_OFFICE_STATES = REGISTRY_STATES;
export type MemberOfficeContractId = `member-offices:${BallotState}`;
export const memberOfficeContractId = (state: string): MemberOfficeContractId => `member-offices:${requireRegistryState(state)}`;
export const memberOfficeScope = (state: string): string => `US-${requireRegistryState(state)}:state-legislator-member-offices`;
export function memberOfficeStateOf(contractId: string): BallotState | null {
  const state = /^member-offices:([A-Z]{2})$/.exec(contractId)?.[1];
  return MEMBER_OFFICE_STATES.find(value => value === state) ?? null;
}
