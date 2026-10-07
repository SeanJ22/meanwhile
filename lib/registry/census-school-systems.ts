/**
 * The Census school-system index: the authority for independent versus dependent school systems, read
 * directly from the Census of Governments (`census_govt_units_2022.csv` school districts are governments;
 * `census_govt_units_2022_dependent_school_systems.csv` rows are departments of another government).
 *
 * Every branch is one-to-one only; a key resolving to rows of both kinds yields nothing.
 * 1. EXACT: the shared normalizer's core key, `fips|core`.
 * 2. RELAXED: New England structural words dropped and tokens de-pluralised. `CITY` and `COUNTY` stay.
 * 3. NCES ALIAS: the crosswalk's `nces_lea_name` mapped to its `census_kind`.
 * 4. PLACE-WORD RELAXED: `CITY` and `COUNTY` also dropped, still keyed to the state; safe only because
 *    of the one-to-one rule.
 * 5. INTERSTATE: a nationwide unique-name match with no state key (the Census files an interstate
 *    district under one state only).
 * A district none of them reaches is `UNCLASSIFIED` and gets no class definition; never a base-rate guess.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { normalizeName } from "./school-name-key.ts";

export type SchoolDependency = "INDEPENDENT" | "DEPENDENT" | "UNCLASSIFIED";

/** Which branch answered. Reported per district so a stamp can be audited. */
export type MatchBranch = "EXACT" | "RELAXED" | "NCES_ALIAS" | "PLACE_RELAXED" | "INTERSTATE";

export interface Classification {
  kind: Exclude<SchoolDependency, "UNCLASSIFIED">;
  branch: MatchBranch;
  /** The Census's own name for the row that answered. */
  censusName: string;
}

/**
 * A minimal RFC-4180 reader. The Census files quote embedded commas, which a `split(",")` reader would
 * shift into later columns.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** New England says these; the Census says them and the registry does not. */
const RELAXABLE = new Set(["TOWN", "COOPERATIVE", "COOP", "TOWNSHIP", "VILLAGE", "BOROUGH"]);

/** Dropped only on branch 4, and only where the result stays one-to-one. */
const PLACE_WORDS = new Set(["CITY", "COUNTY"]);

const depluralise = (t: string): string => (t.length > 3 && t.endsWith("S") ? t.slice(0, -1) : t);

export const exactKey = (fips: string, name: string): string =>
  `${fips}|${normalizeName(name).core}`;

export const relaxedKey = (fips: string, name: string): string =>
  `${fips}|${normalizeName(name)
    .core.split(" ")
    .filter((t) => t !== "" && !RELAXABLE.has(t))
    .map(depluralise)
    .join(" ")}`;

export const placeRelaxedKey = (fips: string, name: string): string =>
  `${fips}|${normalizeName(name)
    .core.split(" ")
    .filter((t) => t !== "" && !RELAXABLE.has(t) && !PLACE_WORDS.has(t))
    .map(depluralise)
    .join(" ")}`;

const nationwideKey = (name: string): string => relaxedKey("US", name);

interface Bucket {
  kinds: Set<Classification["kind"]>;
  censusName: string;
}

export interface CensusSchoolIndex {
  lookup(fips: string, name: string): Classification | null;
  /** Stated counts, so a caller can report what it read rather than assume. */
  readonly counts: { independent: number; dependent: number };
}

function put(map: Map<string, Bucket>, key: string, kind: Classification["kind"], name: string) {
  if (key.endsWith("|")) return; // an empty core is not a name
  const at = map.get(key);
  if (at) at.kinds.add(kind);
  else map.set(key, { kinds: new Set([kind]), censusName: name });
}

/**
 * Reads both Census files and the crosswalk and builds the branch indexes. `root` is the repo root.
 * No network.
 */
export function buildCensusSchoolIndex(root: string): CensusSchoolIndex {
  const exact = new Map<string, Bucket>();
  const relaxed = new Map<string, Bucket>();
  const placeRelaxed = new Map<string, Bucket>();
  const alias = new Map<string, Bucket>();
  const nationwide = new Map<string, Bucket>();
  const counts = { independent: 0, dependent: 0 };

  const loadCensus = (path: string, fixed: Classification["kind"] | null) => {
    const rows = parseCsv(readFileSync(join(root, path), "utf8"));
    const head = rows[0] ?? [];
    const iName = head.indexOf("unit_name");
    const iFips = head.indexOf("fips_state");
    const iType = head.indexOf("gov_type");
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const name = row[iName];
      if (name === undefined || name === "") continue;
      const kind = fixed ?? (row[iType] === "SCHOOL DISTRICT" ? "INDEPENDENT" : null);
      if (kind === null) continue;
      if (kind === "DEPENDENT") counts.dependent++;
      else counts.independent++;
      const fips = (row[iFips] ?? "").padStart(2, "0");
      put(exact, exactKey(fips, name), kind, name);
      put(relaxed, relaxedKey(fips, name), kind, name);
      put(placeRelaxed, placeRelaxedKey(fips, name), kind, name);
      put(nationwide, nationwideKey(name), kind, name);
    }
  };

  loadCensus("data/reference/census_govt_units_2022_dependent_school_systems.csv", "DEPENDENT");
  loadCensus("data/reference/census_govt_units_2022.csv", null);

  {
    const rows = parseCsv(
      readFileSync(join(root, "data/derived/census-nces-crosswalk.csv"), "utf8"),
    );
    const head = rows[0] ?? [];
    const iName = head.indexOf("nces_lea_name");
    const iKind = head.indexOf("census_kind");
    const iFips = head.indexOf("fips_state");
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const name = row[iName];
      if (name === undefined || name === "") continue;
      const kind: Classification["kind"] = row[iKind] === "DEPENDENT" ? "DEPENDENT" : "INDEPENDENT";
      const fips = (row[iFips] ?? "").padStart(2, "0");
      put(alias, exactKey(fips, name), kind, name);
      put(alias, relaxedKey(fips, name), kind, name);
    }
  }

  const answer = (map: Map<string, Bucket>, key: string, branch: MatchBranch) => {
    const at = map.get(key);
    if (at === undefined || at.kinds.size !== 1) return null;
    const [kind] = [...at.kinds];
    return { kind, branch, censusName: at.censusName } satisfies Classification;
  };

  return {
    counts,
    lookup(fips, name) {
      return (
        answer(exact, exactKey(fips, name), "EXACT") ??
        answer(relaxed, relaxedKey(fips, name), "RELAXED") ??
        answer(alias, exactKey(fips, name), "NCES_ALIAS") ??
        answer(alias, relaxedKey(fips, name), "NCES_ALIAS") ??
        answer(placeRelaxed, placeRelaxedKey(fips, name), "PLACE_RELAXED") ??
        answer(nationwide, nationwideKey(name), "INTERSTATE")
      );
    },
  };
}
