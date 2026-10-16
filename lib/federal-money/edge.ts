import { createHash } from "node:crypto";
import type { ReaderArtifactStore } from "../meetings/edge-store.ts";
import type { FederalMoneyFact, FederalMoneySource } from "./model.ts";
import type { FederalMoneyTarget } from "./view.ts";

export const FEDERAL_MONEY_PAGE_SIZE = 100;
export interface FederalMoneyPageRef { readonly key: string; readonly hash: string; readonly count: number }
export interface FederalMoneyPlaceSegment {
  readonly year: string;
  readonly source: FederalMoneySource;
  readonly versionId: string;
  readonly contentHash: string;
  readonly checkedAt: string;
  readonly latestPublication: string | null;
  readonly pages: readonly FederalMoneyPageRef[];
}
export interface FederalMoneyPlaceIndex {
  readonly formatVersion: 3;
  readonly state: string;
  readonly place: string;
  readonly snapshot: string;
}
export interface FederalMoneyPlaceSnapshot {
  readonly formatVersion: 3;
  readonly state: string;
  readonly place: string;
  segments: string | null;
  order: string | null;
}
export interface FederalMoneySegmentArtifact extends FederalMoneyPlaceSegment {
  readonly formatVersion: 3;
  readonly state: string;
  readonly place: string;
  readonly segmentId: string;
}
export function federalMoneySegmentOrder(segment: FederalMoneySegmentArtifact): string {
  const time = segment.latestPublication ? Date.parse(segment.latestPublication) : 0;
  return `${String(999999999999999 - time).padStart(15, "0")}:${segment.segmentId}`;
}
export interface FederalMoneyPlacePage {
  readonly formatVersion: 2;
  readonly state: string;
  readonly place: string;
  readonly source: FederalMoneySource;
  readonly versionId: string;
  readonly records: readonly FederalMoneyFact[];
}
export interface FederalMoneySourceStatus {
  readonly checkedAt: string;
  readonly complete: boolean;
  readonly reason: string | null;
}
export interface FederalMoneyStateStatus {
  readonly formatVersion: 2;
  readonly state: string;
  readonly sources: Partial<Record<FederalMoneySource, FederalMoneySourceStatus>>;
}
export function federalMoneyPlaceKey(state: string, place: string): string {
  return `reader/federal-money/${state.toLowerCase()}/places/${createHash("sha256").update(place).digest("hex")}.json`;
}
export function federalMoneyStatusKey(state: string): string { return `reader/federal-money/${state.toLowerCase()}/status.json`; }
export function federalMoneyFactPlaces(fact: FederalMoneyFact): string[] {
  return [...new Set([...fact.bodyIds.map(id => `body:${id}`), ...fact.divisionIds.map(id => `division:${id}`)])];
}
export function federalMoneyTargetPlaces(target: FederalMoneyTarget): string[] {
  const county = /^(.+\/county:[^/]+)(?:\/|$)/.exec(target.divisionId)?.[1];
  return [...new Set([`division:${target.divisionId}`, ...(target.bodyId ? [`body:${target.bodyId}`] : []), ...(county ? [`division:${county}`] : [])])];
}

