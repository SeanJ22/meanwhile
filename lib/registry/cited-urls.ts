const text = (value: unknown): value is string => typeof value === "string";
const row = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const rows = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

export function registryMemberCitedUrls(key: string, record: unknown): string[] {
  const member = row(record);
  const kind = key.slice(0, key.indexOf(":"));
  const cited: unknown[] =
    kind === "division" || kind === "body" ? [row(member.provenance).sourceUrl]
      : kind === "statewide-executive" ? [member.sourceUrl, member.partySourceUrl]
      : kind === "official-candidacy" ? [row(member.candidacy).sourceUrl, ...rows(member.ballotSourceUrls)]
      : kind === "official-photo" ? [member.sourceUrl]
      : [];
  return [...new Set(cited.filter((url): url is string => text(url) && /^https:\/\//.test(url)))].sort();
}
