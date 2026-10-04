import type { OfficeholderSet } from "../officials/types.ts";
import type { FundingSnapshot } from "./types.ts";

export interface FecTarget {
  targetKey: string; displayName: string; familyName: string | null; givenName: string | null;
  state: string; office: "H" | "S"; district: string | null; route: "roster" | "ballot" | "fec";
  bioguide: string | null; knownFecCandidateId: string | null; knownPrincipalCommitteeId: string | null;
}
export interface FecDistrict { readonly state: string; readonly district: string }
export interface FecSearchScope { readonly state: string; readonly district: string | null; readonly office?: "H" | "S" }
export interface FecSearchCandidate {
  readonly candidate_id: string; readonly name?: string; readonly state?: string; readonly office?: string;
  readonly district?: string; readonly principal_committees?: readonly { readonly committee_id?: string }[];
}

/** Every promoted member enters, even when no earlier money snapshot knew them. */
export function promotedCongressTargets(roster: OfficeholderSet, prior: FundingSnapshot): FecTarget[] {
  return roster.officeholders.filter(holder => holder.level === "FEDERAL" && holder.id.startsWith("congress:")).map(holder => {
    const links = roster.divisions.filter(row => row.officeholderId === holder.id);
    const house = links.find(row => /\/cd:[^/]+$/.test(row.ocdId));
    const state = holder.state ?? /\/state:([a-z]{2})/.exec(links[0]?.ocdId ?? "")?.[1]?.toUpperCase();
    const office = house ? "H" : /senat/i.test(holder.officeTitle) ? "S" : null;
    if (!state || !office) throw new Error(`FEC_PROMOTED_MEMBER_SCOPE_UNRESOLVED:${holder.id}`);
    const districtValue = house ? /\/cd:([^/]+)$/.exec(house.ocdId)![1] : null;
    const district = districtValue === "at-large" ? "00" : districtValue?.padStart(2, "0") ?? null;
    const held = prior.candidates.find(row => row.targetKeys.includes(holder.id) && row.office === office && row.state === state && row.district === district);
    const tokens = holder.name.trim().split(/\s+/).filter(word => !/^(?:Jr\.?|Sr\.?|II|III|IV|V)$/i.test(word));
    return { targetKey: holder.id, displayName: holder.name, familyName: tokens.at(-1) ?? holder.name, givenName: tokens[0] ?? null,
      state, office, district, route: "roster", bioguide: holder.id.slice("congress:".length),
      knownFecCandidateId: held?.fecCandidateId ?? null, knownPrincipalCommitteeId: held?.principalCommitteeId ?? null };
  });
}

/** Financial filers are financial identities. This function creates no ballot contest or candidacy. */
export function fecDistrictTargets(scope: FecSearchScope, candidates: readonly FecSearchCandidate[]): FecTarget[] {
  const seen = new Set<string>();
  const office = scope.office ?? "H";
  return candidates.map(row => {
    if (!new RegExp(`^${office}[A-Z0-9]{8}$`).test(row.candidate_id) || !row.name?.trim() || row.office !== office || row.state !== scope.state ||
      (office === "H" && (row.district ?? "").padStart(2, "0") !== scope.district) || seen.has(row.candidate_id)) throw new Error("FEC_DISTRICT_SEARCH_IDENTITY_INVALID");
    seen.add(row.candidate_id);
    return { targetKey: `fec:${row.candidate_id}`, displayName: row.name, familyName: null, givenName: null,
      state: scope.state, district: scope.district, office, route: "fec", bioguide: null,
      knownFecCandidateId: row.candidate_id, knownPrincipalCommitteeId: row.principal_committees?.[0]?.committee_id ?? null };
  });
}
