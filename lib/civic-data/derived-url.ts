export function derivedRequestedUrl(sourceId: string, scope: string): string {
  return `derived:${sourceId}:${scope}`;
}
