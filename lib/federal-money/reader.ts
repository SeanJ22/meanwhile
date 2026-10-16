import { gunzipSync } from "node:zlib";
import { jurisdictionFromOcdId } from "../coverage/states.ts";
import { resolveReaderArtifactStore, type ReaderArtifactStore } from "../meetings/edge-store.ts";
import { FEDERAL_MONEY_SOURCES, type FederalMoneyProjection, type FederalMoneySource } from "./model.ts";
import { FederalMoneyIndex, federalMoneyArtifactHash, federalMoneyArtifactKey, readFederalMoneyJson, type FederalMoneyIndexEntry, FEDERAL_MONEY_PAGE_SIZE, federalMoneyPlaceKey, federalMoneyStatusKey, federalMoneyTargetPlaces, type FederalMoneyPlaceIndex, type FederalMoneyPlacePage, type FederalMoneyPlaceSnapshot, type FederalMoneySegmentArtifact, type FederalMoneyStateStatus } from "./edge.ts";
import { federalMoneyRows, type FederalMoneyTarget } from "./view.ts";

function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function text(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }

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
interface SourcePosition { readonly key: string; readonly place: string; readonly page: number }
interface PageCursor {
  readonly target: string;
  readonly snapshots: Record<string, string | null>;
  readonly positions: Partial<Record<FederalMoneySource, SourcePosition>>;
}
function decodeCursor(value: string | null | undefined, target: string): PageCursor | null {
  if (!value) return null;
  if (value.length > 8192) throw new Error("The federal records page is invalid.");
  let parsed: PageCursor;
  try { parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")); }
  catch { throw new Error("The federal records page is invalid."); }
  if (!parsed || parsed.target !== target || !record(parsed.snapshots) || Object.values(parsed.snapshots).some(key => key !== null && !federalMoneyArtifactKey(key)) || !record(parsed.positions) || Object.entries(parsed.positions).some(([source, position]) => !FEDERAL_MONEY_SOURCES.includes(source as FederalMoneySource) || !record(position) || !text(position.key) || !text(position.place) || !Number.isSafeInteger(position.page) || Number(position.page) < 0 || Number(position.page) > 5)) throw new Error("The federal records page is invalid.");
  return parsed;
}

export async function readFederalMoneyForPlace(target: FederalMoneyTarget, options: FederalMoneyReadOptions = {}): Promise<FederalMoneyPlaceRead> {
  const state = jurisdictionFromOcdId(target.divisionId)?.usps;
  if (!state) throw new Error("A US state, district or territory division is required.");
  if (options.year !== undefined && !/^\d{4}$/.test(options.year)) throw new Error("The federal records year is invalid.");
  const targetId = federalMoneyArtifactHash(JSON.stringify({ division: target.divisionId, body: target.bodyId ?? null, year: options.year ?? null }));
  const cursor = decodeCursor(options.cursor, targetId);
  const store = options.artifactStore === undefined ? resolveReaderArtifactStore() : options.artifactStore;
  const unavailable = (source: FederalMoneySource): FederalMoneyPlaceRead["sources"][number] => ({ source, status: "UNAVAILABLE", records: [], versionId: null, checkedAt: null });
  if (!store) return { division: target.divisionId, bodyId: target.bodyId ?? null, nextCursor: null, sources: FEDERAL_MONEY_SOURCES.map(unavailable) };
  const places = federalMoneyTargetPlaces(target);
  if (cursor && (Object.keys(cursor.snapshots).length !== places.length || places.some(place => !Object.hasOwn(cursor.snapshots, place)))) throw new Error("The federal records page is invalid.");
  const snapshots: PageCursor["snapshots"] = {};
  const loaded = await Promise.allSettled(places.map(async place => {
    let key = cursor?.snapshots[place];
    if (key === undefined) {
      const held = await store.readJsonPointer<FederalMoneyPlaceIndex>(federalMoneyPlaceKey(state, place));
      if (held && (held.value.formatVersion !== 3 || held.value.state !== state || held.value.place !== place || !federalMoneyArtifactKey(held.value.snapshot))) throw new Error("Federal place artifact identity is invalid.");
      key = held?.value.snapshot ?? null;
    }
    snapshots[place] = key;
    if (!key) return null;
    const snapshot = await readFederalMoneyJson<FederalMoneyPlaceSnapshot>(store, key);
    if (snapshot.formatVersion !== 3 || snapshot.state !== state || snapshot.place !== place || snapshot.order !== null && !federalMoneyArtifactKey(snapshot.order) || snapshot.segments !== null && !federalMoneyArtifactKey(snapshot.segments)) throw new Error("Federal place snapshot identity is invalid.");
    return snapshot;
  }));
  const statusRead = await store.readJsonPointer<FederalMoneyStateStatus>(federalMoneyStatusKey(state)).catch(() => null);
  const statuses = statusRead?.value.formatVersion === 2 && statusRead.value.state === state ? statusRead.value.sources : {};
  const positions: PageCursor["positions"] = {};
  const results = await Promise.allSettled(FEDERAL_MONEY_SOURCES.map(async source => {
    if (loaded.some(row => row.status === "rejected")) throw new Error("Federal place artifact is unavailable.");
    const indices = loaded.flatMap(row => row.status === "fulfilled" && row.value ? [row.value] : []);
    const selected = indices.filter(index => source === "openfema"
      ? index.place.startsWith("division:") && /\/county:[^/]+$/.test(index.place)
      : source === "federal-audit-clearinghouse" || source === "sam-gov-entities"
        ? index.place === (target.bodyId ? `body:${target.bodyId}` : `division:${target.divisionId}`)
        : index.place === `division:${target.divisionId}` || index.place === `body:${target.bodyId}`);
    const prefix = `${source}:${options.year ?? "*"}:`;
    const position = cursor?.positions[source];
    if (position && (!position.key.startsWith(prefix) || !selected.some(index => index.place === position.place))) throw new Error("The federal records page is invalid.");
    const candidates: { entry: FederalMoneyIndexEntry; index: FederalMoneyPlaceSnapshot; tree: FederalMoneyIndex; page: number }[] = [];
    for (const index of selected) {
      const tree = new FederalMoneyIndex(store, `${federalMoneyPlaceKey(state, index.place)}:order`);
      const entry = await tree.next(index.order, position?.key ?? prefix, !!position && index.place < position.place);
      if (entry?.key.startsWith(prefix)) candidates.push({ entry, index, tree, page: entry.key === position?.key && index.place === position.place ? position.page : 0 });
    }
    let chosen: typeof candidates[number] | undefined, segment: FederalMoneySegmentArtifact | null = null;
    while (candidates.length) {
      candidates.sort((a, b) => a.entry.key < b.entry.key ? -1 : a.entry.key > b.entry.key ? 1 : a.index.place < b.index.place ? -1 : a.index.place > b.index.place ? 1 : 0);
      chosen = candidates.shift()!;
      segment = await readFederalMoneyJson<FederalMoneySegmentArtifact>(store, chosen.entry.value);
      if (segment.formatVersion !== 3 || segment.state !== state || segment.place !== chosen.index.place || segment.source !== source || !Array.isArray(segment.pages) || segment.pages.length === 0 || segment.pages.length > 5) throw new Error("Federal place segment identity is invalid.");
      if (chosen.page < segment.pages.length) break;
      const entry = await chosen.tree.next(chosen.index.order, chosen.entry.key, true);
      if (entry?.key.startsWith(prefix)) candidates.push({ ...chosen, entry, page: 0 });
      chosen = undefined; segment = null;
    }
    const facts = new Map<string, FederalMoneyProjection["records"][number]>();
    let moreRecords = false;
    if (chosen && segment) {
      const ref = segment.pages[chosen.page];
      const bytes = await store.readBytes(ref.key);
      if (!bytes || !federalMoneyArtifactKey(ref.key) || !ref.key.includes(federalMoneyArtifactHash(bytes))) throw new Error("Federal place records are unavailable.");
      const plain = gunzipSync(bytes);
      if (federalMoneyArtifactHash(plain) !== ref.hash) throw new Error("Federal place records do not match their accepted artifact.");
      const page = JSON.parse(plain.toString("utf8")) as FederalMoneyPlacePage;
      if (page.formatVersion !== 2 || page.state !== state || page.place !== chosen.index.place || page.source !== source || page.versionId !== segment.versionId || !Array.isArray(page.records) || page.records.length > FEDERAL_MONEY_PAGE_SIZE || page.records.length !== ref.count) throw new Error("Federal place records do not match their accepted artifact.");
      for (const row of federalMoneyRows(page.records, target)) facts.set(row.fact.id, row.fact);
      positions[source] = { key: chosen.entry.key, place: chosen.index.place, page: chosen.page + 1 };
      moreRecords = chosen.page + 1 < segment.pages.length || candidates.length > 0 || !!(await chosen.tree.next(chosen.index.order, chosen.entry.key, true))?.key.startsWith(prefix);
    } else if (position) positions[source] = position;
    const status = statuses[source];
    const versionId = federalMoneyArtifactHash(JSON.stringify(selected.map(index => snapshots[index.place])));
    return { source, status: segment || position ? "HELD" as const : status?.reason ? "UNAVAILABLE" as const : "NOT_HELD" as const,
      records: [...facts.values()], versionId: segment || position ? versionId : null, checkedAt: status?.checkedAt ?? segment?.checkedAt ?? null,
      coverageComplete: status?.complete ?? false, moreRecords };
  }));
  const sources = results.map((result, index) => result.status === "fulfilled" ? result.value : unavailable(FEDERAL_MONEY_SOURCES[index]));
  const nextCursor = sources.some(source => source.moreRecords) ? Buffer.from(JSON.stringify({ target: targetId, snapshots, positions })).toString("base64url") : null;
  return { division: target.divisionId, bodyId: target.bodyId ?? null, nextCursor, sources };
}
