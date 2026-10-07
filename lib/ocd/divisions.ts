import { FIPS_TO_STATE } from "./fips.ts";

/**
 * OCD identity for division types below Congress, constructed from Census name fields and not verified against the
 * canonical list: a match means the same shape on the map, not a join key for officeholders.
 */

/** Lowercase, underscore-separated, ASCII. The canonical list's style. */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    // Strip combining marks so "Doña Ana" and "Dona Ana" agree.
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export interface DivisionIdentity {
  ocdId: string;
  state: string;
  district: string;
  label: string;
  /** Census LSAD, verbatim: the only boundary field that says whether a polygon has a government. Interpreted in lib/registry/. */
  lsad?: string;
  /**
   * Census functional status: `A`, `B`, `G` govern; `C` is consolidated into another unit; `F`, `N`, `S` do not govern.
   * Not in the cartographic files; joined from TIGER/Line on GEOID at fetch time.
   */
  funcstat?: string;
  /** Census class code: a cross-check on FUNCSTAT for place/subdivision duplicates. */
  classfp?: string;
}

/** `ocd-division/country:us/state:az`, or null for an unknown FIPS code. */
export function stateBase(statefp: string): { base: string; postal: string } | null {
  const entry = FIPS_TO_STATE[statefp];
  if (!entry) return null;

  return {
    base: `ocd-division/country:us/${entry.prefix}:${entry.postal.toLowerCase()}`,
    postal: entry.postal,
  };
}

/** State legislative districts. An all-numeric code is normalised (`007` -> `7`); anything else is slugified as-is. */
export function legislativeIdentity(
  statefp: string,
  chamber: "sldu" | "sldl",
  code: string,
  name: string,
): DivisionIdentity | null {
  const state = stateBase(statefp);
  if (!state) return null;

  const trimmed = code.trim();
  // ZZZ marks water and unassigned area, the SLD equivalent of CD's ZZ.
  if (trimmed === "" || /^Z+$/i.test(trimmed)) return null;

  const numeric = /^\d+$/.test(trimmed);
  const segment = numeric ? String(Number(trimmed)) : slugify(trimmed);
  if (segment === "" || (numeric && Number(trimmed) < 1)) return null;

  const chamberLabel = chamber === "sldu" ? "Senate" : "House";

  return {
    ocdId: `${state.base}/${chamber}:${segment}`,
    state: state.postal,
    district: segment,
    // The Census name is more useful than a bare number for a chamber a reader
    // may not be able to name, but fall back to one when it is missing.
    label: name.trim() || `${state.postal} ${chamberLabel} ${segment}`,
  };
}

export function countyIdentity(
  statefp: string,
  name: string,
): DivisionIdentity | null {
  const state = stateBase(statefp);
  if (!state || !name.trim()) return null;

  const slug = slugify(name);
  if (!slug) return null;

  return {
    ocdId: `${state.base}/county:${slug}`,
    state: state.postal,
    district: slug,
    label: name.trim(),
  };
}

/**
 * Municipalities, from either Census layer. Both land on the `place:` segment, so a municipality in both layers yields
 * the same identifier twice; the caller de-duplicates on `ocdId`.
 */
export function placeIdentity(
  statefp: string,
  name: string,
  lsad?: string,
  funcstat?: string,
  classfp?: string,
): DivisionIdentity | null {
  const state = stateBase(statefp);
  if (!state || !name.trim()) return null;

  const slug = slugify(name);
  if (!slug) return null;

  return {
    ocdId: `${state.base}/place:${slug}`,
    state: state.postal,
    district: slug,
    label: name.trim(),
    lsad: lsad?.trim() || undefined,
    funcstat: funcstat?.trim() || undefined,
    classfp: classfp?.trim() || undefined,
  };
}

/**
 * County subdivisions, nested under the county and slugged from `NAMELSAD`: `NAME` alone collides between distinct
 * governments, and omitting the county collides across counties. Does not match the canonical list everywhere.
 */
export function subdivisionIdentity(
  statefp: string,
  countyName: string,
  nameLsad: string,
  lsad?: string,
  funcstat?: string,
  classfp?: string,
): DivisionIdentity | null {
  const state = stateBase(statefp);
  if (!state || !nameLsad.trim() || !countyName.trim()) return null;

  // `NAMELSADCO` drops its county suffix, matching countyIdentity. Not every county-equivalent's suffix is dropped, so
  // this segment can differ from the county's own id; do not widen the list, since these ids are committed. A
  // subdivision's county is its GEOID's first five digits.
  const county = slugify(countyName.replace(/\s+(County|Parish|Borough|Census Area)$/i, ""));
  const slug = slugify(nameLsad);
  if (!county || !slug) return null;

  return {
    ocdId: `${state.base}/county:${county}/place:${slug}`,
    state: state.postal,
    district: slug,
    label: nameLsad.trim(),
    lsad: lsad?.trim() || undefined,
    funcstat: funcstat?.trim() || undefined,
    classfp: classfp?.trim() || undefined,
  };
}

/** School districts of all three types share the `school_district:` segment; several can cover one point. */
export function schoolIdentity(
  statefp: string,
  name: string,
): DivisionIdentity | null {
  const state = stateBase(statefp);
  if (!state || !name.trim()) return null;

  const slug = slugify(name);
  if (!slug) return null;

  return {
    ocdId: `${state.base}/school_district:${slug}`,
    state: state.postal,
    district: slug,
    label: name.trim(),
  };
}
