/**
 * The host a URL points at, for a link whose publisher we did not record. A
 * mechanical read that makes no claim about who published it. Shared by both
 * Ask surfaces.
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
 * One source line per publisher, not per document: keyed on the recorded
 * publisher, else the host; the first document from each carries the link. The
 * evidence list still renders every record.
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
