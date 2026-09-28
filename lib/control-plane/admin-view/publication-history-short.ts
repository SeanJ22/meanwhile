/** A saved literal of at most 100 UTF-16 units fits inside every indexed overlap. */
export function publicationHistoryShortGrams(query: string): readonly string[] {
  const characters = Array.from(query);
  if (characters.length === 0) return [];
  if (characters.length === 1) return [characters[0]!];
  const first = characters[0]! + characters[1]!;
  const last = characters.at(-2)! + characters.at(-1)!;
  return first === last ? [first] : [first, last];
}

/** PostgreSQL ILIKE uses backslash as its default escape character. */
export function publicationHistoryExactGramPattern(gram: string): string {
  return gram.replace(/[\\%_]/g, character => `\\${character}`);
}

/** This changes only the candidate index; both paths still run exact ILIKE. */
export function publicationHistoryNeedsShortIndex(query: string): boolean {
  return !/[\p{L}\p{N}]{3}/u.test(query);
}
