import { REGISTRY_STATES, requireRegistryState, type BallotState } from "./state-scopes.ts";

export const MEETING_DERIVATION_FAMILIES = ["meeting-body-crosswalk-derived", "meeting-source-wiring"] as const;
export type MeetingDerivationFamily = typeof MEETING_DERIVATION_FAMILIES[number];

export const meetingDerivationScope = (family: MeetingDerivationFamily, state: string): string => `US-${requireRegistryState(state)}:${family}`;
export const meetingDerivationContractId = (family: MeetingDerivationFamily, state: string): string => `${family}:${requireRegistryState(state)}`;
export function parseMeetingDerivationContractId(id: string): { family: MeetingDerivationFamily; state: BallotState } | null {
  const [family, state, extra] = id.split(":");
  return extra === undefined && MEETING_DERIVATION_FAMILIES.includes(family as MeetingDerivationFamily) && REGISTRY_STATES.includes(state as BallotState)
    ? { family: family as MeetingDerivationFamily, state: state as BallotState } : null;
}
export function stateFromMeetingDerivationScope(scope: string): BallotState | null {
  const match = /^US-([A-Z]{2}):(meeting-body-crosswalk-derived|meeting-source-wiring)$/.exec(scope);
  return match && REGISTRY_STATES.includes(match[1] as BallotState) ? match[1] as BallotState : null;
}
