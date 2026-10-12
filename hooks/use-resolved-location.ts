"use client";

import { useSyncExternalStore } from "react";

import {
  SESSION_ADDRESS_KEY,
  sessionAddressFor,
  subscribeToSessionAddress,
} from "@/lib/geo/session-address";
import {
  zipOnly,
  type ResolvedLocation,
} from "@/lib/state/resolved-location";

/**
 * The reader's resolved location, from `lib/geo/session-address.ts`, scoped
 * to the zip by `sessionAddressFor`. A hook so every open surface sees an
 * address settled anywhere without a reload. `subscribeToSessionAddress` is
 * the store's own subscription, covering same-tab writes and cross-tab
 * `storage` events.
 */
export function useResolvedLocation(zip: string | null): ResolvedLocation {
  const raw = useSyncExternalStore(
    subscribeToSessionAddress,
    () => {
      try {
        return `${zip ?? ""}|${window.sessionStorage.getItem(SESSION_ADDRESS_KEY) ?? ""}`;
      } catch {
        // A refused store means no address, never an error.
        return `${zip ?? ""}|`;
      }
    },
    // Server snapshot: zip-only, which hedges.
    () => `${zip ?? ""}|`,
  );

  // Derived from the raw string so the snapshot stays identity-stable.
  return snapshotFor(raw, zip);
}

let cachedRaw: string | null = null;
let cached: ResolvedLocation = zipOnly(null);

function snapshotFor(raw: string, zip: string | null): ResolvedLocation {
  if (raw === cachedRaw) return cached;
  const scope = sessionAddressFor(zip);
  cachedRaw = raw;
  cached =
    scope === null
      ? zipOnly(zip)
      : {
          certainty: "ADDRESS_RESOLVED",
          zip,
          confirmedDivisionIds: scope.divisionIds,
          splitLevels: scope.splitLevels,
          excludedDivisionIds: scope.excludedDivisionIds,
        };
  return cached;
}
