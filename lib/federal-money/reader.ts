import { gunzipSync } from "node:zlib";
import { jurisdictionFromOcdId } from "../coverage/states.ts";
import { resolveReaderArtifactStore, type ReaderArtifactStore } from "../meetings/edge-store.ts";
import { FEDERAL_MONEY_SOURCES, compareFederalMoneyActions, federalMoneyActionDate, type FederalMoneyFact, type FederalMoneyProjection, type FederalMoneySource } from "./model.ts";
import { FederalMoneyIndex, FEDERAL_MONEY_ACTION_ORDER_BASE, federalMoneyArtifactHash, federalMoneyArtifactKey, readFederalMoneyJson, type FederalMoneyIndexEntry, FEDERAL_MONEY_PAGE_SIZE, federalMoneyPlaceKey, federalMoneyStatusKey, federalMoneyTargetPlaces, type FederalMoneyPlaceIndex, type FederalMoneyPlacePage, type FederalMoneyPlaceSnapshot, type FederalMoneySegmentArtifact, type FederalMoneyStateStatus } from "./edge.ts";
import { federalMoneyRows, federalMoneyStateDivision, type FederalMoneyTarget } from "./view.ts";

function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function text(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }

export interface FederalMoneyPlaceRead {
  readonly division: string;
  readonly bodyId: string | null;
  readonly recipientIds?: readonly string[];
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
interface ActionPosition { readonly date: string; readonly id: string }
function comparePosition(left: ActionPosition, right: ActionPosition): number {
  const date = right.date.localeCompare(left.date);
  const a = encodeURIComponent(left.id), b = encodeURIComponent(right.id);
  return date || (a < b ? -1 : a > b ? 1 : 0);
}
function actionBound(key: string): ActionPosition {
  const matched = /^(\d{16}):([^:]*):/.exec(key);
  if (!matched) throw new Error("Federal action order is invalid.");
  const date = matched[1] === "9999999999999999" ? "" : new Date(FEDERAL_MONEY_ACTION_ORDER_BASE - Number(matched[1])).toISOString();
  return { date, id: decodeURIComponent(matched[2]) };
}
interface SourcePosition { readonly after: ActionPosition | null; readonly complete: boolean; readonly held: boolean }
interface PageCursor {
  readonly formatVersion: 2;
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
  if (!parsed || parsed.formatVersion !== 2 || parsed.target !== target || !record(parsed.snapshots) || Object.values(parsed.snapshots).some(key => key !== null && !federalMoneyArtifactKey(key)) || !record(parsed.positions) || Object.entries(parsed.positions).some(([source, position]) => !FEDERAL_MONEY_SOURCES.includes(source as FederalMoneySource) || !record(position) || typeof position.complete !== "boolean" || typeof position.held !== "boolean" || position.after !== null && (!record(position.after) || !text(position.after.id) || typeof position.after.date !== "string" || position.after.date !== "" && (!Number.isFinite(Date.parse(position.after.date)) || new Date(position.after.date).toISOString() !== position.after.date)))) throw new Error("The federal records page is invalid.");
  return parsed;
}

export async function readFederalMoneyForPlace(target: FederalMoneyTarget, options: FederalMoneyReadOptions = {}): Promise<FederalMoneyPlaceRead> {
  const jurisdiction = jurisdictionFromOcdId(target.divisionId);
  if (!jurisdiction) throw new Error("A US state, district or territory division is required.");
  const state = jurisdiction.usps;
  if (options.year !== undefined && !/^\d{4}$/.test(options.year)) throw new Error("The federal records year is invalid.");
  const recipientIds = target.bodyId ? [...new Set([target.bodyId, ...(target.bodyIds ?? [])])].sort() : [];
  const targetId = federalMoneyArtifactHash(JSON.stringify({ division: target.divisionId, body: target.bodyId ?? null, recipientIds,
    recipientNames: [...new Set(target.recipientNames ?? [])].sort(), recipientState: target.recipientState ?? null, year: options.year ?? null }));
  const cursor = decodeCursor(options.cursor, targetId);
  const backing = options.artifactStore === undefined ? resolveReaderArtifactStore() : options.artifactStore;
  const unavailable = (source: FederalMoneySource): FederalMoneyPlaceRead["sources"][number] => ({ source, status: "UNAVAILABLE", records: [], versionId: null, checkedAt: null });
  if (!backing) return { division: target.divisionId, bodyId: target.bodyId ?? null, recipientIds, nextCursor: null, sources: FEDERAL_MONEY_SOURCES.map(unavailable) };
  // Index seeks share immutable pages within this one request, including seeks
  // for overlapping recipient aliases. No reader state or source bytes persist.
  const bytes = new Map<string, ReturnType<ReaderArtifactStore["readBytes"]>>();
  const store = new Proxy(backing, { get(value, property) {
    if (property === "readBytes") return (key: string) => {
      let pending = bytes.get(key);
      if (!pending) { pending = value.readBytes(key); bytes.set(key, pending); }
      return pending;
    };
    const member = Reflect.get(value, property);
    return typeof member === "function" ? member.bind(value) : member;
  } });
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
  const positions: PageCursor["positions"] = { ...cursor?.positions };
  const results = await Promise.allSettled(FEDERAL_MONEY_SOURCES.map(async source => {
    if (loaded.some(row => row.status === "rejected")) throw new Error("Federal place artifact is unavailable.");
    const indices = loaded.flatMap(row => row.status === "fulfilled" && row.value ? [row.value] : []);
    const selected = indices.filter(index => source === "openfema"
      ? index.place.startsWith("division:") && (/\/county:[^/]+$/.test(index.place) || !target.bodyId && target.divisionId === federalMoneyStateDivision(state) && index.place === `division:${target.divisionId}`)
      : source === "federal-audit-clearinghouse" || source === "sam-gov-entities"
        ? target.bodyId ? recipientIds.some(id => index.place === `body:${id}`) : index.place === `division:${target.divisionId}`
        : index.place === `division:${target.divisionId}` || recipientIds.some(id => index.place === `body:${id}`));
    const prefix = `${source}:${options.year ?? "*"}:`;
    const position = cursor?.positions[source];
    interface Frontier { readonly index: FederalMoneyPlaceSnapshot; readonly tree: FederalMoneyIndex; entry: FederalMoneyIndexEntry | null }
    interface Stream { readonly segment: FederalMoneySegmentArtifact; readonly index: FederalMoneyPlaceSnapshot;
      page: number; offset: number; rows: readonly FederalMoneyFact[]; complete: boolean; readonly legacy: boolean }
    let after = position?.after ?? null;
    let held = position?.held ?? false;
    let checkedAt: string | null = null;
    const afterPosition = (fact: FederalMoneyFact) => !after || comparePosition({ date: federalMoneyActionDate(fact), id: fact.id }, after) > 0;
    async function pageRecords(segment: FederalMoneySegmentArtifact, pageIndex: number): Promise<readonly FederalMoneyFact[]> {
      const ref = segment.pages[pageIndex];
      const compressed = await store.readBytes(ref.key);
      if (!compressed || !federalMoneyArtifactKey(ref.key) || !ref.key.includes(federalMoneyArtifactHash(compressed))) throw new Error("Federal place records are unavailable.");
      const plain = gunzipSync(compressed);
      if (federalMoneyArtifactHash(plain) !== ref.hash) throw new Error("Federal place records do not match their accepted artifact.");
      const page = JSON.parse(plain.toString("utf8")) as FederalMoneyPlacePage;
      if (page.formatVersion !== 2 || page.state !== state || page.place !== segment.place || page.source !== source || page.versionId !== segment.versionId || !Array.isArray(page.records) || page.records.length > FEDERAL_MONEY_PAGE_SIZE || page.records.length !== ref.count) throw new Error("Federal place records do not match their accepted artifact.");
      return federalMoneyRows(page.records, target).map(row => row.fact).sort(compareFederalMoneyActions);
    }
    const streams: Stream[] = [];
    const reconciled = new Set<string>();
    async function segmentFor(index: FederalMoneyPlaceSnapshot, key: string) {
      const segment = await readFederalMoneyJson<FederalMoneySegmentArtifact>(store, key);
      if (segment.formatVersion !== 3 || segment.state !== state || segment.place !== index.place || segment.source !== source || !Array.isArray(segment.pages) || segment.pages.length === 0 || segment.pages.length > 5) throw new Error("Federal place segment identity is invalid.");
      return segment;
    }
    async function advance(frontier: Frontier) {
      do {
        const next = await frontier.tree.next(frontier.index.order, frontier.entry!.key, true);
        frontier.entry = next?.key.startsWith(prefix) ? next : null;
      } while (frontier.entry && reconciled.has(/^\d{16}:[^:]*:(.+)$/.exec(frontier.entry.key.slice(prefix.length))?.[1] ?? ""));
    }
    async function open(frontier: Frontier) {
      const segment = await segmentFor(frontier.index, frontier.entry!.value);
      await advance(frontier);
      held = true;
      checkedAt = checkedAt && checkedAt > segment.checkedAt ? checkedAt : segment.checkedAt;
      if (reconciled.has(segment.segmentId)) return;
      // Place pointers publish independently. During a correction, aliases may
      // hold two revisions of one partition. Reconcile just that bounded
      // partition before presenting either revision of the same native award.
      const replicas = selected.length > 1 ? (await Promise.all(selected.map(async index => {
        if (index.place === segment.place) return segment;
        const tree = new FederalMoneyIndex(store, `${federalMoneyPlaceKey(state, index.place)}:segments`);
        const key = await tree.get(index.segments, segment.segmentId);
        return key ? segmentFor(index, key) : null;
      }))).filter((row): row is FederalMoneySegmentArtifact => row !== null) : [segment];
      if (reconciled.has(segment.segmentId)) return;
      if (new Set(replicas.map(row => row.versionId)).size > 1) {
        reconciled.add(segment.segmentId);
        const winners = new Map<string, { fact: FederalMoneyFact; segment: FederalMoneySegmentArtifact }>();
        for (const replica of replicas) {
          const rows = (await Promise.all(replica.pages.map((_, index) => pageRecords(replica, index)))).flat();
          for (const fact of rows) {
            const prior = winners.get(fact.id);
            if (!prior || Date.parse(fact.provenance.retrievedAt) > Date.parse(prior.fact.provenance.retrievedAt)
                || fact.provenance.retrievedAt === prior.fact.provenance.retrievedAt && Date.parse(replica.checkedAt) > Date.parse(prior.segment.checkedAt)) {
              winners.set(fact.id, { fact, segment: replica });
            }
          }
        }
        streams.push({ segment, index: frontier.index, legacy: true, rows: [...winners.values()].map(row => row.fact).sort(compareFederalMoneyActions), page: 0, offset: 0, complete: false });
        for (const pending of frontiers) {
          if (pending.entry && reconciled.has(/^\d{16}:[^:]*:(.+)$/.exec(pending.entry.key.slice(prefix.length))?.[1] ?? "")) await advance(pending);
        }
        return;
      }
      const legacy = segment.actionOrderVersion !== 2;
      // Old immutable pages used publication order. Normalize each bounded
      // segment before merging; the ordinary publisher replaces those pages.
      const rows = legacy ? (await Promise.all(segment.pages.map((_, index) => pageRecords(segment, index)))).flat().sort(compareFederalMoneyActions) : [];
      const consumed = !legacy && after !== null && segment.pages.length === 1 && segment.pages[0].count === 1
        && comparePosition({ date: segment.latestActionDate ?? "", id: segment.latestActionId! }, after) <= 0;
      streams.push({ segment, index: frontier.index, legacy, rows, page: 0, offset: 0, complete: consumed });
    }
    async function head(stream: Stream): Promise<FederalMoneyFact | null> {
      while (!stream.complete) {
        while (stream.offset < stream.rows.length) {
          const fact = stream.rows[stream.offset];
          if (afterPosition(fact)) return fact;
          stream.offset++;
        }
        if (stream.legacy || stream.page >= stream.segment.pages.length) { stream.complete = true; break; }
        stream.rows = await pageRecords(stream.segment, stream.page++);
        stream.offset = 0;
      }
      return null;
    }
    const frontiers: Frontier[] = position?.complete ? [] : await Promise.all(selected.map(async index => {
      const tree = new FederalMoneyIndex(store, `${federalMoneyPlaceKey(state, index.place)}:order`);
      const entry = await tree.next(index.order, prefix);
      return { index, tree, entry: entry?.key.startsWith(prefix) ? entry : null };
    }));
    const actionOrder = selected.every(index => index.legacyActionSegments === 0);
    if (!actionOrder) await Promise.all(frontiers.map(async frontier => { while (frontier.entry) await open(frontier); }));
    const facts = new Map<string, FederalMoneyFact>();
    while (facts.size < FEDERAL_MONEY_PAGE_SIZE) {
      const heads = await Promise.all(streams.map(async stream => ({ stream, fact: await head(stream) })));
      const chosen = heads.filter((row): row is { stream: Stream; fact: FederalMoneyFact } => row.fact !== null)
        .sort((left, right) => compareFederalMoneyActions(left.fact, right.fact))[0];
      const unopened = frontiers.filter(frontier => frontier.entry).sort((left, right) => left.entry!.key < right.entry!.key ? -1 : left.entry!.key > right.entry!.key ? 1 : 0)[0];
      // The next segment's action bound must be below the chosen fact before
      // that fact is safe to show. The stable id bound also handles equal dates.
      const bound = unopened ? actionBound(unopened.entry!.key.slice(prefix.length)) : null;
      if (unopened && (!chosen || bound !== null && comparePosition(bound, { date: federalMoneyActionDate(chosen.fact), id: chosen.fact.id }) <= 0)) { await open(unopened); continue; }
      if (!chosen) break;
      chosen.stream.offset++;
      after = { date: federalMoneyActionDate(chosen.fact), id: chosen.fact.id };
      facts.set(chosen.fact.id, chosen.fact);
    }
    // Consume copies already in memory, so a recipient and its geographic copy
    // do not create a second page containing the same last award.
    for (const stream of streams) {
      while (stream.offset < stream.rows.length && !afterPosition(stream.rows[stream.offset])) stream.offset++;
      if (stream.offset >= stream.rows.length && (stream.legacy || stream.page >= stream.segment.pages.length)) stream.complete = true;
    }
    const moreRecords = frontiers.some(frontier => frontier.entry !== null) || streams.some(stream => !stream.complete);
    positions[source] = { after, complete: !moreRecords, held };
    const status = statuses[source];
    const versionId = federalMoneyArtifactHash(JSON.stringify(selected.map(index => snapshots[index.place])));
    return { source, status: held ? "HELD" as const : status?.reason ? "UNAVAILABLE" as const : "NOT_HELD" as const,
      records: [...facts.values()], versionId: held ? versionId : null, checkedAt: status?.checkedAt ?? checkedAt,
      coverageComplete: status?.complete ?? false, moreRecords };
  }));
  const sources = results.map((result, index) => result.status === "fulfilled" ? result.value : unavailable(FEDERAL_MONEY_SOURCES[index]));
  const nextCursor = sources.some(source => source.moreRecords) ? Buffer.from(JSON.stringify({ formatVersion: 2, target: targetId, snapshots, positions })).toString("base64url") : null;
  return { division: target.divisionId, bodyId: target.bodyId ?? null, recipientIds, nextCursor, sources };
}
