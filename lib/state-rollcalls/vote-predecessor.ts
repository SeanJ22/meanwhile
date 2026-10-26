import { createVotePageSink } from "./vote-page-writer.ts";
import { createHash } from "node:crypto";
import { CivicPayloadParts } from "../civic-data/payload-parts.ts";
import { isCivicPayloadPart } from "../civic-data/payload-codec.ts";
import { canonicalCivicDataJson } from "../civic-data/changes.ts";
import { readerQuery } from "../civic-data/promoted-reader-query.ts";
import { parseValidationReceipt } from "../civic-data/receipt.ts";
import { PostgresRoutineDataStore, type RoutineDataStore } from "../civic-data/store.ts";
import type { CivicDataReadResult } from "../civic-data/read-model.ts";
import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import { pluralVotesProjectionIssue, type PluralVoteFact } from "../sources/plural/votes.ts";
import type { VotePageProjection } from "./vote-page-model.ts";
import { canonicalCivicDataHash } from "../civic-data/changes.ts";
import { runtimeCivicReadCache, type CivicReadCache } from "../db/civic-read-cache.ts";

const SHA = /^[a-f0-9]{64}$/;
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("VOTE_PREDECESSOR_SHAPE_INVALID");
  return value as Record<string, unknown>;
};

/** Read the encoded source projection only. Candidate payloads and their other
 * evidence graphs stay in Postgres; the boolean couples the exact published proof. */
const POINTER_ETAG = `concat(p.xmin::text,'/',p.ctid::text,':',c.xmin::text,'/',c.ctid::text)`;
const POINTER = `SELECT CASE WHEN ${POINTER_ETAG}=$3 THEN NULL ELSE p.payload END AS payload,
  ${POINTER_ETAG}=$3 AS unchanged,${POINTER_ETAG} AS etag,
  p.current_version_id AS version_id,p.validation_receipt AS receipt,c.normalized_hash,
  (c.id=p.current_version_id AND c.source_id=p.source_id AND c.record_class=p.record_class AND c.scope=p.scope
    AND p.current_version_id=p.last_known_good_version_id AND c.promoted_version_id=c.id AND c.last_known_good_version_id=c.id
    AND c.state='PROMOTED' AND c.acquisition_succeeded AND c.candidate#>'{normalization,succeeded}'='true'::jsonb
    AND c.normalized_hash ~ '^[a-f0-9]{64}$' AND c.candidate#>>'{normalization,normalizedHash}'=c.normalized_hash
    AND p.validation_receipt=c.validation_receipt AND p.payload=c.candidate->'readModel'
    AND p.source_id=$2 AND p.validation_receipt->>'decision'='GOOD'
    AND p.validation_receipt->>'candidateId'=c.id AND p.validation_receipt->>'sourceId'=p.source_id
    AND p.validation_receipt->>'recordClass'=p.record_class AND p.validation_receipt->>'scope'=p.scope) AS proof_valid
  FROM civic_data_promotions p LEFT JOIN civic_data_candidates c ON c.id=p.current_version_id
  WHERE p.record_class='STATE_ROLL_CALL' AND p.scope=$1`;

type Metadata<T> = Omit<T, "rollCalls"> & { rollCalls: [] };

type VoteRefreshInput<T extends VotePageProjection> = {
  state: string; sourceId: string; scope: string; civicStore: RoutineDataStore; vault: EvidenceStore; signal?: AbortSignal;
  readPrior: () => Promise<CivicDataReadResult<T>>;
  /** The same read-only query interface permits deterministic storage-codec tests. */
  query?: ReadOnlyQuery;
  cache?: CivicReadCache;
};
type PartVersion = { key: string; etag: string };
type SavedPredecessor<T> = { projection: T; versionId: string; payload: unknown; parts: PartVersion[] };

async function partVersions(query: ReadOnlyQuery, hashes: readonly string[]): Promise<PartVersion[]> {
  const versions: PartVersion[] = [];
  for (let at = 0; at < hashes.length; at += 512) {
    const [rows] = await query([{ text: "SELECT hash AS key,concat(xmin::text,'/',ctid::text) AS etag FROM civic_data_payload_parts WHERE hash=ANY($1::text[])", params: [hashes.slice(at, at + 512)] }]);
    for (const row of rows) {
      if (typeof row.key !== "string" || !SHA.test(row.key) || typeof row.etag !== "string" || !row.etag.length) throw new Error("VOTE_PREDECESSOR_PART_ID_INVALID");
      versions.push({ key: row.key, etag: row.etag });
    }
  }
  return versions;
}

/** A legacy source is authenticated while each individual roll moves directly
 * into SQLite. Every reuse checks the published rows and their part versions. */
