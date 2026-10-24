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

/** A routed meeting task's source and exact body identity, without loading source adapters. */
export function meetingPartitionIdentity(id: string): { readonly source: string; readonly bodyId: string; readonly route?: string } | null {
  const named = /^meetings:([^:]+):(.+)$/.exec(id);
  if (named === null) return null;
  const routed = /^(.*):route:([a-f0-9]{16})$/.exec(named[2]!);
  try {
    return { source: named[1]!, bodyId: decodeURIComponent(routed?.[1] ?? named[2]!), ...(routed ? { route: routed[2]! } : {}) };
  } catch { return null; }
}
