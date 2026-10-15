import { createHash } from "node:crypto";
import type { AuthorityArtifactRef } from "../meetings/edge-artifacts.ts";
import type { PublishRegistrations } from "../meetings/edge-serving.ts";
import { stateFactVersions } from "./db.ts";
import type { Query } from "./publish.ts";
import { patchStateFacts, readStateFacts, type StateFacts } from "./registry-overlay.ts";

const QUEUED_BODIES_SQL = `SELECT DISTINCT found.id, found.state FROM unnest($1::text[]) AS queued(place)
  CROSS JOIN LATERAL (SELECT e.id, e.state FROM entity_place p JOIN entity e ON e.id = p.entity_id WHERE p.place_id = queued.place AND e.kind = 'body'
    UNION SELECT b.id, b.state FROM entity b WHERE b.id > queued.place || '#' AND b.id < queued.place || '$' AND b.kind = 'body') found`;

/** A bucket holds at most this many bodies, so a pass holds one bucket at a time whatever the state's size. */
const BODIES_PER_BUCKET = 2_000;

/** A state's served facts: one artifact per bucket of its bodies. */
export interface StateFactsIndex { readonly buckets: readonly (AuthorityArtifactRef | null)[] }

const EMPTY: StateFacts = { bodies: {}, rosters: [], dispositions: [], comments: [] };
const bucketCount = (bodies: number) => Math.max(1, Math.ceil(bodies / BODIES_PER_BUCKET));
const factBucket = (bodyId: string, count: number) =>
  count === 1 ? 0 : Number.parseInt(createHash("sha1").update(bodyId).digest("hex").slice(0, 8), 16) % count;

/** Where the served buckets are read from and new ones written, one at a time. */
export interface StateFactsStore {
  readonly readIndex: (state: string, ref: AuthorityArtifactRef) => Promise<StateFactsIndex | null>;
  readonly readBucket: (state: string, bucket: number, ref: AuthorityArtifactRef) => Promise<StateFacts | null>;
  readonly writeBucket: (state: string, bucket: number, versionId: string, value: StateFacts) => Promise<AuthorityArtifactRef>;
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

/** Each state's facts for the reader edge: carried while its version holds, otherwise only the buckets holding a queued place's bodies are read again. */
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
  const stateBodies = async (state: string) => (await query("SELECT id FROM entity WHERE state = $1 AND kind = 'body' ORDER BY id", [state])).map(row => String(row.id));
  const build = async (state: string, versionId: string, ids: readonly string[], count: number, bucket: number) => {
    const own = ids.filter(id => factBucket(id, count) === bucket);
    bodiesRead += own.length;
    return store.writeBucket(state, bucket, versionId, await readStateFacts(query, own));
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
        const held = buckets[bucket] ? await store.readBucket(state, bucket, buckets[bucket]!) : EMPTY;
        if (held === null) { buckets[bucket] = await build(state, versionId, await stateBodies(state), count, bucket); continue; }
        bodiesRead += ids.length;
        buckets[bucket] = await store.writeBucket(state, bucket, versionId, patchStateFacts(held, await readStateFacts(query, ids), new Set(ids)));
      }
      patched.push(state);
    } else {
      const ids = await stateBodies(state);
      for (let bucket = 0; bucket < count; bucket++) buckets[bucket] = await build(state, versionId, ids, count, bucket);
      rebuilt.push(state);
    }
    entries[state] = { versionId, value: { buckets } satisfies StateFactsIndex };
  }
  return { entries, rebuilt, patched, bodiesRead, settle: async () => {
    if (queue.length) await query(`DELETE FROM rebuild_queue q USING unnest($1::text[], $2::text[]) AS done(place, at)
      WHERE q.place_id = done.place AND q.queued_at::text = done.at`, [places, queue.map(row => String(row.queued_at))]);
  } };
}
