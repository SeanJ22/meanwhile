/**
 * **RL-1 for the meetings snapshot, on the ingest side.** (NH326/NH327,
 * 2026-09-05.)
 *
 * `lib/meetings/snapshot.ts` is a reader-side module: the Reader Last-Mile
 * closure receipt binds it by hash, so it must not grow a dependency for the
 * refresh's convenience. The facts comparison therefore lives here, in the
 * ingest's own library, and the reader module's `writeSnapshot` is called only
 * when the civic facts actually moved.
 *
 * Stamp keys record WHEN a meeting or document was looked at; the two
 * top-level blocks describe this run's own accounting. A refresh whose meetings
 * and agenda documents are the same civic facts as the committed file leaves
 * the file byte-identical, and the observation goes to the run record.
 *
 * @freshness-reads-here — `observedAt` is stamped by the ingest that has just
 * read every meeting source and is deciding whether the read changed a fact;
 * it lands in the run record, never in the snapshot (RULING 107).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeSnapshot, type MeetingsSnapshot } from "../../lib/meetings/snapshot.ts";
import { OBSERVATIONS_ENV, compareFacts, recordObservation, type RefreshObservation } from "../../lib/ops/stamp-stable.ts";

export const MEETINGS_SNAPSHOT_STAMPS = {
  stampKeys: ["generatedAt", "collectedAt", "verifiedAt", "retrievedAt", "lastFreshAt"],
  ignoreTopLevel: ["counts", "sources"],
} as const;

export const MEETINGS_SNAPSHOT_PATH = "data/meetings-snapshot.json";

export function writeMeetingsSnapshotStampStable(
  snapshot: MeetingsSnapshot,
  root: string = process.cwd(),
): { path: string; observation: RefreshObservation } {
  const absolute = join(root, MEETINGS_SNAPSHOT_PATH);
  const existing = existsSync(absolute) ? readFileSync(absolute, "utf8") : null;
  const compared = compareFacts(existing, snapshot, MEETINGS_SNAPSHOT_STAMPS);
  const observation: RefreshObservation = {
    path: MEETINGS_SNAPSHOT_PATH,
    observedAt: new Date().toISOString(),
    verdict: compared.verdict,
    written: compared.verdict !== "FACTS_UNCHANGED",
    stampKeys: [...MEETINGS_SNAPSHOT_STAMPS.stampKeys],
    ignoredTopLevel: [...MEETINGS_SNAPSHOT_STAMPS.ignoreTopLevel],
    factsSha256: compared.factsSha256,
  };
  const path = observation.written ? writeSnapshot(snapshot, root) : absolute;
  recordObservation(observation, process.env[OBSERVATIONS_ENV] ?? null);
  console.log(
    observation.written
      ? `stamp-stable: ${MEETINGS_SNAPSHOT_PATH} — ${compared.verdict === "NEW_FILE" ? "new file" : "facts changed"}; written (observed ${observation.observedAt})`
      : `stamp-stable: ${MEETINGS_SNAPSHOT_PATH} — facts unchanged (observed ${observation.observedAt}); bytes left untouched, stamps not rewritten: ${MEETINGS_SNAPSHOT_STAMPS.stampKeys.join(", ")}`,
  );
  return { path, observation };
}
