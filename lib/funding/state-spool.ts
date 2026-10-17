import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CAMPAIGN_FINANCE_JOIN_REASONS, type CampaignSourceRecord } from "./state-source-records.ts";
import type { CampaignFinanceResource } from "./state-sources.ts";

const FIELDS = ["nativeId", "projectionOrdinal", "committeeId", "committeeName", "candidateName", "organizationName", "office", "period", "transactionDate", "nativeGovernmentId", "issues", "invalidAmounts"] as const;
const REASONS = Object.values(CAMPAIGN_FINANCE_JOIN_REASONS);
type Provenance = CampaignSourceRecord["provenance"];
type Observation = Omit<Provenance, "rawHash" | "vaultKey" | "byteLength" | "publicationDate"> & {
  readonly vault: { readonly key: string; readonly hash: string; readonly bytes: number } | { readonly prefix: string };
};
type Pair<T> = readonly [number, T];
type Encoded = [unknown[], Pair<number>[], number, Pair<string>[], number, string | null, string | null, number | null, string | null, string];

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
    const { rawHash, vaultKey, byteLength, publicationDate, ...source } = row.provenance;
    if (source.storage === "CHUNK" && !vaultKey.endsWith(rawHash)) throw new Error("Campaign capture key does not carry its source hash.");
    const archive = source.storage === "ARCHIVE";
    const observation: Observation = { ...source, vault: archive ? { key: vaultKey, hash: rawHash, bytes: byteLength } : { prefix: vaultKey.slice(0, -rawHash.length) } };
    const text = JSON.stringify(observation), key = createHash("sha256").update(text).digest("hex");
    this.first ??= key;
    if (key !== this.written) { await writeFile(join(this.directory, key), text); this.written = key; }
    const amounts = row.amounts.map(amount => [this.resource.amounts.findIndex(field => field.label === amount.label), amount.amount] as const);
    const qualifiers = row.qualifiers.map(value => [(this.resource.qualifiers ?? []).findIndex(field => field.label === value.label), value.value] as const);
    return JSON.stringify([FIELDS.map(field => row[field]), amounts, row.title === null ? -1 : this.titles.indexOf(row.title), qualifiers,
      row.unjoinedReason === null ? -1 : REASONS.indexOf(row.unjoinedReason as typeof REASONS[number]), row.filingUrl === source.url ? null : row.filingUrl,
      archive ? null : rawHash, archive ? null : byteLength, publicationDate, key === this.first ? "" : key] satisfies Encoded);
  }

  async decode(id: string, text: string): Promise<CampaignSourceRecord> {
    const [values, amounts, title, qualifiers, reason, filingUrl, hash, bytes, publicationDate, observation] = JSON.parse(text) as Encoded;
    const key = observation || this.first!;
    if (this.read?.id !== key) this.read = { id: key, value: JSON.parse(await readFile(join(this.directory, key), "utf8")) };
    const { vault, ...source } = this.read.value;
    const rawHash = "key" in vault ? vault.hash : hash!, byteLength = "key" in vault ? vault.bytes : bytes!;
    return { ...Object.fromEntries(FIELDS.map((field, index) => [field, values[index]])) as Pick<CampaignSourceRecord, typeof FIELDS[number]>,
      id: `${this.state}:${this.resource.id}:${id}`, state: this.state, resource: this.resource.id, governmentOcdId: this.resource.governmentOcdId ?? null,
      amounts: amounts.map(([index, amount]) => ({ label: this.resource.amounts[index].label, amount })),
      qualifiers: qualifiers.map(([index, value]) => ({ label: this.resource.qualifiers![index].label, value })),
      title: title < 0 ? null : this.titles[title], unjoinedReason: reason < 0 ? null : REASONS[reason], filingUrl: filingUrl ?? source.url,
      provenance: { ...source, rawHash, byteLength, publicationDate, vaultKey: "key" in vault ? vault.key : `${vault.prefix}${rawHash}` } };
  }
}
