import type { StateOfficeContact } from "../lib/reference/state-offices.ts";
import { Card } from "./ui/card";

/** Server-selected directory rows; no national data or file reader enters the browser. */
export function StateOfficeContacts({ offices }: { offices: readonly StateOfficeContact[] }) {
  if (!offices.length) return null;
  return <section className="mt-4 grid gap-3 sm:grid-cols-2" aria-label="State election and campaign-finance offices" data-state-offices>
    {offices.map(office => <Card key={office.id} title={`${office.stateName} ${office.kind === "ELECTION_OFFICE" ? "election office" : "campaign-finance office"}`}
      attrs={{ "data-state-office": office.kind, "data-office-state": office.state }}
      sources={[{ what: `${office.stateName} ${office.kind === "ELECTION_OFFICE" ? "election office" : "campaign-finance office"}`,
        provenance: { sourceUrl: office.sourceUrl, sourceOrg: "Federal Election Commission", collectedAt: office.checkedAt, verifiedAt: null } }]}>
      <div className="contact-pill-row">
        <a className="contact-pill" href={office.url}>{office.office}</a>
        {office.phone.split(/\s+(?=\d{3}\/)/).map(phone => <a key={phone} className="contact-pill" href={`tel:+1${phone.replace(/\D/g, "")}`}>{phone}</a>)}
      </div>
    </Card>)}
  </section>;
}
