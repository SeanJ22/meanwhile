/**
 * CA-03 · A term date is published only when the page itself writes it.
 *
 * A reader hands the publisher an ISO date (`2028-12-31`, or `2028-12` when the
 * page names only a month). The date is verified when the saved page's visible
 * text carries that same date in one of the forms a government writes it.
 * Nothing is computed from an election cycle or parsed out of prose.
 */

const LONG = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

export function isoTermDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  if (match[3] !== undefined) {
    const day = Number(match[3]);
    if (day < 1 || day > new Date(Date.UTC(Number(match[1]), month, 0)).getUTCDate()) return null;
  }
  return value.trim();
}

/** The visible, lower-cased page text (see `pageWords`) carries this ISO date in a written form. */
export function isoTermDateOnPage(iso: string, words: string): boolean {
  const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(iso);
  if (!match) return false;
  const year = match[1], month = Number(match[2]), day = match[3] === undefined ? null : Number(match[3]);
  const name = LONG[month - 1], abbr = name.slice(0, 3);
  const names = `(?:${name}|${abbr}\\.?)`;
  const text = words.replace(/,/g, " ").replace(/\s+/g, " ");
  const patterns = day === null
    ? [new RegExp(`\\b${names} ${year}\\b`), new RegExp(`\\b${month}/${year}\\b`), new RegExp(`\\b0?${month}/\\d{1,2}/${year}\\b`)]
    : [
      new RegExp(`\\b${names} 0?${day}(?:st|nd|rd|th)? ${year}\\b`),
      new RegExp(`\\b0?${day}(?:st|nd|rd|th)? ${names} ${year}\\b`),
      new RegExp(`\\b0?${month}/0?${day}/(?:${year}|${year.slice(2)})\\b`),
      new RegExp(`\\b${year}-${match[2]}-${match[3]}\\b`),
    ];
  return patterns.some((pattern) => pattern.test(text));
}
