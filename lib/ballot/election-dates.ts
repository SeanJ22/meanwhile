
export interface DatedStep {
  label: string;
  date: string;
  detail: string | null;
  sourceUrl: string;
  sourceOrg: string;
  collectedAt: string;
  verifiedAt: string;
}

export interface ElectionDates {
  state: string;
  electionDay: string;
  steps: DatedStep[];
}

export function electionDatesFor(state: string, projection: readonly ElectionDates[], electionDay = "2026-11-03"): ElectionDates | null {
  return projection.find(calendar => calendar.state === state && calendar.electionDay === electionDay) ?? null;
}
