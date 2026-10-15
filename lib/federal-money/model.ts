export const FEDERAL_MONEY_SOURCES = ["usaspending", "federal-audit-clearinghouse", "sam-gov-entities", "openfema"] as const;
export type FederalMoneySource = typeof FEDERAL_MONEY_SOURCES[number];
export const FEDERAL_MONEY_RECORD_CLASS = "FEDERAL_MONEY" as const;
export const FEDERAL_MONEY_PARSER = "federal-money/2";
export function federalMoneyScope(source: FederalMoneySource, state: string) { return `${source}:${state.toUpperCase()}`; }

export interface FederalMoneyFact {
  readonly id: string;
  readonly source: FederalMoneySource;
  readonly sourceId: string;
  readonly state: string;
  readonly kind: "GRANT" | "CONTRACT" | "LOAN" | "AUDIT" | "ENTITY" | "DISASTER";
  readonly title: string;
  readonly amount: number | null;
  readonly amountLabel: string | null;
  readonly period: string | null;
  readonly recipient: string | null;
  readonly uei: string | null;
  readonly identifiers: Readonly<Record<string, string>>;
  readonly geography: readonly { readonly type: "county" | "place" | "school" | "congressional"; readonly geoid: string }[];
  readonly bodyIds: readonly string[];
  readonly divisionIds: readonly string[];
  readonly joinStatus: "JOINED" | "UNJOINED";
  readonly joinReason: string;
  readonly details: Readonly<Record<string, string | number | boolean | null>>;
  readonly provenance: { readonly sourceUrl: string; readonly sourceOrg: string; readonly publicationDate: string | null; readonly retrievedAt: string; readonly official: true; readonly rawHash: string };
}
export interface FederalMoneyCapture {
  readonly url: string;
  readonly rawHash: string;
  readonly vaultKey: string;
  readonly byteLength: number;
  readonly format: "csv" | "json";
  readonly archiveId?: string;
  readonly retrievedAt: string;
  readonly publicationDate: string | null;
}
export interface FederalMoneyPage {
  readonly facts: readonly FederalMoneyFact[];
  readonly captures: readonly FederalMoneyCapture[];
  readonly complete: boolean;
  readonly declaredTotal: number | null;
  readonly continuation?: FederalMoneyCursor | null;
}
export interface FederalMoneyCursor {
  readonly source: FederalMoneySource;
  readonly phase: string;
  readonly offset?: number;
  readonly category?: number;
  readonly location?: "performance" | "recipient";
  readonly statusUrl?: string;
  readonly fileUrl?: string;
  readonly reportIds?: readonly string[];
  readonly nextOffset?: number;
  readonly generalComplete?: boolean;
  readonly since?: string;
  readonly registered?: boolean;
  readonly year?: number;
  readonly bulkId?: string;
  readonly chunkIndex?: number;
}
export interface FederalMoneyPartition {
  readonly year: string;
  readonly place: string;
  readonly shard: string;
}
export interface FederalMoneyCounts {
  readonly loaded: number;
  readonly joined: number;
  readonly unjoined: number;
}
export interface FederalMoneyProjection {
  readonly formatVersion: 2;
  readonly source: FederalMoneySource;
  readonly state: string;
  readonly partition: FederalMoneyPartition;
  readonly records: readonly FederalMoneyFact[];
  readonly lookupKeys: readonly string[];
  readonly counts: FederalMoneyCounts;
  readonly children?: readonly string[];
  readonly subtreeCounts?: FederalMoneyCounts;
  readonly childCounts?: Readonly<Record<string, FederalMoneyCounts>>;
}
export interface FederalMoneyCheckpoint {
  readonly formatVersion: 2;
  readonly source: FederalMoneySource;
  readonly state: string;
  readonly counts: FederalMoneyCounts;
  readonly checkpoint: {
    readonly cursor: FederalMoneyCursor | null;
    readonly complete: boolean;
    readonly lastCompleteAt: string | null;
    readonly refreshStartedAt: string | null;
    readonly pending?: {
      readonly page: Omit<FederalMoneyPage, "facts">;
      readonly baselines: Readonly<Record<string, FederalMoneyCounts>>;
      readonly priorLocations: readonly { readonly id: string; readonly partition: FederalMoneyPartition }[];
    };
  };
}
export const FEDERAL_MONEY_PARTITION_ROWS = 500;
export const FEDERAL_MONEY_PARTITION_BYTES = 4 * 1024 * 1024;
export function federalMoneyPartitionWithinBounds(records: readonly unknown[]): boolean {
  return records.length <= FEDERAL_MONEY_PARTITION_ROWS && (records.length <= 1 || Buffer.byteLength(JSON.stringify(records)) <= FEDERAL_MONEY_PARTITION_BYTES);
}
export function federalMoneyPartitionScope(source: FederalMoneySource, state: string, partition: FederalMoneyPartition) {
  return `${federalMoneyScope(source, state)}:${partition.year}:${encodeURIComponent(partition.place)}:${partition.shard || "root"}`;
}

export function federalMoneyLookupKeys(records: readonly FederalMoneyFact[]): string[] {
  return [...new Set(records.flatMap(row => [`id:${row.id}`, ...(row.source === "sam-gov-entities" && row.kind === "ENTITY" && row.uei ? [`uei:${row.uei}`] : []),
    ...(row.identifiers.reportId && row.details.table === "general" ? [`report:${row.identifiers.reportId}`] : [])]))].sort();
}

export function federalMoneyPartitionOf(fact: FederalMoneyFact): FederalMoneyPartition {
  if (fact.kind === "ENTITY") {
    const district = fact.details.congressionalDistrict;
    return { year: "registration", place: typeof district === "string" && district.trim() ? `registration-address-district:${district}` : "registration-unlocated", shard: "" };
  }
  const year = /^\d{4}/.exec(fact.period ?? "")?.[0] ?? "undated";
  const geo = fact.geography.find(row => row.type === "county") ?? fact.geography[0];
  const place = geo ? `${geo.type}:${geo.geoid}` : (fact.uei ? `uei:${fact.uei}` : "unjoined");
  return { year, place, shard: "" };
}
