import { resolvedCandidacyForOfficial } from "../funding/campaign-money.ts";

/** Multiple sourced roles belong to one person only through the committed bridge. */
export function canonicalOfficialAliases(ids: readonly string[], preferredIds: readonly string[]): Map<string, string> {
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const candidacy = resolvedCandidacyForOfficial(id);
    if (!candidacy) continue;
    const group = groups.get(candidacy.candidacyId) ?? [];
    if (!group.includes(id)) group.push(id);
    groups.set(candidacy.candidacyId, group);
  }
  const aliases = new Map<string, string>();
  for (const group of groups.values()) {
    const ordered = group.toSorted((a, b) => Number(/^(congress|plural):/.test(b)) - Number(/^(congress|plural):/.test(a)) || a.localeCompare(b));
    const chosen = preferredIds.find((id) => group.includes(id)) ?? ordered[0];
    for (const id of group) aliases.set(id, chosen);
  }
  return aliases;
}
