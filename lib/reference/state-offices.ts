import { US_STATES } from "../control-plane/readiness/catalog.ts";
import { FIPS_TO_STATE } from "../ocd/fips.ts";
import { readRecords } from "./index.ts";

export interface StateOfficeContact {
  readonly id: string;
  readonly state: string;
  readonly stateName: string;
  readonly divisionId: string;
  readonly kind: "ELECTION_OFFICE" | "CAMPAIGN_FINANCE_OFFICE";
  readonly office: string;
  readonly url: string;
  readonly phone: string;
  readonly sourceUrl: string;
  readonly checkedAt: string;
}

export const FEC_ELECTION_OFFICES_SOURCE = "https://www.fec.gov/introduction-campaign-finance/how-to-research-public-records/state-election-offices/";
export const FEC_DISCLOSURE_DIRECTORY_SOURCE = "https://www.fec.gov/resources/cms-content/documents/cfsded.pdf";

function jurisdiction(name: string) {
  const base = name.replace(/\s*\([^)]*\)$/, "").replace(/^U\.S\.\s+/i, "").trim().toLowerCase();
  return US_STATES.find(state => state.name.replace(/^U\.S\.\s+/i, "").toLowerCase() === base);
}

/** The two small national directories are read once, then only the requested states leave the server. */
let nationalOffices: ReadonlyMap<string, readonly StateOfficeContact[]> | undefined;
function officesByState(): ReadonlyMap<string, readonly StateOfficeContact[]> {
  if (nationalOffices) return nationalOffices;
  const byState = new Map<string, StateOfficeContact[]>();
  const add = (row: Record<string, string>, kind: StateOfficeContact["kind"]) => {
    const state = jurisdiction(row.jurisdiction);
    if (!state) throw new Error(`FEC_OFFICE_UNKNOWN_JURISDICTION:${row.jurisdiction}`);
    const identity = Object.values(FIPS_TO_STATE).find(entry => entry.postal.toLowerCase() === state.code)!;
    const office = kind === "ELECTION_OFFICE" ? row.office : row.agency;
    const url = kind === "ELECTION_OFFICE" ? row.url : row.agency_url;
    if (!office?.trim() || !row.phone?.trim() || !/^https?:\/\//i.test(url)) throw new Error(`FEC_OFFICE_INCOMPLETE:${state.code}:${kind}`);
    const contact: StateOfficeContact = {
      id: `fec:${kind.toLowerCase()}:${state.code}:${row.jurisdiction.toLowerCase()}`,
      state: identity.postal, stateName: state.name,
      divisionId: `ocd-division/country:us/${identity.prefix}:${state.code}`,
      kind, office, url, phone: row.phone,
      sourceUrl: kind === "ELECTION_OFFICE" ? FEC_ELECTION_OFFICES_SOURCE : FEC_DISCLOSURE_DIRECTORY_SOURCE,
      checkedAt: kind === "ELECTION_OFFICE" ? "2026-08-22" : row.verified_on,
    };
    const rows = byState.get(identity.postal) ?? [];
    rows.push(contact);
    byState.set(identity.postal, rows);
  };
  for (const row of readRecords("fec_state_election_offices")) add(row, "ELECTION_OFFICE");
  for (const row of readRecords("state-cf-agencies")) add(row, "CAMPAIGN_FINANCE_OFFICE");
  nationalOffices = byState;
  return byState;
}

export function stateOfficesForStates(states: readonly string[]): StateOfficeContact[] {
  const index = officesByState();
  return [...new Set(states.map(state => state.toUpperCase()))].flatMap(state => index.get(state) ?? []);
}

export function stateOfficesForDivisions(divisions: readonly string[]): StateOfficeContact[] {
  return stateOfficesForStates(divisions.flatMap(id => /^ocd-division\/country:us\/(?:state|district|territory):([a-z]{2})(?:\/|$)/.exec(id)?.[1] ?? []));
}

/** A federal directory's links also establish the source of state acquisition routes. */
export function stateOfficeLinkingPage(office: StateOfficeContact) {
  const text = office.office.replace(/[&<>\"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!);
  const url = office.url.replace(/&/g, "&amp;").replace(/\"/g, "&quot;");
  return { url: office.sourceUrl, html: `<a href="${url}">${text}</a>` };
}
