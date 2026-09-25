/**
 * **THE STATES WE TRACK, AND THE CAPABILITY TAXONOMY.** (State Readiness, 2026-09-03.)
 *
 * Two fixed reference lists, not measurements:
 *   - `US_STATES`: the 50 states, DC and the five territories the panel selects
 *     over. The selector is linkable (`/readiness/<code>`), and a state with no
 *     published snapshot still loads — rendering the taxonomy below fully
 *     NOT_WALKED, never blank and never an error (acceptance #14).
 *   - `CAPABILITY_TAXONOMY`: the starting capability rows (§5.3). It is a STARTING
 *     POINT, not a limit — the publisher adds every capability the repo actually
 *     tracks; these are the rows a bare, unwalked state shows. Loaded from the
 *     versioned readiness standard (`standard.json`, MW-063).
 */
import { CAPABILITY_DOMAINS, JURISDICTION_LEVELS, type CapabilityDomain, type JurisdictionLevel } from "./model.ts";
import { currentStandard, type StandardCapability } from "./standard.ts";

export interface StateEntry {
  readonly code: string;
  readonly name: string;
  /** The pilot states carrying real walked data first. */
  readonly pilot: boolean;
}

export const US_STATES: readonly StateEntry[] = [
  { code: "al", name: "Alabama", pilot: false },
  { code: "ak", name: "Alaska", pilot: false },
  { code: "az", name: "Arizona", pilot: true },
  { code: "ar", name: "Arkansas", pilot: false },
  { code: "ca", name: "California", pilot: false },
  { code: "co", name: "Colorado", pilot: false },
  { code: "ct", name: "Connecticut", pilot: false },
  { code: "de", name: "Delaware", pilot: false },
  { code: "dc", name: "District of Columbia", pilot: false },
  { code: "fl", name: "Florida", pilot: false },
  { code: "ga", name: "Georgia", pilot: false },
  { code: "hi", name: "Hawaii", pilot: false },
  { code: "id", name: "Idaho", pilot: false },
  { code: "il", name: "Illinois", pilot: false },
  { code: "in", name: "Indiana", pilot: false },
  { code: "ia", name: "Iowa", pilot: false },
  { code: "ks", name: "Kansas", pilot: false },
  { code: "ky", name: "Kentucky", pilot: false },
  { code: "la", name: "Louisiana", pilot: false },
  { code: "me", name: "Maine", pilot: false },
  { code: "md", name: "Maryland", pilot: false },
  { code: "ma", name: "Massachusetts", pilot: false },
  { code: "mi", name: "Michigan", pilot: false },
  { code: "mn", name: "Minnesota", pilot: false },
  { code: "ms", name: "Mississippi", pilot: false },
  { code: "mo", name: "Missouri", pilot: false },
  { code: "mt", name: "Montana", pilot: false },
  { code: "ne", name: "Nebraska", pilot: false },
  { code: "nv", name: "Nevada", pilot: false },
  { code: "nh", name: "New Hampshire", pilot: true },
  { code: "nj", name: "New Jersey", pilot: true },
  { code: "nm", name: "New Mexico", pilot: false },
  { code: "ny", name: "New York", pilot: false },
  { code: "nc", name: "North Carolina", pilot: false },
  { code: "nd", name: "North Dakota", pilot: false },
  { code: "oh", name: "Ohio", pilot: false },
  { code: "ok", name: "Oklahoma", pilot: false },
  { code: "or", name: "Oregon", pilot: false },
  { code: "pa", name: "Pennsylvania", pilot: false },
  { code: "ri", name: "Rhode Island", pilot: false },
  { code: "sc", name: "South Carolina", pilot: false },
  { code: "sd", name: "South Dakota", pilot: false },
  { code: "tn", name: "Tennessee", pilot: false },
  { code: "tx", name: "Texas", pilot: false },
  { code: "ut", name: "Utah", pilot: false },
  { code: "vt", name: "Vermont", pilot: false },
  { code: "va", name: "Virginia", pilot: false },
  { code: "wa", name: "Washington", pilot: false },
  { code: "wv", name: "West Virginia", pilot: false },
  { code: "wi", name: "Wisconsin", pilot: false },
  { code: "wy", name: "Wyoming", pilot: false },
  { code: "as", name: "American Samoa", pilot: false },
  { code: "gu", name: "Guam", pilot: false },
  { code: "mp", name: "Northern Mariana Islands", pilot: false },
  { code: "pr", name: "Puerto Rico", pilot: false },
  { code: "vi", name: "U.S. Virgin Islands", pilot: false },
];

const STATE_BY_CODE: ReadonlyMap<string, StateEntry> = new Map(
  US_STATES.map((s) => [s.code, s]),
);

/** The entry for a code, or null when it names no state we track. */
export function stateEntry(code: string): StateEntry | null {
  return STATE_BY_CODE.get(code.trim().toLowerCase()) ?? null;
}

/** One row of the starting capability taxonomy. */
export interface TaxonomyRow {
  readonly capabilityId: string;
  readonly domain: CapabilityDomain;
  readonly label: string;
  readonly level: JurisdictionLevel;
}

/**
 * A standard capability row, checked: its domain and level must be ones the
 * panel groups and filters by. A row the code cannot place refuses to load
 * rather than rendering under no heading.
 */
function taxonomyRow(row: StandardCapability): TaxonomyRow {
  if (!(CAPABILITY_DOMAINS as readonly string[]).includes(row.domain) || !(JURISDICTION_LEVELS as readonly string[]).includes(row.level)) {
    throw new Error(`READINESS_STANDARD_CAPABILITY_UNKNOWN: ${row.capabilityId} names domain "${row.domain}" and level "${row.level}"; the code knows neither or not both`);
  }
  return { capabilityId: row.capabilityId, domain: row.domain as CapabilityDomain, label: row.label, level: row.level as JurisdictionLevel };
}

/**
 * The starting rows (§5.3), from the readiness standard in force
 * (`standard.json`, MW-063). A starting point, never a limit: the publisher may
 * add every capability the repo tracks, and a bare state renders exactly these,
 * all NOT_WALKED.
 */
export const CAPABILITY_TAXONOMY: readonly TaxonomyRow[] = currentStandard().capabilities.map(taxonomyRow);
