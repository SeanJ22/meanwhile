import { holdersFor, stateOcdIdFrom, seatHolderForMembership, type OfficeholderIndex, type SeatHolder } from "../officials/lookup.ts";
import { scopedHolders } from "../officials/scoped-holders.ts";
import { statewideExecutivesFor } from "../officials/statewide-executives.ts";
import { statePeopleScopeForDivision, type StatePeopleJurisdiction } from "../officials/people-identity.ts";
import type { heldOfficialStateLegislatorsFromRead } from "../state-rollcalls/legislators.ts";
import { governingRosterHoldersForDivision } from "./body-rosters.ts";

/** Exact divisions to which the production federal roster can contribute. */
export function federalDirectoryAppliesToDivision(ocdId: string): boolean {
  return ocdId === "ocd-division/country:us"
    || /^ocd-division\/country:us\/(?:state|district|territory):[a-z]{2}$/.test(ocdId)
    || /\/cd:[^/]+$/.test(ocdId);
}

/** The division question only. Body membership always resolves by the body's own identity. */
export function heldDivisionRepresentatives(ocdId: string, additional: readonly SeatHolder[] = []): SeatHolder[] {
  const primary = stateOcdIdFrom(ocdId) === ocdId ? statewideExecutivesFor([ocdId])
    : !/\/(?:sld[lu]|cd):[^/]+$/.test(ocdId) && !federalDirectoryAppliesToDivision(ocdId)
      ? governingRosterHoldersForDivision(ocdId) : [];
  return scopedHolders(primary, additional);
}

interface DivisionReaders {
  statePeople(scope: StatePeopleJurisdiction): Promise<ReturnType<typeof heldOfficialStateLegislatorsFromRead> | null>;
  federal(): Promise<OfficeholderIndex>;
  registry(): Promise<void>;
}

/** Read independent authorities for this exact division, retaining each current membership and official precedence. */
export async function readDivisionRepresentatives(ocdId: string, readers: DivisionReaders): Promise<SeatHolder[]> {
  const stateScope = /\/cd:[^/]+$/.test(ocdId) ? null : statePeopleScopeForDivision(ocdId);
  const reads: { official: boolean; read: Promise<SeatHolder[]> }[] = [];
  if (stateScope) reads.push({ official: false, read: readers.statePeople(stateScope).then(held => {
    if (!held) return [];
    const byId = new Map(held.seats.map(holder => [holder.id, holder]));
    return held.divisions.filter(row => row.ocdId === ocdId).flatMap(link => {
      const holder = byId.get(link.officeholderId);
      const selected = holder ? seatHolderForMembership(holder, link.membershipId) : null;
      return selected ? [selected] : [];
    });
  }) });
  if (federalDirectoryAppliesToDivision(ocdId)) reads.push({ official: false,
    read: readers.federal().then(officials => holdersFor(officials, ocdId)) });
  if (stateOcdIdFrom(ocdId) === ocdId || !/\/(?:sld[lu]|cd):[^/]+$/.test(ocdId) && !federalDirectoryAppliesToDivision(ocdId)) {
    reads.push({ official: true, read: readers.registry().then(() => heldDivisionRepresentatives(ocdId)) });
  }
  const settled = await Promise.allSettled(reads.map(row => row.read));
  const primary = settled.flatMap((read, index) => read.status === "fulfilled" && reads[index].official ? read.value : []);
  const additional = settled.flatMap((read, index) => read.status === "fulfilled" && !reads[index].official ? read.value : []);
  const holders = scopedHolders(primary, additional);
  const failed = settled.find(read => read.status === "rejected");
  if (!holders.length && failed?.status === "rejected") throw failed.reason;
  return holders;
}
