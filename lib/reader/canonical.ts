import {savedCanonicalStatement as canonicalStatement,type PageAdditional} from "./page-authorities.ts";
import {buildMissingPlacePages} from "./place-builder.ts";
import {currentReaderSelection} from "../db/reader-route.ts";
import { parseUnchangedConfirmation } from "../civic-data/unchanged-confirmation.ts";
import { canonicalCivicDataHash } from "../civic-data/canonical-hash.ts";
import type { ReadOnlyQuery, Statement, Row } from "../control-plane/admin-view/promoted-slices.ts";
import { readerDatabaseQuery } from "./database.ts";
import { CivicPayloadParts } from "../civic-data/payload-parts.ts";
import { registerIntegrityCheckedEdgeEntries, type CivicDataReadStore, type PromotedEdgeEntry } from "../civic-data/read-model.ts";
import type { RoutineRecordClass } from "../civic-data/types.ts";
import { isCivicPayloadPart } from "../civic-data/payload-codec.ts";

type Pointer = { recordClass: RoutineRecordClass; scope: string };
type Additional = PageAdditional;
type CanonicalRead = Awaited<ReturnType<typeof readCanonicalShelf>>;
type PublishedQuery = ReadOnlyQuery & { canonicalBody?: ReadOnlyQuery };

/** One network read with independent group failures; accompanying geography belongs to the first group. */
export function readCanonicalPackages(groups: readonly (readonly Pointer[])[], query: ReadOnlyQuery | null = readerDatabaseQuery(), additional?: Additional): CivicDataReadStore & { readGroup(index: number): Promise<CanonicalRead> } {
  const keys = [...new Set(groups.flatMap(group => group.map(entry => `${entry.recordClass}:${entry.scope}`)))];
  const batch = (async () => {
    if (!query) throw new Error("READER_STORE_NOT_CONFIGURED");
    const statement = canonicalStatement(keys, additional);
    return readReadyStatement(query,statement);
  })();
  void batch.catch(() => undefined);
  const stores = new Map<string, Promise<CivicDataReadStore>>();
  const reads: Promise<CanonicalRead>[] = [];
  for (const [index,group] of groups.entries()) {
    const selected = new Set(group.map(entry => `${entry.recordClass}:${entry.scope}`));
    const read = readCanonicalShelf(group, async () => {
      const [rows] = await batch;
      const extra = index === 0 ? rows.find(row => row.row_kind === "additional") : undefined;
      if (extra && additional?.canonicalKeys) for (const row of extra.part_payload as readonly Row[]) {
        for (const key of row.canonical_keys as readonly string[] ?? []) selected.add(key);
      }
      const promotions = rows.filter(row => row.row_kind === "promotion" && selected.has(String(row.key)));
      const parts = new Map(rows.filter(row => row.row_kind === "part").map(row => [String(row.part_hash),row]));
      const needed = new Set<string>();
      const visit = (value: unknown): void => {
        if (isCivicPayloadPart(value)) {
          const hash = value.$civicPayloadPart;
          if (needed.has(hash)) return;
          needed.add(hash); visit(parts.get(hash)?.part_payload);
        } else if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === "object") Object.values(value).forEach(visit);
      };
      for (const row of promotions) { visit(row.payload); visit(row.validation_receipt); }
      const selectedRows: Row[] = [...promotions];
      for (const hash of needed) { const part = parts.get(hash); if (part) selectedRows.push(part); }
      if (extra) selectedRows.push(extra);
      return [structuredClone(selectedRows)];
    }, index === 0 ? additional : undefined);
    reads.push(read);
    void read.catch(() => undefined);
    for (const entry of group) stores.set(`${entry.recordClass}:${entry.scope}`, read);
  }
  return {
    async readGroup(index) {
      const read = reads[index];
      if (!read) throw new Error("READER_GROUP_NOT_SELECTED");
      return read;
    },
    async readPromotion() { throw new Error("READER_USES_CANONICAL_ENTRY"); },
    async readCandidate() { throw new Error("READER_USES_CANONICAL_ENTRY"); },
    async readPromotedEntry(recordClass, scope) {
      const read = stores.get(`${recordClass}:${scope}`);
      if (!read) throw new Error(`READER_SCOPE_NOT_SELECTED:${recordClass}:${scope}`);
      return (await read).readPromotedEntry!(recordClass, scope);
    },
  };
}

