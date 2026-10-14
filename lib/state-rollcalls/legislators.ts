import { statePeopleVersion } from "../officials/people-version.ts";
import type { OfficeholderSet } from "../officials/types.ts";
import { type StatePeopleJurisdiction } from "../officials/people-identity.ts";
import { mergePeopleSets } from "../officials/merge-people.ts";
import { PEOPLE_SOURCE_IDS } from "../officials/people-sources.ts";
import { readPeopleSourceProjection } from "../civic-data/people-source-read.ts";
import type { SeatHolder } from "../officials/lookup.ts";
import { currentReaderAuthorityEdge, type ReaderAuthorityEdgeBundle } from "../registry/runtime-edge.ts";
import {
  CivicDataStoreUnavailableError,
  readPromotedCivicData,
  type CivicDataReadResult,
  type PromotedCivicDataReadOptions,
} from "../civic-data/read-model.ts";
import {
  readNhMembers,
} from "../civic-data/state-members.ts";
import type { OfficialStateLegislatorReadModel } from "../civic-data/candidate-builders.ts";
import {
  officialStateLegislatorTargetByScope,
  type OfficialStateVoteScope,
} from "./authority.ts";

const NH_COUNTY: Readonly<Record<string, string>> = {
  Belknap: "BEL",
  Carroll: "CAR",
  Cheshire: "CHE",
  Coos: "COO",
  Grafton: "GRA",
  Hillsborough: "HIL",
  Merrimack: "MER",
  Rockingham: "ROC",
  Strafford: "STR",
  Sullivan: "SUL",
};

const requestPeople = new WeakMap<ReaderAuthorityEdgeBundle, Map<StatePeopleJurisdiction, OfficialStateLegislatorReadModel>>();
let standalonePeople: OfficialStateLegislatorReadModel | null = null;

export function primeStatePeopleProjection(value: OfficialStateLegislatorReadModel): void {
  const request = currentReaderAuthorityEdge();
  if (!request) { standalonePeople = value; return; }
  const people = requestPeople.get(request) ?? new Map();
  people.set(value.jurisdiction, value);
  requestPeople.set(request, people);
}

export function currentStatePeopleProjection(scope: StatePeopleJurisdiction): OfficialStateLegislatorReadModel | null {
  const request = currentReaderAuthorityEdge();
  return request ? requestPeople.get(request)?.get(scope) ?? null
    : standalonePeople?.jurisdiction === scope ? standalonePeople : null;
}

function nhHouseDivision(county: string, district: string): string | null {
  const abbreviation = NH_COUNTY[county.trim()];
  const number = Number(district);
  if (!abbreviation || !Number.isInteger(number) || number <= 0) return null;
  const ordinal = Object.keys(NH_COUNTY).indexOf(county.trim());
  if (ordinal < 0) return null;
  return `ocd-division/country:us/state:nh/sldl:${Number(`${ordinal}${String(number).padStart(2, "0")}`)}`;
}

function nhReadModel(
  result: Extract<Awaited<ReturnType<typeof readNhMembers>>, { kind: "PROMOTED" | "BOOTSTRAP" }>,
): OfficialStateLegislatorReadModel {
  const identityByComposite = new Map(result.value.identities.map((identity) => [
    `${identity.chamber}\u0000${identity.seatNo}\u0000${identity.district}`,
    identity,
  ]));
  const officeholders = result.value.members.flatMap((member) => {
    const identity = identityByComposite.get(`${member.chamber}\u0000${member.seatNo}\u0000${member.district}`);
    if (!identity) return [];
    return [{
      id: identity.officeholderId,
      personId: identity.officeholderId,
      nativeIds: {"nh-general-court":[identity.officialPersonId]},
      name: [member.givenName, member.middleName, member.familyName].filter(Boolean).join(" "),
      officeTitle: member.chamber === "S" ? "State Senator" : "State Representative",
      level: "STATE" as const,
      termStart: "",
      termEnd: "",
      birthDate: null,
      partyLabel: member.party,
      websiteUrl: null,
      contactFormUrl: null,
      phone: member.phone,
      email: member.email,
      campaignUrl: null,
      photo: null,
      state: "NH",
      chamber: member.chamber === "S" ? "upper" : "lower",
      provenance: {
        sourceUrl: "https://gc.nh.gov/downloads/Members.txt",
        sourceOrg: "New Hampshire General Court",
        collectedAt: result.value.memberSourceDates?.[identity.officeholderId] ?? result.metadata.retrievedAt ?? result.metadata.sourceThrough ?? result.value.term,
        verifiedAt: result.metadata.retrievedAt ?? null,
      },
    }];
  });
  const divisions = result.value.members.flatMap((member) => {
    const identity = identityByComposite.get(`${member.chamber}\u0000${member.seatNo}\u0000${member.district}`);
    if (!identity) return [];
    const division = member.chamber === "S"
      ? `ocd-division/country:us/state:nh/sldu:${Number(member.district)}`
      : nhHouseDivision(member.county, member.district);
    return division ? [{ officeholderId: identity.officeholderId, ocdId: division, bodyId: null }] : [];
  });
  const linked = new Set(divisions.map((row) => row.officeholderId));
  const roster: OfficeholderSet = {
    scope: "33",
    generatedAt: result.metadata.retrievedAt ?? result.metadata.sourceThrough ?? result.value.term,
    officeholders,
    divisions,
    unmatched: officeholders
      .filter((row) => !linked.has(row.id))
      .map((row) => ({ officeholderId: row.id, reason: "The official Members.txt district could not be mapped to an exact held OCD division." })),
  };
  return {
    formatVersion: 1,
    sourceId: "nh-general-court",
    jurisdiction: "US-NH",
    term: result.value.term,
    generatedAt: roster.generatedAt,
    roster,
  };
}

