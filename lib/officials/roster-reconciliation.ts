import type { Officeholder, OfficeholderSet } from "./types.ts";
import { sameNativePerson } from "./people-identity.ts";
import { officeIdentity } from "./office-identity.ts";

const chamberKey = (value?: string) => value === "sen" ? "senate" : value === "rep" ? "house" : value;
const officeKey = (title: string) => officeIdentity(title) ?? title;
const key = (division: string, title: string) => `${division}|${officeKey(title)}`;

/** An official occupant replaces a mirror's claim to an office without joining the two people by name. */
export function officialRosterReference(reference: OfficeholderSet, official: OfficeholderSet): OfficeholderSet {
  const authoritativeDivisions = new Set(official.currentMembershipComplete
    ? official.divisions.flatMap(link => {
      const person = official.officeholders.find(row => row.id === link.officeholderId);
      return person ? [key(link.ocdId, person.officeTitle)] : [];
    }) : []);
  // A Senate class and a House district each have one federal holder. A state's district may have several seats.
  const nativeSingleSeat = (id: string) => /^US:(?:sen|rep):[A-Z]{2}:/.test(id) || /:seat:[^:]+$/.test(id);
  const explicitVacantSeats = new Set((official.vacancies ?? []).map(row => row.id).filter(nativeSingleSeat));
  const occupiedSeats = new Set(official.officeholders.flatMap(person => person.memberships?.filter(row => row.current !== false && nativeSingleSeat(row.officeId)).map(row => row.officeId) ?? []));
  const completeChambers = new Set(official.coveredChambers?.map(chamberKey));
  const knownOfficial = (person: Officeholder) => official.officeholders.some(row => sameNativePerson(row, person));
  const activeMemberships = (person: Officeholder) => person.memberships?.filter(row => row.current !== false &&
    (row.current === true || !row.termEnd || row.termEnd >= official.generatedAt.slice(0, 10)));
  const removedLinks = new Set(reference.divisions.filter(link => {
    const person = reference.officeholders.find(row => row.id === link.officeholderId);
    if (!person) return false;
    const membership = person.memberships?.find(row => row.id === link.membershipId);
    if (knownOfficial(person) && official.divisions.some(row => row.ocdId === link.ocdId && official.officeholders.some(holder => holder.id === row.officeholderId && sameNativePerson(holder, person)))) return true;
    return completeChambers.has(chamberKey(membership?.chamber ?? person.chamber)) ||
      authoritativeDivisions.has(key(link.ocdId, membership?.officeTitle ?? person.officeTitle)) ||
      activeMemberships(person)?.some(row => explicitVacantSeats.has(row.officeId) || occupiedSeats.has(row.officeId));
  }).map(link => `${link.officeholderId}|${link.ocdId}|${link.membershipId ?? ""}`));
  const divisions = reference.divisions.filter(link => !removedLinks.has(`${link.officeholderId}|${link.ocdId}|${link.membershipId ?? ""}`));
  const linked = new Set(divisions.map(row => row.officeholderId));
  const officeholders = reference.officeholders.filter(person => knownOfficial(person) || linked.has(person.id) ||
    !reference.divisions.some(link => link.officeholderId === person.id) && !completeChambers.has(chamberKey(person.chamber)))
    .map(person => ({...person, ...(person.memberships ? {memberships: person.memberships.map(row =>
      completeChambers.has(chamberKey(row.chamber ?? person.chamber)) || explicitVacantSeats.has(row.officeId) || occupiedSeats.has(row.officeId)
        ? {...row, current: false} : row)} : {})}));
  const ids = new Set(officeholders.map(row => row.id));
  // A partial official read can replace a specifically vacant native seat; an unsourced omission cannot.
  const occupied = new Set(official.officeholders.flatMap(person => person.memberships?.filter(row => row.current !== false).map(row => row.officeId) ?? []));
  const replacedVacancies = new Set((official.vacancies ?? []).map(row => row.id));
  return { ...reference, officeholders, divisions, unmatched: reference.unmatched.filter(row => ids.has(row.officeholderId)),
    vacancies: reference.vacancies?.filter(row => !occupied.has(row.id) && !replacedVacancies.has(row.id) && !completeChambers.has(chamberKey(row.chamber))) };
}

