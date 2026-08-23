/**
 * **THE CENSUS SCHOOL-SYSTEM INDEX — the authority for independent versus
 * dependent, read directly rather than through an intersection.**
 * (Rewritten 2026-08-23, item 2, from `scripts/classify-school-districts.mts`.)
 *
 * ## The defect this replaces, and it was a false zero of exactly the shape
 * this project names most often
 *
 * The first classifier looked a district up in
 * `data/derived/census-nces-crosswalk.csv`. That file is a MATCHED-PAIRS
 * artifact: 9,776 rows, each a Census system that also matched an NCES LEA.
 * Its own report states the cost in the same breath — **4,083 Census school
 * systems failed to match NCES and are therefore not in it at all**, 3,373
 * independent and 710 dependent.
 *
 * So the classifier was asking the INTERSECTION a question only the CENSUS can
 * answer, and every district the intersection had dropped came back
 * `UNCLASSIFIED` — 219 of 514, reported as a gap in the data when it was a gap
 * in the lookup. Newmarket School District is the clean example: it is in NCES
 * as a regular local district and it is not in the crosswalk, so a district
 * that plainly exists rendered with no class definition at all.
 *
 * **The authority is the Census of Governments itself**, and both halves of it
 * are committed:
 *
 * - `data/reference/census_govt_units_2022.csv` — 12,546 rows with
 *   `gov_type = SCHOOL DISTRICT`. These ARE governments: their own board,
 *   their own budget.
 * - `data/reference/census_govt_units_2022_dependent_school_systems.csv` —
 *   1,313 rows. These are NOT governments: departments of a city, a county or
 *   the state.
 *
 * ## The four branches, and why each one exists
 *
 * Every branch is ONE-TO-ONE ONLY. A key resolving to rows of BOTH kinds is
 * ambiguous and yields nothing, because a coin-flip between "you elect this
 * board" and "you do not" is the worst possible answer.
 *
 * 1. **EXACT** — the shared normalizer's core key, `fips|core`.
 * 2. **RELAXED** — the same with the New England structural words dropped
 *    (`TOWN`, `COOPERATIVE`), and each token de-pluralised. The Census writes
 *    `GILMANTON TOWN SCH DIST` and `WHITE MTS REGIONAL SCH DIST` where the
 *    registry writes `Gilmanton School District` and `White Mountain Regional
 *    School District`. `CITY` and `COUNTY` are deliberately NOT dropped, for
 *    the reason the normalizer already gives: `Albertville City` and `Marshall
 *    County` are different governments.
 * 3. **NCES ALIAS** — the crosswalk's `nces_lea_name` mapped to its
 *    `census_kind`. This is the crosswalk used for what it IS good for: a
 *    dictionary of the OTHER agency's house style for a system whose Census
 *    kind is already known. It catches a registry label that follows NCES
 *    rather than Census wording.
 * 4. **PLACE-WORD RELAXED** — the same again with `CITY` and `COUNTY` also
 *    dropped, still keyed to the state. The two agencies disagree about the
 *    place word in BOTH directions: the Census writes `NASHUA CITY SCHOOL
 *    DISTRICT` where the registry writes `Nashua School District`, and the
 *    registry writes `Rahway City School District` where the Census writes
 *    `RAHWAY SCHOOL DIST`. The normalizer keeps these words for a real reason
 *    — in Alabama `Albertville City` and `Marshall County` are different
 *    districts — and the one-to-one rule is what makes dropping them safe
 *    here: where a state genuinely holds both, the key resolves to two rows
 *    and this branch declines to answer.
 * 5. **INTERSTATE** — a nationwide unique-name match, no state key.
 *    `Rivendell Interstate School District` sits in NH and VT and the Census
 *    files it once, under **Vermont**. A state-keyed lookup can never find it
 *    from the New Hampshire side, and that is a fact about interstate
 *    districts rather than about this one.
 *
 * A district none of the four reaches is `UNCLASSIFIED` and gets NO class
 * definition. That direction of failure is deliberate and unchanged: guessing
 * INDEPENDENT because most districts are would be a claim about who governs a
 * reader's schools made on a base rate.
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
 * A minimal RFC-4180 reader. The Census files quote embedded commas —
 * `"BOARD OF EDUCATION, CITY OF X"` — and a `split(",")` reader silently
 * shifts every column after it, which is how `gov_type` came back holding
 * fragments like ` INC."`.
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
 * Reads both Census files and builds the four branch indexes.
 *
 * `root` is the repo root. Nothing here touches the network: both files and
 * the crosswalk are committed, which is what makes this runnable with no
 * credentials and no egress.
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
