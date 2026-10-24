import type { SeatHolder } from "../officials/lookup.ts";
import type { Provenance } from "../sources/types.ts";
import { isOfficialSource } from "../civic-data/source-authority.ts";
import { nativePersonIdFromUrl, personIdentityKeys } from "../officials/people-identity.ts";
import { officeIdentity } from "../officials/office-identity.ts";

export interface BallotPersonHolder extends SeatHolder {
  readonly personAliases: readonly string[];
  readonly sourceHolders: readonly SeatHolder[];
}

const fields = ["photoUrl", "email", "phone", "contactFormUrl", "websiteUrl", "campaignUrl", "termStart", "termEnd",
  "birthDate", "partyLabel", "termNote", "selectionMethod", "selectionMethodSourceUrl", "contactScope", "state", "chamber",
  "officeJurisdictionOcdId"] as const;
const present = (value: unknown) => value !== null && value !== undefined && value !== "";
const fieldSource = (holder: SeatHolder, field: string): Provenance | null => holder.fieldSources?.[field] ?? holder.provenance;
const checkedAt = (holder: SeatHolder, field: string) => Date.parse(fieldSource(holder, field)?.collectedAt ?? "") || 0;
const official = (source: Pick<Provenance, "kind" | "sourceUrl"> | null) => Boolean(source?.kind === "OFFICIAL" || source?.sourceUrl && isOfficialSource(source.sourceUrl));

function withOfficialMemberPage(holder: SeatHolder): SeatHolder {
  if (present(holder.websiteUrl)) return holder;
  const url = [holder.sourceUrl, holder.provenance?.sourceUrl].find(value => value && nativePersonIdFromUrl(value)
    && official({ kind: holder.provenance?.kind, sourceUrl: value }));
  if (!url) return holder;
  const provenance = holder.provenance ? { ...holder.provenance, sourceUrl: url } : null;
  return { ...holder, websiteUrl: url,
    fieldSources: { ...holder.fieldSources, ...(provenance ? { websiteUrl: provenance } : {}) } };
}

function prefers(right: SeatHolder, left: SeatHolder, field: string): boolean {
  const rightOfficial = official(fieldSource(right, field)), leftOfficial = official(fieldSource(left, field));
  return rightOfficial !== leftOfficial ? rightOfficial : checkedAt(right, field) > checkedAt(left, field);
}

function complementary(left: unknown, right: unknown): unknown {
  if (!present(left)) return right;
  if (!present(right)) return left;
  if (Array.isArray(left) && Array.isArray(right)) return [...new Map([...left, ...right].map(value => [JSON.stringify(value), value])).values()];
  if (typeof left === "object" && typeof right === "object" && !Array.isArray(left) && !Array.isArray(right)) {
    const first = left as Record<string, unknown>, other = right as Record<string, unknown>;
    return Object.fromEntries([...new Set([...Object.keys(first), ...Object.keys(other)])].map(key => [key, complementary(first[key], other[key])]));
  }
  return left;
}

/** Combine records already linked to the same candidate by the verified person graph.
 * This function performs no name, office, district or party matching. */
export function mergeBallotPersonHolders(verified: readonly SeatHolder[]): BallotPersonHolder | null {
  const sourceHolders = [...new Map(verified.flatMap(ballotHolderSources).map(holder => [JSON.stringify(holder), holder])).values()];
  if (!sourceHolders.length) return null;
  const holders = sourceHolders.map(withOfficialMemberPage);
  // A populated person card supplies the identity; an empty reusable office slot
  // can still contribute a newer field without replacing the rest of that card.
  const ranked = [...holders].sort((left, right) => {
    for (const field of fields) if (present(left[field]) !== present(right[field])) return present(left[field]) ? -1 : 1;
    return left.id.localeCompare(right.id);
  });
  const canonical = ranked[0], fieldSources = { ...canonical.fieldSources };
  const result: SeatHolder = { ...canonical };
  for (const field of fields) {
    const available = ranked.filter(holder => present(holder[field]));
    const selected = available.reduce<SeatHolder | null>((kept, holder) => !kept || prefers(holder, kept, field) ? holder : kept, null);
    if (!selected) continue;
    Object.assign(result, { [field]: selected[field] });
    const source = fieldSource(selected, field);
    if (source) fieldSources[field] = source;
  }
  const nativeIds: Record<string, string[]> = {};
  for (const holder of ranked) for (const [source, ids] of Object.entries(holder.nativeIds ?? {})) {
    nativeIds[source] = [...new Set([...nativeIds[source] ?? [], ...ids])];
  }
  const federal = ["us_senator", "us_representative"].includes(officeIdentity(result.officeTitle, result.officeJurisdictionOcdId ?? undefined) ?? "");
  const congressKeys = [...personIdentityKeys({ ...result, nativeIds })].filter(key => /^congress:[A-Z]\d{6}$/i.test(key));
  const personId = federal && congressKeys.length === 1 ? congressKeys[0] : result.personId ?? result.id;
  const id = federal && congressKeys.length === 1 ? congressKeys[0] : result.id;
  const personAliases = [...new Set([...ranked.flatMap(holder => [holder.id, holder.personId ?? holder.id, ...holder.nativeIds?.reader ?? []]), id, personId])];
  nativeIds.reader = [...new Set([...nativeIds.reader ?? [], ...personAliases])];
  return { ...result, id, personId, fieldSources, nativeIds, personAliases, sourceHolders,
    memberships: complementary(canonical.memberships ?? [], ranked.flatMap(holder => holder.memberships ?? [])) as SeatHolder["memberships"],
    social: complementary(canonical.social ?? [], ranked.flatMap(holder => holder.social ?? [])) as SeatHolder["social"],
    executive: ranked.reduce<SeatHolder["executive"]>((value, holder) => complementary(value, holder.executive) as SeatHolder["executive"], canonical.executive),
  };
}

export function ballotHolderSources(holder: SeatHolder): readonly SeatHolder[] {
  return (holder as Partial<BallotPersonHolder>).sourceHolders ?? [holder];
}
