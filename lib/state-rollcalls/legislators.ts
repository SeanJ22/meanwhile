import type { OfficeholderSet } from "../officials/types.ts";
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
        collectedAt: result.metadata.retrievedAt ?? result.metadata.sourceThrough ?? result.value.term,
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
  readonly scope: OfficialStateVoteScope;
  readonly versionId: string;
  readonly seats: readonly SeatHolder[];
  readonly divisions: readonly { officeholderId: string; ocdId: string }[];
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
  scope: OfficialStateVoteScope,
  result: AvailableOfficialStateLegislatorsRead,
): HeldOfficialStateLegislators {
  const seats: SeatHolder[] = result.value.roster.officeholders.map((person) => ({
    id: person.id,
    name: person.name,
    officeTitle: person.officeTitle,
    partyLabel: person.partyLabel,
    termEnd: person.termEnd || null,
    birthDate: person.birthDate,
    websiteUrl: person.websiteUrl,
    sourceUrl: person.provenance.sourceUrl,
    provenance: person.provenance,
    email: person.email,
    phone: person.phone,
    contactFormUrl: person.contactFormUrl,
    photoUrl: null,
    campaignUrl: null,
    state: person.state,
    chamber: person.chamber,
  }));
  return {
    scope,
    versionId: result.metadata.versionId ?? result.kind,
    seats,
    divisions: result.value.roster.divisions.map(({ officeholderId, ocdId }) => ({ officeholderId, ocdId })),
  };
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
