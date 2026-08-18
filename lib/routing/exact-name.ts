/**
 * THE EXACT-NAME RUNG (the author's matcher ruling, 2026-08-17).
 *
 * The ruling gives the keyword layer two strong classes and only two:
 * *"multiple distinct keyword hits, or an exact name match (a body, person,
 * district, or destination named as such)."* The first lives in `match.ts`
 * as `STRONG_MATCH_MIN_HITS`. This is the second.
 *
 * ## Why a name is strong at one hit when a keyword is not
 *
 * A keyword is a word a topic happens to use. "election" appears in a
 * question about the weather. A NAME is not like that: a reader who types
 * *Pima County Board of Supervisors* has not used a word that a body happens
 * to share — they have said the body's name, whole, and there is nothing else
 * that string could be asking for. Naming a thing IS the intent to be taken
 * to it, so it routes on one match where a keyword needs two.
 *
 * The strength comes entirely from being EXACT and WHOLE. A name that merely
 * appears inside a longer sentence is not this rung: "when does the Pima
 * County Board of Supervisors meet" is a question about meetings that happens
 * to name a body, and it belongs to the destination and topic layers, which
 * read the whole sentence. So this rung compares the WHOLE input against the
 * WHOLE name and nothing else — a substring is never enough.
 *
 * ## The classes honored, and where each comes from
 *
 * Five, all of them things the product already holds a record for, none of
 * them invented here:
 *
 * | class         | source                                             |
 * |---------------|----------------------------------------------------|
 * | `body`        | the search index's `body` rows (registry bodies)   |
 * | `person`      | the search index's `officeholder` rows             |
 * | `district`    | the search index's `district` rows                 |
 * | `place`       | the search index's `place` rows                    |
 * | `meeting`     | the search index's `meeting` rows                  |
 *
 * The ruling names body, person and district; `place` and `meeting` are the
 * remaining two kinds the same index already carries, and they are named
 * exactly as such by a reader typing them. The fourth class the ruling names
 * — a DESTINATION named as such — is not here: destinations are curated
 * phrases and `destinations.ts` already matches them whole. Two modules, one
 * rule.
 *
 * ## What it refuses
 *
 * Ambiguity, always. Two different rows sharing a normalized name means the
 * reader's string did not say which one, and this rung answers null rather
 * than picking the first — the same tie-or-zero discipline the topic matcher
 * and the destination matcher already run on. Two rows that are the SAME row
 * (the same id) are not a tie.
 *
 * It generates nothing, fetches nothing, and stores nothing. Given the same
 * input and the same index it returns the same answer, which is what lets a
 * test state exactly what routes.
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
