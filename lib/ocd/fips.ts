/**
 * FIPS state codes to postal abbreviations and OCD prefixes, written out as a literal and never derived from names.
 * States are `state:`, DC is `district:`, territories are `territory:`.
 */

export type OcdPrefix = "state" | "district" | "territory";

export interface FipsEntry {
  /** Two-letter postal abbreviation. */
  postal: string;
  /** Which OCD division class this jurisdiction belongs to. */
  prefix: OcdPrefix;
}

export const FIPS_TO_STATE: Readonly<Record<string, FipsEntry>> = {
  "01": { postal: "AL", prefix: "state" },
  "02": { postal: "AK", prefix: "state" },
  "04": { postal: "AZ", prefix: "state" },
  "05": { postal: "AR", prefix: "state" },
  "06": { postal: "CA", prefix: "state" },
  "08": { postal: "CO", prefix: "state" },
  "09": { postal: "CT", prefix: "state" },
  "10": { postal: "DE", prefix: "state" },
  "11": { postal: "DC", prefix: "district" },
  "12": { postal: "FL", prefix: "state" },
  "13": { postal: "GA", prefix: "state" },
  "15": { postal: "HI", prefix: "state" },
  "16": { postal: "ID", prefix: "state" },
  "17": { postal: "IL", prefix: "state" },
  "18": { postal: "IN", prefix: "state" },
  "19": { postal: "IA", prefix: "state" },
  "20": { postal: "KS", prefix: "state" },
  "21": { postal: "KY", prefix: "state" },
  "22": { postal: "LA", prefix: "state" },
  "23": { postal: "ME", prefix: "state" },
  "24": { postal: "MD", prefix: "state" },
  "25": { postal: "MA", prefix: "state" },
  "26": { postal: "MI", prefix: "state" },
  "27": { postal: "MN", prefix: "state" },
  "28": { postal: "MS", prefix: "state" },
  "29": { postal: "MO", prefix: "state" },
  "30": { postal: "MT", prefix: "state" },
  "31": { postal: "NE", prefix: "state" },
  "32": { postal: "NV", prefix: "state" },
  "33": { postal: "NH", prefix: "state" },
  "34": { postal: "NJ", prefix: "state" },
  "35": { postal: "NM", prefix: "state" },
  "36": { postal: "NY", prefix: "state" },
  "37": { postal: "NC", prefix: "state" },
  "38": { postal: "ND", prefix: "state" },
  "39": { postal: "OH", prefix: "state" },
  "40": { postal: "OK", prefix: "state" },
  "41": { postal: "OR", prefix: "state" },
  "42": { postal: "PA", prefix: "state" },
  "44": { postal: "RI", prefix: "state" },
  "45": { postal: "SC", prefix: "state" },
  "46": { postal: "SD", prefix: "state" },
  "47": { postal: "TN", prefix: "state" },
  "48": { postal: "TX", prefix: "state" },
  "49": { postal: "UT", prefix: "state" },
  "50": { postal: "VT", prefix: "state" },
  "51": { postal: "VA", prefix: "state" },
  "53": { postal: "WA", prefix: "state" },
  "54": { postal: "WV", prefix: "state" },
  "55": { postal: "WI", prefix: "state" },
  "56": { postal: "WY", prefix: "state" },
  "60": { postal: "AS", prefix: "territory" },
  "66": { postal: "GU", prefix: "territory" },
  "69": { postal: "MP", prefix: "territory" },
  "72": { postal: "PR", prefix: "territory" },
  "78": { postal: "VI", prefix: "territory" },
};

/** `district:dc`, `territory:pr` …: the jurisdiction segments this table gives a class other than `state:`. */
const NON_STATE_SEGMENTS = new Set(
  Object.values(FIPS_TO_STATE)
    .filter((entry) => entry.prefix !== "state")
    .map((entry) => `${entry.prefix}:${entry.postal.toLowerCase()}`),
);

/**
 * Whether `<prefix>:<postal>` is how this table names a state, DC or territory
 * at the root of an OCD id. `state:` is every state's; `district:` and
 * `territory:` count only for the postal codes the table gives that class, so
 * a reader of an id's jurisdiction recognizes `district:dc` and `territory:pr`
 * exactly as they are minted here, and never a `district:` segment that names
 * something else.
 */
export function isJurisdictionSegment(prefix: string, postal: string): boolean {
  return prefix === "state" || NON_STATE_SEGMENTS.has(`${prefix}:${postal}`);
}

/** Congressional district codes that carry no seat; `ZZ` is water and unassigned area. */
export const NON_DISTRICT_CD_CODES = new Set(["ZZ"]);

/** Census's code for a state with a single at-large district. */
export const AT_LARGE_CD_CODE = "00";

/**
 * Census's code for a non-voting delegate or resident commissioner seat —
 * DC and the five territories.
 */
export const DELEGATE_CD_CODE = "98";

export interface DistrictIdentity {
  ocdId: string;
  state: string;
  district: string;
  label: string;
}

/**
 * The OCD division ID for one congressional seat, `<jurisdiction>/cd:<number|at-large>`, or null when the row is not a
 * seat. Single-seat states, DC and territories use `cd:at-large`.
 */
export function districtIdentity(
  statefp: string,
  cdfp: string,
): DistrictIdentity | null {
  if (NON_DISTRICT_CD_CODES.has(cdfp)) return null;

  const entry = FIPS_TO_STATE[statefp];
  if (!entry) return null;

  const { postal, prefix } = entry;
  const jurisdiction = `ocd-division/country:us/${prefix}:${postal.toLowerCase()}`;

  // DC and the territories elect a delegate or resident commissioner rather
  // than a numbered district, and the canonical list gives those seats the same
  // at-large segment that a single-seat state gets.
  const atLarge =
    prefix !== "state" || cdfp === AT_LARGE_CD_CODE || cdfp === DELEGATE_CD_CODE;

  if (atLarge) {
    return {
      ocdId: `${jurisdiction}/cd:at-large`,
      state: postal,
      district: "AL",
      label: `${postal}-AL`,
    };
  }

  const number = String(Number(cdfp));
  if (!/^\d+$/.test(number) || Number(number) < 1) return null;

  return {
    ocdId: `${jurisdiction}/cd:${number}`,
    state: postal,
    district: number,
    label: `${postal}-${number}`,
  };
}
