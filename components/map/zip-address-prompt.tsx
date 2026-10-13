"use client";

import { AddressPrompt } from "@/components/address/address-prompt";
import { useAddressResolution } from "@/components/address/address-resolution-context";
import { nearestZctaAsync } from "@/lib/geo/zcta-table";
import { sessionAddressFor, writeSessionAddress } from "@/lib/geo/session-address";
import { recordLocationOrigin } from "@/lib/state/location-origin";

/** The same address resolver is ready on first entry, postal destinations and ZIP changes. */
export function ZipAddressPrompt({ zip, onLocated }: {
  zip: string;
  onLocated: (zip: string, lat: number, lng: number) => void;
}) {
  const handlers = useAddressResolution();
  return <AddressPrompt
    key={zip}
    zip={zip}
    startOpen
    postalEntry
    onResolved={handlers.onResolved}
    onPoint={async point => {
      const near = await nearestZctaAsync(point.lat, point.lng);
      const destination = near?.zip ?? zip;
      const scope = sessionAddressFor(zip);
      if (scope && destination !== zip) writeSessionAddress({ ...scope, zip: destination });
      recordLocationOrigin(destination, "ADDRESS_RESOLVED");
      onLocated(destination, point.lat, point.lng);
    }}
  />;
}
