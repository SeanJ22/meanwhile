import type { CardSource } from "../officials/card-sources.ts";
import type { CampaignSourceRecord } from "./state-source-records.ts";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
export function campaignFinanceRecordText(row: CampaignSourceRecord): string {
  const parts = [row.filerName, row.office, row.period ?? row.transactionDate].filter(Boolean);
  if (row.filingState === "FILED") {
    for (const amount of row.amounts) parts.push(`${amount.label}: ${money.format(amount.amount)}`);
    if (row.organizationName) parts.push(`Filed organization: ${row.organizationName}`);
  }
  if (row.title) parts.push(row.title);
  if (row.filingState === "UNFILED") parts.push("The source marks this document unfiled");
  else if (row.filingState === "ACTIVITY_UNCONFIRMED") parts.push("Registration on file");
  return parts.join(" · ");
}
export function campaignFinanceRecordSources(row: CampaignSourceRecord): CardSource[] {
  const captures = [row.provenance, ...row.amounts.flatMap(amount => amount.provenance ? [amount.provenance] : [])];
  return captures.flatMap(source => [{ what: `Campaign filing${row.nativeId ? ` ${row.nativeId}` : ""}${source.publicationDate ? ` · published ${source.publicationDate}` : ""}`,
    provenance: { kind: "OFFICIAL" as const, sourceOrg: source.publisher, sourceUrl: source.url, collectedAt: source.retrievedAt, verifiedAt: null },
    dataAttrs: { "data-campaign-record": row.id, "data-source-hash": source.rawHash } },
  ...(source.lookup ? [{ what: `Filed report details${source.lookup.publicationDate ? ` · published ${source.lookup.publicationDate}` : ""}`,
    provenance: { kind: "OFFICIAL" as const, sourceOrg: source.publisher, sourceUrl: source.lookup.url, collectedAt: source.lookup.retrievedAt, verifiedAt: null },
    dataAttrs: { "data-campaign-record": row.id, "data-source-hash": source.lookup.rawHash } }] : [])]);
}
