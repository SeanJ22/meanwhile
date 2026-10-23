import type { CardSource } from "../officials/card-sources.ts";
import type { CampaignMoneyCycle } from "./state-reader.ts";
import { smallDonorSentence } from "./small-donors.ts";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
export function campaignFinanceRecordText(row: CampaignMoneyCycle): string {
  return [row.person.name, row.committee, `${row.cycle} cycle`, ...row.totals.map(amount => `${amount.label}: ${money.format(amount.amount)}`),
    smallDonorSentence(row.individualLarge??null,row.individualSmall??null),
    ...row.donors?.filter(donor=>donor.kind==="COMMITTEE_OR_ORGANIZATION" || donor.kind==="INDIVIDUAL" && donor.amount>200)
      .map(donor=>`${donor.filedName}: ${money.format(donor.amount)}`)??[]].filter(Boolean).join(" · ");
}
export function campaignFinanceRecordSources(row: CampaignMoneyCycle): CardSource[] {
  return row.sources.flatMap(source => [...new Set([source.url,source.filingUrl])].map(url=>({ what: `Campaign records · ${row.cycle} cycle${source.publicationDate ? ` · published ${source.publicationDate}` : ""}`,
    provenance: { kind: "OFFICIAL" as const, sourceOrg: source.publisher, sourceUrl: url, collectedAt: source.retrievedAt, verifiedAt: source.checkedAt??source.retrievedAt },
    dataAttrs: { "data-campaign-record": row.id, "data-source-hash": source.rawHash } })));
}
