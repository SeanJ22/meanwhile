/**
 * **WHERE A LINK GOES, WHEN WE DID NOT RECORD WHO PUBLISHED IT.**
 *
 * Mechanical: it reads a URL that is already on screen and says what host it
 * points at. It makes no claim about who published the page, which is precisely
 * the claim a phrase like "the record" makes for free — a link labelled that
 * way reads as an attributed source and is not one. The render-default sweep
 * caught exactly that on the ballot Ask panel.
 *
 * Shared by both Ask surfaces rather than copied into each (RULING 103): two
 * copies of a render default are two places for it to drift back into a claim.
 */
export function hostOf(url: string | null | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

/**
 * **ONE LINE PER PUBLISHER, NOT ONE PER DOCUMENT.**
 * (Found by reading the panel, 2026-08-28.)
 *
 * The source line deduplicated by URL, which is correct for the URL and wrong
 * for the reader: an answer resting on six executive orders carries six
 * distinct PDF links from ONE office, so the line read
 *
 *   Sources: … Office of the Arizona Governor, Office of the Arizona Governor,
 *   Office of the Arizona Governor, Office of the Arizona Governor, …
 *
 * seven times over. Nothing about it was false and all of it was unreadable,
 * and an attribution nobody can read is an attribution that stops working.
 *
 * So the LABEL is the key — the publisher where we recorded one, the host
 * otherwise — and the first document from each publisher carries the link. The
 * count of documents is not lost: it is the evidence list above, which renders
 * every record.
 */
export function sourceLinks<T extends { sourceUrl?: string | null; sourceOrg?: string | null }>(
  records: readonly T[],
): { label: string; url: string }[] {
  const byLabel = new Map<string, { label: string; url: string }>();
  for (const record of records) {
    if (!record.sourceUrl) continue;
    const label = record.sourceOrg ?? hostOf(record.sourceUrl);
    if (!label || byLabel.has(label)) continue;
    byLabel.set(label, { label, url: record.sourceUrl });
  }
  return [...byLabel.values()];
}
