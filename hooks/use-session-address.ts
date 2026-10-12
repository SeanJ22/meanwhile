"use client";

import { useMemo, useSyncExternalStore } from "react";
import { sessionAddressFor, subscribeToSessionAddress, type SessionAddressScope } from "@/lib/geo/session-address";

/** Every address consumer reads the same current session result, including writes from another prompt. */
export function useSessionAddressScope(zip: string | null): SessionAddressScope | null {
  const raw = useSyncExternalStore(subscribeToSessionAddress, () => JSON.stringify(sessionAddressFor(zip)), () => "null");
  return useMemo(() => JSON.parse(raw) as SessionAddressScope | null, [raw]);
}
