import type {
  OfficeholderDivision,
  Officeholder,
  OfficeholderSet,
} from "../../officials/types.ts";

import { notADocument, sourceUserAgent } from "../http.ts";
import { shortTransfer } from "../bulk-completeness.ts";
import { FIPS_TO_STATE } from "../../ocd/fips.ts";

/**
 * State legislators from the Open States (Plural Open) nightly bulk CSV: one
 * file per state, no key, no login. Data is CC-0; attribution is carried on
 * every row.
 */

const SOURCE_NAME = "plural";

const SOURCE_ORG = "Plural Open States (CC-0)";

/** Acquisition is national; a missing local boundary never suppresses a roster. */
export const PLURAL_STATES: readonly string[] = Object.values(FIPS_TO_STATE)
  .filter(state => state.prefix === "state" || state.postal === "DC" || state.postal === "PR")
  .map(state => state.postal.toLowerCase());

export type PluralState = (typeof PLURAL_STATES)[number];

export function bulkUrl(state: string): string {
  return `https://data.openstates.org/people/current/${state.toLowerCase()}.csv`;
}

/**
 * What a chamber's members are called, per state. Not derivable: some lower
 * chambers' members are Assemblymembers, not Representatives.
 */
const CHAMBER_TITLE: Record<string, { upper: string; lower: string }> = {
  az: { upper: "State Senator", lower: "State Representative" },
  nh: { upper: "State Senator", lower: "State Representative" },
  nj: { upper: "State Senator", lower: "Assemblymember" },
};

for (const state of PLURAL_STATES) {
  CHAMBER_TITLE[state] ??= {
    upper: state === "dc" ? "Councilmember" : "State Senator",
    lower: ["ca", "nv", "ny", "wi"].includes(state) ? "Assemblymember"
      : ["md", "va", "wv"].includes(state) ? "Delegate" : "State Representative",
  };
}

export interface PluralPerson {
  /** An `ocd-person/<uuid>` identifier. Stable across runs. */
  id: string;
  name: string;
  current_party: string;
  /** `"19"` in most states; `"<County> 8"` where districts are designated by county. */
  current_district: string;
  current_chamber: "upper" | "lower" | string;
  email: string;
  image: string;
  /** The capitol office address, as Open States publishes it ("…, City, ST 12345"). */
  capitol_address: string;
  /** The capitol office phone, as the legislature publishes it. */
  capitol_voice: string;
  /** The district office address, where one is published. */
  district_address: string;
  /** The district office phone, where one is published. */
  district_voice: string;
  /** Semicolon-separated. */
  links: string;
  sources: string;
  state: string;
}

/**
 * Reduces a district designation to something two spellings agree on. Some
 * districts are designated by county and number ("<County> 8") and the two
 * sides zero-pad differently; everything else is a bare number.
 */
export function designationKey(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ")
    // Strip leading zeros so "<County> 08" meets "<County> 8".
    .replace(/\b0+(\d)/g, "$1");
}

const LABEL_PREFIX = /^(?:State (?:Senate|House)|State Legislative Districts?\s*-?\s*(?:Upper|Lower)|Senatorial|Representative) District\s*/i;
const NJ_LABEL_PREFIX = /^(Assembly|Senate) District\s*/i;

/** The designation a registry division's Census-sourced label encodes. */
export function designationFromLabel(label: string): string {
  return designationKey(
    label.replace(LABEL_PREFIX, "").replace(NJ_LABEL_PREFIX, ""),
  );
}

export interface RegistryDivisionLite {
  ocdId: string;
  label: string;
  divisionType: string;
}

/**
 * Indexes the registry's legislative divisions by state, chamber and
 * designation. The registry ids are Census codes (`sldl:608`) and Plural uses
 * the statutory designation; the Census-sourced label bridges them. Matching
 * is exact within one state and chamber, and every miss is reported.
 */
export function indexDivisions(
  divisions: RegistryDivisionLite[],
): Map<string, string> {
  const index = new Map<string, string>();

  for (const division of divisions) {
    if (division.divisionType !== "sldu" && division.divisionType !== "sldl") {
      continue;
    }
    const state = /(?:state|district|territory):([a-z]{2})\//.exec(division.ocdId)?.[1];
    if (!state) continue;

    const chamber = division.divisionType === "sldu" ? "upper" : "lower";
    index.set(
      `${state}|${chamber}|${designationFromLabel(division.label)}`,
      division.ocdId,
    );
  }

  return index;
}

/** Minimal CSV reader — quoted fields, embedded commas and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\r") {
      // ignore
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

export function rowsToPeople(csv: string, state: string): PluralPerson[] {
  const rows = parseCsv(csv);
  if (rows.length === 0) return [];

  const header = rows[0];
  const at = (row: string[], name: string) => {
    const i = header.indexOf(name);
    return i === -1 ? "" : (row[i] ?? "");
  };

  return rows
    .slice(1)
    .filter((row) => row.length >= header.length - 2 && at(row, "id"))
    .map((row) => ({
      id: at(row, "id"),
      name: at(row, "name"),
      current_party: at(row, "current_party"),
      current_district: at(row, "current_district"),
      current_chamber: at(row, "current_chamber"),
      email: at(row, "email"),
      image: at(row, "image"),
      capitol_address: at(row, "capitol_address"),
      capitol_voice: at(row, "capitol_voice"),
      district_address: at(row, "district_address"),
      district_voice: at(row, "district_voice"),
      links: at(row, "links"),
      sources: at(row, "sources"),
      state,
    }));
}

/**
 * What a build spent. Bulk CSVs are static files not metered against the
 * GraphQL quota, so the two counters are kept separate.
 */
