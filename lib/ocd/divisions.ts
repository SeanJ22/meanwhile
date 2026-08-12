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
  /**
   * Census LSAD, carried verbatim on place and county-subdivision features.
   *
   * The fifth property, and it earns its bytes: it is the only thing in the
   * boundary data that says whether a polygon has a government. 376 of
   * Arizona's 467 "places" are census designated places with no municipality
   * at all, and all 80 of its county subdivisions are statistical CCDs. A
   * derivation rule without this mints a city council for Vail.
   *
   * Stored as the raw code rather than an interpreted flag so the geometry
   * file stays a faithful copy of the source and the interpretation lives in
   * lib/registry/, where it can be corrected without refetching.
   */
  lsad?: string;
  /**
   * Census functional status. The sixth property, and the one that finally
   * settles whether a polygon is a government.
   *
   * `A` active, `B` active and partially consolidated, `G` active but
   * subordinate — all governments. `C` consolidated with another unit under a
   * single set of officials, which is one government, not two. `F` a
   * *fictitious* entity that exists only to fill the geographic hierarchy, `N`
   * nonfunctioning, `S` statistical — none of them govern.
   *
   * This is what resolves the place/cousub duplicate, and it does it better
   * than any rule inferred from the layer a row came from. Concord NH appears
   * in both files under the same GNIS code: the place row is `FUNCSTAT=A` and
   * the county-subdivision row is `FUNCSTAT=F`. Census has already said which
   * one is the government. New Hampshire's 221 *towns* go the other way — the
   * subdivision is `A` and there is no place row at all — which is why a
   * "prefer the subdivision" rule got Concord backwards while still counting
   * it once.
   *
   * **Not present in the cartographic (`cb_*`) files.** It is joined in from
   * TIGER/Line on GEOID at fetch time; see `scripts/fetch-districts.ts`.
   */
  funcstat?: string;
  /**
   * Census class code — the *kind* of entity, where LSAD is its legal name and
   * FUNCSTAT its status.
   *
   * Carried because it names the duplicate directly: `C2`, `C5` and `C6` on a
   * place all mean an incorporated place that is coextensive with, or serving
   * as, a county subdivision, and `Z7` on a subdivision means the reverse. It
   * is a cross-check on FUNCSTAT rather than the primary test, and it is what
   * makes New Jersey — wall-to-wall C2/C5 — auditable.
   */
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

/**
 * Municipalities, from either Census layer that carries them.
 *
 * Both `place` and `cousub` land on the same `place:` segment, and that is
 * deliberate: which layer a municipality lives in is an artifact of Census
 * geography, not a fact about the government. Arizona's cities are places and
 * its county subdivisions are statistical CCDs; New Jersey's 564 municipalities
 * and New Hampshire's towns are county subdivisions and are largely absent from
 * the place file. Newbury NH and Rockaway Township NJ have no polygon in this
 * repo at all without the second layer.
 *
 * Because both layers feed one segment, a municipality listed in both — every
 * New Hampshire city is a place *and* a county subdivision — produces the same
 * identifier twice. That is correct; it is one government, and the caller
 * de-duplicates on `ocdId`.
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
 * County subdivisions — New England towns, mid-Atlantic townships, boroughs.
 *
 * Nested under the county and slugged from `NAMELSAD` (the name *with* its
 * legal type) rather than `NAME`, because neither shortcut survives contact
 * with the data:
 *
 * - **`NAME` alone collides between distinct governments.** Morris County NJ
 *   contains both Rockaway borough and Rockaway township — two separate
 *   municipalities, each with its own council, both slugging to `rockaway`.
 *   Hunterdon has Clinton town and Clinton township; Morris also has Mendham
 *   borough and Mendham township. 30 of New Jersey's 564 subdivisions collide
 *   this way.
 * - **Omitting the county collides across counties.** Six different Washington
 *   townships, five Franklins. Arizona's Fort Apache CCD spans three counties
 *   as three separate records.
 *
 * So the identifier carries both: `state:nj/county:morris/place:rockaway_township`.
 *
 * **This does not match the canonical list everywhere, and that is unresolved.**
 * `opencivicdata/ocd-division-ids` nests New Jersey under county but lists New
 * Hampshire towns flat (`state:nh/place:newbury`), and it appears to omit New
 * Jersey's townships entirely — `county:morris/place:rockaway` is present, the
 * township is not. Reconciling is tracker **D15**; until then treat a match
 * here as "same shape on the map", never as "same division as the state's own
 * records", and do not join an officeholder onto one.
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

  // `NAMELSADCO` arrives as "Morris County" / "Merrimack County"; the canonical
  // vocabulary drops the suffix, matching countyIdentity above.
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
