import { currentGenericBallotProjection } from "./generic-projection.ts";
import { ballotCandidateAliases, ballotCandidatePeople } from "./tickets.ts";
import { verifiedCandidateProfilePerson, type HeldCandidatePerson } from "./held-person.ts";
import { currentCandidateProfilesProjection } from "../civic-data/manual-read-models.ts";
import { currentStatePeopleProjection } from "../state-rollcalls/legislators.ts";
import { getRegistryRuntimeReadModel } from "../registry/runtime-read-model.ts";

const indexes = new WeakMap<object, ReadonlyMap<string, readonly string[]>>();

/** Source aliases are race-specific and never join the two members of a ticket. */
export function candidateKeysForState(state: string, subjectId: string): readonly string[] {
  let projection;
  try { projection = currentGenericBallotProjection(state); } catch { return []; }
  let index = indexes.get(projection);
  if (!index) {
    const rows = new Map<string, readonly string[]>();
    for (const ballot of Object.values(projection.ballots)) for (const candidate of [...ballot.candidacies, ...ballot.filingCandidacies ?? []]) {
      for (const person of ballotCandidatePeople(candidate)) {
        const keys = [...new Set([...ballotCandidateAliases(person), ...person.personId ? [person.personId] : []])];
        for (const key of keys) rows.set(key, keys);
      }
    }
    index = rows; indexes.set(projection, index);
  }
  return index.get(subjectId) ?? [];
}

const profileMatches = new WeakMap<object, { inputs: readonly unknown[]; keys: ReadonlyMap<string, readonly string[]>; people: ReadonlyMap<string, string> }>();

function heldProfileMatches(state: string) {
  let ballot, profiles, registry;
  try {
    ballot = currentGenericBallotProjection(state);
    profiles = currentCandidateProfilesProjection(state);
    registry = getRegistryRuntimeReadModel();
  } catch { return null; }
  const roster = currentStatePeopleProjection(`US-${state}`)?.roster;
  const inputs = [profiles, registry, roster];
  const cached = profileMatches.get(ballot);
  if (cached && inputs.every((value, index) => cached.inputs[index] === value)) return cached;
  const holders: HeldCandidatePerson[] = [...roster?.officeholders ?? [],
    ...registry.statewideExecutives.map(row => row.holder), ...registry.bodyRosters.flatMap(row => row.members)];
  const keys = new Map<string, readonly string[]>(), people = new Map<string, string>();
  for (const value of Object.values(ballot.ballots)) for (const choice of [...value.candidacies, ...value.filingCandidacies ?? []]) {
    for (const person of ballotCandidatePeople(choice)) {
      const aliases = ballotCandidateAliases(person);
      const officialLinks = aliases.flatMap(key => profiles.links.links[key]?.official ?? []);
      const matches = officialLinks.map(official => verifiedCandidateProfilePerson(person, official, holders)).filter(match => match !== null);
      if (!matches.length) continue;
      const related = [...new Set([...aliases, ...matches.flatMap(match => match.keys)])];
      for (const key of related) keys.set(key, [...new Set([...keys.get(key) ?? [], ...related])]);
      for (const key of aliases) people.set(key, matches[0].personId);
    }
  }
  const result = { inputs, keys, people }; profileMatches.set(ballot, result); return result;
}

export function heldCandidatePersonKeys(state: string, subjectId: string): readonly string[] {
  return heldProfileMatches(state)?.keys.get(subjectId) ?? [];
}

/** Exact verified profile/native-id relationship, independent of the office sought. */
export function heldPersonIdForCandidate(state: string, subjectId: string): string | null {
  return heldProfileMatches(state)?.people.get(subjectId) ?? null;
}