export interface PluralRequestCount {
  /** Static bulk-file downloads. Not counted against the API quota. */
  bulk: number;
  /** Metered against the 500/day tier. Currently always zero. */
  graphql: number;
}

/** The free tier's documented ceiling, stated once so the build can print it. */
export const GRAPHQL_DAILY_QUOTA = 500;
export const GRAPHQL_MIN_INTERVAL_MS = 1000;

export const requestCount: PluralRequestCount = { bulk: 0, graphql: 0 };

export function resetRequestCount(): void {
  requestCount.bulk = 0;
  requestCount.graphql = 0;
}

/** The columns `rowsToPeople` reads to build a legislator; a header without them is not the roster. */
export const PLURAL_REQUIRED_COLUMNS = ["id", "name", "current_chamber", "current_district"] as const;

/** Refuse an empty response. */
export const PLURAL_ROSTER_FLOOR = 1;

/**
 * Is this 200 body actually a Plural roster, and the whole of it? Returns the
 * reason it is not, or null. An HTML error page passes the comma check and
 * parses to zero people, so the header and the floor are checked here.
 */
export function pluralRosterIssue(csv: string): string | null {
  const rows = parseCsv(csv);
  const header = rows[0] ?? [];
  const missing = PLURAL_REQUIRED_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length > 0) {
    return `a CSV whose header is missing ${missing.join(", ")} — a truncated file or an error page, not the roster`;
  }
  const dataRows = rows.length - 1;
  if (dataRows < PLURAL_ROSTER_FLOOR) {
    return `${dataRows} data row(s), below the floor of ${PLURAL_ROSTER_FLOOR} — refusing a truncated roster`;
  }
  return null;
}

async function fetchState(state: string): Promise<string> {
  const url = bulkUrl(state);
  const MAX_ATTEMPTS = 4;
  let lastStatus = 0;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    requestCount.bulk++;
    const response = await fetch(url, {
      headers: { "User-Agent": sourceUserAgent(), Accept: "text/csv" },
    });

    if (response.ok) {
      const text = await response.text();
      // This adapter rolls its own backoff, so it applies the shared client's
      // document checks by hand.
      const notDoc = notADocument(text, { label: "a bulk CSV", marker: "," });
      if (notDoc !== null) throw new Error(`${url} returned HTTP 200 with ${notDoc}`);
      const short = shortTransfer(response.headers, text);
      if (short !== null) throw new Error(`${url} returned HTTP 200 with ${short}`);
      const issue = pluralRosterIssue(text);
      if (issue !== null) throw new Error(`${url} returned HTTP 200 with ${issue}`);
      return text;
    }

    lastStatus = response.status;
    if (response.status !== 429 && response.status < 500) break;
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
  }

  throw new Error(`${url} returned HTTP ${lastStatus}`);
}

/** Downloads every configured state, serialized: one request per state, nothing per legislator. */
export async function fetchAll(
  states: readonly string[] = PLURAL_STATES,
): Promise<PluralPerson[]> {
  const people: PluralPerson[] = [];
  for (const state of states) {
    people.push(...rowsToPeople(await fetchState(state), state));
  }
  return people;
}

/**
 * Maps people onto officeholders and division links. Everything unattached
 * lands in `unmatched` with a reason that separates a missing boundary from an
 * identifier mismatch.
 */
export function normalize(
  raw: PluralPerson[],
  divisionIndex: Map<string, string>,
  collectedAt: string,
  scope: string,
): OfficeholderSet {
  const officeholders: Officeholder[] = [];
  const divisions: OfficeholderDivision[] = [];
  const unmatched: OfficeholderSet["unmatched"] = [];

  for (const person of raw) {
    const id = `${SOURCE_NAME}:${person.id.replace("ocd-person/", "")}`;
    const chamber = person.current_chamber;

    if (chamber !== "upper" && chamber !== "lower") {
      unmatched.push({ officeholderId: id, reason: `unknown chamber "${chamber}"` });
      continue;
    }

    const title = CHAMBER_TITLE[person.state]?.[chamber];
    if (!title) {
      // No title table for this state: never invent a title for its members.
      unmatched.push({
        officeholderId: id,
        reason: `no chamber title recorded for ${person.state}`,
      });
      continue;
    }

    const key = `${person.state}|${chamber}|${designationKey(person.current_district)}`;
    const ocdId = divisionIndex.get(key);

    officeholders.push({
      id,
      name: person.name,
      officeTitle: title,
      level: "STATE",
      // The CSV carries no term dates; empty, never guessed.
      termStart: "",
      termEnd: "",
      // State rosters publish no birth date.
      birthDate: null,
      partyLabel: person.current_party || null,
      websiteUrl: person.links.split(";")[0] || null,
      contactFormUrl: null,
      // Capitol office first; the district office where the capitol number is
      // not published. Empty strings are absences.
      phone: person.capitol_voice || person.district_voice || null,
      email: person.email || null,
      campaignUrl: null,
      // A lead for the shared portrait source check, not a reader image.
      photo: null,
      ...(person.image ? { portraitCandidate: { imageUrl: person.image, sourceUrl: bulkUrl(person.state), collectedAt } } : {}),
      provenance: {
        sourceUrl: bulkUrl(person.state),
        sourceOrg: SOURCE_ORG,
        collectedAt,
        verifiedAt: null,
      },
    });

    if (!ocdId) {
      unmatched.push({
        officeholderId: id,
        reason: `no ${chamber} division for ${person.state.toUpperCase()} "${person.current_district}" — outside the clipped boundary coverage, or a designation mismatch`,
      });
      continue;
    }

    divisions.push({ officeholderId: id, ocdId, bodyId: null });
  }

  return { scope, generatedAt: collectedAt, officeholders, divisions, unmatched };
}


export { SOURCE_ORG, SOURCE_NAME, CHAMBER_TITLE };
