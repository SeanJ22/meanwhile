import type { OfficeholderSet } from "../officials/types.ts";
import { sourceAcquisitionFailure, isSourceAcquisitionFailure } from "../civic-data/source-acquisition-error.ts";
import { fecText, fecSourceObservedAt, readFecPages, type FecReadPage, type FecRow } from "./fec-api.ts";

export interface FecTarget {
  targetKey: string; displayName: string; state: string; office: "H" | "S";
  district: string | null; route: "roster" | "fec"; knownFecCandidateId: string;
}
export interface FecRegistration {
  candidateId: string; name: string; state: string; office: "H" | "S"; district: string | null;
  electionYear: number; principalCommitteeId: string | null; observedAt: string;
}
export interface FecDiscovery {
  registrations: FecRegistration[]; totals: FecRow[]; route: "api" | "bulk";
}
export interface FecRoster {
  readonly officeholders: readonly Pick<OfficeholderSet["officeholders"][number], "id" | "fecCandidateIds" | "nativeIds">[];
}
export function fecRegistrationLabel(row: { office: "H" | "S"; state: string; district: string | null }): string {
  if (row.office === "H" && row.district === null) return `registered with the FEC for House ${row.state}; district not recorded`;
  return `registered with the FEC for ${row.office === "H" ? "House" : "Senate"} ${row.state}-${row.district ?? "00"}`;
}

/** The directory's native ID is the person join. A name never supplies one. */
export function fecRegistrationTargets(row: FecRegistration, roster?: FecRoster): FecTarget[] {
  const base = { displayName: row.name, state: row.state, office: row.office, district: row.district, knownFecCandidateId: row.candidateId };
  const holders = roster?.officeholders.filter(holder => holder.id.startsWith("congress:") &&
    (holder.fecCandidateIds ?? holder.nativeIds?.fec ?? []).includes(row.candidateId)) ?? [];
  if (holders.length > 1) throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", `FEC_DIRECTORY_ID_AMBIGUOUS:${row.candidateId}`);
  return [{ ...base, targetKey: `fec:${row.candidateId}`, route: "fec" },
    ...holders.map(holder => ({ ...base, targetKey: holder.id, route: "roster" as const }))];
}

export function fecRegistration(row: FecRow, cycle: number, observedAt: string): FecRegistration {
  const id = fecText(row.candidate_id), name = fecText(row.name) ?? "", state = fecText(row.state), office = row.office;
  const district = office === "H" ? fecText(row.district)?.padStart(2, "0") ?? null : null;
  if (!id || !/^[HS]\d[A-Z]{2}\d{5}$/.test(id) || !state || !/^[A-Z]{2}$/.test(state) ||
      (office !== "H" && office !== "S") || id[0] !== office || district !== null && !/^\d{2}$/.test(district) ||
      !Array.isArray(row.election_years) || !row.election_years.includes(cycle)) {
    throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "FEC_REGISTRATION_INVALID");
  }
  return { candidateId: id, name, state, office, district, electionYear: cycle,
    principalCommitteeId: /^C\d{8}$/.test(String(row.principal_committee_id)) ? String(row.principal_committee_id) : null, observedAt };
}

/** Complete source pages define the universe, including registrations with no filed totals. */
export async function discoverFecCandidates(input: {
  cycle: number; read: FecReadPage; observedAt: () => string; bulk: () => Promise<FecDiscovery>;
  onApiFailure?: (detail: string) => void;
}): Promise<FecDiscovery> {
  try {
    const pages = await Promise.allSettled([
      readFecPages(input.read, "/candidates/", { election_year: input.cycle, office: "H" }),
      readFecPages(input.read, "/candidates/", { election_year: input.cycle, office: "S" }),
      readFecPages(input.read, "/candidates/totals/", { election_year: input.cycle, cycle: input.cycle, election_full: false }),
    ]);
    const failure = pages.find(row => row.status === "rejected" && !isSourceAcquisitionFailure(row.reason)) ?? pages.find(row => row.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
    const [house, senate, totals] = pages.map(row => { if (row.status !== "fulfilled") throw new Error("FEC_DISCOVERY_NOT_SETTLED"); return row.value; });
    if (totals.some(row => row.is_election === true || row.election_full === true)) {
      throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "FEC_TWO_YEAR_TOTALS_REQUIRED");
    }
    const registrations = [...house, ...senate].map(row => fecRegistration(row, input.cycle, fecSourceObservedAt(row) ?? input.observedAt()));
    if (new Set(registrations.map(row => row.candidateId)).size !== registrations.length) {
      throw sourceAcquisitionFailure("PUBLISHER_DOCUMENT_INVALID", "FEC_REGISTRATION_DUPLICATE");
    }
    return { registrations, totals, route: "api" };
  } catch (error) {
    if (!isSourceAcquisitionFailure(error)) throw error;
    input.onApiFailure?.(error.message);
    return input.bulk();
  }
}
