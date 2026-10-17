import { createHash } from "node:crypto";
import type { RecordIndex } from "../meetings/authority-records.ts";
import type { AuthorityArtifactRef } from "../meetings/edge-artifacts.ts";
import { writePassCursor } from "./db.ts";
import type { Query } from "./publish.ts";
import { readBodyFacts, type BodyFacts } from "./registry-overlay.ts";

// Each queued place with the bodies it names; a place with none comes back once with a null body.
const QUEUED_BODIES_SQL = `SELECT DISTINCT queued.place, found.id, found.state FROM unnest($1::text[]) AS queued(place)
  LEFT JOIN LATERAL (SELECT e.id, e.state FROM entity_place p JOIN entity e ON e.id = p.entity_id WHERE p.place_id = queued.place AND e.kind = 'body'
    UNION SELECT b.id, b.state FROM entity b WHERE b.id > queued.place || '#' AND b.id < queued.place || '$' AND b.kind = 'body') found ON true`;

const STATES_SQL = `SELECT w.scope AS state, 'facts:' || w.scope || ':' || w.version AS version, c.position AS published
  FROM fact_watermark w LEFT JOIN pass_cursor c ON c.name = 'state-facts:' || w.scope WHERE w.scope ~ '^[A-Z]{2}$'`;

/** A bucket holds at most this many bodies, so a pass holds one bucket at a time whatever the state's size. */
const BODIES_PER_BUCKET = 2_000;

/** A state's served facts at its own pointer, outside the manifest: one record index per bucket of its bodies, each body its own record. */
export interface StateFactsPointer {
  readonly state: string;
  readonly versionId: string;
  readonly buckets: readonly (AuthorityArtifactRef | null)[];
}

const bucketCount = (bodies: number) => Math.max(1, Math.ceil(bodies / BODIES_PER_BUCKET));
const factBucket = (bodyId: string, count: number) =>
  count === 1 ? 0 : Number.parseInt(createHash("sha1").update(bodyId).digest("hex").slice(0, 8), 16) % count;
// A reader's selection finds a body by its id, its division or a member.
const tagsOf = (body: BodyFacts) => [...new Set([body.id, body.division, ...(body.roster?.members.flatMap(member => member.personId ? [member.id, member.personId] : [member.id]) ?? [])])];

/** Where each state's pointer and its buckets and records are read and written. */
interface StateFactsStore {
  readonly readPointer: (state: string) => Promise<{ readonly value: StateFactsPointer; readonly etag: string | null } | null>;
  /** Compare-and-set against `etag` (null = expect absent); false when another writer moved the pointer first. */
  readonly writePointer: (state: string, value: StateFactsPointer, etag: string | null) => Promise<boolean>;
  readonly readBucket: (state: string, bucket: number, ref: AuthorityArtifactRef) => Promise<RecordIndex | null>;
  readonly writeRecord: (value: BodyFacts) => Promise<{ readonly key: string; readonly sha: string }>;
  readonly writeBucket: (state: string, bucket: number, versionId: string, index: RecordIndex) => Promise<AuthorityArtifactRef>;
}

export interface StateFactsPublication {
  /** States whose pointer this pass wrote; those built bucket by bucket, those patched body by body, and those another writer moved first. */
  readonly published: readonly string[];
  readonly rebuilt: readonly string[];
  readonly patched: readonly string[];
  readonly raced: readonly string[];
  readonly bodiesRead: number;
}

