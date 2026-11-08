import { type StatePeopleJurisdiction } from "../officials/people-identity.ts";
import { currentReaderAuthorityEdge, type ReaderAuthorityEdgeBundle } from "../registry/runtime-edge.ts";
import type { OfficialStateLegislatorReadModel } from "../civic-data/candidate-builders.ts";

const requestPeople = new WeakMap<ReaderAuthorityEdgeBundle, Map<StatePeopleJurisdiction, OfficialStateLegislatorReadModel>>();

let standalonePeople: OfficialStateLegislatorReadModel | null = null;

export function primeStatePeopleProjection(value: OfficialStateLegislatorReadModel): void {
  const request = currentReaderAuthorityEdge();
  if (!request) { standalonePeople = value; return; }
  const people = requestPeople.get(request) ?? new Map();
  people.set(value.jurisdiction, value);
  requestPeople.set(request, people);
}

export function dropStatePeopleProjection(jurisdiction: StatePeopleJurisdiction): void {
  const request = currentReaderAuthorityEdge();
  if (request) requestPeople.get(request)?.delete(jurisdiction);
  else if (standalonePeople?.jurisdiction === jurisdiction) standalonePeople = null;
}

export function currentStatePeopleProjection(scope: StatePeopleJurisdiction): OfficialStateLegislatorReadModel | null {
  const request = currentReaderAuthorityEdge();
  return request ? requestPeople.get(request)?.get(scope) ?? null
    : standalonePeople?.jurisdiction === scope ? standalonePeople : null;
}
