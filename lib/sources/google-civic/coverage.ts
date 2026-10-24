import type { CivicStateCoverage } from "./model.ts";
import type { CivicDataReadStore } from "../../civic-data/read-model.ts";
import { readPromotedCivicData } from "../../civic-data/read-model.ts";
import { civicStateScope, GOOGLE_CIVIC_ELECTION_DAY, GOOGLE_CIVIC_RECORD_CLASS } from "./targets.ts";

/** An office-address sample describes provider availability, never a saved voting answer. */
export interface CountyCivicCoverage {
  countyFips: string;
  available: boolean;
  pollingLocations: number;
  earlyVoteSites: number;
  dropOffLocations: number;
}

export interface CountyCivicStateCoverage extends CivicStateCoverage {
  electionDate: string;
  counties: CountyCivicCoverage[];
}

export type CountyCivicCoverageMap = ReadonlyMap<string, CountyCivicCoverage>;

/** Read one state's saved yes/no samples and counts; no voterinfo payload is ever held. */
export async function readCountyCivicCoverage(store: CivicDataReadStore, state: string, electionDate = GOOGLE_CIVIC_ELECTION_DAY): Promise<CountyCivicCoverageMap> {
  if (electionDate !== GOOGLE_CIVIC_ELECTION_DAY) return new Map();
  const held = await readPromotedCivicData<{ coverage: CountyCivicStateCoverage[] }>(GOOGLE_CIVIC_RECORD_CLASS, civicStateScope(state), { store, bypassCache: true });
  if (held.kind !== "PROMOTED") return new Map();
  const report = held.value.coverage?.find(report => report.state === state.toUpperCase() && report.electionDate === electionDate);
  return new Map((report?.counties ?? []).filter(row => /^\d{5}$/.test(row.countyFips) && typeof row.available === "boolean" &&
    [row.pollingLocations, row.earlyVoteSites, row.dropOffLocations].every(count => Number.isSafeInteger(count) && count >= 0))
    .map(row => [row.countyFips, row]));
}
