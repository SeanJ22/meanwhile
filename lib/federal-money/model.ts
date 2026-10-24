export const FEDERAL_MONEY_SOURCES = ["usaspending", "federal-audit-clearinghouse", "sam-gov-entities", "openfema"] as const;
export type FederalMoneySource = typeof FEDERAL_MONEY_SOURCES[number];
export const FEDERAL_MONEY_RECORD_CLASS = "FEDERAL_MONEY" as const;
export const FEDERAL_MONEY_PARSER = "federal-money/2";
export const OPENFEMA_STATE_PROJECTION_VERSION = "openfema-state/1";
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
    readonly projectionVersion?: string;
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
const FEDERAL_MONEY_PARTITION_ROWS = 500;
const FEDERAL_MONEY_PARTITION_BYTES = 4 * 1024 * 1024;
export function federalMoneyPartitionWithinBounds(records: readonly unknown[]): boolean {
  if (records.length > FEDERAL_MONEY_PARTITION_ROWS) return false;
  if (records.length <= 1) return true;
  let bytes = records.length + 1;
  for (const record of records) {
    bytes += Buffer.byteLength(JSON.stringify(record) ?? "null");
    if (bytes > FEDERAL_MONEY_PARTITION_BYTES) return false;
  }
  return true;
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

const SOURCE_KINDS: Readonly<Record<FederalMoneySource, readonly string[]>> = {
  usaspending: ["GRANT", "CONTRACT", "LOAN"], "federal-audit-clearinghouse": ["AUDIT"], "sam-gov-entities": ["ENTITY"], openfema: ["DISASTER"],
};
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function text(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function nullableText(value: unknown) { return value === null || text(value); }
function ids(value: unknown): value is string[] { return Array.isArray(value) && value.every(text) && new Set(value).size === value.length; }

export function federalMoneyProjectionIssue(value: unknown, source: FederalMoneySource, state: string): string | null {
  if (!record(value) || value.formatVersion !== 2 || value.source !== source || value.state !== state.toUpperCase() || !Array.isArray(value.records) || !record(value.partition) || !text(value.partition.year) || !text(value.partition.place) || typeof value.partition.shard !== "string") return "Federal projection source, state or format is invalid.";
  const shard = value.partition.shard;
  if (!federalMoneyPartitionWithinBounds(value.records) || !/^[a-f0-9]*$/.test(shard)) return "Federal partition is larger than its bounded leaf or has an invalid shard.";
  if (value.children !== undefined && (!Array.isArray(value.children) || value.records.length > 0 || value.children.some(child => typeof child !== "string" || !child.startsWith(String(shard)) || child.length !== String(shard).length + 1 || !/^[a-f0-9]+$/.test(child)))) return "Federal partition routing is invalid.";
  if (Array.isArray(value.children)) {
    const countsValid = (counts: unknown): counts is Record<"loaded" | "joined" | "unjoined", number> => record(counts) && [counts.loaded, counts.joined, counts.unjoined].every(n => typeof n === "number" && Number.isSafeInteger(n) && n >= 0) && counts.loaded === Number(counts.joined) + Number(counts.unjoined);
    if (!record(value.childCounts) || !countsValid(value.subtreeCounts) || new Set(value.children).size !== value.children.length || Object.keys(value.childCounts).length !== value.children.length) return "Federal partition child counts are invalid.";
    const childCounts = value.childCounts;
    if (value.children.some(child => typeof child !== "string" || !countsValid(childCounts[child]))) return "Federal partition child counts are invalid.";
    for (const key of ["loaded", "joined", "unjoined"] as const) if (value.subtreeCounts[key] !== Object.values(childCounts).reduce<number>((sum, counts) => sum + Number((counts as Record<string, number>)[key]), 0)) return "Federal partition subtree counts disagree with its children.";
  }
  const seen = new Set<string>();
  let joined = 0;
  for (const fact of value.records) {
    if (!record(fact) || fact.source !== source || fact.state !== state.toUpperCase() || !text(fact.id) || !text(fact.sourceId) || fact.id !== `${source}:${fact.sourceId}` || !text(fact.title) || seen.has(fact.id) || !SOURCE_KINDS[source].includes(String(fact.kind))) return "Federal record native identity or kind is invalid.";
    seen.add(fact.id);
    if (fact.amount !== null && (typeof fact.amount !== "number" || !Number.isFinite(fact.amount))) return "Federal record amount is invalid.";
    if (![fact.amountLabel, fact.period, fact.recipient, fact.uei].every(nullableText) || (fact.uei !== null && !/^[A-Z0-9]{12}$/.test(String(fact.uei)))) return "Federal record recipient or reporting period is invalid.";
    if (!ids(fact.bodyIds) || !ids(fact.divisionIds) || !fact.divisionIds.every(id => id.startsWith("ocd-division/country:us")) || !text(fact.joinReason)) return "Federal record joins are invalid.";
    const hasJoin = fact.bodyIds.length + fact.divisionIds.length > 0;
    if (fact.joinStatus !== (hasJoin ? "JOINED" : "UNJOINED")) return "Federal record join status disagrees with its held identifiers.";
    if (hasJoin) joined += 1;
    if (!record(fact.identifiers) || !Object.values(fact.identifiers).every(text) || fact.uei !== null && fact.identifiers.uei !== undefined && fact.uei !== fact.identifiers.uei || !Array.isArray(fact.geography) || fact.geography.some(place => !record(place) || !["county", "place", "school", "congressional"].includes(String(place.type)) || !text(place.geoid))) return "Federal record native geography or identifiers are invalid.";
    if (!record(fact.details) || Object.values(fact.details).some(detail => detail !== null && typeof detail !== "string" && typeof detail !== "boolean" && !(typeof detail === "number" && Number.isFinite(detail)))) return "Federal record details are invalid.";
    const provenance = fact.provenance;
    if (!record(provenance) || provenance.official !== true || !text(provenance.sourceUrl) || !text(provenance.sourceOrg) || !text(provenance.retrievedAt) || !Number.isFinite(Date.parse(provenance.retrievedAt)) || !(provenance.publicationDate === null || text(provenance.publicationDate) && Number.isFinite(Date.parse(provenance.publicationDate))) || !text(provenance.rawHash) || !/^[a-f0-9]{64}$/.test(provenance.rawHash)) return "Federal record source attribution is invalid.";
    try { const url = new URL(provenance.sourceUrl); if (url.protocol !== "https:" || !url.hostname.endsWith(".gov")) return "Federal record official source URL is invalid."; }
    catch { return "Federal record official source URL is invalid."; }
  }
  if (!ids(value.lookupKeys) || JSON.stringify(value.lookupKeys) !== JSON.stringify(federalMoneyLookupKeys(value.records as unknown as FederalMoneyProjection["records"]))) return "Federal partition native lookup keys disagree with its records.";
  if (!record(value.counts) || value.counts.loaded !== value.records.length || value.counts.joined !== joined || value.counts.unjoined !== value.records.length - joined) return "Federal projection loaded and joined counts disagree with its retained records.";
  return null;
}
