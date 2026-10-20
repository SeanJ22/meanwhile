import { resolvedCandidacyForOfficial } from "../funding/campaign-money.ts";
import { personIdentityKeys } from "../officials/people-identity.ts";
import type { SeatHolder } from "../officials/lookup.ts";

/** Join sourced roles through publisher person IDs or the committed candidacy bridge. */
export function canonicalOfficialAliases(ids: readonly string[], preferredIds: readonly string[], holders: readonly SeatHolder[] = []): Map<string, string> {
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const candidacy = resolvedCandidacyForOfficial(id);
    const keys = [...(candidacy ? [`candidacy:${candidacy.candidacyId}`] : []),
      ...holders.filter(holder => holder.id === id).flatMap(holder => [...personIdentityKeys(holder)])];
    const joined = [...new Set([id, ...keys.flatMap(key => groups.get(key) ?? [])])];
    for (const [key, group] of groups) if (group.some(member => joined.includes(member))) groups.set(key, joined);
    for (const key of keys) groups.set(key, joined);
  }
  const aliases = new Map<string, string>();
  for (const [key, group] of groups) {
    const ordered = group.toSorted((a, b) => Number(/^(congress|plural):/.test(b)) - Number(/^(congress|plural):/.test(a)) || a.localeCompare(b));
    const chosen = preferredIds.find((id) => group.includes(id)) ?? ordered[0];
    for (const id of group) aliases.set(id, chosen);
    if (!key.startsWith("candidacy:")) aliases.set(key, chosen);
  }
  return aliases;
}
