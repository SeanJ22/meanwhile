import { FIPS_TO_STATE } from "./fips.ts";

/**
 * OCD identity for the division types below Congress.
 *
 * A caveat that matters, stated up front. The congressional mapping in
 * fips.ts was **verified against the canonical list**
 * (opencivicdata/ocd-division-ids, identifiers/country-us.csv) — that is how
 * the `cd:at-large` convention was found and corrected. The identifiers built
 * here are **constructed from Census name fields, not verified against that
 * list.** They follow its conventions (lowercase, underscores, the suffix
 * dropped from a county name) and they are internally consistent, which is
 * enough to key an overlay and a click.
 *
 * It is *not* yet enough to join officeholder records onto. CLAUDE.md makes
 * OCD-IDs the only join key, so before Phase 5 attaches a person to one of
 * these, the slugs need the same verification pass the congressional ones got.
 * Until then, treat a match here as "same shape on the map", not "same
 * division as the state's own records".
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

/**
 * State legislative districts, upper and lower chambers.
 *
 * Census ships the district code zero-padded and occasionally alphanumeric —
 * New Hampshire's floterial districts, Massachusetts' named districts. A code
 * that is entirely numeric is normalised (`007` -> `7`); anything else is
 * slugified and kept as-is rather than coerced into a number it is not.
 */
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

export function placeIdentity(
  statefp: string,
  name: string,
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
  };
}

/**
 * School districts — unified, elementary, and secondary.
 *
 * All three land on the same `school_district:` segment, because that is what
 * the canonical vocabulary has. That is exactly why Rockaway NJ resolves to two
 * of them at one point: an elementary district and a regional high school
 * district cover the same ground and are different divisions. Nothing here
 * de-duplicates them, and nothing downstream may assume one per point.
 */
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
