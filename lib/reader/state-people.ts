import type { Officeholder, OfficeholderSet, PersonMembership } from "../officials/types.ts";
import { personIdentityKeys } from "../officials/people-identity.ts";
import { mergePeopleSets } from "../officials/merge-people.ts";
import type { StatewideExecutive } from "../officials/statewide-executives.ts";
import { officeIdentity } from "../officials/office-identity.ts";
import { isOfficialSource } from "../civic-data/source-authority.ts";

const legislativeDivision = (division: string) => /\/sld[lu]:/.test(division);
const legislativeOffice = (holder: Officeholder, membership?: PersonMembership) => {
  if ((membership?.level ?? holder.level) !== "STATE") return false;
  const title = membership?.officeTitle ?? holder.officeTitle, office = officeIdentity(title);
  if (office && office !== "state_senator" && office !== "state_lower_house") return false;
  return ["upper", "lower", "senate", "house", "assembly"].includes(membership ? membership.chamber ?? "" : holder.chamber ?? "") ||
    /^(?:State )?(?:Senator|Representative|Assemblymember|Assembly Member|Delegate)$|^Member of (?:the )?(?:State )?(?:Senate|House|Assembly)/i.test(title) ||
    Boolean(membership?.divisionId && legislativeDivision(membership.divisionId));
};

const sourcedFields = ["name", "officeTitle", "termStart", "termEnd", "birthDate", "partyLabel", "websiteUrl", "phone", "email", "contactFormUrl", "photo", "campaignUrl", "selectionMethod", "selectionMethodSourceUrl"] as const;
const words = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const officeKey = (title: string) => officeIdentity(title) ?? words(title);

/** Carry the already-held official identity source into the newly exposed person; supplementary fields retain their own attribution. */
function withStatewideOfficialSource(holder: Officeholder, executives: readonly StatewideExecutive[]): Officeholder {
  if (holder.provenance.kind === "OFFICIAL" || holder.provenance.sourceUrl && isOfficialSource(holder.provenance.sourceUrl)) return holder;
  const candidates = executives.filter(row => row.verification === "PAGE_FETCHED" && isOfficialSource(row.sourceUrl) &&
    row.stateOcdId.endsWith(`:${holder.state?.toLowerCase()}`) && officeKey(row.holder.officeTitle) === officeKey(holder.officeTitle) &&
    ([...personIdentityKeys(holder)].some(key => personIdentityKeys(row.holder).has(key)) || words(row.holder.name) === words(holder.name)));
  if (candidates.length !== 1) return holder;
  const row = candidates[0], provenance = { sourceUrl: row.sourceUrl, sourceOrg: row.sourceOrg, collectedAt: row.collectedAt, verifiedAt: null };
  const fieldSources = Object.fromEntries(sourcedFields.filter(field => holder[field] !== null && holder[field] !== undefined && holder[field] !== "")
    .map(field => [field, holder.fieldSources?.[field] ?? holder.provenance]));
  return { ...holder, name: row.holder.name, officeTitle: row.holder.officeTitle, provenance,
    memberships: holder.memberships?.map(membership => membership.divisionId === row.stateOcdId &&
      officeKey(membership.officeTitle ?? holder.officeTitle) === officeKey(row.holder.officeTitle) && !isOfficialSource(membership.sourceUrl)
      ? { ...membership, officeTitle: row.holder.officeTitle, sourceUrl: row.sourceUrl } : membership),
    fieldSources: { ...fieldSources, ...holder.fieldSources, name: provenance, officeTitle: provenance } };
}

/** A legislature's current list controls legislative seats, while other verified offices retain their own authority. */
export function statePeopleWithLegislativeAuthority(roster: OfficeholderSet | null, authoritative: OfficeholderSet | null,
  executives: readonly StatewideExecutive[] = []): OfficeholderSet | null {
  if (!authoritative) return roster;
  if (!roster) return authoritative;
  const authoritativeKeys = new Set(authoritative.officeholders.flatMap(holder => [...personIdentityKeys(holder)]));
  const linkedLegislators = new Set(roster.divisions.filter(link => legislativeDivision(link.ocdId)).map(link => link.officeholderId));
  const memberships = new Map<string, ReadonlySet<string>>();
  const officeholders = roster.officeholders.flatMap(holder => {
    if ([...personIdentityKeys(holder)].some(key => authoritativeKeys.has(key))) return [holder];
    // Federal division rows keep the separate directory's IDs and contact authority.
    if (holder.level === "FEDERAL" && !holder.memberships?.some(membership => membership.level === "STATE")) return [];
    const selected = withStatewideOfficialSource(holder, executives);
    const retained = selected.memberships?.filter(membership => !legislativeOffice(holder, membership));
    if (legislativeOffice(holder) && !retained?.some(membership => membership.current !== false)) return [];
    if (!retained) {
      if (holder.level === "STATE" && linkedLegislators.has(holder.id)) {
        const otherLinks = roster.divisions.filter(link => link.officeholderId === holder.id && !legislativeDivision(link.ocdId));
        if (!otherLinks.length) return [];
        memberships.set(holder.id, new Set(otherLinks.flatMap(link => link.membershipId ?? [])));
      }
      return [selected];
    }
    memberships.set(holder.id, new Set(retained.map(membership => membership.id)));
    return [{ ...selected, memberships: retained }];
  });
  const ids = new Set(officeholders.map(holder => holder.id));
  const divisions = roster.divisions.filter(link => {
    if (!ids.has(link.officeholderId)) return false;
    const retained = memberships.get(link.officeholderId);
    return !retained || !legislativeDivision(link.ocdId) && (!link.membershipId || retained.has(link.membershipId));
  });
  return mergePeopleSets([authoritative, { ...roster, officeholders, divisions,
    unmatched: roster.unmatched.filter(row => ids.has(row.officeholderId)),
  }]);
}
