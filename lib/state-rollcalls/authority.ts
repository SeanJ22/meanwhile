/**
 * Official state roll-call authorities: one pointer, clock, retry stream and
 * last-known-good per legislature. Dependency-free so acquisition, validation
 * and every Reader use the same boundary.
 */

export const OFFICIAL_STATE_ROLL_CALL_TARGETS = [
  {
    state: "AZ",
    jurisdiction: "US-AZ",
    sourceId: "az-legislature",
    contractId: "az-state-rollcalls",
    publisher: "Arizona State Legislature",
    probeUrl: "https://www.azleg.gov/legtext/",
  },
  {
    state: "NH",
    jurisdiction: "US-NH",
    sourceId: "nh-general-court",
    contractId: "nh-state-rollcalls",
    publisher: "New Hampshire General Court",
    probeUrl: "https://gc.nh.gov/nhgcrollcalls/",
  },
  {
    state: "NJ",
    jurisdiction: "US-NJ",
    sourceId: "nj-legislature",
    contractId: "nj-state-rollcalls",
    publisher: "New Jersey Legislature / Office of Legislative Services",
    probeUrl: "https://www.njleg.state.nj.us/voting-records",
  },
] as const;

/**
 * Current-person authorities required before a roll position can reach a
 * Reader. NH reuses its Members.txt routine contract.
 */
export const OFFICIAL_STATE_LEGISLATOR_TARGETS = [
  {
    state: "AZ",
    jurisdiction: "US-AZ",
    sourceId: "az-legislature",
    contractId: "az-state-legislators",
    publisher: "Arizona State Legislature",
    probeUrl: "https://www.azleg.gov/MemberRoster/",
    expectedChamberFloor: { lower: 55, upper: 27 },
    expectedChamberCount: { lower: 60, upper: 30 },
  },
  {
    state: "NH",
    jurisdiction: "US-NH",
    sourceId: "nh-general-court",
    contractId: "nh-members",
    publisher: "New Hampshire General Court",
    probeUrl: "https://gc.nh.gov/downloads/Members.txt",
    expectedChamberFloor: { lower: 350, upper: 20 },
    expectedChamberCount: null,
  },
  {
    state: "NJ",
    jurisdiction: "US-NJ",
    sourceId: "nj-legislature",
    contractId: "nj-state-legislators",
    publisher: "New Jersey Legislature / Office of Legislative Services",
    probeUrl: "https://www.njleg.state.nj.us/legislative-roster",
    expectedChamberFloor: { lower: 75, upper: 35 },
    expectedChamberCount: { lower: 80, upper: 40 },
  },
] as const;

export type OfficialStateCode = (typeof OFFICIAL_STATE_ROLL_CALL_TARGETS)[number]["state"];
export type OfficialStateVoteScope = (typeof OFFICIAL_STATE_ROLL_CALL_TARGETS)[number]["jurisdiction"];
export type OfficialStateRollCallSourceId = (typeof OFFICIAL_STATE_ROLL_CALL_TARGETS)[number]["sourceId"];
export type OfficialStateRollCallContractId = (typeof OFFICIAL_STATE_ROLL_CALL_TARGETS)[number]["contractId"];
export type OfficialStateLegislatorContractId = (typeof OFFICIAL_STATE_LEGISLATOR_TARGETS)[number]["contractId"];

export function officialStateRollCallTargetByState(state: string) {
  return OFFICIAL_STATE_ROLL_CALL_TARGETS.find((target) => target.state === state.toUpperCase()) ?? null;
}

export function officialStateRollCallTargetByScope(scope: string) {
  return OFFICIAL_STATE_ROLL_CALL_TARGETS.find((target) => target.jurisdiction === scope) ?? null;
}

export function officialStateRollCallTargetByContract(contractId: string) {
  return OFFICIAL_STATE_ROLL_CALL_TARGETS.find((target) => target.contractId === contractId) ?? null;
}

export function officialStateLegislatorTargetByState(state: string) {
  return OFFICIAL_STATE_LEGISLATOR_TARGETS.find((target) => target.state === state.toUpperCase()) ?? null;
}

export function officialStateLegislatorTargetByScope(scope: string) {
  return OFFICIAL_STATE_LEGISLATOR_TARGETS.find((target) => target.jurisdiction === scope) ?? null;
}

export function officialStateLegislatorTargetByContract(contractId: string) {
  return OFFICIAL_STATE_LEGISLATOR_TARGETS.find((target) => target.contractId === contractId) ?? null;
}

/** A production state-vote identity is always namespaced by its publisher. */
export function officialStateOfficeholderId(
  sourceId: OfficialStateRollCallSourceId,
  officialPersonId: string,
): string {
  const exact = officialPersonId.trim();
  if (exact === "" || /[\u0000-\u001f\u007f]/.test(exact)) {
    throw new Error(`OFFICIAL_STATE_PERSON_ID_INVALID:${sourceId}`);
  }
  return `${sourceId}:${exact}`;
}

/** Resolve an exact production person id before any state store is opened. */
export function officialStateVoteScopeForOfficeholderId(
  officeholderId: string,
): OfficialStateVoteScope | null {
  const target = OFFICIAL_STATE_ROLL_CALL_TARGETS.find(({ sourceId }) =>
    officeholderId.startsWith(`${sourceId}:`) && officeholderId.length > sourceId.length + 1
  );
  return target?.jurisdiction ?? null;
}
