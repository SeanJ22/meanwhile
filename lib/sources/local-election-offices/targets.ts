import { FIPS_TO_STATE } from "../../ocd/fips.ts";

export const LOCAL_ELECTION_OFFICES_SOURCE_ID = "local-election-offices" as const;
export const LOCAL_ELECTION_OFFICES_RECORD_CLASS = "CURATED_READER_RECORD" as const;
export const LOCAL_ELECTION_OFFICES_PARSER_VERSION = "local-election-offices/1";
export const LOCAL_ELECTION_OFFICES_STATES = Object.values(FIPS_TO_STATE).filter(row => row.prefix === "state" || row.postal === "DC").map(row => row.postal);
export const LOCAL_ELECTION_OFFICES_TOWN_STATES = ["CT", "ME", "MA", "MI", "NH", "RI", "VT", "WI"] as const;
export const localElectionOfficesScope = (state: string) => `local-election-offices:US-${state.toUpperCase()}`;
export const localElectionOfficesContractId = (state: string) => `local-election-offices:${state.toLowerCase()}`;
export const LOCAL_ELECTION_OFFICES_CADENCE = {
  description: "Weekly through November 3, 2026; monthly afterward",
  defaultEveryMs: 30 * 86_400_000,
  phases: [{ through: "2026-11-04T07:00:00.000Z", everyMs: 7 * 86_400_000, description: "Weekly through November 3, 2026" }],
} as const;

export function requireLocalElectionOfficeState(state: string): string {
  const upper = state.toUpperCase();
  if (!LOCAL_ELECTION_OFFICES_STATES.includes(upper)) throw new Error(`Local election-office state is unsupported: ${state}.`);
  return upper;
}
