import type { StateOfficeContact } from "../lib/reference/state-offices.ts";
import { Card } from "./ui/card";
import { readerText } from "../lib/text/reader-names.ts";

/** Server-selected directory rows; no national data or file reader enters the browser. */
export function StateOfficeContacts({ offices }: { offices: readonly StateOfficeContact[] }) {
  if (!offices.length) return null;
  return <section className="mt-4 space-y-3" aria-label="State election and campaign-finance offices" data-state-offices>
    {offices.map(office => <Card key={office.id} title={`${office.stateName} ${office.kind === "ELECTION_OFFICE" ? "election office" : "campaign-finance office"}`}
      attrs={{ "data-state-office": office.kind, "data-office-state": office.state }}
      sources={[{ what: `${office.stateName} ${office.kind === "ELECTION_OFFICE" ? "election office" : "campaign-finance office"}`,
        provenance: { sourceUrl: office.sourceUrl, sourceOrg: "Federal Election Commission", collectedAt: office.checkedAt, verifiedAt: null } }]}>
      <p className="mt-1 t-detail text-voice"><a className="text-link underline decoration-dotted underline-offset-2" href={office.url}>{readerText(office.office)}</a></p>
      <p className="t-detail text-voice">{office.phone.split(/\s+(?=\d{3}\/)/).map((phone, index) => <span key={phone}>{index > 0 ? " · " : ""}<a href={`tel:+1${phone.replace(/\D/g, "")}`}>{phone}</a></span>)}</p>
    </Card>)}
  </section>;
}
