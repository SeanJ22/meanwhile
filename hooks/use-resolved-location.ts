"use client";

import { useSessionAddressScope } from "@/hooks/use-session-address";
import { zipOnly, type ResolvedLocation } from "@/lib/state/resolved-location";

/** Representation uses the remembered address result; ballot exclusions are separate. */
export function useResolvedLocation(zip: string | null): ResolvedLocation {
  const scope = useSessionAddressScope(zip);
  return scope === null ? zipOnly(zip) : {
    certainty: "ADDRESS_RESOLVED", zip,
    confirmedDivisionIds: scope.divisionIds,
    splitLevels: scope.splitLevels,
  };
}
