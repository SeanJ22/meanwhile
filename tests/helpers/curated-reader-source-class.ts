import type { ManualSourceClass } from "../../lib/civic-data/types.ts";

/** One test fixture mapping for the four reviewed curated-Reader families. */
export function curatedReaderSourceClass(contractId: string): ManualSourceClass {
  if (contractId === "ballot-navigation") return "ELECTION_AUTHORITY";
  if (contractId === "campaign-sites") return "CANDIDATE_CONTROLLED";
  if (contractId === "member-offices") return "REFERENCE_PUBLISHER";
  return "OFFICIAL_PUBLISHER";
}
