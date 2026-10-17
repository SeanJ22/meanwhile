"use client";

import { useEffect } from "react";

import { useActiveScroll } from "@/hooks/use-active-scroll";
import { captureEvent } from "@/lib/events/client";
import { readLocationOriginFor } from "@/lib/state/location-origin";
import { readSessionAddress } from "@/lib/geo/session-address";
import { getOrCreateBrowserKey } from "@/lib/state/browser-key";
import { logEvent } from "@/lib/log/client";

/**
 * What a reader does on the ballot page that the page itself cannot see: the
 * ZIP being viewed (with how it was reached) and how long they scroll. The
 * ballot is a server component, so this renders nothing and runs the hooks.
 */
export function BallotCapture({ zip, ocdIds }: { zip: string | null; ocdIds: string[] }) {
  useActiveScroll("BALLOT");
  useEffect(() => {
    if (zip) captureEvent({ type: "ZIP_VIEW", zip, locationOrigin: readLocationOriginFor(zip) });
    const remembered = readSessionAddress();
    if (!zip && remembered) return; // The remembered-address redirect records the resolved ballot view.
    const scope = remembered && (!zip || remembered.zip === zip) ? remembered : null;
    logEvent("BALLOT_VIEWED", scope?.divisionIds ?? ocdIds, { page: "BALLOT" },
      scope?.zip ?? zip, getOrCreateBrowserKey("wtp.ask_key"));
  }, [zip, ocdIds]);
  return null;
}
