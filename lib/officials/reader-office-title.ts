/** Office titles that arrive run together are spelled the way a reader spells them, the same way everywhere. */

/**
 * Reader spellings for titles that arrive run together. Keyed on the exact
 * filed string, lower-cased, so a roster that shouts it still matches.
 */
const READER_SPELLING = new Map<string, string>([
  ["assemblymember", "Assembly member"],
  ["councilmember", "Council member"],
]);

/** The title as a reader should see it; anything unrecognised is returned verbatim. */
export function readerOfficeTitle(title: string | null | undefined): string {
  if (!title) return "";
  const trimmed = title.trim();
  const mapped = READER_SPELLING.get(trimmed.toLowerCase());
  if (mapped) return mapped;

  // A qualifier after the office (`Ward 3`, `, District 25`) is carried through untouched.
  const [, head, rest] = trimmed.match(/^([A-Za-z]+)([\s,].*)$/) ?? [];
  if (head) {
    const mappedHead = READER_SPELLING.get(head.toLowerCase());
    if (mappedHead) return `${mappedHead}${rest}`;
  }
  return trimmed;
}
