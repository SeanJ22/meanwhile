/** Distinct source-task identity for the original-hunt Cochise slice.
 * The production write contract remains the registered voting-sites contract. */
export const COCHISE_VOTING_SOURCE_TASK_ID = "voting-sites:cochise-2026";
export const VOTING_SITES_REGISTERED_CONTRACT_ID = "voting-sites";

export function votingSitesReceiptSource(cochiseOnly: boolean): string {
  return cochiseOnly ? COCHISE_VOTING_SOURCE_TASK_ID : VOTING_SITES_REGISTERED_CONTRACT_ID;
}
