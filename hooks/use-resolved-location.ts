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
 * **THE READER'S RESOLVED LOCATION, FOR ANY SURFACE THAT ASKS.**
 * (WGH-12/13/14, 2026-08-28.)
 *
 * `lib/geo/session-address.ts` has held the confirmed divisions since RULING
 * 74 landed on 2026-08-22. Nothing read it. The one component that wrote it
 * was also the only component that looked at it, so every other surface went
 * on answering from the zip — which is how a card came to display "Set to ...
 * State House District 17" directly above a list of District 19's members.
 *
 * This is the read side, and it is a HOOK rather than a call so a surface
 * cannot hold a stale answer: the address can be settled on the ballot page,
 * on the meeting pill or on this card, and whichever surface is open has to
 * see it without a reload. Same `useSyncExternalStore` shape as
 * `use-stored-zip` and `use-narrowing`, for the same reason — the server
 * renders the zip-only state and the first client pass resolves it, so a
 * returning reader never watches their address flash off.
 *
 * Scoped to the zip, by `sessionAddressFor`: an address resolved in 07866
 * answers nothing about 03255, and treating the two as one would be the
 * product asserting a location the reader never gave it.
 */
/**
 * The subscription belongs to the STORE, not to this hook. (WGH-22,
 * 2026-08-31.)
 *
 * This file used to hold its own listener set and hand it to
 * `subscribeToStorage`. Nothing ever iterated that set: the two writers live
 * in `lib/geo/session-address.ts` and could not see it, so the only
 * notification this hook could ever receive was the cross-tab `storage`
 * event — which by specification never fires in the tab that wrote. A reader
 * confirming their address in their own tab moved the store and told nobody,
 * and this hook went on returning the ZIP-only snapshot it had read at mount.
 *
 * `subscribeToSessionAddress` is the store's own subscription, and it carries
 * both halves. A hook cannot be given a stale answer by a writer it does not
 * know about, because it no longer owns the set the writers must find.
 */
export function useResolvedLocation(zip: string | null): ResolvedLocation {
  const raw = useSyncExternalStore(
    subscribeToSessionAddress,
    () => {
      try {
        return `${zip ?? ""}|${window.sessionStorage.getItem(SESSION_ADDRESS_KEY) ?? ""}`;
      } catch {
        // A refused store means no address, which is the same state as never
        // having given one — never an error to the reader.
        return `${zip ?? ""}|`;
      }
    },
    // The SERVER snapshot. Zip-only is the honest pre-hydration answer: it
    // hedges, and a hedge that turns out to be unnecessary costs a reader
    // nothing, while a confidence that turns out to be wrong costs them the
    // whole page.
    () => `${zip ?? ""}|`,
  );

  // Derived from the raw string so the snapshot stays identity-stable and
  // `useSyncExternalStore` cannot loop.
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
        };
  return cached;
}
