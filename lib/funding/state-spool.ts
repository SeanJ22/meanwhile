import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CAMPAIGN_FINANCE_JOIN_REASONS, type CampaignSourceRecord } from "./state-source-records.ts";
import type { CampaignFinanceResource } from "./state-sources.ts";

const FIELDS = ["nativeId", "nativeIdScope", "projectionOrdinal", "filerId", "filerName", "filingState", "candidateName", "organizationName", "office", "period", "transactionDate", "nativeGovernmentId", "issues", "unavailableAmounts"] as const;
const REASONS = Object.values(CAMPAIGN_FINANCE_JOIN_REASONS);
type Provenance = CampaignSourceRecord["provenance"];
type Observation = Omit<Provenance, "publicationDate">;
type Pair<T> = readonly [number, T];
type Encoded = [unknown[], Pair<number>[], number | string, Pair<string>[], number, string | null, string | null, string];

export class CampaignFinanceSpool {
  private written: string | null = null;
  private first: string | null = null;
  private read: { readonly id: string; readonly value: Observation } | null = null;
  private readonly directory: string;
  private readonly state: string;
  private readonly resource: CampaignFinanceResource;
  private readonly titles: readonly string[];
  constructor(directory: string, state: string, resource: CampaignFinanceResource) {
    this.directory = directory; this.state = state; this.resource = resource;
    this.titles = [...new Set(Object.values(resource.summaryLine?.labels ?? {}).flatMap(lines => Object.values(lines)))];
  }

  async encode(row: CampaignSourceRecord): Promise<string> {
    const { publicationDate, ...observation } = row.provenance;
    const text = JSON.stringify(observation), key = createHash("sha256").update(text).digest("hex");
    this.first ??= key;
    if (key !== this.written) { await writeFile(join(this.directory, key), text); this.written = key; }
    const amounts = row.amounts.map(amount => [this.resource.amounts.findIndex(field => field.label === amount.label), amount.amount] as const);
    const qualifiers = row.qualifiers.map(value => [(this.resource.qualifiers ?? []).findIndex(field => field.label === value.label), value.value] as const);
    if (amounts.some(([index]) => index < 0) || qualifiers.some(([index]) => index < 0) ||
        row.unjoinedReason !== null && !REASONS.includes(row.unjoinedReason as typeof REASONS[number])) throw new Error("Campaign spool contains a fact outside its source descriptor.");
    return JSON.stringify([FIELDS.map(field => row[field]), amounts, row.title === null ? -1 : this.titles.includes(row.title) ? this.titles.indexOf(row.title) : row.title, qualifiers,
      row.unjoinedReason === null ? -1 : REASONS.indexOf(row.unjoinedReason as typeof REASONS[number]), row.filingUrl === observation.url ? null : row.filingUrl,
      publicationDate, key === this.first ? "" : key] satisfies Encoded);
  }

  async decode(id: string, text: string): Promise<CampaignSourceRecord> {
    const [values, amounts, title, qualifiers, reason, filingUrl, publicationDate, observation] = JSON.parse(text) as Encoded;
    const key = observation || this.first!;
    if (this.read?.id !== key) this.read = { id: key, value: JSON.parse(await readFile(join(this.directory, key), "utf8")) };
    const source = this.read.value;
    return { ...Object.fromEntries(FIELDS.map((field, index) => [field, values[index]])) as Pick<CampaignSourceRecord, typeof FIELDS[number]>,
      id: `${this.state}:${this.resource.id}:${id}`, state: this.state, resource: this.resource.id, governmentOcdId: this.resource.governmentOcdId ?? null,
      amounts: amounts.map(([index, amount]) => ({ label: this.resource.amounts[index].label, amount })),
      qualifiers: qualifiers.map(([index, value]) => ({ label: this.resource.qualifiers![index].label, value })),
      title: typeof title === "string" ? title : title < 0 ? null : this.titles[title], unjoinedReason: reason < 0 ? null : REASONS[reason], filingUrl: filingUrl ?? source.url,
      provenance: { ...source, publicationDate } };
  }
}
