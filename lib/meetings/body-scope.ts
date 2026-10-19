import { ocdStateCode } from "../ocd/state-of.ts";
import { statesForRegistryDivisions } from "../civic-data/state-scopes.ts";

/** The state, DC or territory of a division or body; US for a national body. */
export function meetingStateOf(id: string | null | undefined): string {
  return ocdStateCode(id)?.toUpperCase() ?? statesForRegistryDivisions([id ?? ""])[0] ?? "US";
}
export const divisionOf = (id: string): string => id.split("#")[0]!;

export function meetingPartitionId(sourceName: string, bodyId: string): string {
  return `meetings:${sourceName}:${encodeURIComponent(bodyId)}`;
}
