import { createVotePageSink } from "./vote-page-writer.ts";
import { createHash } from "node:crypto";
import { CivicPayloadParts } from "../civic-data/payload-parts.ts";
import { civicPayloadBytes, isCivicPayloadPart } from "../civic-data/payload-codec.ts";
import { canonicalCivicDataJson } from "../civic-data/changes.ts";
import { readerQuery } from "../civic-data/promoted-reader-query.ts";
import { parseValidationReceipt } from "../civic-data/receipt.ts";
import { PostgresRoutineDataStore, type RoutineDataStore } from "../civic-data/store.ts";
import type { CivicDataReadResult } from "../civic-data/read-model.ts";
import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import { pluralVotesProjectionIssue, type PluralVoteFact } from "../sources/plural/votes.ts";
import type { VotePageProjection } from "./vote-page-model.ts";

const CACHE_BYTES = 64 * 1024 * 1024;
const SHA = /^[a-f0-9]{64}$/;
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("VOTE_PREDECESSOR_SHAPE_INVALID");
  return value as Record<string, unknown>;
};

/** Read the encoded source projection only. Candidate payloads and their other
 * evidence graphs stay in Postgres; the boolean couples the exact published proof. */
const POINTER = `SELECT p.payload,p.current_version_id AS version_id,p.validation_receipt AS receipt,c.normalized_hash,
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

/** A legacy source is authenticated while each individual roll moves directly
 * into SQLite. No decoded row group or complete session positions stay in memory. */
export async function createVoteRefreshSink<T extends VotePageProjection>(input: {
  state: string; sourceId: string; scope: string; civicStore: RoutineDataStore; vault: EvidenceStore; signal?: AbortSignal;
  readPrior: () => Promise<CivicDataReadResult<T>>;
  /** The same read-only query interface permits deterministic storage-codec tests. */
  query?: ReadOnlyQuery;
}): Promise<{ sink: Awaited<ReturnType<typeof createVotePageSink>>; baseVersionId: string | null; priorMetadata: Metadata<T> | null }> {
  const empty = () => createVotePageSink({ state: input.state, sourceId: input.sourceId, vault: input.vault, prior: null, signal: input.signal });
  const ordinary = async () => {
    const prior = await input.readPrior();
    if (prior.kind !== "PROMOTED" && prior.kind !== "NOT_RECORDED") throw new Error("VOTE_PREDECESSOR_UNAVAILABLE");
    const value = prior.kind === "PROMOTED" ? prior.value : null;
    return { sink: await createVotePageSink({ state: input.state, sourceId: input.sourceId, vault: input.vault, prior: value, signal: input.signal }),
      baseVersionId: prior.metadata.versionId, priorMetadata: value ? { ...value, rollCalls: [] } as Metadata<T> : null };
  };
  if (!input.query && !(input.civicStore instanceof PostgresRoutineDataStore)) return ordinary();
  const query = input.query ?? readerQuery();
  if (!query) throw new Error("VOTE_PREDECESSOR_READER_UNAVAILABLE");
  const [rows] = await query([{ text: POINTER, params: [input.scope, input.sourceId] }]);
  if (!rows.length) return { sink: await empty(), baseVersionId: null, priorMetadata: null };
  const pointer = rows[0], versionId = pointer.version_id;
  const receipt = parseValidationReceipt(pointer.receipt);
  if (rows.length !== 1 || pointer.proof_valid !== true || typeof versionId !== "string" || !versionId ||
      !receipt || receipt.decision !== "GOOD" || receipt.candidateId !== versionId || receipt.sourceId !== input.sourceId ||
      receipt.recordClass !== "STATE_ROLL_CALL" || receipt.scope !== input.scope || typeof pointer.normalized_hash !== "string" || !SHA.test(pointer.normalized_hash))
    throw new Error("VOTE_PREDECESSOR_PROOF_INVALID");

  const cache = new Map<string, { payload: unknown; bytes: number }>();
  let cachedBytes = 0;
  const readParts = async (hashes: readonly string[]) => {
    input.signal?.throwIfAborted();
    if (hashes.some(hash => !SHA.test(hash))) throw new Error("VOTE_PREDECESSOR_PART_ID_INVALID");
    const missing = [...new Set(hashes.filter(hash => !cache.has(hash)))];
    const fetched = new Map<string, unknown>();
    if (missing.length) {
      const [parts] = await query([{ text: "SELECT hash,payload FROM civic_data_payload_parts WHERE hash=ANY($1::text[])", params: [missing] }]);
      for (const part of parts) {
        if (typeof part.hash !== "string" || !missing.includes(part.hash) || fetched.has(part.hash)) throw new Error("VOTE_PREDECESSOR_PART_ID_INVALID");
        fetched.set(part.hash, part.payload);
        const bytes = civicPayloadBytes(part.payload);
        if (bytes <= CACHE_BYTES / 8) { cache.set(part.hash, { payload: part.payload, bytes }); cachedBytes += bytes; }
      }
      if (missing.some(hash => !fetched.has(hash))) throw new Error("VOTE_PREDECESSOR_PART_MISSING");
    }
    const result = hashes.map(hash => {
      const held = cache.get(hash);
      if (held) { cache.delete(hash); cache.set(hash, held); return { hash, payload: held.payload }; }
      return { hash, payload: fetched.get(hash) };
    });
    for (const [hash, held] of cache) {
      if (cachedBytes <= CACHE_BYTES) break;
      cache.delete(hash); cachedBytes -= held.bytes;
    }
    return result;
  };
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
  if (format === 2) return ordinary();
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
    return { sink, baseVersionId: versionId, priorMetadata: { ...metadata, rollCalls: [] } as Metadata<T> };
  } catch (error) { await sink.close(); throw error; }
  finally { cache.clear(); }
}
