import type { OfficialStateLegislatorReadModel } from "./candidate-builders.ts";
import { readPromotedCivicData, type PromotedCivicDataReadOptions } from "./read-model.ts";
import { isPeopleSource, peopleSourceRecordClass, peopleSourceScope } from "../officials/people-sources.ts";

/** The read side of the people sources, apart from publication so the crawlers'
 * file reads never enter a reader route's bundle. */
export interface PeopleSourceReadModel extends Omit<OfficialStateLegislatorReadModel,"jurisdiction"> {
  readonly jurisdiction: "US" | `US-${string}`;
}
export function peopleJurisdiction(state: string): PeopleSourceReadModel["jurisdiction"] {
  return state === "US" ? "US" : `US-${state.replace(/^US-/i, "").toUpperCase()}`;
}
export async function readPeopleSourceProjection(jurisdiction: PeopleSourceReadModel["jurisdiction"], sourceId: string, options: PromotedCivicDataReadOptions = {}) {
  if (!isPeopleSource(sourceId)) throw Error("PEOPLE_SOURCE_UNREGISTERED");
  const result = await readPromotedCivicData<PeopleSourceReadModel>(peopleSourceRecordClass(jurisdiction, sourceId), peopleSourceScope(jurisdiction, sourceId), options);
  if (result.kind === "PROMOTED" || result.kind === "BOOTSTRAP") {
    const value = result.value, roster = value.roster;
    const ids = new Set(roster.officeholders.map(row=>row.id));
    if (value.formatVersion !== 1 || value.sourceId !== sourceId || value.jurisdiction !== jurisdiction || ids.size !== roster.officeholders.length ||
      roster.officeholders.some(row=>!row.id || !row.name || !row.officeTitle || !row.provenance.sourceUrl || jurisdiction !== "US" && row.state?.toUpperCase() !== jurisdiction.slice(3)) ||
      roster.divisions.some(row=>!ids.has(row.officeholderId))) throw Error("PEOPLE_SOURCE_PROJECTION_INVALID");
  }
  return result;
}