export const FEDERAL_MONEY_INDEX_PAGE_SIZE = 64;
export interface FederalMoneyIndexEntry { key: string; value: string }
interface IndexPage { formatVersion: 3; identity: string; leaf: boolean; entries: FederalMoneyIndexEntry[] }
export function federalMoneyArtifactKey(value: unknown): value is string { return typeof value === "string" && /^reader\/artifacts\/[a-f0-9]{64}\.json(?:\.gz)?$/.test(value); }
export function federalMoneyArtifactHash(bytes: string | Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
export async function readFederalMoneyJson<T>(store: ReaderArtifactStore, key: string): Promise<T> {
  if (!federalMoneyArtifactKey(key) || !key.endsWith(".json")) throw new Error("Federal index artifact key is invalid.");
  const bytes = await store.readBytes(key);
  if (!bytes || !key.includes(federalMoneyArtifactHash(bytes))) throw new Error("Federal index artifact is unavailable or corrupted.");
  return JSON.parse(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("utf8")) as T;
}
export class FederalMoneyIndex {
  private readonly store: ReaderArtifactStore;
  private readonly identity: string;
  private readonly written: (bytes: number) => void;
  constructor(store: ReaderArtifactStore, identity: string, written: (bytes: number) => void = () => {}) {
    this.store = store; this.identity = identity; this.written = written;
  }
  private async read(key: string): Promise<IndexPage> {
    const page = await readFederalMoneyJson<IndexPage>(this.store, key);
    if (page.formatVersion !== 3 || page.identity !== this.identity || typeof page.leaf !== "boolean" || !Array.isArray(page.entries) || page.entries.length === 0 || page.entries.length > FEDERAL_MONEY_INDEX_PAGE_SIZE || page.entries.some((entry, index) => !entry || typeof entry.key !== "string" || !federalMoneyArtifactKey(entry.value) || index > 0 && page.entries[index - 1].key >= entry.key)) throw new Error("Federal index page is invalid.");
    return page;
  }
  private async save(page: IndexPage): Promise<FederalMoneyIndexEntry> {
    const bytes = Buffer.from(JSON.stringify(page));
    const value = await this.store.putImmutable(bytes, "json");
    this.written(bytes.byteLength);
    return { key: page.entries[0].key, value };
  }
  async next(root: string | null, lowerBound: string, exclusive = false): Promise<FederalMoneyIndexEntry | null> {
    if (!root) return null;
    const page = await this.read(root);
    if (page.leaf) return page.entries.find(entry => exclusive ? entry.key > lowerBound : entry.key >= lowerBound) ?? null;
    let index = page.entries.findIndex(entry => entry.key > lowerBound);
    index = index < 0 ? page.entries.length - 1 : Math.max(0, index - 1);
    for (; index < page.entries.length; index += 1) {
      const found = await this.next(page.entries[index].value, lowerBound, exclusive);
      if (found) return found;
    }
    return null;
  }
  async get(root: string | null, key: string): Promise<string | null> {
    const found = await this.next(root, key);
    return found?.key === key ? found.value : null;
  }
  async set(root: string | null, key: string, value: string | null): Promise<string | null> {
    const changed = await this.change(root, key, value);
    if (changed.length === 0) return null;
    if (changed.length === 1) return changed[0].value;
    return (await this.save({ formatVersion: 3, identity: this.identity, leaf: false, entries: changed })).value;
  }
  private async change(root: string | null, key: string, value: string | null): Promise<FederalMoneyIndexEntry[]> {
    if (root === null && value === null) return [];
    const page = root ? await this.read(root) : { formatVersion: 3 as const, identity: this.identity, leaf: true, entries: [] };
    let index = page.entries.findIndex(entry => entry.key >= key);
    if (page.leaf) {
      if (index < 0) index = page.entries.length;
      if (page.entries[index]?.key === key) {
        if (value === null) page.entries.splice(index, 1);
        else page.entries[index].value = value;
      } else if (value !== null) page.entries.splice(index, 0, { key, value });
    } else {
      if (index < 0) index = page.entries.length - 1;
      else if (page.entries[index].key !== key) index = Math.max(0, index - 1);
      const changed = await this.change(page.entries[index].value, key, value);
      page.entries.splice(index, 1, ...changed);
    }
    if (page.entries.length === 0) return [];
    if (!page.leaf && page.entries.length === 1) return page.entries;
    if (page.entries.length <= FEDERAL_MONEY_INDEX_PAGE_SIZE) return [await this.save(page)];
    const right = page.entries.splice(Math.ceil(page.entries.length / 2));
    return [await this.save(page), await this.save({ formatVersion: 3, identity: this.identity, leaf: page.leaf, entries: right })];
  }
}
