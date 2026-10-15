import { gunzipSync } from "node:zlib";
import { jurisdictionFromOcdId } from "../coverage/states.ts";
import { readPromotedCivicData, type CivicDataReadResult, type PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";
import { sha256OfJson } from "../meetings/edge-artifacts.ts";
import { resolveReaderArtifactStore, type ReaderArtifactStore } from "../meetings/edge-store.ts";
import { federalMoneyLookupKeys, federalMoneyPartitionWithinBounds, FEDERAL_MONEY_RECORD_CLASS, FEDERAL_MONEY_SOURCES, type FederalMoneyProjection, type FederalMoneySource } from "./model.ts";
import { FEDERAL_MONEY_PAGE_SIZE, federalMoneyPlaceKey, federalMoneyStatusKey, federalMoneyTargetPlaces, type FederalMoneyPlaceIndex, type FederalMoneyPlacePage, type FederalMoneyStateStatus } from "./edge.ts";
import { federalMoneyRows, type FederalMoneyTarget } from "./view.ts";

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

export async function readFederalMoneyPartition(source: FederalMoneySource, scope: string, options: PromotedCivicDataReadOptions): Promise<CivicDataReadResult<FederalMoneyProjection>> {
  const state = scope.split(":")[1];
  const read = await readPromotedCivicData<FederalMoneyProjection>(FEDERAL_MONEY_RECORD_CLASS, scope, options);
  if (read.kind === "PROMOTED") { const issue = federalMoneyProjectionIssue(read.value, source, state); if (issue) throw new Error(issue); }
  return read;
}

export interface FederalMoneyPlaceRead {
  readonly division: string;
  readonly bodyId: string | null;
  readonly nextCursor: string | null;
  readonly sources: readonly {
    readonly source: FederalMoneySource;
    readonly status: "HELD" | "NOT_HELD" | "UNAVAILABLE";
    readonly records: FederalMoneyProjection["records"];
    readonly versionId: string | null;
    readonly checkedAt: string | null;
    readonly coverageComplete?: boolean;
    readonly moreRecords?: boolean;
  }[];
}
export interface FederalMoneyReadOptions {
  readonly artifactStore?: ReaderArtifactStore | null;
  readonly cursor?: string | null;
  readonly year?: string;
}
interface PageCursor { readonly target: string; readonly offsets: Partial<Record<FederalMoneySource, { version: string; offset: number }>> }
function decodeCursor(value: string | null | undefined, target: string): PageCursor {
  if (!value) return { target, offsets: {} };
  let parsed: PageCursor;
  try { parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")); }
  catch { throw new Error("The federal records page is invalid."); }
  if (value.length > 4096 || parsed.target !== target || !record(parsed.offsets) || Object.entries(parsed.offsets).some(([source, offset]) => !FEDERAL_MONEY_SOURCES.includes(source as FederalMoneySource) || !record(offset) || !text(offset.version) || !Number.isSafeInteger(offset.offset) || Number(offset.offset) < 0)) throw new Error("The federal records page is invalid.");
  return parsed;
}

export async function readFederalMoneyForPlace(target: FederalMoneyTarget, options: FederalMoneyReadOptions = {}): Promise<FederalMoneyPlaceRead> {
  const state = jurisdictionFromOcdId(target.divisionId)?.usps;
  if (!state) throw new Error("A US state, district or territory division is required.");
  if (options.year !== undefined && !/^\d{4}$/.test(options.year)) throw new Error("The federal records year is invalid.");
  const targetId = sha256OfJson({ division: target.divisionId, body: target.bodyId ?? null, year: options.year ?? null });
  const cursor = decodeCursor(options.cursor, targetId);
  const store = options.artifactStore === undefined ? resolveReaderArtifactStore() : options.artifactStore;
  const unavailable = (source: FederalMoneySource): FederalMoneyPlaceRead["sources"][number] => ({ source, status: "UNAVAILABLE", records: [], versionId: null, checkedAt: null });
  if (!store) return { division: target.divisionId, bodyId: target.bodyId ?? null, nextCursor: null, sources: FEDERAL_MONEY_SOURCES.map(unavailable) };
  const places = federalMoneyTargetPlaces(target);
  const loaded = await Promise.allSettled(places.map(async place => {
    const held = await store.readJsonPointer<FederalMoneyPlaceIndex>(federalMoneyPlaceKey(state, place));
    if (held && (held.value.formatVersion !== 2 || held.value.state !== state || held.value.place !== place || !record(held.value.segments))) throw new Error("Federal place artifact identity is invalid.");
    return held?.value ?? null;
  }));
  const statusRead = await store.readJsonPointer<FederalMoneyStateStatus>(federalMoneyStatusKey(state)).catch(() => null);
  const statuses = statusRead?.value.formatVersion === 2 && statusRead.value.state === state ? statusRead.value.sources : {};
  const offsets: PageCursor["offsets"] = {};
  const nextOffsets = offsets as Record<FederalMoneySource, { version: string; offset: number }>;
  const results = await Promise.allSettled(FEDERAL_MONEY_SOURCES.map(async source => {
    if (loaded.some(row => row.status === "rejected")) throw new Error("Federal place artifact is unavailable.");
    const indices = loaded.flatMap(row => row.status === "fulfilled" && row.value ? [row.value] : []);
    const selected = indices.filter(index => source === "openfema"
      ? index.place.startsWith("division:") && /\/county:[^/]+$/.test(index.place)
      : source === "federal-audit-clearinghouse" || source === "sam-gov-entities"
        ? index.place === (target.bodyId ? `body:${target.bodyId}` : `division:${target.divisionId}`)
        : index.place === `division:${target.divisionId}` || index.place === `body:${target.bodyId}`);
    const pages = selected.flatMap(index => Object.entries(index.segments).filter(([, segment]) => segment.source === source && (options.year === undefined || segment.year === options.year)).flatMap(([segmentId, segment]) => segment.pages.map((page, pageIndex) => ({ ...page, place: index.place, segment, segmentId, pageIndex }))))
      .sort((a, b) => (b.segment.latestPublication ?? "").localeCompare(a.segment.latestPublication ?? "") || a.segmentId.localeCompare(b.segmentId) || a.pageIndex - b.pageIndex || a.place.localeCompare(b.place));
    const versionId = sha256OfJson(pages.map(page => [page.place, page.hash]));
    const position = cursor.offsets[source];
    let offset = position?.version === versionId ? position.offset : 0;
    const facts = new Map<string, FederalMoneyProjection["records"][number]>();
    if (offset < pages.length) {
      const ref = pages[offset];
      const bytes = await store.readBytes(ref.key);
      if (!bytes) throw new Error("Federal place records are unavailable.");
      const page = JSON.parse(gunzipSync(bytes).toString("utf8")) as FederalMoneyPlacePage;
      if (page.formatVersion !== 2 || page.state !== state || page.place !== ref.place || page.source !== source || page.versionId !== ref.segment.versionId || !Array.isArray(page.records) || page.records.length > FEDERAL_MONEY_PAGE_SIZE || page.records.length !== ref.count || sha256OfJson(page) !== ref.hash) throw new Error("Federal place records do not match their accepted artifact.");
      for (const row of federalMoneyRows(page.records, target)) facts.set(row.fact.id, row.fact);
      offset += 1;
    }
    nextOffsets[source] = { version: versionId, offset };
    const status = statuses[source];
    const checkedAt = status?.checkedAt ?? pages.map(page => page.segment.checkedAt).sort().at(-1) ?? null;
    return { source, status: pages.length > 0 ? "HELD" as const : status?.reason ? "UNAVAILABLE" as const : "NOT_HELD" as const,
      records: [...facts.values()], versionId: pages.length ? versionId : null, checkedAt,
      coverageComplete: status?.complete ?? false, moreRecords: offset < pages.length };
  }));
  const sources = results.map((result, index) => result.status === "fulfilled" ? result.value : unavailable(FEDERAL_MONEY_SOURCES[index]));
  const nextCursor = sources.some(source => source.moreRecords) ? Buffer.from(JSON.stringify({ target: targetId, offsets })).toString("base64url") : null;
  return { division: target.divisionId, bodyId: target.bodyId ?? null, nextCursor, sources };
}
