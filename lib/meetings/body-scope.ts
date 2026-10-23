import { ocdStateCode } from "../ocd/state-of.ts";
import { statesForRegistryDivisions } from "../civic-data/state-scopes.ts";

/** The state, DC or territory of a division or body; US for a national body. */
export function meetingStateOf(id: string | null | undefined): string {
  return ocdStateCode(id)?.toUpperCase() ?? statesForRegistryDivisions([id ?? ""])[0] ?? "US";
}
export const divisionOf = (id: string): string => id.split("#")[0]!;

export function meetingPartitionId(sourceName: string, bodyId: string, route?: string): string {
  if (route !== undefined && !/^[a-f0-9]{16}$/.test(route)) throw new Error("MEETING_PARTITION_ROUTE_INVALID");
  return `meetings:${sourceName}:${encodeURIComponent(bodyId)}${route ? `:route:${route}` : ""}`;
}