export interface OfficialRosterChange {
  readonly kind: "appointed" | "departed" | "vacant" | "changed";
  readonly name: string | null;
  readonly officeTitle: string;
  readonly divisionId: string;
  readonly sourceUrl: string | null;
  readonly since?: string | null;
}
export interface RosterDisagreement {
  readonly divisionId: string;
  readonly officeTitle: string;
  readonly officialName: string | null;
  readonly mirrorNames: readonly string[];
  readonly sourceUrl: string | null;
}

export function officialRosterChanges(prior: OfficeholderSet | null, next: OfficeholderSet): OfficialRosterChange[] {
  const changes: OfficialRosterChange[] = [];
  for (const person of next.officeholders) {
    const held = prior?.officeholders.find(row => sameNativePerson(row, person));
    if (held && held.name === person.name && held.officeTitle === person.officeTitle && held.termStart === person.termStart) continue;
    for (const link of next.divisions.filter(row => row.officeholderId === person.id)) changes.push({
      kind: held ? "changed" : "appointed", name: person.name, officeTitle: person.officeTitle, divisionId: link.ocdId, sourceUrl: person.provenance.sourceUrl,
    });
  }
  for (const vacancy of next.vacancies ?? []) {
    if (prior?.vacancies?.some(row => row.id === vacancy.id && row.since === vacancy.since)) continue;
    changes.push({ kind: "vacant", name: null, officeTitle: vacancy.officeTitle, divisionId: vacancy.divisionId, sourceUrl: vacancy.provenance.sourceUrl, since: vacancy.since });
  }
  if (prior) for (const person of prior.officeholders) {
    if (!next.currentMembershipComplete && !next.coveredChambers?.map(chamberKey).includes(chamberKey(person.chamber))) continue;
    if (next.officeholders.some(row => sameNativePerson(row, person))) continue;
    for (const link of prior.divisions.filter(row => row.officeholderId === person.id)) changes.push({
      kind: "departed", name: person.name, officeTitle: person.officeTitle, divisionId: link.ocdId,
      sourceUrl: next.vacancies?.find(row => row.divisionId === link.ocdId)?.provenance.sourceUrl ?? next.officeholders[0]?.provenance.sourceUrl ?? null,
    });
  }
  return changes;
}

/** Keep the losing values for BL-01. Comparing names reports disagreement; it never establishes person identity. */
export function officialRosterDisagreements(mirror: OfficeholderSet | null, official: OfficeholderSet): RosterDisagreement[] {
  if (!mirror) return [];
  const out: RosterDisagreement[] = [];
  const entries = [
    ...official.officeholders.flatMap(person => official.divisions.filter(link => link.officeholderId === person.id).map(link => ({
      divisionId: link.ocdId, officeTitle: person.officeTitle, officialName: person.name, sourceUrl: person.provenance.sourceUrl,
    }))),
    ...(official.vacancies ?? []).map(row => ({ divisionId: row.divisionId, officeTitle: row.officeTitle, officialName: null, sourceUrl: row.provenance.sourceUrl })),
  ];
  for (const entry of entries) {
    const mirrors = mirror.officeholders.filter(person => officeKey(person.officeTitle) === officeKey(entry.officeTitle) && mirror.divisions.some(link => link.officeholderId === person.id && link.ocdId === entry.divisionId));
    if (entry.officialName !== null && mirrors.some(row => row.name === entry.officialName)) continue;
    if (mirrors.length) out.push({ ...entry, mirrorNames: mirrors.map(row => row.name) });
  }
  return out;
}
