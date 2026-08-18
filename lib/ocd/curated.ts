import type { OcdId } from "../sources/types.ts";

/**
 * Identifiers for governments the Census does not enumerate — tracker **D31**,
 * settled 2026-08-17 (g10) on evidence rather than by preference.
 *
 * ## The question
 *
 * Community college districts, flood control districts, library districts,
 * stadium districts, water improvement districts, authorities and joint
 * bodies are real governments with elected or appointed boards and published
 * meetings. Census publishes no boundary for them, so `lib/registry/derive.ts`
 * cannot produce them and they arrive with `ocdId: null`. ~39,555 special
 * districts nationally inherit whatever is decided here, so the row required
 * the decision be made once, with national evidence, and never ad hoc by an
 * adapter.
 *
 * ## What opencivicdata's own list actually does
 *
 * Read 2026-08-17 from `identifiers/country-us.csv`, 194,977 identifiers.
 *
 * **There IS a convention, and it is consistent.** A special district gets a
 * segment named for its FUNCTION, nested under the county that contains it
 * (or under the state where it spans counties), slugged from the district's
 * own name:
 *
 *     ocd-division/country:us/state:ca/county:los_angeles/water:castaic_lake_water_agency
 *     ocd-division/country:us/state:nc/county:carteret/sanitation:harkers_island
 *     ocd-division/country:us/state:mn/county:hennepin/park_district:1
 *     ocd-division/country:us/state:il/sewer:mwrd
 *
 * Six such segment types exist — `water`, `sanitation`, `sewer`,
 * `park_district`, `health_care`, `transit` — across **51 identifiers in the
 * whole country**. There is no `community_college` segment anywhere in the
 * file; the only appearances of the phrase are two Maricopa entries slugged
 * as `school_district:` for a DBA, not a modelled government.
 *
 * **And it carries none of the governments this repo needs.** Arizona's
 * segment types, in full: `country`, `state`, `cd`, `county`,
 * `council_district`, `precinct`, `school_district`, `court_of_appeals`,
 * `place`, `ward`, `sldl`, `sldu`. Not one of the seven special districts the
 * D19 attribution pass found sitting inside Pima County's own agendas — Flood
 * Control, Library, Improvement, Stadium, Rocking K South CFD, Wildflower CFD,
 * Ajo Domestic Water ID — appears in it. Neither does Pima Community College.
 *
 * ## The decision
 *
 * **Adopt the SHAPE. Mint in our OWN namespace.**
 *
 * The shape is opencivicdata's and is followed exactly — function segment,
 * nested under the containing division, slug from the government's published
 * name — so that if these identifiers are ever contributed upstream, or the
 * upstream list grows to cover them, the two agree by construction and the
 * reconciliation in `scripts/build-registry.ts` closes them the way it closed
 * D24's.
 *
 * The NAMESPACE is ours, and that is the whole point. Writing
 * `ocd-division/country:us/state:az/county:pima/water:ajo_domestic_water_improvement_district`
 * would assert a canonical identifier that opencivicdata does not carry — a
 * minted id wearing a public vocabulary's clothes, indistinguishable from a
 * real one to anything downstream. That is the same failure as a fabricated
 * agenda URL, one layer more abstract. So a curated identifier says what it is
 * in its first eight characters:
 *
 *     curated:ocd-division/country:us/state:az/county:pima/water:ajo_domestic_water_improvement_district
 *
 * Everything after the prefix is a well-formed OCD path. Strip the prefix and
 * you have the identifier we would propose upstream; keep it and nothing can
 * mistake ours for theirs.
 *
 * ## What this does NOT do
 *
 * It mints nothing on its own. A curated id is created only where a
 * government has been READ off its publisher's page — the same standard every
 * curated body row already meets. The seven districts D19 found are recorded
 * as UNRESOLVED with their published agenda headings as evidence, and they
 * stay that way until someone reads their own pages; a heading is proof that
 * a government acted, not a source for its name and boundary.
 */

/** The prefix that says an identifier is ours and not opencivicdata's. */
export const CURATED_PREFIX = "curated:";

/**
 * A division identifier, canonical or curated.
 *
 * Deliberately the same TypeScript type as `OcdId` — a string — because every
 * consumer that stores, indexes or joins on a division key must accept both.
 * The distinction is carried in the VALUE, where it travels with the data,
 * rather than in a type that is erased at runtime and cannot reach a database
 * column or a JSON file.
 */
export type DivisionKey = string;

/** Is this identifier one we minted? */
export function isCurated(id: DivisionKey): boolean {
  return id.startsWith(CURATED_PREFIX);
}

/** The OCD path inside a curated identifier — what we would propose upstream. */
export function proposedOcdId(id: DivisionKey): OcdId | null {
  return isCurated(id) ? id.slice(CURATED_PREFIX.length) : null;
}

/**
 * Reduce a government's published name to a slug, opencivicdata's way.
 *
 * Lowercase, non-alphanumerics to single underscores, trimmed. Matches the
 * observed canonical slugs (`castaic_lake_water_agency`, `harkers_island`) so
 * an identifier minted here is the one that would be proposed upstream.
 */
export function slugFor(publishedName: string): string {
  return publishedName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Mint a curated division identifier.
 *
 * `parent` is the containing division's OCD-ID — the county for a district
 * inside one, the state for a district that spans counties, exactly as the
 * canonical list nests them. `functionSegment` is the function name; prefer
 * one opencivicdata already uses (`water`, `sanitation`, `sewer`,
 * `park_district`, `health_care`, `transit`) so a future contribution needs no
 * renaming, and name a new one after the function rather than after the
 * government when none fits.
 *
 * It throws rather than returning a malformed id: an identifier is a join key,
 * and a silently wrong one is the aliasing failure `CLAUDE.md` requires keyed
 * joins to be checkable against.
 */
export function mintCuratedDivision(
  parent: OcdId,
  functionSegment: string,
  publishedName: string,
): DivisionKey {
  if (!parent.startsWith("ocd-division/")) {
    throw new Error(`curated id needs an OCD parent, received "${parent}"`);
  }
  if (!/^[a-z][a-z0-9_]*$/.test(functionSegment)) {
    throw new Error(`function segment must be lowercase snake_case, received "${functionSegment}"`);
  }
  const slug = slugFor(publishedName);
  if (!slug) throw new Error(`"${publishedName}" reduces to an empty slug`);
  return `${CURATED_PREFIX}${parent}/${functionSegment}:${slug}`;
}

/**
 * The key a venue-cache row and a meetings row are stored under (D31's second
 * named consequence).
 *
 * The venue cache used to key on `(sourceId, bodyOcdId, rawLocation)` with
 * `bodyOcdId` NULL for a division-less body, which degrades the key to
 * `(sourceId, rawLocation)` — and collides the day two division-less bodies
 * share a source and a location string. Diligent already serves three
 * tenants, one of them division-less, so that day was coming.
 *
 * A division-less body now carries a curated key instead of a null, so the
 * key never degrades. `null` is still accepted and still means "no division
 * and none minted yet"; it is the value this function turns into something
 * that cannot silently collide, using the body's own id, which is unique by
 * construction.
 */
export function divisionKeyFor(body: {
  id: string;
  ocdId: OcdId | null;
}): DivisionKey {
  return body.ocdId ?? `${CURATED_PREFIX}body/${body.id}`;
}
