import type { OfficialStateLegislatorReadModel } from "./candidate-builders.ts";
import { readPromotedCivicData, type PromotedCivicDataReadOptions } from "./read-model.ts";

export async function readOfficialRosterProjection(scope: string, options: PromotedCivicDataReadOptions = {}) {
  const read = await readPromotedCivicData<OfficialStateLegislatorReadModel>("STATE_LEGISLATOR", scope, options);
  if (read.kind === "PROMOTED") {
    const value = read.value;
    if (value.formatVersion !== 1 || value.sourceId !== "official-rosters" || !Array.isArray(value.roster?.officeholders) ||
      !Array.isArray(value.roster.divisions) || value.roster.officeholders.some(row => !row.id || !row.name || !row.officeTitle || !row.provenance.sourceUrl)) {
      throw new Error("OFFICIAL_ROSTER_PROJECTION_INVALID");
    }
    const ids = new Set(value.roster.officeholders.map(row => row.id));
    if (ids.size !== value.roster.officeholders.length || value.roster.divisions.some(row => !ids.has(row.officeholderId))) throw new Error("OFFICIAL_ROSTER_IDENTITY_INVALID");
    if (value.roster.vacancies?.some(row => !row.id || !row.divisionId || !row.provenance.sourceUrl || row.since !== null && !/^\d{4}-\d{2}-\d{2}$/.test(row.since))) throw new Error("OFFICIAL_VACANCY_INVALID");
  }
  return read;
}