/** Read canonical promotions once; source evidence was checked when each fact was published. */
export async function readCanonicalShelf(entries: readonly { recordClass: RoutineRecordClass; scope: string }[], query: ReadOnlyQuery | null = readerDatabaseQuery(), additional?: Additional): Promise<CivicDataReadStore & { additionalRows: readonly Row[]; additionalEntries: readonly Pointer[] }> {
  if (!query) throw new Error("READER_STORE_NOT_CONFIGURED");
  const keys = entries.map(entry => `${entry.recordClass}:${entry.scope}`);
  const [loaded] = await readReadyStatement(query,canonicalStatement(keys,additional));
  const additionalRows = loaded.find(row => row.row_kind === "additional")?.part_payload as readonly Row[] | undefined;
  const additionalEntries: Pointer[] = additional?.canonicalKeys ? [...new Set((additionalRows ?? []).flatMap(row => row.canonical_keys as readonly string[] ?? []))]
    .map(key => { const colon = key.indexOf(":"); return { recordClass: key.slice(0, colon) as RoutineRecordClass, scope: key.slice(colon + 1) }; }) : [];
  keys.push(...additionalEntries.map(entry => `${entry.recordClass}:${entry.scope}`));
  const rows = loaded.filter(row => row.row_kind === "promotion");
  const preloaded = Object.fromEntries(loaded.filter(row => row.row_kind === "part").map(row => [String(row.part_hash),row.part_payload]));
  if (rows.some(row => row.published !== true)) throw new Error("READER_PUBLISHED_POINTER_INVALID");
  const parts = new CivicPayloadParts({
    async existing() { throw new Error("READER_IS_READ_ONLY"); },
    async write() { throw new Error("READER_IS_READ_ONLY"); },
    async read() { throw new Error("READER_PARTS_MISSING"); },
  });
  const values = await parts.loadOwned(rows, preloaded) as typeof rows;
  const decoded: { root: PromotedEdgeEntry }[] = values.map(row => ({ root: { kind: "PROMOTED", projection: {
    key: String(row.key), recordClass: row.record_class as RoutineRecordClass, scope: String(row.scope), sourceId: String(row.source_id),
    versionId: String(row.current_version_id), lastKnownGoodVersionId: String(row.last_known_good_version_id), promotedAt: String(row.promoted_at),
    receipt: row.validation_receipt as import("../civic-data/types.ts").ValidationReceipt, payload: row.payload,
  }, attested: { recordClass: row.record_class as RoutineRecordClass, scope: String(row.scope), versionId: String(row.current_version_id),
    payloadSha256: String(row.normalized_hash), retrievedAt: String(row.retrieved_at), staleAtRetrieval: false, version: null, sourceThrough: null,
  } } }));
  for (let index = 0; index < decoded.length; index++) {
    const entry = decoded[index].root;
    const serialized = values[index].confirmation;
    const confirmation = typeof serialized === "string" ? parseUnchangedConfirmation(serialized) : null;
    if (entry.kind === "PROMOTED" && confirmation?.versionId === entry.projection.versionId && confirmation.pointerKey === entry.projection.key) Object.assign(entry.projection, { latestConfirmation: confirmation });
  }
  const held = new Map(decoded.map(({ root }) => [root.kind === "PROMOTED" ? root.projection.key : `${root.recordClass}:${root.scope}`, root]));
  for (const entry of held.values()) if (entry.kind === "PROMOTED") {
    if (canonicalCivicDataHash(entry.projection.payload) !== entry.attested.payloadSha256) throw new Error("READER_PUBLISHED_PAYLOAD_HASH_MISMATCH");
  }
  registerIntegrityCheckedEdgeEntries([...held.values()]);
  return {
    additionalRows: additionalRows ?? [], additionalEntries,
    async readPromotion() { throw new Error("READER_USES_CANONICAL_ENTRY"); },
    async readCandidate() { throw new Error("READER_USES_CANONICAL_ENTRY"); },
    async readPromotedEntry(recordClass, scope) {
      const key = `${recordClass}:${scope}`;
      if (!keys.includes(key)) throw new Error(`READER_SCOPE_NOT_SELECTED:${key}`);
      return held.get(key) ?? { kind: "NOT_RECORDED", recordClass, scope };
    },
  };
}

/** Missing sections are built once; every successful request consumes the saved page. */
async function readReadyStatement(query:ReadOnlyQuery,statement:Statement):ReturnType<ReadOnlyQuery> {
  const run=(query as PublishedQuery).canonicalBody??query;
  let [rows]=await run([statement]);
  const missing=rows.filter(row=>row.row_kind==='missing-page').map(row=>String(row.part_hash));
  if(missing.length){
    const pages=[];
    for(const id of missing){
      const state=/\/(?:state|territory|district):([a-z]{2})(?:\/|$)/.exec(id)?.[1]?.toUpperCase()
        ??currentReaderSelection()?.states?.[0]??(id==='ocd-division/country:us'?'US':undefined);
      if(!state)throw new Error(`PLACE_AUTHORITY_STATE_MISSING:${id}`);
      pages.push({id,kind:'place',state,authorities:true});
    }
    await buildMissingPlacePages(pages);
    [rows]=await run([statement]);
    if(rows.some(row=>row.row_kind==='missing-page'))throw new Error('PLACE_AUTHORITY_BUILD_NOT_SAVED');
  }
  return [rows];
}
