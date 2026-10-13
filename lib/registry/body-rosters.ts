/**
 * Who sits on each body, as readers see it: composed from live facts
 * (`lib/facts/roster-read.ts`). A body with no roster renders an explicit absence.
 */

import type { Provenance } from "../sources/types.ts";

import { getRegistryRuntimeReadModel } from "./runtime-read-model.ts";

export interface RosterMember {
  fieldSources?: Record<string, Provenance>;
  /** An unresolved update must retain an older member on its actual source/date. */
  membershipSource?: { sourceUrl: string; sourceOrg: string; collectedAt: string };
  /** Optional facts kept from an earlier verified read when this update omits them. */
  retainedFieldSources?: Partial<Record<"termNote" | "termStart" | "termEnd" | "email" | "phone" | "websiteUrl", { sourceUrl: string; sourceOrg: string; collectedAt: string }>>;
  /** A shared public office line is not a person's private contact route. */
  contactKind?: "PUBLIC_OFFICE" | "PERSONAL";
  contactScope?: "SHARED_OFFICE" | "INDIVIDUAL_OFFICE";
  /** Stable within the roster: `roster:<bodyId>#<n>`. */
  id: string;
  personId?: string;
  sourceRecordId?: string;
  nativeIds?: Readonly<Record<string, readonly string[]>>;
  officeId?: string;
  name: string;
  /** The published role — "Mayor", "Ward 3 Council Member", "Chair". */
  officeTitle: string;
  /** The body's own wording for the term, where it states one. */
  termNote: string | null;
  /** ISO dates (`YYYY-MM-DD`, or `YYYY-MM`) the member's term starts and ends, only where the page writes them. */
  termStart?: string | null;
  termEnd?: string | null;
  email: string | null;
  phone: string | null;
  /** The member's own official page, where the body publishes one. */
  websiteUrl: string | null;
  /**
   * The member's party, exactly as a government record states it; never
   * inferred. Null means either a nonpartisan office or an unsourced party on
   * a partisan one — the roster's `partisanship` says which.
   */
  partyLabel?: string | null;
  /** The government record the party was read from. Required with it. */
  partySourceUrl?: string;
  /** Who published that record — an election authority, never a party. */
  partySourceOrg?: string;
  /** The day the record was read. Distinct from the roster's `collectedAt`. */
  partyCollectedAt?: string;
}

/**
 * Whether a body's seats are contested on party lines. Recorded per body, not
 * assumed per state, so an unsourced partisan office is distinguishable from a
 * nonpartisan one.
 */
export type Partisanship =
  /** Elected on party lines; party is a fact about the seat. */
  | "PARTISAN"
  /** No party appears on the ballot for this office. Nothing renders. */
  | "NONPARTISAN"
  /** Not yet established. Nothing renders, and it stays a work item. */
  | "UNDETERMINED";

export interface BodyRoster {
  kind?: import("../control-plane/promotion/source-kinds.ts").SourceKind;
  /** Matches `BodySourceWiring.bodyId` exactly. */
  bodyId: string;
  bodyName: string;
  members: RosterMember[];
  /** The body's own page the roster was read from. */
  sourceUrl: string;
  sourceOrg: string;
  collectedAt: string;
  /**
   * Describes the seats, not the people: a PARTISAN body may still hold a
   * member with no sourced party (e.g. one appointed to fill a vacancy).
   */
  partisanship: Partisanship;
  /** What established `partisanship`. Absent while UNDETERMINED. */
  partisanshipSourceUrl?: string;
}

export interface RosterReaderDisposition {
  sourceId: string;
  canonicalId: string | null;
  state: "READER_ELIGIBLE" | "EXACT_DUPLICATE" | "IDENTITY_UNRESOLVED";
  reason: string;
}

/** The one promoted body-person/contact projection initialized at a request boundary. */
export function currentBodyRosters(): readonly BodyRoster[] {
  return getRegistryRuntimeReadModel().bodyRosters;
}

/** Reader eligibility derived from the normalized promoted roster, never a retired held row. */
export function currentRosterMemberReaderDisposition(id: string): RosterReaderDisposition | null {
  return getRegistryRuntimeReadModel().rosterReaderDispositions.find((row) => row.sourceId === id) ?? null;
}

export interface RosterReaderGap {
  bodyId: string;
  expectedMembers: number;
  verifiedMembers: number;
  unresolvedSlots: number;
  statement: string;
  sourceUrl: string;
  sourceOrg: string;
  readAt: string;
  denominatorSource: string;
}

// Expected seat count. The raw rows included the same mayor twice, so the
// four distinct identities must not be presented as a complete roster.
const ROSTER_MEMBER_DENOMINATORS = [{
  bodyId: "ocd-division/country:us/state:nj/county:morris/place:pequannock_township#governing",
  members: 5,
  source: "data/states/nj/hunt/wikipedia-nj-morris.json: Pequannock Township governingBody.seats, the existing nj:wire completeness input",
}];

