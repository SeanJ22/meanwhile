import type { AuthorityArtifactRef } from "../meetings/edge-artifacts.ts";
import type { PublishRegistrations } from "../meetings/edge-serving.ts";
import { stateFactVersions } from "./db.ts";
import type { Query } from "./publish.ts";
import { patchStateFacts, readStateFacts, type StateFacts } from "./registry-overlay.ts";

const QUEUED_BODIES_SQL = `SELECT DISTINCT e.id, e.state FROM unnest($1::text[]) AS queued(place)
  CROSS JOIN LATERAL (SELECT p.entity_id FROM entity_place p WHERE p.place_id = queued.place
    UNION SELECT b.id FROM entity b WHERE b.id > queued.place || '#' AND b.id < queued.place || '$') found(id)
  JOIN entity e ON e.id = found.id AND e.kind = 'body'`;

export interface StateFactsPlan {
  readonly entries: PublishRegistrations;
  /** States rebuilt whole because no served copy could be read, and states patched place by place. */
  readonly rebuilt: readonly string[];
  readonly patched: readonly string[];
  readonly bodiesRead: number;
  /** Clears the queued places this plan covered; run once its manifest is written. */
  readonly settle: () => Promise<void>;
}

/** Each state's facts for the reader edge: carried while its version holds, otherwise its served copy with only the queued places read again. */
export async function planStateFacts(query: Query, served: Readonly<Record<string, AuthorityArtifactRef>> | undefined,
  readServed: (state: string, ref: AuthorityArtifactRef) => Promise<StateFacts | null>): Promise<StateFactsPlan> {
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
  for (const [state, versionId] of versions) {
    const ref = served?.[state];
    if (ref?.version === versionId) { entries[state] = { versionId, carried: true }; continue; }
    const prior = ref ? await readServed(state, ref) : null;
    if (prior) {
      const bodies = byState.get(state) ?? [];
      bodiesRead += bodies.length;
      entries[state] = { versionId, value: patchStateFacts(prior, await readStateFacts(query, bodies), new Set(bodies)) };
      patched.push(state);
    } else {
      const bodies = (await query("SELECT id FROM entity WHERE state = $1 AND kind = 'body'", [state])).map(row => String(row.id));
      bodiesRead += bodies.length;
      entries[state] = { versionId, value: await readStateFacts(query, bodies) };
      rebuilt.push(state);
    }
  }
  return { entries, rebuilt, patched, bodiesRead, settle: async () => {
    if (queue.length) await query(`DELETE FROM rebuild_queue q USING unnest($1::text[], $2::text[]) AS done(place, at)
      WHERE q.place_id = done.place AND q.queued_at::text = done.at`, [places, queue.map(row => String(row.queued_at))]);
  } };
}
