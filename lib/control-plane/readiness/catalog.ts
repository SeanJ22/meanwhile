export interface StateEntry {
  readonly code: string;
  readonly name: string;
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
