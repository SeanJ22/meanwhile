import { nameParts, namesAgree, splitDisplayName } from "../ballot/incumbency.ts";
import { nameTokens } from "../officials/person-name.ts";
import { officeIdentity } from "../officials/office-identity.ts";
import { sameSeatDiscriminators } from "../officials/office-seat.ts";
import { personIdentityKeys } from "../officials/people-identity.ts";
import type { BodyRoster, RosterMember, RosterReaderDisposition } from "./body-rosters.ts";
import type { RegistryRuntimeReadModel } from "./runtime-data-plane.ts";
import { mergeRosterMemberSources } from "./state-composition.ts";
import { compositionFor } from "./body-membership.ts";
import { isOfficialSource } from "../civic-data/source-authority.ts";

const comparable = (name: string) => {
  const parts = splitDisplayName(nameTokens(name).join(" "));
  return nameParts(parts.givenName, parts.familyName);
};

/** CL-01's exact given name/surname and compatible middle-name comparison,
 * inside one body. Known different native people or numbered seats stay separate. */
export function sameRosterPerson(left: RosterMember, right: RosterMember, division: string): boolean {
  const keys = personIdentityKeys(left);
  const shared = [...personIdentityKeys(right)].some(key => keys.has(key));
  if (left.id === right.id) return true;
  // resolvePerson also mints ocd-person UUIDs for separate fact extractions.
  // Those entity keys are retained aliases; different publisher IDs below are
  // the evidence that two sourced people are distinct.
  const factEntity = (id: string) => /^ocd-person\/[a-f0-9]{8}-[a-f0-9-]{27}$/i.test(id);
  if (left.personId && right.personId && left.personId !== right.personId && !shared &&
      !(factEntity(left.personId) || factEntity(right.personId))) return false;
  for (const [source, ids] of Object.entries(left.nativeIds ?? {})) {
    const other = right.nativeIds?.[source];
    if (source !== "reader" && ids.length && other?.length && !ids.some(id => other.includes(id))) return false;
  }
  if (shared) return true;
  if (!namesAgree(comparable(left.name), comparable(right.name)) ||
      !sameSeatDiscriminators(left.officeTitle, right.officeTitle, division, { allowUnspecified: true })) return false;
  const a = officeIdentity(left.officeTitle, division), b = officeIdentity(right.officeTitle, division);
  return !a || !b || a === b;
}

function mergeRosterPeople(roster: BodyRoster): BodyRoster {
  const groups: RosterMember[][] = [];
  for (const member of roster.members) {
    const originals = member.sourceMembers ?? [member];
    const matches = groups.filter(group => group.every(held => originals.every(row =>
      sameRosterPerson(held, row, roster.bodyId.split("#")[0]))));
    if (matches.length === 1) matches[0].push(...originals);
    else groups.push([...originals]);
  }
  if (groups.length === roster.members.length && !roster.members.some(member => member.sourceMembers)) return roster;
  return { ...roster, members: groups.map(group => {
    if (group.length === 1) return group[0];
    const sources = [...new Map(group.map(member => {
      const row = member.membershipSource ? member : { ...member, membershipSource: {
        sourceUrl: roster.sourceUrl, sourceOrg: roster.sourceOrg, collectedAt: roster.collectedAt,
      } };
      return [JSON.stringify(row), row] as const;
    })).values()];
    const first = sources[0];
    const member = sources.slice(1).reduce((held, row) => mergeRosterMemberSources(held, row, roster, roster), first);
    const aliases = [...new Set(sources.flatMap(row => [row.id, row.personId ?? row.id, ...row.nativeIds?.reader ?? []]))];
    return { ...member, id: first.id, personId: first.personId ?? member.personId ?? first.id,
      nativeIds: { ...member.nativeIds, reader: aliases }, sourceMembers: sources };
  }) };
}

/** A complete newer sourced roster supersedes older unspecified memberships.
 * Missing seats or explicit older seats remain present; no count is guessed. */
export function rosterPeople(roster: BodyRoster, expectedSeats = compositionFor(roster.bodyId)?.expectedSeats): BodyRoster {
  const merged = mergeRosterPeople(roster);
  if (!expectedSeats || merged.members.length <= expectedSeats) return merged;
  const membershipDate = (member: RosterMember) => Date.parse(member.membershipSource?.collectedAt ?? roster.collectedAt) || 0;
  const latest = Math.max(...merged.members.map(membershipDate));
  const current = merged.members.filter(member => membershipDate(member) === latest);
  if (current.length !== expectedSeats || !current.every(member => member.fieldSources?.name?.kind === "OFFICIAL" ||
    roster.kind === "OFFICIAL" || isOfficialSource(member.membershipSource?.sourceUrl ?? roster.sourceUrl))) return merged;
  const earlier = merged.members.filter(member => membershipDate(member) < latest && /^(?:(?:board|council) )?member$/i.test(member.officeTitle.trim()));
  if (!earlier.length) return merged;
  const prior = new Set(earlier);
  return { ...merged, members: merged.members.filter(member => !prior.has(member)),
    membershipHistory: [...new Map([...(merged.membershipHistory ?? []), ...earlier].map(member => [member.id, member])).values()] };
}

const projections = new WeakMap<RegistryRuntimeReadModel, RegistryRuntimeReadModel>();

/** A derived reader view; source publications and every old identity stay held. */
export function withRosterPeople(value: RegistryRuntimeReadModel): RegistryRuntimeReadModel {
  const cached = projections.get(value);
  if (cached) return cached;
  const bodyRosters = value.bodyRosters.map(roster => rosterPeople(roster));
  if (bodyRosters.every((roster, index) => roster === value.bodyRosters[index])) {
    projections.set(value, value); return value;
  }
  const dispositions = new Map(value.rosterReaderDispositions.map(row => [row.sourceId, row]));
  for (const roster of bodyRosters) for (const member of [...roster.members, ...roster.membershipHistory ?? []]) if (member.sourceMembers) {
    const canonical = dispositions.get(member.id);
    if (canonical?.state === "EXACT_DUPLICATE" && member.nativeIds?.reader?.includes(canonical.canonicalId!)) {
      dispositions.set(member.id, { sourceId: member.id, canonicalId: member.id, state: "READER_ELIGIBLE",
        reason: "The retained canonical person in this body's sourced roster." });
    }
    for (const sourceId of member.nativeIds?.reader ?? []) if (sourceId !== member.id) {
      const prior = dispositions.get(sourceId);
      if (prior?.state === "IDENTITY_UNRESOLVED") continue;
      const row: RosterReaderDisposition = { sourceId, canonicalId: member.id,
        state: "EXACT_DUPLICATE", reason: "The same person in this body's sourced roster; original records retained." };
      dispositions.set(sourceId, row);
    }
  }
  const result = { ...value, bodyRosters, rosterReaderDispositions: [...dispositions.values()] };
  projections.set(value, result); projections.set(result, result);
  return result;
}
