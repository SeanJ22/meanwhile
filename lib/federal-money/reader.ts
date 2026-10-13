import { jurisdictionFromOcdId } from "../coverage/states.ts";
import { civicDataReadNotInitialized, readPromotedCivicData, type CivicDataReadResult, type PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { currentPromotedEdge, ensureFederalMoneyStateEdge } from "../registry/runtime-edge.ts";
import { FEDERAL_MONEY_RECORD_CLASS, FEDERAL_MONEY_SOURCES, federalMoneyScope, type FederalMoneyProjection, type FederalMoneySource } from "./model.ts";
import { federalMoneyRows, type FederalMoneyTarget } from "./view.ts";

const SOURCE_KINDS: Readonly<Record<FederalMoneySource, readonly string[]>> = {
  usaspending: ["GRANT", "CONTRACT", "LOAN"], "federal-audit-clearinghouse": ["AUDIT"], "sam-gov-entities": ["ENTITY"], openfema: ["DISASTER"],
};
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function text(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function nullableText(value: unknown) { return value === null || text(value); }
function ids(value: unknown): value is string[] { return Array.isArray(value) && value.every(text) && new Set(value).size === value.length; }

/** Publication and reads share the native identity check. An unmatched row
 * remains in the projection and is counted, with the reason it did not join. */
export function federalMoneyProjectionIssue(value: unknown, source: FederalMoneySource, state: string): string | null {
  if (!record(value) || value.formatVersion !== 1 || value.source !== source || value.state !== state.toUpperCase() || !Array.isArray(value.records)) return "Federal projection source, state or format is invalid.";
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
  if (!record(value.counts) || value.counts.loaded !== value.records.length || value.counts.joined !== joined || value.counts.unjoined !== value.records.length - joined) return "Federal projection loaded and joined counts disagree with its retained records.";
  return null;
}

/** The runner may inject its authoritative store. A reader request uses only
 * the published edge, including when this independent family is absent. */
export async function readFederalMoneyProjection(source: FederalMoneySource, state: string, options: PromotedCivicDataReadOptions = {}): Promise<CivicDataReadResult<FederalMoneyProjection>> {
  const scope = federalMoneyScope(source, state);
  if (options.store === undefined && options.edge === undefined) await ensureFederalMoneyStateEdge(state.toUpperCase());
  const served = options.store === undefined && options.edge === undefined ? currentPromotedEdge(FEDERAL_MONEY_RECORD_CLASS, scope) : null;
  if (options.store === undefined && options.edge === undefined && !served) {
    return civicDataReadNotInitialized(FEDERAL_MONEY_RECORD_CLASS, scope, "Federal records for this source and state have not reached the reader edge.");
  }
  const read = await readPromotedCivicData<FederalMoneyProjection>(FEDERAL_MONEY_RECORD_CLASS, scope, { ...options, ...(served ? { edge: served.value } : {}) });
  if (read.kind === "PROMOTED") { const issue = federalMoneyProjectionIssue(read.value, source, state); if (issue) throw new Error(issue); }
  return read;
}

export interface FederalMoneyPlaceRead {
  readonly division: string;
  readonly bodyId: string | null;
  readonly sources: readonly {
    readonly source: FederalMoneySource;
    readonly status: "HELD" | "NOT_HELD" | "UNAVAILABLE";
    readonly records: FederalMoneyProjection["records"];
    readonly versionId: string | null;
    readonly checkedAt: string | null;
    readonly coverageComplete?: boolean;
  }[];
}

/** Four parallel, independent reads: one outage preserves the other sources. */
export async function readFederalMoneyForPlace(target: FederalMoneyTarget, options: PromotedCivicDataReadOptions = {}): Promise<FederalMoneyPlaceRead> {
  const state = jurisdictionFromOcdId(target.divisionId)?.usps;
  if (!state) throw new Error("A US state, district or territory division is required.");
  const results = await Promise.allSettled(FEDERAL_MONEY_SOURCES.map(source => readFederalMoneyProjection(source, state, options)));
  return { division: target.divisionId, bodyId: target.bodyId ?? null, sources: results.map((result, index) => {
    const source = FEDERAL_MONEY_SOURCES[index];
    if (result.status === "rejected") return { source, status: "UNAVAILABLE", records: [], versionId: null, checkedAt: null };
    const read = result.value;
    return { source, status: read.kind === "PROMOTED" ? "HELD" : read.kind === "NOT_RECORDED" ? "NOT_HELD" : "UNAVAILABLE",
      records: read.kind === "PROMOTED" ? federalMoneyRows(read.value.records, target).map(row => row.fact) : [],
      versionId: read.metadata.versionId, checkedAt: read.metadata.checkedAt ?? read.metadata.retrievedAt,
      ...(read.kind === "PROMOTED" && read.value.checkpoint ? { coverageComplete: read.value.checkpoint.complete || read.value.checkpoint.lastCompleteAt !== null } : {}) };
  }) };
}
