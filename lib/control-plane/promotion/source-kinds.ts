/** CP-02: source labels and their code defaults. Pure, including in the isolated Validator. */
export const SOURCE_KINDS = ["OFFICIAL", "CAMPAIGN", "FILING", "VOTER_GUIDE", "FORUM", "NEWS", "REFERENCE", "OTHER"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];
export interface SourcePolicy {
  readonly hosts: Readonly<Record<string, SourceKind>>;
  readonly enabled: Readonly<Record<SourceKind, boolean>>;
}
export const DEFAULT_SOURCE_HOSTS: SourcePolicy["hosts"] = {
  "openstates.org": "REFERENCE", "wikipedia.org": "REFERENCE", "ballotpedia.org": "REFERENCE",
  "vote411.org": "VOTER_GUIDE", "votesmart.org": "VOTER_GUIDE",
};
export const DEFAULT_SOURCE_KINDS = Object.fromEntries(SOURCE_KINDS.map(kind => [kind, true])) as Record<SourceKind, boolean>;
export const DEFAULT_SOURCE_POLICY: SourcePolicy = { hosts: DEFAULT_SOURCE_HOSTS, enabled: DEFAULT_SOURCE_KINDS };
export const SOURCE_HOSTS_SETTING = "publication.sourceHosts";
export const SOURCE_KINDS_SETTING = "publication.sourceKinds";
export function sourceHost(url: string): string | null {
  const match = /^https?:\/\/([a-z0-9.-]+)(?::\d+)?(?:[/?#]|$)/i.exec(url);
  return match?.[1].toLowerCase().replace(/^www\./, "") ?? null;
}
export function hostSourceKind(url: string, policy: SourcePolicy = DEFAULT_SOURCE_POLICY): SourceKind {
  const host = sourceHost(url);
  if (!host) return "OTHER";
  // Longest entry wins, so a specific subdomain can have its own kind.
  const entry = Object.entries(policy.hosts).sort(([a], [b]) => b.length - a.length)
    .find(([key]) => host === key || host.endsWith(`.${key}`));
  return entry?.[1] ?? "OTHER";
}
export function validSourceHosts(value: unknown): value is SourcePolicy["hosts"] {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.entries(value).every(([host, kind]) => sourceHost(`https://${host}/`) === host && SOURCE_KINDS.includes(kind as SourceKind));
}
export function validSourceKinds(value: unknown): value is SourcePolicy["enabled"] {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === SOURCE_KINDS.length && SOURCE_KINDS.every(kind => typeof (value as Record<string, unknown>)[kind] === "boolean");
}
