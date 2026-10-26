import { nameParts, namesAgree, splitDisplayName } from "../ballot/incumbency.ts";
import { nameTokens } from "../officials/person-name.ts";
import { officeIdentity } from "../officials/office-identity.ts";
import { sameSeatDiscriminators } from "../officials/office-seat.ts";
import { personIdentityKeys } from "../officials/people-identity.ts";
import type { BodyRoster, RosterMember, RosterReaderDisposition } from "./body-rosters.ts";
import type { RegistryRuntimeReadModel } from "./runtime-data-plane.ts";
import { mergeRosterMemberSources } from "./state-composition.ts";

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

export function rosterPeople(roster: BodyRoster): BodyRoster {
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

const projections = new WeakMap<RegistryRuntimeReadModel, RegistryRuntimeReadModel>();

/** A derived reader view; source publications and every old identity stay held. */
export function withRosterPeople(value: RegistryRuntimeReadModel): RegistryRuntimeReadModel {
  const cached = projections.get(value);
  if (cached) return cached;
  const bodyRosters = value.bodyRosters.map(rosterPeople);
  if (bodyRosters.every((roster, index) => roster === value.bodyRosters[index])) {
    projections.set(value, value); return value;
  }
  const dispositions = new Map(value.rosterReaderDispositions.map(row => [row.sourceId, row]));
  for (const roster of bodyRosters) for (const member of roster.members) if (member.sourceMembers) {
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
