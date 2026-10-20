import type { CardSource } from "../officials/card-sources.ts";
import type { CampaignMoneyCycle } from "./state-reader.ts";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
export function campaignFinanceRecordText(row: CampaignMoneyCycle): string {
  return [row.person.name, row.committee, `${row.cycle} cycle`, ...row.totals.map(amount => `${amount.label}: ${money.format(amount.amount)}`)].join(" · ");
}
export function campaignFinanceRecordSources(row: CampaignMoneyCycle): CardSource[] {
  return row.sources.map(source => ({ what: `Campaign filing · ${row.cycle} cycle${source.publicationDate ? ` · published ${source.publicationDate}` : ""}`,
    provenance: { kind: "OFFICIAL", sourceOrg: source.publisher, sourceUrl: source.filingUrl, collectedAt: source.retrievedAt, verifiedAt: source.retrievedAt },
    dataAttrs: { "data-campaign-record": row.id, "data-source-hash": source.rawHash } }));
}
