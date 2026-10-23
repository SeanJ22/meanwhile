import { stateOcdIdFrom } from "../ocd/state-division.ts";
export { stateOcdIdFrom } from "../ocd/state-division.ts";
import type { Provenance } from "../sources/types.ts";

import { campaignSiteFor } from "./campaign-sites.ts";
import { socialAccountsOf } from "./social-platforms.ts";
import { personIdentityKeys } from "./people-identity.ts";
import { executiveCardProfile } from "./national-executive.ts";
import type {
  Officeholder,
  OfficeholderSet,
  SocialAccount,
} from "./types.ts";

export interface SeatHolder {
  fieldSources?: Record<string, Provenance>;
  id: string;
  personId?: string;
  nativeIds?: Officeholder["nativeIds"];
  memberships?: Officeholder["memberships"];
  selectionMethod?: Officeholder["selectionMethod"];
  selectionMethodSourceUrl?: string;
  name: string;
  officeTitle: string;

  officeJurisdictionOcdId?: string | null;

  partyLabel: string | null;

  termEnd: string | null;

  termStart?: string | null;

  termNote?: string | null;

  birthDate: string | null;
  websiteUrl: string | null;

  sourceUrl: string | null;

  provenance: Provenance | null;

  email: string | null;
  phone: string | null;

  contactScope?: "SHARED_OFFICE" | "INDIVIDUAL_OFFICE";
  contactFormUrl: string | null;

  photoUrl: string | null;

  campaignUrl: string | null;

  social?: readonly SocialAccount[];
  executive?: Officeholder["executive"];

  state?: string;
  chamber?: string;
}

export type OfficeholderIndex = Map<string, SeatHolder[]>;

export function seatHolderForMembership(holder: SeatHolder, membershipId?: string): SeatHolder | null {
  const membership = membershipId ? holder.memberships?.find(row=>row.id === membershipId && row.current !== false) : undefined;
  if (!membership) return membershipId ? null : holder;
  return {...holder,officeTitle:membership.officeTitle ?? holder.officeTitle,
    selectionMethod:membership.selectionMethod ?? holder.selectionMethod,
    selectionMethodSourceUrl:membership.selectionMethodSourceUrl ?? holder.selectionMethodSourceUrl,
    officeJurisdictionOcdId:membership.divisionId ?? holder.officeJurisdictionOcdId,
    chamber:membership.chamber,termStart:membership.termStart ?? null,termEnd:membership.termEnd ?? null,
    sourceUrl:membership.sourceUrl};
}

export function indexByOfficeholderId(sets: readonly OfficeholderSet[], photos?: PhotoIndex): Map<string, SeatHolder> {
  const out = new Map<string, SeatHolder>();
  for (const set of sets) for (const person of set.officeholders) {
    const holder = toSeatHolder(person, photos);
    for (const id of personIdentityKeys(person)) if (!out.has(id)) out.set(id,holder);
  }
  return out;
}

export type PhotoIndex = Map<string, string>;

function toSeatHolder(person: Officeholder, photos?: PhotoIndex): SeatHolder {
  return {
    id: person.id,
    personId: person.personId ?? person.id,
    nativeIds: person.nativeIds,
    memberships: person.memberships,
    selectionMethod: person.selectionMethod,
    selectionMethodSourceUrl: person.selectionMethodSourceUrl,
    fieldSources: person.photo ? { ...person.fieldSources, photoUrl: person.fieldSources?.photoUrl ?? {
      sourceUrl: person.photo.sourceUrl, sourceOrg: [person.provenance.sourceOrg, person.photo.attribution, person.photo.license].filter(Boolean).join(" · "),
      collectedAt: person.photo.collectedAt, verifiedAt: person.photo.verification?.checkedAt ?? null,
    } } : person.fieldSources ? { ...person.fieldSources } : undefined,
    name: person.name,
    officeTitle: person.officeTitle,
    partyLabel: person.partyLabel,
    termEnd: person.termEnd || null,
    termStart: person.termStart || null,
    termNote: person.executive?.termEndDescription?.text ?? null,
    birthDate: person.birthDate ?? null,
    websiteUrl: person.websiteUrl,
    sourceUrl: person.provenance.sourceUrl,
    provenance: person.provenance,
    email: person.email,
    phone: person.phone,
    contactFormUrl: person.contactFormUrl,
    photoUrl: person.photo?.url ?? photos?.get(person.personId ?? person.id) ?? photos?.get(person.id) ?? null,
    campaignUrl: person.campaignUrl ?? campaignSiteFor(person.id)?.url ?? null,
    social: person.social === undefined ? undefined : socialAccountsOf(person.social),
    executive: executiveCardProfile(person.executive),
    state: person.state,
    chamber: person.chamber,
  };
}

export function indexByDivision(
  sets: OfficeholderSet[],
  photos?: PhotoIndex,
): OfficeholderIndex {
  const index: OfficeholderIndex = new Map();

  for (const set of sets) {
    const byId = new Map(set.officeholders.map((o) => [o.id, o]));

    for (const link of set.divisions) {
      const person = byId.get(link.officeholderId);
      if (!person) continue;
      const holder = seatHolderForMembership(toSeatHolder(person, photos), link.membershipId);
      if (!holder) continue;

      const existing = index.get(link.ocdId);
      if (existing) existing.push(holder);
      else index.set(link.ocdId, [holder]);
    }
  }
  for (const holders of index.values()) {
    holders.sort((a, b) => a.name.localeCompare(b.name));
  }

  return index;
}

export function holdersFor(
  index: OfficeholderIndex,
  ocdId: string,
): SeatHolder[] {
  return index.get(ocdId) ?? [];
}

export function senatorsFor(
  index: OfficeholderIndex,
  ocdIds: string[],
): SeatHolder[] {
  const states = new Set<string>();
  for (const ocdId of ocdIds) {
    const state = stateOcdIdFrom(ocdId);
    if (state) states.add(state);
  }

  const seen = new Set<string>();
  const holders: SeatHolder[] = [];
  for (const state of states) {
    for (const holder of holdersFor(index, state)) {
      if (holder.officeTitle !== "U.S. Senator") continue;
      if (seen.has(holder.id)) continue;
      seen.add(holder.id);
      holders.push(holder);
    }
  }

  return holders.sort((a, b) => a.name.localeCompare(b.name));
}
