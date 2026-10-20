/** Stable identity for a derived source; no source records are needed to name its task. */
export function derivedRequestedUrl(sourceId: string, scope: string): string {
  return `derived:${sourceId}:${scope}`;
}
