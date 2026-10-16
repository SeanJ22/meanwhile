import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import type { ReaderArtifactStore } from "../meetings/edge-store.ts";
import { federalMoneyProjectionIssue, federalMoneyPartitionScope, type FederalMoneyProjection, type FederalMoneySource } from "./model.ts";
import { FederalMoneyIndex, federalMoneyArtifactHash, readFederalMoneyJson, FEDERAL_MONEY_PAGE_SIZE, federalMoneyFactPlaces, federalMoneyPlaceKey, federalMoneySegmentOrder, federalMoneyStatusKey,
  type FederalMoneyPlaceIndex, type FederalMoneyPlacePage, type FederalMoneyPlaceSnapshot, type FederalMoneySegmentArtifact, type FederalMoneyStateStatus } from "./edge.ts";

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
  const places = new Set<string>();
  for (const fact of projection.records) for (const place of federalMoneyFactPlaces(fact)) places.add(place);
  for (const fact of input.previous?.records ?? []) for (const place of federalMoneyFactPlaces(fact)) places.add(place);
  let bytesWritten = 0;
  const saved = (bytes: number) => { bytesWritten += bytes; };
  async function immutable(value: unknown): Promise<string> {
    const bytes = Buffer.from(JSON.stringify(value));
    const key = await store.putImmutable(bytes, "json");
    saved(bytes.byteLength);
    return key;
  }
  for (const place of places) {
    const records = projection.records.filter(fact => federalMoneyFactPlaces(fact).includes(place))
      .sort((a, b) => (b.provenance.publicationDate ?? "").localeCompare(a.provenance.publicationDate ?? "") || a.id.localeCompare(b.id));
    const digest = createHash("sha256");
    for (const record of records) digest.update(JSON.stringify(record)).update("\n");
    const contentHash = digest.digest("hex");
    const key = federalMoneyPlaceKey(projection.state, place);
    const segments = new FederalMoneyIndex(store, `${key}:segments`, saved);
    const order = new FederalMoneyIndex(store, `${key}:order`, saved);
    let prepared: FederalMoneySegmentArtifact | null = null, preparedKey: string | null = null;
    for (let attempt = 0; ; attempt += 1) {
      const held = await store.readJsonPointer<FederalMoneyPlaceIndex>(key);
      if (held && (held.value.formatVersion !== 3 || held.value.state !== projection.state || held.value.place !== place)) throw new Error("Federal place index identity does not match its key.");
      const snapshot: FederalMoneyPlaceSnapshot = held ? await readFederalMoneyJson(store, held.value.snapshot) : { formatVersion: 3, state: projection.state, place, segments: null, order: null };
      if (snapshot.formatVersion !== 3 || snapshot.state !== projection.state || snapshot.place !== place) throw new Error("Federal place snapshot identity does not match its key.");
      const previousKey = await segments.get(snapshot.segments, segmentId);
      const previous = previousKey ? await readFederalMoneyJson<FederalMoneySegmentArtifact>(store, previousKey) : null;
      if (previous?.versionId === input.versionId || previous?.contentHash === contentHash || previous === null && records.length === 0) break;
      if (prepared === null && records.length) {
        const pages = [];
        for (let offset = 0; offset < records.length; offset += FEDERAL_MONEY_PAGE_SIZE) {
          const page: FederalMoneyPlacePage = { formatVersion: 2, state: projection.state, place, source: projection.source, versionId: input.versionId, records: records.slice(offset, offset + FEDERAL_MONEY_PAGE_SIZE) };
          const plain = Buffer.from(JSON.stringify(page));
          const bytes = gzipSync(plain);
          pages.push({ key: await store.putImmutable(bytes, "json.gz"), hash: federalMoneyArtifactHash(plain), count: page.records.length });
          saved(bytes.byteLength);
        }
        prepared = { formatVersion: 3, state: projection.state, place, segmentId, year: projection.partition.year, source: projection.source, versionId: input.versionId, contentHash, checkedAt: input.checkedAt, latestPublication: records[0]?.provenance.publicationDate ?? null, pages };
        preparedKey = await immutable(prepared);
      }
      if (previous) for (const period of ["*", previous.year]) snapshot.order = await order.set(snapshot.order, `${projection.source}:${period}:${federalMoneySegmentOrder(previous)}`, null);
      snapshot.segments = await segments.set(snapshot.segments, segmentId, preparedKey);
      if (prepared) for (const period of ["*", prepared.year]) snapshot.order = await order.set(snapshot.order, `${projection.source}:${period}:${federalMoneySegmentOrder(prepared)}`, preparedKey);
      const value: FederalMoneyPlaceIndex = { formatVersion: 3, state: projection.state, place, snapshot: await immutable(snapshot) };
      const written = await store.writeJsonPointer(key, value, held?.etag ?? null);
      if (written.modified) { saved(Buffer.byteLength(JSON.stringify(value))); break; }
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
    if (held && federalMoneyArtifactHash(JSON.stringify(held.value)) === federalMoneyArtifactHash(JSON.stringify(value))) return;
    if ((await input.store.writeJsonPointer(key, value, held?.etag ?? null)).modified) return;
    if (attempt >= 7) throw new Error("Federal source status publication raced with another writer.");
  }
}
