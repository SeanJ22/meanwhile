"use client";

import { useEffect } from "react";

import { useActiveScroll } from "@/hooks/use-active-scroll";
import { captureEvent } from "@/lib/events/client";
import { readLocationOriginFor } from "@/lib/state/location-origin";

/**
 * What a reader does on the ballot page that the page itself cannot see: the
 * ZIP being viewed (with how it was reached) and how long they scroll. The
 * ballot is a server component, so this renders nothing and runs the hooks.
 */
export function BallotCapture({ zip }: { zip: string | null }) {
  useActiveScroll("BALLOT");
  useEffect(() => {
    if (zip) captureEvent({ type: "ZIP_VIEW", zip, locationOrigin: readLocationOriginFor(zip) });
  }, [zip]);
  return null;
}
