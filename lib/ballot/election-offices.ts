/**
 * The offices that run a reader's elections, with their phone lines, as a
 * saved official page names them for the reader's own city or county
 * ("Early ballots can be requested through the Cochise County Elections
 * Office, (520) 432-8970"). Read from the same proven ballot-navigation
 * projection as the registration and polling-place links.
 */
import { currentCuratedReaderRecords } from "../civic-data/curated-reader-read-model.ts";
import { electionFieldIssue, type PublishedElectionField } from "../civic-data/election-fields.ts";

export type ElectionOffice = PublishedElectionField["value"];

/** Each office once (by its phone line), for the reader's divisions only. */
export function currentElectionOffices(divisions: readonly string[]): readonly ElectionOffice[] {
  const lines = new Set<string>();
  return currentCuratedReaderRecords<{ readonly kind: string }>("ballot-navigation", [])
    .filter(row => row.kind === "ELECTION_FIELD" && electionFieldIssue(row) === null)
    .map(row => (row as unknown as PublishedElectionField).value)
    .filter(office => office.fieldKind === "election_office" && divisions.includes(office.divisionId))
    .filter(office => {
      const line = (office.phone ?? "").replace(/\D/g, "");
      if (lines.has(line)) return false;
      lines.add(line);
      return true;
    });
}
