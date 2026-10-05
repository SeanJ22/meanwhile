import type { OfficialFiling } from "../../lib/civic-data/official-filings";

const labels: Record<string, string> = { candidateName: "Candidate", office: "Office as filed", electionDate: "Election date",
  filingDate: "Filing date", filingStatus: "Status as filed", party: "Party as filed", committeeName: "Committee",
  committeeId: "Agency committee ID", filingPeriod: "Reporting period", reportType: "Report type", currency: "Currency",
  receipts: "Reported receipts", expenditures: "Reported expenditures", cashOnHand: "Reported cash on hand" };

export function OfficialFilings({ rows }: { rows: readonly OfficialFiling[] }) {
  if (!rows.length) return null;
  return <section aria-label="Official filing records" className="my-6 space-y-3">
    <h2 className="t-title font-semibold">Official filing records</h2>
    <p className="t-body text-voice">These are facts in published filings for governments in this ZIP area. A filing alone does not establish a current ballot position. Committee figures are the committee’s reported figures.</p>
    {rows.map(row => <article key={row.id} data-official-filing={row.id} className="rounded border border-rule p-4">
      <h3 className="font-semibold">{String(row.facts.candidateName ?? row.facts.committeeName)}</h3>
      <p className="t-body">{row.jurisdictionName}{" · "}{row.bodyName}</p>
      <dl>{Object.entries(row.facts).filter(([key]) => !["candidateName", "committeeName"].includes(key)).map(([key, value]) =>
        <div key={key}><dt className="inline text-voice">{labels[key]}: </dt><dd className="inline">{String(value)}</dd></div>)}</dl>
      <p className="mt-2 t-body"><a href={row.documentUrl}>Read the official filing</a>{" · "}<a href={row.sourceUrl}>Source</a>{" · "}Read {row.collectedAt.slice(0, 10)}</p>
    </article>)}
  </section>;
}
