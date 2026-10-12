import REFERENCES from "../../data/reference/geography/tribal-seat-areas.json" with { type: "json" };
import type { Provenance } from "../sources/types.ts";
import type { SeatHolder } from "./lookup.ts";
import type { PersonMembership } from "./types.ts";
import type { CardSource } from "./card-sources.ts";

/** Reference facts describe a seat; absence of a current holder never establishes a vacancy. */
export interface TribalSeatReference {
  readonly state: string;
  readonly stateFips: string;
  readonly chamber: string;
  readonly district: string;
  readonly nation: string;
  readonly aiannhAreaIds: readonly string[];
  readonly aiannhIds?: readonly string[];
  readonly officialRosterUrl: string;
  readonly sourceUrls: readonly string[];
  readonly sourceRecords?: readonly { readonly url: string; readonly org: string; readonly checkedAt?: string; readonly what?: string }[];
  readonly sourceOrg?: string;
  readonly checkedAt?: string;
  readonly status?: { readonly value: "vacant"; readonly sourceUrl: string; readonly checkedAt: string };
}

export const TRIBAL_SEAT_REFERENCES: readonly TribalSeatReference[] = REFERENCES as readonly TribalSeatReference[];

export function tribalSeatReferencesFor(state: string, chamber?: string): readonly TribalSeatReference[] {
  const postal = state.replace(/^US-/i, "").toUpperCase();
  return TRIBAL_SEAT_REFERENCES.filter(row => row.state.toUpperCase() === postal && (!chamber || row.chamber === chamber));
}

export function tribalSeatReferenceFor(state: string, chamber: string, district: string): TribalSeatReference | null {
  return tribalSeatReferencesFor(state, chamber).find(row => row.district === district) ?? null;
}

export function tribalSeatForMembership(membership: PersonMembership): TribalSeatReference | null {
  if (membership.current === false || !membership.chamber || !membership.district) return null;
  return tribalSeatReferenceFor(membership.jurisdiction, membership.chamber, membership.district);
}

export function tribalSeatForHolder(holder: Pick<SeatHolder, "memberships">): TribalSeatReference | null {
  const references = (holder.memberships ?? []).flatMap(membership => {
    const reference = tribalSeatForMembership(membership);
    return reference ? [reference] : [];
  });
  return references.length === 1 ? references[0] : null;
}

export function tribalSeatDescription(nation: string): string {
  return `Tribal representative for the ${nation}. Non-voting member of the House: sponsors bills on tribal matters, co-sponsors any bill, sits with committees and may speak on the floor. Represents the nation's members wherever they live.`;
}

export function tribalSeatSources(reference: TribalSeatReference): Provenance[] {
  const sources = new Map((reference.sourceRecords ?? []).map(row => [row.url, row]));
  for (const url of [...reference.sourceUrls, reference.officialRosterUrl]) {
    if (!sources.has(url)) sources.set(url, {url,org:reference.sourceOrg ?? "State legislature",checkedAt:reference.checkedAt});
  }
  return [...sources.values()].map(source => ({
    sourceUrl: source.url,
    sourceOrg: source.org,
    collectedAt: source.checkedAt ?? "",
    verifiedAt: null,
  }));
}

export function tribalSeatCardSources(reference: TribalSeatReference): CardSource[] {
  return tribalSeatSources(reference).map(provenance => ({
    what: reference.sourceRecords?.find(source => source.url === provenance.sourceUrl)?.what ?? "The tribal seat, role and associated area",
    provenance,
  }));
}

export interface TribalSeatListing {
  readonly reference: TribalSeatReference;
  readonly holders: readonly SeatHolder[];
  readonly vacant: boolean;
}

export function tribalSeatIsVacant(reference: TribalSeatReference): boolean {
  return reference.status?.value === "vacant" && reference.status.sourceUrl === reference.officialRosterUrl
    && /^\d{4}-\d{2}-\d{2}/.test(reference.status.checkedAt);
}

/** Explicit district references join current source memberships, including seats with no geometry or holder. */
export function tribalSeatListingsFor(state: string, holders: readonly SeatHolder[]): TribalSeatListing[] {
  return tribalSeatReferencesFor(state).map(reference => ({
    reference,
    holders: holders.filter(holder => (holder.memberships ?? []).some(membership =>
      tribalSeatForMembership(membership) === reference)),
    vacant: tribalSeatIsVacant(reference),
  }));
}

/** Labels explain why a legislative point has more than one district. */
export function legislativeRepresentationLabel(divisionType: string, representation?: "overlay" | "tribal"): string | null {
  if (representation === "tribal") return "Tribal representative";
  if (representation === "overlay") return "Overlay district";
  return divisionType === "sldl" || divisionType === "sldu" ? "Base district" : null;
}