export async function createVoteRefreshSink<T extends VotePageProjection>(input: VoteRefreshInput<T>): Promise<{
  sink: Awaited<ReturnType<typeof createVotePageSink>>; baseVersionId: string | null; priorMetadata: Metadata<T> | null;
}> {
  if (!input.query && !(input.civicStore instanceof PostgresRoutineDataStore)) {
    const prior = await input.readPrior();
    if (prior.kind !== "PROMOTED" && prior.kind !== "NOT_RECORDED") throw new Error("VOTE_PREDECESSOR_UNAVAILABLE");
    const value = prior.kind === "PROMOTED" ? prior.value : null;
    return { sink: await createVotePageSink({ state: input.state, sourceId: input.sourceId, vault: input.vault, prior: value, signal: input.signal }),
      baseVersionId: prior.metadata.versionId, priorMetadata: value ? { ...value, rollCalls: [] } as Metadata<T> : null };
  }
  const query = input.query ?? readerQuery();
  if (!query) throw new Error("VOTE_PREDECESSOR_READER_UNAVAILABLE");
  const shared = (input.cache ?? runtimeCivicReadCache()).jobState();
  const saved = await shared.row<SavedPredecessor<T>>({ namespace: `vote-predecessor:${input.sourceId}`, key: input.scope,
    current: async (etag, held) => {
      const [rows] = await query([{ text: POINTER, params: [input.scope, input.sourceId, etag] }]);
      if (!rows.length) return null;
      const pointer = rows[0] as Record<string, unknown>, receipt = parseValidationReceipt(pointer.receipt);
      if (rows.length !== 1 || pointer.proof_valid !== true || typeof pointer.version_id !== "string" || !pointer.version_id ||
        typeof pointer.etag !== "string" || !pointer.etag.length || !receipt || receipt.decision !== "GOOD" ||
        receipt.candidateId !== pointer.version_id || receipt.sourceId !== input.sourceId || receipt.recordClass !== "STATE_ROLL_CALL" ||
        receipt.scope !== input.scope || typeof pointer.normalized_hash !== "string" || !SHA.test(pointer.normalized_hash)) throw new Error("VOTE_PREDECESSOR_PROOF_INVALID");
      if (pointer.unchanged === true && held && Array.isArray(held.parts)) {
        const current = new Map((await partVersions(query, held.parts.map(part => part.key))).map(part => [part.key, part.etag]));
        if (held.parts.every(part => current.get(part.key) === part.etag)) return { etag: pointer.etag, unchanged: true };
        pointer.payload = held.payload;
      }
      const seeded = await hydratePredecessor(input, pointer, query, shared);
      try { return { etag: pointer.etag, value: { projection: { ...seeded.priorMetadata, ...await seeded.sink.snapshot() } as T,
        versionId: pointer.version_id, payload: pointer.payload, parts: seeded.parts } }; }
      finally { await seeded.sink.close(); }
    } });
  return { sink: await createVotePageSink({ state: input.state, sourceId: input.sourceId, vault: input.vault, prior: saved?.projection ?? null, signal: input.signal }),
    baseVersionId: saved?.versionId ?? null, priorMetadata: saved ? { ...saved.projection, rollCalls: [] } as Metadata<T> : null };
}

