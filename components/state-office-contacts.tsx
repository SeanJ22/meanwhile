import type { StateOfficeContact } from "../lib/reference/state-offices.ts";

/** Server-selected directory rows; no national data or file reader enters the browser. */
export function StateOfficeContacts({ offices }: { offices: readonly StateOfficeContact[] }) {
  if (!offices.length) return null;
  return <section className="mt-4 space-y-3" aria-label="State election and campaign-finance offices" data-state-offices>
    {offices.map(office => <div key={office.id} data-state-office={office.kind} data-office-state={office.state}>
      <h3 className="t-heading text-voice">{office.stateName} {office.kind === "ELECTION_OFFICE" ? "election office" : "campaign-finance office"}</h3>
      <p className="mt-1 t-detail text-voice"><a className="text-link underline decoration-dotted underline-offset-2" href={office.url}>{office.office}</a></p>
      <p className="t-detail text-voice">{office.phone.split(/\s+(?=\d{3}\/)/).map((phone, index) => <span key={phone}>{index > 0 ? " · " : ""}<a href={`tel:+1${phone.replace(/\D/g, "")}`}>{phone}</a></span>)}</p>
      <details className="mt-1 t-caption text-muted"><summary className="cursor-pointer">Sources</summary><p><a href={office.sourceUrl}>Federal Election Commission</a> · Checked {office.checkedAt}</p></details>
    </div>)}
  </section>;
}
