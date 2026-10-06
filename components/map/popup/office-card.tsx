"use client";
import { Card } from "@/components/ui/card";
import { CheckedLink } from "@/components/ui/checked-link";
import { OFFICE_KIND_LABEL, type OfficeSite } from "@/lib/map/office-pins";
import { venueLink } from "@/lib/registry/links";

export function OfficeCard({ site }: { site: OfficeSite }) {
  const directions = venueLink({ name: site.name, address: site.address, lat: site.lat, lng: site.lng });
  return <Card title={site.name} eyebrow={site.offices.length === 1 ? OFFICE_KIND_LABEL[site.offices[0].kind] : "Offices"}
    attrs={{ "data-office-card": site.id }} sources={site.offices.map(office => ({
      what: `${office.name}: office address and contact`, provenance: { sourceUrl: office.sourceUrl, sourceOrg: office.sourceOrg ?? "Office listing",
        collectedAt: office.collectedAt ?? "", verifiedAt: null },
    }))}>
    <p>{site.address}</p>
    {site.offices.map(office => <div key={office.id} className="mt-3">
      {site.offices.length > 1 && <p>{office.name} · {OFFICE_KIND_LABEL[office.kind]}</p>}
      {office.hours && <p>Hours: {office.hours}</p>}
      {office.phone && <p><a href={`tel:${office.phone.replace(/[^+0-9]/g, "")}`}>{office.phone}</a></p>}
    </div>)}
    {directions && <CheckedLink className="mw-pill-btn mw-pill-ring mt-3" href={directions.url} target="_blank" rel="noopener noreferrer">Directions</CheckedLink>}
  </Card>;
}
