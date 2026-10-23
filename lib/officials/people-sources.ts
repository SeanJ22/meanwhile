import type { RoutineRecordClass } from "../civic-data/types.ts";

/** Independent nationally loaded sources, retained as state-sized reader shards. */
export const PEOPLE_SOURCE_IDS = ["legiscan-api", "official-state-people", "statewide-executive-sources", "wikidata-people", "congress-api", "govinfo", "people-portraits"] as const;
export type PeopleSourceId = typeof PEOPLE_SOURCE_IDS[number];
export function isPeopleSource(sourceId: string): sourceId is PeopleSourceId {
  return PEOPLE_SOURCE_IDS.some(id => id === sourceId);
}
export function peopleSourceScope(jurisdiction: string, sourceId: string): string {
  return `${jurisdiction}:people:${sourceId === "people-portraits" ? "portraits" : sourceId}:v1`;
}
export function peopleSourceRecordClass(sourceId: string): RoutineRecordClass {
  return sourceId === "congress-api" || sourceId === "govinfo" ? "FEDERAL_DIRECTORY" : "STATE_LEGISLATOR";
}