export function rosterGapForBody(bodyId: string | null): RosterReaderGap | null {
  const expected = ROSTER_MEMBER_DENOMINATORS.find(row => row.bodyId === bodyId);
  const roster = currentBodyRosters().find(row => row.bodyId === bodyId);
  if (!expected || !roster || roster.members.length >= expected.members) return null;
  const unresolvedSlots = expected.members - roster.members.length;
  return { bodyId: roster.bodyId, expectedMembers: expected.members, verifiedMembers: roster.members.length,
    unresolvedSlots, statement: `We have verified ${roster.members.length} of the ${expected.members} roster identities expected by our held source record. ${unresolvedSlots === 1 ? "One identity remains" : `${unresolvedSlots} identities remain`} unresolved; this is an incomplete roster.`,
    sourceUrl: roster.sourceUrl, sourceOrg: roster.sourceOrg, readAt: roster.collectedAt, denominatorSource: expected.source };
}

export function rosterGapsForDivision(ocdId: string | null): RosterReaderGap[] {
  if (!ocdId) return [];
  return currentBodyRosters().filter(roster => roster.bodyId === `${ocdId}#governing` || roster.bodyId === `${ocdId}#board`)
    .flatMap(roster => { const gap = rosterGapForBody(roster.bodyId); return gap ? [gap] : []; });
}

export function rosterForBody(bodyId: string | null): BodyRoster | null {
  if (!bodyId) return null;
  return currentBodyRosters().find((r) => r.bodyId === bodyId) ?? null;
}

/** A roster member in the shape every officeholder surface renders. */
export interface RosterHolder {
  id: string;
  name: string;
  officeTitle: string;
  /** The body jurisdiction projected for client-side explanatory copy. */
  officeJurisdictionOcdId: string;
  /** The roster's exact term or appointment wording, not an inferred term end. */
  termNote: string | null;
  partyLabel: string | null;
  websiteUrl: string | null;
  sourceUrl: string;
  /** The roster page's publisher and read date. */
  provenance: Provenance;
  email: string | null;
  phone: string | null;
  contactKind?: "PUBLIC_OFFICE" | "PERSONAL";
  contactScope?: "SHARED_OFFICE" | "INDIVIDUAL_OFFICE";
  fieldSources?: RosterMember["fieldSources"];
  retainedFieldSources?: RosterMember["retainedFieldSources"];
  contactFormUrl: null;
  photoUrl: string | null;
  campaignUrl: null;
  /**
   * The term dates a roster states as dates; wording stays in termNote and no
   * date is ever computed from its prose.
   */
  termStart?: string | null;
  termEnd: string | null;
  birthDate: null;
}

/**
 * The roster as `SeatHolder`-shaped rows, so the popup family renders local
 * members with the same machinery as federal and state ones. A member with no
 * photo renders initials; body-page portraits of unknown license are not used.
 */
export function rosterHoldersForBody(bodyId: string | null): RosterHolder[] {
  const roster = rosterForBody(bodyId);
  if (!roster) return [];
  const photos = getRegistryRuntimeReadModel().rosterPhotos;
  return roster.members.map((member) => ({
    id: member.id,
    name: member.name,
    officeTitle: member.officeTitle,
    officeJurisdictionOcdId: roster.bodyId.split("#")[0],
    termNote: member.termNote,
    partyLabel: member.partyLabel ?? null,
    websiteUrl: member.websiteUrl,
    sourceUrl: member.membershipSource?.sourceUrl ?? roster.sourceUrl,
    provenance: {
      ...(member.fieldSources?.name?.kind ?? roster.kind ? { kind: member.fieldSources?.name?.kind ?? roster.kind } : {}),
      sourceUrl: member.membershipSource?.sourceUrl ?? roster.sourceUrl,
      sourceOrg: member.membershipSource?.sourceOrg ?? roster.sourceOrg,
      collectedAt: member.membershipSource?.collectedAt ?? roster.collectedAt,
      verifiedAt: null,
    },
    email: member.email,
    phone: member.phone,
    contactKind: member.contactKind,
    contactScope: member.contactScope,
    fieldSources: member.fieldSources,
    retainedFieldSources: member.retainedFieldSources,
    contactFormUrl: null,
    photoUrl: photos[member.id] ?? null,
    campaignUrl: null,
    termStart: member.termStart ?? null,
    termEnd: member.termEnd ?? null,
    birthDate: null,
  }));
}

/**
 * The division a roster holder serves: the division part of the roster's
 * `bodyId` (`<division ocd-id>#<suffix>`). Used to pick jurisdiction-specific
 * office blurbs. Null for non-roster (federal, state) holders.
 */
export function divisionOcdIdForRosterHolder(
  holderId: string,
): string | null {
  for (const roster of currentBodyRosters()) {
    if (roster.members.some((member) => member.id === holderId)) {
      return roster.bodyId.split("#")[0];
    }
  }
  return null;
}

/**
 * The governing body's roster for a division: `#governing` for county or
 * municipal bodies, else `#board` for school boards. Exact keys only, never a
 * prefix, so an advisory-body roster is never mistaken for the government.
 */
export function governingRosterHoldersForDivision(
  ocdId: string | null,
): RosterHolder[] {
  if (!ocdId) return [];
  const governing = rosterHoldersForBody(`${ocdId}#governing`);
  return governing.length > 0
    ? governing
    : rosterHoldersForBody(`${ocdId}#board`);
}