/** Writes each state whose facts moved to its own pointer and clears its queued places; an unmoved state is neither read nor written. */
export async function publishStateFacts(query: Query, store: StateFactsStore): Promise<StateFactsPublication> {
  const queue = await query("SELECT place_id, queued_at::text AS queued_at FROM rebuild_queue");
  const states = await query(STATES_SQL);
  const places = queue.map(row => String(row.place_id));
  const queued = new Map<string, Set<string>>(), placeStates = new Map<string, Set<string>>();
  for (const row of places.length ? await query(QUEUED_BODIES_SQL, [places]) : []) {
    const held = placeStates.get(String(row.place)) ?? new Set<string>();
    placeStates.set(String(row.place), held);
    if (row.id === null || row.state === null) continue;
    held.add(String(row.state));
    queued.set(String(row.state), (queued.get(String(row.state)) ?? new Set<string>()).add(String(row.id)));
  }
  const published: string[] = [], rebuilt: string[] = [], patched: string[] = [], raced: string[] = [];
  const current = new Set<string>();
  let bodiesRead = 0;
  const records = async (bodies: readonly BodyFacts[], positions: readonly number[]) => {
    const out: RecordIndex["records"][number][] = [];
    for (let at = 0; at < bodies.length; at += 32) out.push(...await Promise.all(bodies.slice(at, at + 32).map(async (body, n) =>
      ({ path: ["bodies", positions[at + n]!], ...await store.writeRecord(body), tags: tagsOf(body) }))));
    return out;
  };
  const build = async (state: string, versionId: string, count: number, bucket: number) => {
    const own = (await query("SELECT id FROM entity WHERE state = $1 AND kind = 'body' ORDER BY id", [state])).map(row => String(row.id)).filter(id => factBucket(id, count) === bucket);
    bodiesRead += own.length;
    const bodies = await readBodyFacts(query, own);
    return store.writeBucket(state, bucket, versionId, { kind: "READER_RECORDS", base: { bodies: [] }, records: await records(bodies, bodies.map((_, n) => n)) });
  };
  for (const row of states) {
    const state = String(row.state), versionId = String(row.version), changed = [...queued.get(state) ?? []];
    if (row.published === versionId && !changed.length) { current.add(state); continue; }
    const held = await store.readPointer(state);
    const [{ bodies }] = await query("SELECT count(*) AS bodies FROM entity WHERE state = $1 AND kind = 'body'", [state]) as [{ bodies: string }];
    const count = bucketCount(Number(bodies));
    const buckets: (AuthorityArtifactRef | null)[] = held?.value.buckets.length === count ? [...held.value.buckets] : Array(count).fill(null);
    if (held?.value.buckets.length === count && held.value.versionId === versionId && !changed.length) {
      await writePassCursor(query, `state-facts:${state}`, versionId);
      current.add(state);
      continue;
    }
    if (held?.value.buckets.length === count) {
      const byBucket = new Map<number, string[]>();
      for (const id of changed) byBucket.set(factBucket(id, count), [...byBucket.get(factBucket(id, count)) ?? [], id]);
      for (const [bucket, ids] of byBucket) {
        const index = buckets[bucket] ? await store.readBucket(state, bucket, buckets[bucket]!) : { kind: "READER_RECORDS" as const, base: { bodies: [] }, records: [] };
        if (index === null) { buckets[bucket] = await build(state, versionId, count, bucket); continue; }
        bodiesRead += ids.length;
        const gone = new Set(ids);
        const kept = index.records.filter(record => !gone.has(String(record.tags[0])));
        const fresh = await readBodyFacts(query, ids);
        // Freed positions are reused first, so a bucket's index stays as long as its bodies.
        const used = new Set(kept.map(record => Number(record.path[1])));
        const positions: number[] = [];
        for (let n = 0; positions.length < fresh.length; n++) if (!used.has(n)) positions.push(n);
        buckets[bucket] = await store.writeBucket(state, bucket, versionId, { ...index, records: [...kept, ...await records(fresh, positions)] });
      }
      patched.push(state);
    } else {
      for (let bucket = 0; bucket < count; bucket++) buckets[bucket] = await build(state, versionId, count, bucket);
      rebuilt.push(state);
    }
    if (!await store.writePointer(state, { state, versionId, buckets }, held?.etag ?? null)) { raced.push(state); continue; }
    await writePassCursor(query, `state-facts:${state}`, versionId);
    published.push(state);
    current.add(state);
  }
  // A place stays queued until every state its bodies sit in is current; a place re-queued since it was read stays too.
  const known = new Set(states.map(row => String(row.state)));
  const settled = queue.filter(row => [...placeStates.get(String(row.place_id)) ?? []].every(state => current.has(state) || !known.has(state)));
  if (settled.length) await query(`DELETE FROM rebuild_queue q USING unnest($1::text[], $2::text[]) AS done(place, at)
    WHERE q.place_id = done.place AND q.queued_at::text = done.at`, [settled.map(row => String(row.place_id)), settled.map(row => String(row.queued_at))]);
  return { published, rebuilt, patched, raced, bodiesRead };
}
