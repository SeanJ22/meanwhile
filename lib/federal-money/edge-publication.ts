import { gzipSync } from "node:zlib";
import { sha256OfJson } from "../meetings/edge-artifacts.ts";
import type { ReaderArtifactStore } from "../meetings/edge-store.ts";
import { federalMoneyPartitionScope, type FederalMoneyProjection, type FederalMoneySource } from "./model.ts";
import { federalMoneyProjectionIssue } from "./reader.ts";
import { FEDERAL_MONEY_PAGE_SIZE, federalMoneyFactPlaces, federalMoneyPlaceKey, federalMoneyStatusKey,
  type FederalMoneyPlaceIndex, type FederalMoneyPlacePage, type FederalMoneyPlaceSegment, type FederalMoneyStateStatus } from "./edge.ts";

export async function publishFederalMoneyPartition(input: {
  readonly store: ReaderArtifactStore;
  readonly projection: FederalMoneyProjection;
  readonly previous: FederalMoneyProjection | null;
  readonly versionId: string;
  readonly checkedAt: string;
}): Promise<{ places: number; bytesWritten: number }> {
  const { projection, store } = input;
  const issue = federalMoneyProjectionIssue(projection, projection.source, projection.state);
  if (issue) throw new Error(issue);
  const segmentId = federalMoneyPartitionScope(projection.source, projection.state, projection.partition);
  const places = new Set([...projection.records, ...(input.previous?.records ?? [])].flatMap(federalMoneyFactPlaces));
  let bytesWritten = 0;
  for (const place of places) {
    const records = projection.records.filter(fact => federalMoneyFactPlaces(fact).includes(place))
      .sort((a, b) => (b.provenance.publicationDate ?? "").localeCompare(a.provenance.publicationDate ?? "") || a.id.localeCompare(b.id));
    const contentHash = sha256OfJson(records);
    const key = federalMoneyPlaceKey(projection.state, place);
    let prepared: FederalMoneyPlaceSegment | null = null;
    for (let attempt = 0; ; attempt += 1) {
      const held = await store.readJsonPointer<FederalMoneyPlaceIndex>(key);
      if (held && (held.value.formatVersion !== 2 || held.value.state !== projection.state || held.value.place !== place)) throw new Error("Federal place index identity does not match its key.");
      if (held?.value.segments[segmentId]?.versionId === input.versionId || held?.value.segments[segmentId]?.contentHash === contentHash) break;
      if (!held && records.length === 0) break;
      if (prepared === null && records.length) {
        const pages = [];
        for (let offset = 0; offset < records.length; offset += FEDERAL_MONEY_PAGE_SIZE) {
          const page: FederalMoneyPlacePage = { formatVersion: 2, state: projection.state, place, source: projection.source, versionId: input.versionId, records: records.slice(offset, offset + FEDERAL_MONEY_PAGE_SIZE) };
          const bytes = gzipSync(Buffer.from(JSON.stringify(page)));
          pages.push({ key: await store.putImmutable(bytes, "json.gz"), hash: sha256OfJson(page), count: page.records.length });
          bytesWritten += bytes.byteLength;
        }
        prepared = { year: projection.partition.year, source: projection.source, versionId: input.versionId, contentHash, checkedAt: input.checkedAt, latestPublication: records[0]?.provenance.publicationDate ?? null, pages };
      }
      const segments = { ...held?.value.segments };
      if (prepared) segments[segmentId] = prepared;
      else delete segments[segmentId];
      const value: FederalMoneyPlaceIndex = { formatVersion: 2, state: projection.state, place, segments };
      const written = await store.writeJsonPointer(key, value, held?.etag ?? null);
      if (written.modified) { bytesWritten += Buffer.byteLength(JSON.stringify(value)); break; }
      if (attempt >= 7) throw new Error("Federal place publication raced with another writer.");
    }
  }
  return { places: places.size, bytesWritten };
}

export async function publishFederalMoneyProgress(input: {
  readonly store: ReaderArtifactStore;
  readonly state: string;
  readonly source: FederalMoneySource;
  readonly checkedAt: string;
  readonly complete: boolean;
  readonly reason: string | null;
}): Promise<void> {
  const key = federalMoneyStatusKey(input.state);
  for (let attempt = 0; ; attempt += 1) {
    const held = await input.store.readJsonPointer<FederalMoneyStateStatus>(key);
    if (held && (held.value.formatVersion !== 2 || held.value.state !== input.state)) throw new Error("Federal source status identity does not match its key.");
    const value: FederalMoneyStateStatus = { formatVersion: 2, state: input.state,
      sources: { ...held?.value.sources, [input.source]: { checkedAt: input.checkedAt, complete: input.complete, reason: input.reason } } };
    if (held && sha256OfJson(held.value) === sha256OfJson(value)) return;
    if ((await input.store.writeJsonPointer(key, value, held?.etag ?? null)).modified) return;
    if (attempt >= 7) throw new Error("Federal source status publication raced with another writer.");
  }
}
