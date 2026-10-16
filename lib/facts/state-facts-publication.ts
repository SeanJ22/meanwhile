import { createHash } from "node:crypto";
import type { RecordIndex } from "../meetings/authority-records.ts";
import type { AuthorityArtifactRef } from "../meetings/edge-artifacts.ts";
import type { PublishRegistrations } from "../meetings/edge-serving.ts";
import { stateFactVersions } from "./db.ts";
import type { Query } from "./publish.ts";
import { readBodyFacts, type BodyFacts } from "./registry-overlay.ts";

const QUEUED_BODIES_SQL = `SELECT DISTINCT found.id, found.state FROM unnest($1::text[]) AS queued(place)
  CROSS JOIN LATERAL (SELECT e.id, e.state FROM entity_place p JOIN entity e ON e.id = p.entity_id WHERE p.place_id = queued.place AND e.kind = 'body'
    UNION SELECT b.id, b.state FROM entity b WHERE b.id > queued.place || '#' AND b.id < queued.place || '$' AND b.kind = 'body') found`;

/** A bucket holds at most this many bodies, so a pass holds one bucket at a time whatever the state's size. */
const BODIES_PER_BUCKET = 2_000;

/** A state's served facts: one record index per bucket of its bodies, each body its own record. */
export interface StateFactsIndex { readonly buckets: readonly (AuthorityArtifactRef | null)[] }

const bucketCount = (bodies: number) => Math.max(1, Math.ceil(bodies / BODIES_PER_BUCKET));
const factBucket = (bodyId: string, count: number) =>
  count === 1 ? 0 : Number.parseInt(createHash("sha1").update(bodyId).digest("hex").slice(0, 8), 16) % count;
// A reader's selection finds a body by its id, its division or a member.
const tagsOf = (body: BodyFacts) => [...new Set([body.id, body.division, ...(body.roster?.members.flatMap(member => member.personId ? [member.id, member.personId] : [member.id]) ?? [])])];

/** Where the served indexes and records are read and new ones written. */
interface StateFactsStore {
  readonly readIndex: (state: string, ref: AuthorityArtifactRef) => Promise<StateFactsIndex | null>;
  readonly readBucket: (state: string, bucket: number, ref: AuthorityArtifactRef) => Promise<RecordIndex | null>;
  readonly writeRecord: (value: BodyFacts) => Promise<{ readonly key: string; readonly sha: string }>;
  readonly writeBucket: (state: string, bucket: number, versionId: string, index: RecordIndex) => Promise<AuthorityArtifactRef>;
}

export interface StateFactsPlan {
  readonly entries: PublishRegistrations;
  /** States built bucket by bucket because no served index could be read or their size crossed a bucket, and states patched place by place. */
  readonly rebuilt: readonly string[];
  readonly patched: readonly string[];
  readonly bodiesRead: number;
  /** Clears the queued places this plan covered; run once its manifest is written. */
  readonly settle: () => Promise<void>;
}

/** Each state's facts for the reader edge: carried while its version holds, otherwise only the records of a queued place's bodies are read and written again. */
export async function planStateFacts(query: Query, served: Readonly<Record<string, AuthorityArtifactRef>> | undefined,
  store: StateFactsStore): Promise<StateFactsPlan> {
  const versions = await stateFactVersions(query);
  const queue = await query("SELECT place_id, queued_at::text AS queued_at FROM rebuild_queue");
  const places = queue.map(row => String(row.place_id));
  const byState = new Map<string, string[]>();
  for (const row of places.length ? await query(QUEUED_BODIES_SQL, [places]) : []) {
    if (row.state !== null) byState.set(String(row.state), [...byState.get(String(row.state)) ?? [], String(row.id)]);
  }
  const entries: Record<string, PublishRegistrations[string]> = {};
  const rebuilt: string[] = [], patched: string[] = [];
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
  for (const [state, versionId] of versions) {
    const ref = served?.[state];
    if (ref?.version === versionId) { entries[state] = { versionId, carried: true }; continue; }
    const [{ bodies }] = await query("SELECT count(*) AS bodies FROM entity WHERE state = $1 AND kind = 'body'", [state]) as [{ bodies: string }];
    const count = bucketCount(Number(bodies));
    const prior = ref ? await store.readIndex(state, ref) : null;
    const buckets: (AuthorityArtifactRef | null)[] = prior?.buckets.length === count ? [...prior.buckets] : Array(count).fill(null);
    if (prior?.buckets.length === count) {
      const changed = new Map<number, string[]>();
      for (const id of byState.get(state) ?? []) changed.set(factBucket(id, count), [...changed.get(factBucket(id, count)) ?? [], id]);
      for (const [bucket, ids] of changed) {
        const held = buckets[bucket] ? await store.readBucket(state, bucket, buckets[bucket]!) : { kind: "READER_RECORDS" as const, base: { bodies: [] }, records: [] };
        if (held === null) { buckets[bucket] = await build(state, versionId, count, bucket); continue; }
        bodiesRead += ids.length;
        const gone = new Set(ids);
        const kept = held.records.filter(record => !gone.has(String(record.tags[0])));
        const fresh = await readBodyFacts(query, ids);
        // Freed positions are reused first, so a bucket's index stays as long as its bodies.
        const used = new Set(kept.map(record => Number(record.path[1])));
        const positions: number[] = [];
        for (let n = 0; positions.length < fresh.length; n++) if (!used.has(n)) positions.push(n);
        buckets[bucket] = await store.writeBucket(state, bucket, versionId, { ...held, records: [...kept, ...await records(fresh, positions)] });
      }
      patched.push(state);
    } else {
      for (let bucket = 0; bucket < count; bucket++) buckets[bucket] = await build(state, versionId, count, bucket);
      rebuilt.push(state);
    }
    entries[state] = { versionId, value: { buckets } satisfies StateFactsIndex };
  }
  return { entries, rebuilt, patched, bodiesRead, settle: async () => {
    if (queue.length) await query(`DELETE FROM rebuild_queue q USING unnest($1::text[], $2::text[]) AS done(place, at)
      WHERE q.place_id = done.place AND q.queued_at::text = done.at`, [places, queue.map(row => String(row.queued_at))]);
  } };
}
