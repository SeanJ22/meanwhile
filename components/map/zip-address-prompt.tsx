"use client";

import { AddressPrompt } from "@/components/address/address-prompt";
import { useAddressResolution } from "@/components/address/address-resolution-context";
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
    onPoint={point => {
      recordLocationOrigin(zip, "ADDRESS_RESOLVED");
      onLocated(zip, point.lat, point.lng);
    }}
  />;
}
