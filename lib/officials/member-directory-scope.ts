import { statePeopleScopeForId } from "./people-identity.ts";
/** Source reach is independent of whether an optional office is already held. */
export function memberDirectoryReaches(holderId: string, section: "committees" | "offices" = "committees", state?: string): boolean {
  return /^congress:[A-Z]\d{6}$/.test(holderId) || section === "offices" && statePeopleScopeForId(holderId,state) !== null;
}
