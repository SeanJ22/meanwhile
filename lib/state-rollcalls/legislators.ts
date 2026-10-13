import { nhReadModel } from "../officials/nh-roster.ts";
import { statePeopleVersion } from "../officials/people-version.ts";
import type { OfficeholderSet } from "../officials/types.ts";
import type { Officeholder } from "../officials/types.ts";
import { sameNativePerson, type StatePeopleJurisdiction } from "../officials/people-identity.ts";
import { officialRosterReference } from "../officials/roster-reconciliation.ts";
import { vacancySeatHolder } from "../officials/lookup.ts";
import { OFFICIAL_ROSTER_TARGETS } from "../sources/official-rosters/targets.ts";
import { readOfficialRosterProjection } from "../civic-data/official-roster-read-model.ts";
import type { SeatHolder } from "../officials/lookup.ts";
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
  seats.push(...(result.value.roster.vacancies ?? []).map(vacancySeatHolder));
  return {
    scope,
    versionId: result.metadata.versionId ?? result.kind,
    seats,
    divisions: [...result.value.roster.divisions.map(({ officeholderId, ocdId, membershipId }) => ({ officeholderId, ocdId, ...(membershipId ? {membershipId} : {}) })),
      ...(result.value.roster.vacancies ?? []).map(row => ({officeholderId: row.id, ocdId: row.divisionId}))],
  };
}

/** Optional facts from a reference remain usable when an official roster only supplies the minimum. */
export function mergeStatePeople(reference: OfficeholderSet | null, official: OfficeholderSet | null): OfficeholderSet {
  if (!reference && !official) throw new Error("STATE_PEOPLE_NO_SOURCE");
  if (!reference) return official!;
  if (!official) return reference;
  reference = officialRosterReference(reference, official);
  const people = [...reference.officeholders];
  const aliases = new Map<string,string>();
  for (const person of official.officeholders) {
    const matches = people.flatMap((row,index) => sameNativePerson(row,person) ? [index] : []);
    if (matches.length !== 1) { people.push(person); continue; }
    const at = matches[0], prior = people[at];
    const fields = ["termStart","termEnd","birthDate","partyLabel","websiteUrl","profileUrls","contactFormUrl","phone","email","campaignUrl","photo","social","offices"] as const;
    const merged: Officeholder = {...prior,...person,personId:prior.personId ?? person.personId ?? person.id,
      nativeIds:{...Object.fromEntries([...new Set([...Object.keys(prior.nativeIds ?? {}),...Object.keys(person.nativeIds ?? {})])].map(key=>[key,[...new Set([...(prior.nativeIds?.[key] ?? []),...(person.nativeIds?.[key] ?? [])])]])),reader:[...new Set([...(prior.nativeIds?.reader ?? []),...(person.nativeIds?.reader ?? []),prior.id,prior.personId ?? prior.id,person.id,person.personId ?? person.id])]},
      fieldSources:{...prior.fieldSources,...person.fieldSources},
      memberships:[...new Map([...(prior.memberships ?? []),...(person.memberships ?? [])].map(row=>[row.id,row])).values()]};
    for (const field of fields) {
      const value = person[field];
      if (value === null || value === undefined || value === "" ||
        typeof value === "object" && Object.keys(value).length === 0) {
        Object.assign(merged,{[field]:prior[field]});
        if (prior[field] !== null && prior[field] !== undefined && prior[field] !== "") {
          merged.fieldSources = {...merged.fieldSources,[field]:prior.fieldSources?.[field] ?? prior.provenance};
        }
      } else merged.fieldSources = {...merged.fieldSources,[field]:person.fieldSources?.[field] ?? person.provenance};
    }
    aliases.set(prior.id,person.id);
    people[at] = merged;
  }
  const divisions = [...reference.divisions,...official.divisions].map(row=>({...row,officeholderId:aliases.get(row.officeholderId) ?? row.officeholderId}));
  const currentMembershipIds=new Set(people.flatMap(person=>(person.memberships ?? []).filter(row=>row.current !== false).map(row=>row.id)));
  const endedMemberships=[...new Map([...(reference.endedMemberships ?? []),...(official.endedMemberships ?? [])].map(row=>[row.id,row])).values()]
    .filter(row=>!currentMembershipIds.has(row.id));
  return JSON.parse(JSON.stringify({currentMembershipComplete:official.currentMembershipComplete ?? false,coveredChambers:official.coveredChambers,
    vacancies:[...(reference.vacancies ?? []),...(official.vacancies ?? [])],scope:official.scope,generatedAt:[reference.generatedAt,official.generatedAt].sort().at(-1)!,officeholders:people,
    ...(endedMemberships.length ? {endedMemberships} : {}),
    divisions:[...new Map(divisions.map(row=>[`${row.officeholderId}|${row.ocdId}|${row.bodyId}|${row.membershipId ?? ""}`,row])).values()],
    unmatched:[...new Map([...reference.unmatched,...official.unmatched].map(row=>({...row,officeholderId:aliases.get(row.officeholderId) ?? row.officeholderId})).map(row=>[`${row.officeholderId}|${row.reason}`,row])).values()]}));
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
    ...OFFICIAL_ROSTER_TARGETS.filter(row => row.jurisdiction === jurisdiction).map(row => readOfficialRosterProjection(row.scope, options)),
  ]);
  const results = reads.flatMap(row=>row.status === "fulfilled" && row.value ? [row.value] : []);
  const available = results.filter((row):row is AvailableOfficialStateLegislatorsRead=>row.kind === "PROMOTED" || row.kind === "BOOTSTRAP");
  if (!available.length) {
    const failed = reads.find((row):row is PromiseRejectedResult=>row.status === "rejected");
    if (failed) throw failed.reason;
    return results.find(row=>row.kind === "STORE_UNREACHABLE") ?? results[0];
  }
  if (available.length === 1) return available[0];
  const roster = available.reduce<OfficeholderSet | null>((combined, row) => mergeStatePeople(combined, row.value.roster), null)!;
  const official = available.at(-1)!;
  const versionId = statePeopleVersion(jurisdiction,available.map(row=>({scope:row.metadata.scope,versionId:row.metadata.versionId ?? row.kind})));
  const value: OfficialStateLegislatorReadModel = {...official.value,roster,generatedAt:roster.generatedAt};
  return official.kind === "PROMOTED" ? {...official,value,metadata:{...official.metadata,versionId,sourceThrough:available.map(row=>row.metadata.sourceThrough).filter((value):value is string=>Boolean(value)).sort().at(-1) ?? null,retrievedAt:available.map(row=>row.metadata.retrievedAt).filter((value):value is string=>Boolean(value)).sort().at(-1) ?? null},projection:{...official.projection,versionId,payload:value}}
    : {...official,value,metadata:{...official.metadata,versionId,sourceThrough:available.map(row=>row.metadata.sourceThrough).filter((value):value is string=>Boolean(value)).sort().at(-1) ?? null,retrievedAt:available.map(row=>row.metadata.retrievedAt).filter((value):value is string=>Boolean(value)).sort().at(-1) ?? null}};
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
