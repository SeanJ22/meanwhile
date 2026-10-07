/**
 * The exact-name rung: one of the keyword layer's two strong classes (the other is
 * `STRONG_MATCH_MIN_HITS` in `match.ts`). A reader who types a body's whole name has said what they
 * want, so it routes on one match. The strength comes from being exact and whole: the whole input is
 * compared against the whole name, never a substring.
 *
 * | class         | source                                             |
 * |---------------|----------------------------------------------------|
 * | `body`        | the search index's `body` rows (registry bodies)   |
 * | `person`      | the search index's `officeholder` rows             |
 * | `district`    | the search index's `district` rows                 |
 * | `place`       | the search index's `place` rows                    |
 * | `meeting`     | the search index's `meeting` rows                  |
 *
 * Destinations named as such are matched whole in `destinations.ts`. Two different rows sharing a
 * normalized name refuse (null); the same row twice is not a tie. Pure and deterministic.
 */

/** The kinds of thing a reader can name outright. Closed on purpose. */
export type ExactNameClass =
  | "body"
  | "person"
  | "district"
  | "place"
  | "meeting";

/**
 * One nameable thing, reduced to what this rung needs. Deliberately not the
 * search index's own type: this module is pure and the caller adapts, so the
 * rule can be tested without building an index.
 */
export interface NameableEntity {
  id: string;
  name: string;
  nameClass: ExactNameClass;
}

export interface ExactNameMatch {
  entity: NameableEntity;
  /** The reader's own string, normalized — the mechanical evidence. */
  matchedOn: string;
}

/**
 * The shortest normalized name this rung will honor.
 *
 * A one- or two-character "name" is not a name a reader typed on purpose; it
 * is a fragment mid-typing, and letting it route would make the input jump
 * away while someone is still writing. Three is the floor.
 */
export const MIN_EXACT_NAME_CHARS = 3;

/**
 * Normalize for comparison only. Case, accents, punctuation and runs of
 * whitespace are noise in a typed name; a leading article is too, because
 * "the Planning Commission" and "Planning Commission" are the same body and
 * a reader should not have to guess which one we recorded.
 */
export function normalizeName(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^the /, "")
    .trim();
}

/**
 * The entity the reader named, or null.
 *
 * Null is the common answer and the correct one: almost everything typed into
 * the box is a question, not a name, and a question falls through to the
 * layers built to read questions.
 */
export function matchExactName(
  text: string,
  entities: readonly NameableEntity[],
): ExactNameMatch | null {
  const needle = normalizeName(text);
  if (needle.length < MIN_EXACT_NAME_CHARS) return null;

  const hits: NameableEntity[] = [];
  for (const entity of entities) {
    if (normalizeName(entity.name) === needle) hits.push(entity);
  }
  if (hits.length === 0) return null;

  // A tie between DIFFERENT rows refuses. The same row arriving twice (the
  // index can carry a body under more than one venue) is not a tie.
  const distinct = new Set(hits.map((h) => h.id));
  if (distinct.size > 1) return null;

  return { entity: hits[0], matchedOn: needle };
}
