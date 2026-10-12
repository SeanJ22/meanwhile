import type { OcdId } from "../sources/types.ts";

/**
 * Identifiers for governments the Census does not enumerate: opencivicdata's shape (function segment nested under the
 * containing division, slugged from the published name) in our own `curated:` namespace, so a minted id is never
 * mistaken for a canonical one. A curated id is minted only for a government read off its publisher's page.
 */

/** The prefix that says an identifier is ours and not opencivicdata's. */
export const CURATED_PREFIX = "curated:";

/** A division identifier, canonical or curated: the same string type, the distinction carried in the value. */
export type DivisionKey = string;

/** Is this identifier one we minted? */
export function isCurated(id: DivisionKey): boolean {
  return id.startsWith(CURATED_PREFIX);
}

/** The OCD path inside a curated identifier — what we would propose upstream. */
export function proposedOcdId(id: DivisionKey): OcdId | null {
  return isCurated(id) ? id.slice(CURATED_PREFIX.length) : null;
}

/** A government's published name as an opencivicdata slug: lowercase, non-alphanumerics to single underscores, trimmed. */
export function slugFor(publishedName: string): string {
  return publishedName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Mint a curated division identifier under `parent` (the containing county, or the state for a district spanning
 * counties). Throws rather than returning a malformed id.
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

/** The key a venue-cache row and a meetings row are stored under; a division-less body keys on a curated id from its own unique id. */
export function divisionKeyFor(body: {
  id: string;
  ocdId: OcdId | null;
}): DivisionKey {
  return body.ocdId ?? `${CURATED_PREFIX}body/${body.id}`;
}
