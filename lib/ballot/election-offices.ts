import { currentElectionFields } from "../civic-data/curated-reader-read-model.ts";
import type { PublishedElectionField } from "../civic-data/election-fields.ts";

export type ElectionOffice = PublishedElectionField["value"];

export function currentElectionOffices(divisions: readonly string[]): readonly ElectionOffice[] {
  const lines = new Set<string>();
  return currentElectionFields()
    .map(row => row.value)
    .filter(office => office.fieldKind === "election_office" && divisions.some(division =>
      division === office.divisionId || division.startsWith(`${office.divisionId}/`)))
    .filter(office => {
      const line = (office.phone ?? "").replace(/\D/g, "");
      if (lines.has(line)) return false;
      lines.add(line);
      return true;
    });
}
