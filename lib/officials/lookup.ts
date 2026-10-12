import { isJurisdictionSegment } from "../ocd/fips.ts";
import type { Provenance } from "../sources/types.ts";

import { campaignSiteFor } from "./campaign-sites.ts";
import { socialAccountsOf } from "./social-platforms.ts";
import { personIdentityKeys } from "./people-identity.ts";
import { tribalSeatForMembership } from "./tribal-seats.ts";
import type {
  Officeholder,
  OfficeholderSet,
  SocialAccount,
} from "./types.ts";

/** Turning the officeholder roster into an answer for a point; pure, separate from loading. */

/** What a surface needs to render a person honestly: who they are and where that claim came from. */
export interface SeatHolder {
  representation?: "overlay" | "tribal";
  nation?: string;
  fieldSources?: Record<string, Provenance>;
  id: string;
  personId?: string;
  nativeIds?: Officeholder["nativeIds"];
  memberships?: Officeholder["memberships"];
  name: string;
  officeTitle: string;
  /** The jurisdiction owning this office when the holder came from a body-scoped roster; presentation context only. */
  officeJurisdictionOcdId?: string | null;
  /** Display only. Never used to infer a position or a vote. */
  partyLabel: string | null;
  /** The end of the current term as the source publishes it; never computed from an election cycle. */
  termEnd: string | null;
  /** Where the source states one: the ISO date this term starts. */
  termStart?: string | null;
  /** Verbatim sourced term/appointment wording; never parsed into a term date. */
  termNote?: string | null;
  /** The only basis for an age: a date, so the age is computed at every render. */
  birthDate: string | null;
  websiteUrl: string | null;
  /** Where the record was read from. Rendered, not just stored. */
  sourceUrl: string | null;
  /** The full record behind this row; null only where a row has no publisher on record. */
  provenance: Provenance | null;
  /** Published official contact (3a). Absences are absences. */
  email: string | null;
  phone: string | null;
  /** Distinguishes a shared public office channel from a direct office line. */
  contactScope?: "SHARED_OFFICE" | "INDIVIDUAL_OFFICE";
  /** Earlier verified sources for optional facts retained after an incomplete update. */
  retainedFieldSources?: Partial<Record<"termNote" | "termStart" | "termEnd" | "email" | "phone" | "websiteUrl", { sourceUrl: string; sourceOrg: string; collectedAt: string }>>;
  contactFormUrl: string | null;
  /** Portrait on our origin (3b), from the licensed-photos manifest. */
  photoUrl: string | null;
  /** The campaign or personal site, always labelled as such and never the primary link. */
  campaignUrl: string | null;
  /** Official accounts; sitting federal members only, the source's scope. */
  social?: readonly SocialAccount[];
  /** The state and chamber the member's own current term states; federal only. */
  state?: string;
  chamber?: string;
}

export type OfficeholderIndex = Map<string, SeatHolder[]>;

/** Select a person's exact current office when several native memberships are held. */
export function seatHolderForMembership(holder: SeatHolder, membershipId?: string): SeatHolder | null {
  const membership = membershipId ? holder.memberships?.find(row=>row.id === membershipId && row.current !== false) : undefined;
  if (!membership) return membershipId ? null : holder;
  const tribal = tribalSeatForMembership(membership);
  return {...holder,officeTitle:membership.officeTitle ?? holder.officeTitle,
    representation: membership.representation ?? (tribal ? "tribal" : undefined),
    nation: membership.nation ?? tribal?.nation,
    officeJurisdictionOcdId:membership.divisionId ?? holder.officeJurisdictionOcdId,
    chamber:membership.chamber,termStart:membership.termStart ?? null,termEnd:membership.termEnd ?? null,
    sourceUrl:membership.sourceUrl};
}

/** Person lookup is independent of whether their district geometry is held. */
export function indexByOfficeholderId(sets: readonly OfficeholderSet[], photos?: PhotoIndex): Map<string, SeatHolder> {
  const out = new Map<string, SeatHolder>();
  for (const set of sets) for (const person of set.officeholders) {
    const holder = toSeatHolder(person, photos);
    for (const id of personIdentityKeys(person)) if (!out.has(id)) out.set(id,holder);
  }
  return out;
}

/** officeholderId → path on our origin, from the licensed-photos manifest. */
export type PhotoIndex = Map<string, string>;

function toSeatHolder(person: Officeholder, photos?: PhotoIndex): SeatHolder {
  return {
    id: person.id,
    personId: person.personId ?? person.id,
    nativeIds: person.nativeIds,
    memberships: person.memberships,
    fieldSources: person.fieldSources ? { ...person.fieldSources } : undefined,
    name: person.name,
    officeTitle: person.officeTitle,
    partyLabel: person.partyLabel,
    termEnd: person.termEnd || null,
    termStart: person.termStart || null,
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
    state: person.state,
    chamber: person.chamber,
  };
}

/** Index a roster by the division each person represents; many-to-many in both directions. */
export function indexByDivision(
  sets: OfficeholderSet[],
  photos?: PhotoIndex,
): OfficeholderIndex {
  const index: OfficeholderIndex = new Map();

  for (const set of sets) {
    const byId = new Map(set.officeholders.map((o) => [o.id, o]));

    for (const link of set.divisions) {
      const person = byId.get(link.officeholderId);
      // A link with no matching person is a broken artifact, not something to
      // paper over. Skipping it is right; rendering an empty name is not.
      if (!person) continue;
      const selected = seatHolderForMembership(toSeatHolder(person, photos), link.membershipId);
      const holder = selected ? {...selected, representation: link.representation ?? selected.representation,
        nation: link.nation ?? selected.nation} : null;
      if (!holder) continue;

      const existing = index.get(link.ocdId);
      if (existing) existing.push(holder);
      else index.set(link.ocdId, [holder]);
    }
  }

  // Alphabetical by name: any data-derived order would be an ordering a reader could read meaning into.
  for (const holders of index.values()) {
    holders.sort((a, b) => a.name.localeCompare(b.name));
  }

  return index;
}

/** The state division identifier implied by any division identifier, as its OCD prefix. */
export function stateOcdIdFrom(ocdId: string): string | null {
  const match = /^(ocd-division\/country:us\/(state|district|territory):([a-z]{2}))(\/|$)/.exec(ocdId);
  return match && isJurisdictionSegment(match[2], match[3]) ? match[1] : null;
}

/** Everyone holding a seat for this division. Empty is a real answer. */
export function holdersFor(
  index: OfficeholderIndex,
  ocdId: string,
): SeatHolder[] {
  return index.get(ocdId) ?? [];
}

/** The senators for whichever state these divisions sit in. */
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
      // The sourced office is a minimum fact; optional chamber metadata may be absent.
      if (holder.officeTitle !== "U.S. Senator") continue;
      if (seen.has(holder.id)) continue;
      seen.add(holder.id);
      holders.push(holder);
    }
  }

  return holders.sort((a, b) => a.name.localeCompare(b.name));
}
