"use client";

import { postalAreaMessage } from "@/lib/geo/postal-core";
import type { ZctaCentroid } from "@/lib/geo/zcta-core";
import { ZipAddressPrompt } from "./zip-address-prompt";

export function PostalZipNotice({ location, onLocated, hidden = false }: {
  location: ZctaCentroid;
  onLocated: (zip: string, lat: number, lng: number) => void;
  hidden?: boolean;
}) {
  if (hidden || !location.postal || location.postal.type === "standard") return null;
  return <section className="zip-postal-entry" aria-label="Mailing ZIP location">
    <p role="status">{postalAreaMessage(location.postal)}</p>
    <ZipAddressPrompt zip={location.zip} onLocated={onLocated} />
  </section>;
}
