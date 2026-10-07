import { officialStateVoteScopeForOfficeholderId } from "../state-rollcalls/authority.ts";

/** Whether the member directory source reaches this person at all, asked in one place for every surface. */

/** About our sourcing, never the person: false means this source does not reach them. */
export function memberDirectoryReaches(holderId: string, section: "committees" | "offices" = "committees"): boolean {
  if (holderId.startsWith("congress:")) return true;
  // Offices also reach state legislators, carried from Open States onto the legislature's own roster row. Committees
  // stay federal.
  return section === "offices" && officialStateVoteScopeForOfficeholderId(holderId) !== null;
}
