import type {
  OfficeholderDivision,
  Officeholder,
  OfficeholderSet,
} from "../../officials/types.ts";

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

/** States with boundary coverage. Adding one is adding a line. */
export const PLURAL_STATES = ["az", "nj", "nh"] as const;

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

const LABEL_PREFIX = /^State (Senate|House) District\s*/i;
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
    const state = /state:([a-z]{2})\//.exec(division.ocdId)?.[1];
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
      links: at(row, "links"),
      sources: at(row, "sources"),
      state,
    }));
}

async function fetchState(state: string): Promise<string> {
  const url = bulkUrl(state);
  const MAX_ATTEMPTS = 4;
  let lastStatus = 0;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const response = await fetch(url, {
      headers: { "User-Agent": userAgent(), Accept: "text/csv" },
    });

    if (response.ok) return response.text();

    lastStatus = response.status;
    if (response.status !== 429 && response.status < 500) break;
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
  }

  throw new Error(`${url} returned HTTP ${lastStatus}`);
}

/** Download every configured state, serialized. */
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
      partyLabel: person.current_party || null,
      websiteUrl: person.links.split(";")[0] || null,
      contactFormUrl: null,
      phone: null,
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

function userAgent(): string {
  const contact = process.env.INGEST_CONTACT_EMAIL?.trim();
  const suffix = contact
    ? `contact: ${contact}`
    : "https://github.com/SeanJ22/we-the-people";
  return `we-the-people civic meeting index (${suffix})`;
}

export { SOURCE_ORG, SOURCE_NAME, CHAMBER_TITLE };
