import { parseUnchangedConfirmation } from "../civic-data/unchanged-confirmation.ts";
import { canonicalCivicDataHash } from "../civic-data/canonical-hash.ts";
import type { ReadOnlyQuery, Statement, Row } from "../control-plane/admin-view/promoted-slices.ts";
import { readerDatabaseQuery } from "./database.ts";
import { CivicPayloadParts } from "../civic-data/payload-parts.ts";
import { registerIntegrityCheckedEdgeEntries, type CivicDataReadStore, type PromotedEdgeEntry } from "../civic-data/read-model.ts";
import type { RoutineRecordClass } from "../civic-data/types.ts";
import { serverReaderValue } from "./memory.ts";
import { isCivicPayloadPart } from "../civic-data/payload-codec.ts";

type Pointer = { recordClass: RoutineRecordClass; scope: string };
type Additional = Statement & { readonly canonicalKeys?: true };
type CanonicalRead = Awaited<ReturnType<typeof readCanonicalShelf>>;

/** One network read with independent group failures; accompanying geography belongs to the first group. */
export function readCanonicalPackages(groups: readonly (readonly Pointer[])[], query: ReadOnlyQuery | null = readerDatabaseQuery(), additional?: Additional): CivicDataReadStore & { readGroup(index: number): Promise<CanonicalRead> } {
  const keys = [...new Set(groups.flatMap(group => group.map(entry => `${entry.recordClass}:${entry.scope}`)))];
  const batch = (async () => {
    if (!query) throw new Error("READER_STORE_NOT_CONFIGURED");
    return query([canonicalStatement(keys, additional)]);
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

// Exclusion reasons belong to the read disposition; copies of rejected source rows stay in the audit store.
const SHELF = `SELECT p.key,p.record_class,p.scope,p.source_id,p.current_version_id,p.last_known_good_version_id,p.promoted_at,
 CASE WHEN jsonb_typeof(p.validation_receipt->'excludedFacts')='array' THEN
  jsonb_set(p.validation_receipt,'{excludedFacts}',coalesce((SELECT jsonb_agg(f.value-'record') FROM jsonb_array_elements(p.validation_receipt->'excludedFacts') f(value)),'[]'::jsonb))
  ELSE p.validation_receipt END AS validation_receipt,
 CASE WHEN p.current_version_id=ANY($2::text[]) THEN NULL ELSE p.payload END AS payload,
 c.normalized_hash,c.retrieved_at,
 (SELECT e.detail FROM civic_data_candidate_events e WHERE e.candidate_id=p.current_version_id AND left(e.detail,26)='UNCHANGED_CONFIRMATION_V1 ' ORDER BY e.sequence DESC LIMIT 1) AS confirmation,
 (p.current_version_id=p.last_known_good_version_id AND c.id=p.current_version_id AND c.state='PROMOTED' AND c.acquisition_succeeded
  AND c.promoted_version_id=c.id AND c.last_known_good_version_id=c.id AND c.record_class=p.record_class AND c.scope=p.scope AND c.source_id=p.source_id
  AND p.validation_receipt->>'decision'='GOOD' AND p.validation_receipt->>'candidateId'=c.id AND p.validation_receipt->>'sourceId'=c.source_id
  AND p.validation_receipt->>'recordClass'=p.record_class AND p.validation_receipt->>'scope'=p.scope) AS published
 FROM civic_data_promotions p LEFT JOIN civic_data_candidates c ON c.id=p.current_version_id WHERE p.key=ANY($1::text[])`;

// Keep payloads as individual rows: aggregating a large state payload into JSON adds avoidable copies.
// LIMIT 1 keeps each recursive hash lookup parameterized on the primary key. Without it,
// PostgreSQL can walk every stored part before joining the requested hashes at each level.
const SHELF_WITH_PARTS = `WITH RECURSIVE shelf AS MATERIALIZED (${SHELF}), hashes(hash) AS (
  SELECT ref#>>'{}' FROM shelf,
    LATERAL (VALUES (shelf.payload),(shelf.validation_receipt)) AS roots(value),
    LATERAL jsonb_path_query(roots.value,'strict $.**."$civicPayloadPart"','{}',true) ref WHERE shelf.published
  UNION
  SELECT ref#>>'{}' FROM hashes
    CROSS JOIN LATERAL (SELECT payload FROM civic_data_payload_parts WHERE hash=hashes.hash LIMIT 1) part,
    LATERAL jsonb_path_query(part.payload,'strict $.**."$civicPayloadPart"','{}',true) ref
)
SELECT 'promotion' AS row_kind,shelf.*,NULL::text AS part_hash,NULL::jsonb AS part_payload FROM shelf
UNION ALL
SELECT 'part',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,part.hash,part.payload
  FROM hashes CROSS JOIN LATERAL (
    SELECT hash,payload FROM civic_data_payload_parts WHERE hash=hashes.hash LIMIT 1
  ) part`;

const cached = serverReaderValue("canonical", () => new Map<string, Extract<PromotedEdgeEntry, { kind: "PROMOTED" }>>());

function canonicalStatement(keys: readonly string[], additional?: Additional): Statement {
  const additionalSql = additional?.text.replace(/\$(\d+)/g, (_, index: string) => `$${Number(index) + 2}`);
  const shelfSql = additional?.canonicalKeys ? SHELF_WITH_PARTS
    .replace("WITH RECURSIVE shelf", () => `WITH RECURSIVE additional AS MATERIALIZED (${additionalSql}), shelf`)
    .replace("p.key=ANY($1::text[])", "p.key=ANY($1::text[] || ARRAY(SELECT DISTINCT unnest(canonical_keys) FROM additional))") : SHELF_WITH_PARTS;
  const extra = additional ? ` UNION ALL SELECT 'additional', empty.*, NULL::text, extra.rows
    FROM (SELECT coalesce(jsonb_agg(to_jsonb(item)), '[]'::jsonb) AS rows FROM (
      ${additional.canonicalKeys ? "SELECT * FROM additional" : additionalSql}
    ) item) extra LEFT JOIN LATERAL (SELECT * FROM shelf LIMIT 0) empty ON true` : "";
  const versions = additional?.canonicalKeys ? [...cached.values()].map(entry => entry.projection.versionId)
    : keys.flatMap(key => cached.get(key)?.projection.versionId ?? []);
  return {text:shelfSql+extra,params:[keys,versions,...additional?.params ?? []]};
}

/** Read canonical promotions once; source evidence was checked when each fact was published. */
export async function readCanonicalShelf(entries: readonly { recordClass: RoutineRecordClass; scope: string }[], query: ReadOnlyQuery | null = readerDatabaseQuery(), additional?: Additional): Promise<CivicDataReadStore & { additionalRows: readonly Row[]; additionalEntries: readonly Pointer[] }> {
  if (!query) throw new Error("READER_STORE_NOT_CONFIGURED");
  const keys = entries.map(entry => `${entry.recordClass}:${entry.scope}`);
  const [loaded] = await query([canonicalStatement(keys,additional)]);
  const additionalRows = loaded.find(row => row.row_kind === "additional")?.part_payload as readonly Row[] | undefined;
  const additionalEntries: Pointer[] = additional?.canonicalKeys ? [...new Set((additionalRows ?? []).flatMap(row => row.canonical_keys as readonly string[] ?? []))]
    .map(key => { const colon = key.indexOf(":"); return { recordClass: key.slice(0, colon) as RoutineRecordClass, scope: key.slice(colon + 1) }; }) : [];
  keys.push(...additionalEntries.map(entry => `${entry.recordClass}:${entry.scope}`));
  const rows = loaded.filter(row => row.row_kind === "promotion");
  const preloaded = Object.fromEntries(loaded.filter(row => row.row_kind === "part").map(row => [String(row.part_hash),row.part_payload]));
  const reused = new Set<string>();
  for (const row of rows) {
    const previous = cached.get(String(row.key));
    if (row.payload === null && previous && previous.projection.versionId === row.current_version_id && previous.attested.payloadSha256 === row.normalized_hash) {
      Object.assign(row, { payload: previous.projection.payload }); reused.add(String(row.key));
    }
  }
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
    if (!reused.has(entry.projection.key) && canonicalCivicDataHash(entry.projection.payload) !== entry.attested.payloadSha256) throw new Error("READER_PUBLISHED_PAYLOAD_HASH_MISMATCH");
    cached.set(entry.projection.key, entry);
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