function projectionIssue(scope: OfficialStateVoteScope, value: OfficialStateLegislatorReadModel): string | null {
  const target = officialStateLegislatorTargetByScope(scope);
  if (!target || value.jurisdiction !== scope || value.sourceId !== target.sourceId) return "STATE_ROSTER_AUTHORITY_MISMATCH";
  if (value.formatVersion !== 1 || !Array.isArray(value.roster.officeholders) || !Array.isArray(value.roster.divisions)) return "STATE_ROSTER_SHAPE_INVALID";
  const ids = new Set(value.roster.officeholders.map((row) => row.id));
  if (ids.size !== value.roster.officeholders.length) return "STATE_ROSTER_ID_DUPLICATED";
  if ([...ids].some((id) => !id.startsWith(`${target.sourceId}:`))) return "STATE_ROSTER_ID_AUTHORITY_MISMATCH";
  if (value.roster.divisions.some((row) => !ids.has(row.officeholderId))) return "STATE_ROSTER_DIVISION_ID_UNRESOLVED";
  return null;
}

/** Read exactly one official state-person authority. */
export async function readOfficialStateLegislatorsProjection(
  scope: OfficialStateVoteScope,
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<OfficialStateLegislatorReadModel>> {
  if (scope === "US-NH") {
    const result = await readNhMembers(options);
    if (result.kind !== "PROMOTED" && result.kind !== "BOOTSTRAP") return result;
    const value = nhReadModel(result);
    const issue = projectionIssue(scope, value);
    if (issue) throw new Error(issue);
    return result.kind === "PROMOTED"
      ? { ...result, value, projection: { ...result.projection, payload: value } }
      : { ...result, value };
  }
  const result = await readPromotedCivicData<OfficialStateLegislatorReadModel>("STATE_LEGISLATOR", scope, options);
  if (result.kind === "PROMOTED") {
    const issue = projectionIssue(scope, result.value);
    if (issue) throw new Error(issue);
  }
  return result;
}

export interface HeldOfficialStateLegislators {
  readonly scope: StatePeopleJurisdiction;
  readonly versionId: string;
  readonly seats: readonly SeatHolder[];
  readonly divisions: readonly { officeholderId: string; ocdId: string; membershipId?: string }[];
}

export type AvailableOfficialStateLegislatorsRead = Extract<
  CivicDataReadResult<OfficialStateLegislatorReadModel>,
  { readonly kind: "PROMOTED" | "BOOTSTRAP" }
>;

/**
 * Projects one already-classified canonical read into the coverage render
 * shape, so composite readers keep the read's exact disposition.
 */
export function heldOfficialStateLegislatorsFromRead(
  scope: StatePeopleJurisdiction,
  result: AvailableOfficialStateLegislatorsRead,
): HeldOfficialStateLegislators {
  const seats: SeatHolder[] = result.value.roster.officeholders.map((person) => ({
    id: person.id,
    personId: person.personId ?? person.id,
    nativeIds: person.nativeIds,
    memberships: person.memberships,
    selectionMethod: person.selectionMethod,
    selectionMethodSourceUrl: person.selectionMethodSourceUrl,
    fieldSources: person.fieldSources ? {...person.fieldSources} : undefined,
    name: person.name,
    officeTitle: person.officeTitle,
    partyLabel: person.partyLabel,
    termEnd: person.termEnd || null,
    termStart: person.termStart || null,
    birthDate: person.birthDate,
    websiteUrl: person.websiteUrl,
    sourceUrl: person.provenance.sourceUrl,
    provenance: person.provenance,
    email: person.email,
    phone: person.phone,
    contactFormUrl: person.contactFormUrl,
    photoUrl: person.photo?.url ?? null,
    campaignUrl: person.campaignUrl,
    state: person.state,
    chamber: person.chamber,
  }));
  return {
    scope,
    versionId: result.metadata.versionId ?? result.kind,
    seats,
    divisions: result.value.roster.divisions.map(({ officeholderId, ocdId, membershipId }) => ({ officeholderId, ocdId, ...(membershipId ? {membershipId} : {}) })),
  };
}

/** Optional facts from a reference remain usable when an official roster only supplies the minimum. */
export function mergeStatePeople(reference: OfficeholderSet | null, official: OfficeholderSet | null): OfficeholderSet {
  const merged = mergePeopleSets([reference, official].filter((row): row is OfficeholderSet=>row !== null));
  if (!merged) throw new Error("STATE_PEOPLE_NO_SOURCE");
  return {...merged,currentMembershipComplete:official?.currentMembershipComplete ?? reference?.currentMembershipComplete ?? false};
}

/** Validate the source shard; source-specific roster authorities keep their independent pointers. */
export async function readOpenStatesPeopleProjection(jurisdiction: StatePeopleJurisdiction, options: PromotedCivicDataReadOptions = {}): Promise<CivicDataReadResult<OfficialStateLegislatorReadModel>> {
  const result = await readPromotedCivicData<OfficialStateLegislatorReadModel>("STATE_LEGISLATOR",`${jurisdiction}:openstates-people:v1`,options);
  if (result.kind === "PROMOTED" || result.kind === "BOOTSTRAP") {
    const value = result.value;
    if (value.formatVersion !== 1 || value.jurisdiction !== jurisdiction || value.sourceId !== "plural-openstates" ||
      new Set(value.roster.officeholders.map(row=>row.id)).size !== value.roster.officeholders.length ||
      value.roster.officeholders.some(row=>!row.name || !row.officeTitle || !row.provenance?.sourceUrl || !row.id.startsWith(`plural:${jurisdiction.slice(3).toLowerCase()}:`))) {
      throw new Error("STATE_PEOPLE_SOURCE_IDENTITY_INVALID");
    }
    const ids = new Set(value.roster.officeholders.map(row=>row.id));
    if (value.roster.divisions.some(row=>!ids.has(row.officeholderId))) throw new Error("STATE_PEOPLE_DIVISION_ID_UNRESOLVED");
  }
  return result;
}

/** One state-sized reader model; official values override reference values only for an exact person. */
export async function readStatePeopleProjection(jurisdiction: StatePeopleJurisdiction, options: PromotedCivicDataReadOptions = {}): Promise<CivicDataReadResult<OfficialStateLegislatorReadModel>> {
  const target = officialStateLegislatorTargetByScope(jurisdiction);
  const reads = await Promise.allSettled([
    readOpenStatesPeopleProjection(jurisdiction,options),
    target ? readOfficialStateLegislatorsProjection(target.jurisdiction,options) : Promise.resolve(null),
    ...PEOPLE_SOURCE_IDS.map(sourceId=>readPeopleSourceProjection(jurisdiction,sourceId,options)),
  ]);
  const results = reads.flatMap(row=>row.status === "fulfilled" && row.value ? [row.value as CivicDataReadResult<OfficialStateLegislatorReadModel>] : []);
  const available = results.filter((row):row is AvailableOfficialStateLegislatorsRead=>row.kind === "PROMOTED" || row.kind === "BOOTSTRAP");
  if (!available.length) {
    const request = currentReaderAuthorityEdge();
    if (request) requestPeople.get(request)?.delete(jurisdiction);
    else if (standalonePeople?.jurisdiction === jurisdiction) standalonePeople = null;
    const failed = reads.find((row):row is PromiseRejectedResult=>row.status === "rejected");
    if (failed) throw failed.reason;
    return results.find(row=>row.kind === "STORE_UNREACHABLE") ?? results[0];
  }
  // The composite version names every read source, including federal and portrait shards.
  const primary = available.find(row=>row.value.sourceId === "plural-openstates") ?? available[0];
  const ordered = [primary,...available.filter(row=>row !== primary)];
  const roster = mergePeopleSets(ordered.map(row=>row.value.roster))!;
  const versionId = available.length === 1 ? primary.metadata.versionId : statePeopleVersion(jurisdiction,available.map(row=>({scope:row.metadata.scope,versionId:row.metadata.versionId ?? row.kind})));
  const value: OfficialStateLegislatorReadModel = {...primary.value,roster,generatedAt:roster.generatedAt};
  primeStatePeopleProjection(value);
  const metadata = {...primary.metadata,versionId,sourceThrough:available.map(row=>row.metadata.sourceThrough).filter((value):value is string=>Boolean(value)).sort().at(-1) ?? null,
    retrievedAt:available.map(row=>row.metadata.retrievedAt).filter((value):value is string=>Boolean(value)).sort().at(-1) ?? null};
  return primary.kind === "PROMOTED" ? {...primary,value,metadata,projection:{...primary.projection,versionId:versionId!,payload:value}}
    : {...primary,value,metadata};
}

/** Reader render shape for one successfully held official roster. */
export async function heldOfficialStateLegislators(
  scope: OfficialStateVoteScope,
  options: PromotedCivicDataReadOptions = {},
): Promise<HeldOfficialStateLegislators | null> {
  const result = await readOfficialStateLegislatorsProjection(scope, options);
  if (result.kind === "STORE_UNREACHABLE") throw new CivicDataStoreUnavailableError(result);
  if (result.kind !== "PROMOTED" && result.kind !== "BOOTSTRAP") return null;
  return heldOfficialStateLegislatorsFromRead(scope, result);
}
