/**
 * **THE SOURCES ONE REGISTRY MEMBER CITES.** One rule, read by the registry's
 * promotion (every cited URL must be receipted) and by the data plane's
 * inherited-authority check (a changed or new member must cite only reviewed
 * sources), so the two can never disagree about what a member claims.
 *
 * Keyed as the plane's change accounting keys registry members
 * (`civicRecordsFor("REGISTRY_RUNTIME_BINDING", …)`): `division:`, `body:`,
 * `statewide-executive:`, `official-candidacy:`,
 * `official-photo:`. A member cites its named source fields only; a body's
 * homepage or a portrait's image address is a fact it states, not a source it
 * cites. Roster portraits cite nothing of their own.
 *
 * A leaf: it imports nothing, so the plane may read it without a cycle.
 */
const text = (value: unknown): value is string => typeof value === "string";
const row = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function registryMemberCitedUrls(key: string, record: unknown): string[] {
  const member = row(record);
  const kind = key.slice(0, key.indexOf(":"));
  const cited: unknown[] =
    kind === "division" || kind === "body" ? [row(member.provenance).sourceUrl]
      : kind === "statewide-executive" ? [member.sourceUrl, member.partySourceUrl]
      : kind === "official-candidacy" ? [row(member.candidacy).sourceUrl]
      : kind === "official-photo" ? [member.sourceUrl]
      : [];
  return [...new Set(cited.filter((url): url is string => text(url) && /^https:\/\//.test(url)))].sort();
}