/** Cold legacy hydration shares the same versioned part reader as warm reads. */
async function hydratePredecessor<T extends VotePageProjection>(input: VoteRefreshInput<T>, pointer: Record<string, unknown>, query: ReadOnlyQuery, shared: CivicReadCache) {
  const dependencies = new Map<string, string>();
  const empty = () => createVotePageSink({ state: input.state, sourceId: input.sourceId, vault: input.vault, prior: null, signal: input.signal });
  const readParts = async (hashes: readonly string[]) => {
    input.signal?.throwIfAborted();
    if (hashes.some(hash => !SHA.test(hash))) throw new Error("VOTE_PREDECESSOR_PART_ID_INVALID");
    const rows = await shared.rows<{ hash: string; payload: unknown; etag: string }, PartVersion>({ namespace: "payload-part", keys: hashes,
      versions: keys => partVersions(query, keys),
      values: async keys => (await query([{ text: "SELECT hash,payload,concat(xmin::text,'/',ctid::text) AS etag FROM civic_data_payload_parts WHERE hash=ANY($1::text[])", params: [keys] }]))[0] as { hash: string; payload: unknown; etag: string }[],
      keyOf: row => row.hash, etagOf: row => row.etag, freshen: (row, version) => ({ ...row, etag: version.etag }) });
    if (rows.length !== hashes.length || rows.some((row, index) => row.hash !== hashes[index])) throw new Error("VOTE_PREDECESSOR_PART_MISSING");
    for (const row of rows) dependencies.set(row.hash, row.etag);
    return rows;
  };
  const savedParts = () => [...dependencies].map(([key, etag]) => ({ key, etag }));
  const parts = new CivicPayloadParts({ existing: async () => [], write: async () => { throw new Error("READ_ONLY"); }, read: readParts });
  const raw = async (value: unknown): Promise<unknown> => {
    const seen = new Set<string>();
    while (isCivicPayloadPart(value)) {
      if (seen.has(value.$civicPayloadPart)) throw new Error("VOTE_PREDECESSOR_PART_CYCLE");
      seen.add(value.$civicPayloadPart);
      value = (await readParts([value.$civicPayloadPart]))[0].payload;
    }
    return value;
  };
  let root = object(await raw(pointer.payload));
  if (root.kind === "object") root = object(await raw(root.value));
  const format = await parts.load(root.formatVersion), state = await parts.load(root.state);
  if (format === 2) {
    const value = await parts.load(root) as T;
    if (canonicalCivicDataHash(value) !== pointer.normalized_hash) throw new Error("VOTE_PREDECESSOR_HASH_MISMATCH");
    return { sink: await createVotePageSink({ state: input.state, sourceId: input.sourceId, vault: input.vault, prior: value, signal: input.signal }),
      priorMetadata: { ...value, rollCalls: [] } as Metadata<T>, parts: savedParts() };
  }
  if (format !== 1 || state !== input.state || !Object.hasOwn(root, "rollCalls")) throw new Error("VOTE_PREDECESSOR_SHAPE_INVALID");

  async function* encodedVotes(): AsyncIterable<unknown> {
    const value = await raw(root.rollCalls);
    if (Array.isArray(value)) { yield* value; return; }
    const node = object(value);
    if (node.kind !== "array" || !Array.isArray(node.groups)) throw new Error("VOTE_PREDECESSOR_ARRAY_INVALID");
    const order = JSON.parse(String(await parts.load(node.order))) as unknown;
    if (!Array.isArray(order)) throw new Error("VOTE_PREDECESSOR_ARRAY_ORDER_INVALID");
    const offsets = new Uint32Array(node.groups.length);
    for (const group of order) {
      input.signal?.throwIfAborted();
      if (!Number.isInteger(group) || group < 0 || group >= node.groups.length) throw new Error("VOTE_PREDECESSOR_ARRAY_ORDER_INVALID");
      const rows = await raw(node.groups[group]);
      if (!Array.isArray(rows) || offsets[group] >= rows.length) throw new Error("VOTE_PREDECESSOR_ARRAY_ORDER_INVALID");
      yield rows[offsets[group]++];
    }
    for (let group = 0; group < node.groups.length; group++) {
      const rows = await raw(node.groups[group]);
      if (!Array.isArray(rows) || offsets[group] !== rows.length) throw new Error("VOTE_PREDECESSOR_ARRAY_ORDER_INVALID");
    }
  }
  const sink = await empty(), hash = createHash("sha256"), metadata: Record<string, unknown> = {}, seen = new Set<string>();
  try {
    hash.update("{"); let firstKey = true;
    for (const key of Object.keys(root).sort((a,b) => a.localeCompare(b))) {
      if (!firstKey) hash.update(","); firstKey = false;
      hash.update(JSON.stringify(key)).update(":");
      if (key !== "rollCalls") {
        metadata[key] = await parts.load(root[key]);
        hash.update(canonicalCivicDataJson(metadata[key]));
        continue;
      }
      hash.update("["); let firstVote = true;
      for await (const encoded of encodedVotes()) {
        input.signal?.throwIfAborted();
        const vote = await parts.load(encoded) as PluralVoteFact;
        if (!vote || seen.has(vote.id) || (input.sourceId === "plural-openstates-votes" && pluralVotesProjectionIssue({ formatVersion: 1, state: input.state, rollCalls: [vote] })))
          throw new Error("VOTE_PREDECESSOR_FACT_INVALID");
        seen.add(vote.id);
        if (!firstVote) hash.update(","); firstVote = false;
        hash.update(canonicalCivicDataJson(vote));
        const issue = await sink.put(vote);
        if (issue) throw new Error(`VOTE_PREDECESSOR_FACT_INVALID:${issue}`);
      }
      hash.update("]");
    }
    hash.update("}");
    if (hash.digest("hex") !== pointer.normalized_hash) throw new Error("VOTE_PREDECESSOR_HASH_MISMATCH");
    return { sink, priorMetadata: { ...metadata, rollCalls: [] } as Metadata<T>, parts: savedParts() };
  } catch (error) { await sink.close(); throw error; }
}
