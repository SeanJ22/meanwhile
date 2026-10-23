/** A person's name with one token in it is incomplete, not a value. */
import { readerText } from "../text/reader-names.ts";

/** Trailing generational and credential suffixes. Never a given name. */
const SUFFIX =
  /^(jr|sr|ii|iii|iv|v|vi|phd|ph\.d|md|m\.d|edd|ed\.d|esq|jd|j\.d|dds|d\.d\.s|rn|cpa|usa|usaf|usn|ret)\.?$/i;

/** Leading honorifics and offices. A title is not half a name. */
const HONORIFIC =
  /^(dr|mr|mrs|ms|miss|mx|rev|fr|sr|hon|honorable|sen|senator|rep|representative|gov|governor|mayor|judge|justice|sheriff|supt|superintendent|chief|capt|col|gen|lt|sgt|prof|professor|councilman|councilwoman|councilmember|commissioner|chair|chairman|chairwoman|president|clerk|treasurer|assessor|recorder|selectman|selectwoman)\.?$/i;

/** The name's tokens, with honorifics and suffixes removed. */
export function nameTokens(name: string | null | undefined): string[] {
  if (name === null || name === undefined) return [];
  const tokens = name
    .normalize("NFC")
    .replace(/[‘’']/g, "'")
    .split(/[\s ]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    // Punctuation-only fragments are not tokens.
    .filter((t) => /[\p{L}\p{N}]/u.test(t));

  // Honorifics come off the front and suffixes off the back, nowhere else ("J.D. Smith" keeps its initials).
  let start = 0;
  while (start < tokens.length && HONORIFIC.test(tokens[start].replace(/[.,]+$/, ""))) {
    start += 1;
  }
  let end = tokens.length;
  while (end > start && SUFFIX.test(tokens[end - 1].replace(/[.,]+$/, ""))) {
    end -= 1;
  }
  return tokens.slice(start, end);
}

/** True when this string cannot stand as a person's name; empty counts. */
export function isIncompletePersonName(name: string | null | undefined): boolean {
  if (name === null || name === undefined) return true;
  return nameTokens(name).length < 2;
}

/** The honest line for a name held incompletely; the fragment never renders as the name. */
export const INCOMPLETE_NAME_LINE = "We haven’t recorded this person’s full name yet.";

/** What to render in a name slot: the name, or the named gap. */
export function displayPersonName(name: string | null | undefined): string {
  return isIncompletePersonName(name) ? INCOMPLETE_NAME_LINE : readerText((name as string).trim(), "name");
}

/** The initials that stand in for a missing portrait; a generational suffix is not a surname. */
const NAME_SUFFIX = /^(?:Jr|Sr|II|III|IV|V|VI|Esq|PhD|MD|DDS)\.?,?$/i;

export function personInitials(name: string): string {
  const parts = name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w));
  while (parts.length > 1 && NAME_SUFFIX.test(parts[parts.length - 1])) parts.pop();
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}
