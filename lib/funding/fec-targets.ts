import type { OfficeholderSet } from "../officials/types.ts";
import type { FundingSnapshot } from "./types.ts";

export interface FecTarget {
  targetKey: string; displayName: string;
  state: string; office: "H" | "S"; district: string | null; route: "roster" | "ballot" | "fec";
  knownFecCandidateId: string | null;
  knownFecCandidateIds?: string[];
}
/** Every promoted member enters, even when no earlier money snapshot knew them. */
export function promotedCongressTargets(roster: OfficeholderSet, prior: FundingSnapshot, onUnresolved?: (id: string) => void): FecTarget[] {
  return roster.officeholders.filter(holder => holder.level === "FEDERAL" && holder.id.startsWith("congress:")).flatMap(holder => {
    const links = roster.divisions.filter(row => row.officeholderId === holder.id);
    const house = links.find(row => /\/cd:[^/]+$/.test(row.ocdId));
    const state = holder.state ?? /\/state:([a-z]{2})/.exec(links[0]?.ocdId ?? "")?.[1]?.toUpperCase();
    const office = house ? "H" : /senat/i.test(holder.officeTitle) ? "S" : null;
    if (!state || !office) { onUnresolved?.(holder.id); return []; }
    const districtValue = house ? /\/cd:([^/]+)$/.exec(house.ocdId)![1] : null;
    const district = districtValue === "at-large" ? "00" : districtValue?.padStart(2, "0") ?? null;
    const held = prior.candidates.find(row => row.targetKeys.includes(holder.id) && row.office === office && row.state === state && row.district === district);
    const native = (holder.fecCandidateIds ?? holder.nativeIds?.fec ?? []).filter(id => new RegExp(`^${office}\\d[A-Z]{2}\\d{5}$`).test(id));
    return [{ targetKey: holder.id, displayName: holder.name,
      state, office, district, route: "roster" as const,
      knownFecCandidateId: native.includes(held?.fecCandidateId ?? "") ? held!.fecCandidateId : native.length === 1 ? native[0] : held?.fecCandidateId ?? null,
      knownFecCandidateIds: native.length ? [...new Set(native)] : held ? [held.fecCandidateId] : [],
    }];
  });
}
