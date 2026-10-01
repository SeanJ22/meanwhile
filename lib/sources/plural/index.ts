import type {
  OfficeholderDivision,
  Officeholder,
  OfficeholderSet,
} from "../../officials/types.ts";

import { notADocument, sourceUserAgent } from "../http.ts";
import { shortTransfer } from "../bulk-completeness.ts";
import { FIPS_TO_STATE } from "../../ocd/fips.ts";

/**
 * State legislators, from Plural Open (ex-Open States). Phase 5.2 tier 2,
 * tracker **D03**.
 *
 * **Reads the nightly bulk CSV, not the v3 API.** `data.openstates.org` publishes
 * one file per state, needs no key and no login, and 5.0a says to prefer bulk
 * where one exists. That also means the `PLURAL_API_KEY` in `.env.local` is not
 * required for the roster — it is there for the API, which this does not use.
 *
 * Data is CC-0. Attribution is requested rather than required, and is carried on
 * every row regardless because provenance rides on everything.
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
 * What a chamber's members are actually called, per state.
 *
 * **Not derivable, and not guessable.** New Jersey's lower chamber is the
 * General Assembly and its members are Assemblymembers, not Representatives.
 * This is the same problem the body registry has with supervisors against
 * commissioners against select boards, and it gets the same answer: state it
 * explicitly rather than mint a plausible wrong title and render it to somebody.
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
  /** `"19"` in most states; `"Merrimack 8"` for the New Hampshire House. */
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
 * Reduce a district designation to something two spellings agree on.
 *
 * Handles the only real variation across these three states: New Hampshire
 * House districts are designated by county and number — "Merrimack 8" — and the
 * two sides zero-pad differently. Everything else is a bare number.
 */
export function designationKey(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ")
    // Strip leading zeros from any number so "Merrimack 08" meets "Merrimack 8".
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
 * Index the registry's legislative divisions by state, chamber and designation.
 *
 * **This is not the name-string join `CLAUDE.md` forbids, and the distinction
 * matters.** That rule is about joining *geographic entities* on names that
 * collide across states and drift between sources. What is matched here is a
 * district's official *designation* — "Merrimack 8" is what that district is
 * called in statute, not a colloquial name — scoped to one state and one
 * chamber, matched exactly after normalization, with every miss reported rather
 * than resolved by similarity. The output is keyed on this repo's OCD-IDs.
 *
 * It is needed because the two sides genuinely disagree: the registry's
 * identifiers are Census numeric codes (`sldl:608`) and Plural uses the
 * statutory designation. The label is the only thing that bridges them, and it
 * is Census-sourced on both counts.
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
 * What a build spent, so the quota is a printed number rather than a surprise.
 *
 * **The two counters are deliberately separate.** Plural's free tier allows
 * **500 GraphQL requests per day at 1 per second**; the bulk CSVs are ordinary
 * static files on `data.openstates.org` and are not metered against it. Adding
 * them together would invent pressure on a ceiling nothing is approaching, and
 * showing neither is how a ceiling gets discovered by hitting it.
 */
export interface PluralRequestCount {
  /** Static bulk-file downloads. Not counted against the API quota. */
  bulk: number;
  /** Metered against the 500/day tier. Currently always zero — see below. */
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

/** Refuse an empty response; a pilot seat count is not a national admission rule. */
export const PLURAL_ROSTER_FLOOR = 1;

/**
 * Is this 200 body actually a Plural roster, and the whole of it? Returns the
 * reason it is not, or null.
 *
 * The `,` blank-check `fetchState` runs first cannot catch the real failure: an
 * HTML error page served at 200 contains commas, so it passes, and then parses
 * to a table whose header is not the roster's — `rowsToPeople` finds no `id`
 * column and returns ZERO people, a state's whole legislature reading as absent
 * with no error at all. The header check refuses that; the floor refuses a
 * file truncated to a handful of rows. Kept pure so it is tested directly.
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
      // A status is not a document (NH Hunt 3, 2026-08-21). This adapter hand-
      // rolls its own backoff rather than using the shared client, so it gets
      // the shared client's checks by hand — a 200 with a blank body, a
      // transfer cut short of its declared length, or an error page that parses
      // to zero people here is a state's whole legislature reading as empty.
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

/**
 * Download every configured state, serialized.
 *
 * **One request per state, and nothing per legislator.** That is the whole
 * reason for the bulk route: 620 legislators across these three states would
 * cost most of a day's GraphQL quota under any per-person or per-district fetch
 * pattern, and would cost it again on every rerun. Three static files cost
 * three requests and are metered against nothing.
 */
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
 * Map people onto officeholders and division links.
 *
 * Everything that cannot be attached lands in `unmatched` with a reason.
 * **Most misses here are expected and are not errors**: the registry is clipped
 * to three counties, so the overwhelming majority of a state's legislators sit
 * in districts this repo holds no boundary for. That is a coverage fact, and it
 * must not be confused with an identifier mismatch — which is why the reason
 * distinguishes them.
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
      // No title table for this state means nobody decided what its members
      // are called. Inventing "State Representative" for a chamber that calls
      // them something else is a small fabrication rendered to a reader.
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
      // The CSV carries no term dates. Null is not allowed by the type and a
      // guessed date is worse than an empty string, so the field records what
      // is known: nothing. Term dates need the API or the YAML repo — D03.
      termStart: "",
      termEnd: "",
      // State rosters publish no birth date; no sourced date, no age (6d).
      birthDate: null,
      partyLabel: person.current_party || null,
      websiteUrl: person.links.split(";")[0] || null,
      contactFormUrl: null,
      // Contact as the legislature publishes it, carried through the CC-0
      // bulk file (3a). Capitol office first; the district office where the
      // capitol number is not published. Empty strings are absences.
      phone: person.capitol_voice || person.district_voice || null,
      email: person.email || null,
      // Curated separately with per-entry verification (3e).
      campaignUrl: null,
      // Plural publishes an image URL. It is NOT shipped: it would be a
      // hotlink, and its licence is unknown. D20 handles both.
      photo: null,
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
