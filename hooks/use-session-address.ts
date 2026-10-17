"use client";

import { useMemo, useSyncExternalStore } from "react";
import { readSessionAddress, sessionAddressFor, subscribeToSessionAddress, type SessionAddressScope } from "@/lib/geo/session-address";

/** Every address consumer reads the same device result, including writes from another tab. */
export function useSessionAddressScope(zip: string | null): SessionAddressScope | null {
  const raw = useSyncExternalStore(subscribeToSessionAddress, () => JSON.stringify(sessionAddressFor(zip)), () => "null");
  return useMemo(() => JSON.parse(raw) as SessionAddressScope | null, [raw]);
}

export function useRememberedAddress(): SessionAddressScope | null {
  const raw = useSyncExternalStore(subscribeToSessionAddress, () => JSON.stringify(readSessionAddress()), () => "null");
  return useMemo(() => JSON.parse(raw) as SessionAddressScope | null, [raw]);
}
