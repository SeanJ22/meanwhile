import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { readerEdgePieces } from "../lib/civic-data/reader-edge-publication.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import { stateRegistryRuntimeScope } from "../lib/civic-data/state-scopes.ts";
import { HOUR, PIMA, T1, at, countWrites, readPartition } from "./helpers/meeting-body-fixtures.ts";
import { publishPieces } from "./helpers/reader-edge-pieces.ts";

const MEETINGS = [{ recordClass: "MEETING" as const, scope: PIMA.scope }];

/** A store that counts the reads that compose a meeting: the work queue and the partitions. */
function meetingReads(memory: MemoryRoutineDataStore) {
  const reads = { queue: 0, partitions: 0 };
  const store = new Proxy(memory, { get(target, key) {
    const value = Reflect.get(target, key);
    if (typeof value !== "function") return value;
    if (key === "readMeetingQueue") return async () => { reads.queue += 1; return target.readMeetingQueue(); };
    if (key === "readPromotion") return async (...args: Parameters<typeof memory.readPromotion>) => { if (args[0] === "MEETING") reads.partitions += 1; return target.readPromotion(...args); };
    return value.bind(target);
  } });
  return { store, reads };
}

test("meetings compose only in their own state's piece, are carried through an authority piece, and a quiet piece writes nothing", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "reader-carry-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const edge = new LocalFileArtifactStore(directory);
  const memory = new MemoryRoutineDataStore();
  await readPartition(memory, PIMA, T1, ["a", "b"]);
  const { store, reads } = meetingReads(memory);
  const publish = (selected: typeof MEETINGS, now: string, pieces = readerEdgePieces(selected)) => publishPieces(store, edge, selected, { now, pieces });

  const first = await publish(MEETINGS, at(T1, HOUR));
  assert.equal(first.readerEdge, "PUBLISHED");
  assert.ok(reads.queue > 0 && reads.partitions > 0, "a meeting pass reads what is queued and the partitions it names");
  const held = (await edge.readManifest())!.manifest;
  assert.ok(held.meetingStates?.AZ, "the meeting pass published Arizona's index");
  assert.deepEqual(await memory.readMeetingQueue(), [], "and settled what it covered");

  const before = { ...reads };
  assert.deepEqual(readerEdgePieces(MEETINGS), [{ family: "meetings", place: "AZ" }]);
  const authorityOnly = await publish([], at(T1, 2 * HOUR), [{ family: "campaign-sites", place: null }]);
  assert.equal(authorityOnly.ok, true);
  assert.deepEqual(reads, before, "an authority-only pass opens no meeting queue or partition");
  assert.deepEqual((await edge.readManifest())!.manifest.meetingStates, held.meetingStates, "the meetings are carried by reference");

  const writes = countWrites(memory, edge);
  const quiet = await publish(MEETINGS, at(T1, 3 * HOUR));
  writes.stop();
  assert.equal(quiet.readerEdge, "CURRENT");
  assert.equal(quiet.sequence, (await edge.readManifest())!.manifest.sequence);
  assert.equal(reads.partitions, before.partitions, "nothing queued: no partition is read again");
  assert.deepEqual({ records: writes.records, rows: writes.rows }, { records: 0, rows: 0 });
  assert.deepEqual((await edge.readManifest())!.manifest.meetingStates, held.meetingStates);
});

test("a state's meetings publish right after the registry that draws its territories, before every other piece", () => {
  const registry = { recordClass: "REGISTRY_RUNTIME_BINDING" as const, scope: stateRegistryRuntimeScope("AZ") };
  const pieces = readerEdgePieces([{ recordClass: "STATE_LEGISLATOR", scope: "US-AZ" }, registry, ...MEETINGS]).map(piece => `${piece.family}/${piece.place}`);
  assert.deepEqual(pieces.slice(0, 2), ["registry-runtime/AZ", "meetings/AZ"]);
});
