import type { NhMemberReadModel, OfficialStateLegislatorReadModel } from "../civic-data/candidate-builders.ts";
import type { OfficeholderSet } from "./types.ts";

const NH_COUNTY: Readonly<Record<string, string>> = {
  Belknap: "BEL", Carroll: "CAR", Cheshire: "CHE", Coos: "COO", Grafton: "GRA",
  Hillsborough: "HIL", Merrimack: "MER", Rockingham: "ROC", Strafford: "STR", Sullivan: "SUL",
};

export function nhHouseDivision(county: string, district: string): string | null {
  const abbreviation = NH_COUNTY[county.trim()];
  const number = Number(district);
  if (!abbreviation || !Number.isInteger(number) || number <= 0) return null;
  const ordinal = Object.keys(NH_COUNTY).indexOf(county.trim());
  if (ordinal < 0) return null;
  return `ocd-division/country:us/state:nh/sldl:${Number(`${ordinal}${String(number).padStart(2, "0")}`)}`;
}

/** One native NH member projection serves both the reader and source-change comparisons. */
export function nhReadModel(result: {
  readonly value: NhMemberReadModel;
  readonly metadata: { readonly retrievedAt?: string | null; readonly sourceThrough?: string | null };
}): OfficialStateLegislatorReadModel {
  const identityByComposite = new Map(result.value.identities.map((identity) => [
    `${identity.chamber}\u0000${identity.seatNo}\u0000${identity.district}`, identity,
  ]));
  const officeholders = result.value.members.flatMap((member) => {
    const identity = identityByComposite.get(`${member.chamber}\u0000${member.seatNo}\u0000${member.district}`);
    if (!identity) return [];
    return [{
      id: identity.officeholderId,
      personId: identity.officeholderId,
      nativeIds: { "nh-general-court": [identity.officialPersonId] },
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
        sourceUrl: result.value.memberSourceUrls?.[identity.officeholderId]?.[0] ?? "https://gc.nh.gov/downloads/Members.txt",
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
    currentMembershipComplete: result.value.currentMembershipComplete,
    coveredChambers: result.value.currentMembershipComplete ? ["upper", "lower"] : [],
    scope: "33",
    generatedAt: result.metadata.retrievedAt ?? result.metadata.sourceThrough ?? result.value.term,
    officeholders,
    divisions,
    unmatched: officeholders.filter((row) => !linked.has(row.id))
      .map((row) => ({ officeholderId: row.id, reason: "The official Members.txt district could not be mapped to an exact held OCD division." })),
  };
  return { formatVersion: 1, sourceId: "nh-general-court", jurisdiction: "US-NH", term: result.value.term,
    generatedAt: roster.generatedAt, roster };
}
