import type { LocalElectionOfficeFile } from "../sources/local-election-offices/model.ts";
import { LOCAL_ELECTION_OFFICE_FIELDS } from "../sources/local-election-offices/model.ts";
import { LOCAL_ELECTION_OFFICES_TOWN_STATES } from "../sources/local-election-offices/targets.ts";
import type { ReferenceDivision } from "../registration/reference.ts";

/** The state's published roster, including every native municipality identifier. */
export interface LocalElectionOfficeRoster {
  readonly sourceUrl: string;
  readonly checkedAt: string;
  readonly divisions: readonly { readonly divisionId: string; readonly name: string }[];
}

/** Reports missing work; independently verified offices publish regardless of this report. */
export function localElectionOfficeCoverage(state: string, reference: readonly ReferenceDivision[], file: LocalElectionOfficeFile | null, roster?: LocalElectionOfficeRoster) {
  const upper = state.toUpperCase();
  if (file && file.state !== upper) throw new Error("Election-office coverage state does not match its held data.");
  const municipal = (LOCAL_ELECTION_OFFICES_TOWN_STATES as readonly string[]).includes(upper);
  // Unorganized Census subdivisions are geography; only the state roster establishes a clerk.
  const expected = municipal ? roster?.divisions ?? null : reference.filter(row => row[1] === "county")
    .map(row => ({ divisionId: row[0], name: row[3] }));
  const offices = file?.offices ?? [];
  const held = new Set(offices.map(row => row.divisionId));
  const missing = expected?.filter(row => !held.has(row.divisionId)) ?? null;
  const geographicCandidates = municipal ? reference.filter(row => row[1] === "cousub").map(row => ({ divisionId: row[0], name: row[3] })) : expected ?? [];
  // A publisher's incomplete directory cannot certify its own completeness.
  // Unorganized subdivisions stay named for reconciliation, without inventing a clerk.
  const unreconciledGeographies = municipal ? geographicCandidates.filter(row => !held.has(row.divisionId)) : [];
  const missingFields = offices.flatMap(office => LOCAL_ELECTION_OFFICE_FIELDS.filter(field => !office[field])
    .map(field => ({ officeId: office.id, divisionId: office.divisionId, field })));
  const missingSources = offices.flatMap(office => LOCAL_ELECTION_OFFICE_FIELDS.filter(field => office[field] && !office.fields[field])
    .map(field => ({ officeId: office.id, field })));
  return { state: upper, offices: offices.length, jurisdictions: held.size,
    universe: municipal ? "STATE_MUNICIPAL_DIRECTORY" : "CENSUS_COUNTY_EQUIVALENTS",
    universeSource: municipal ? roster?.sourceUrl ?? null : "data/derived/registration",
    expected: expected?.length ?? null, geographicCandidates: geographicCandidates.length, unreconciledGeographies, missing, missingFields, missingSources,
    complete: missing !== null && missing.length === 0 && unreconciledGeographies.length === 0 && missingSources.length === 0 };
}
