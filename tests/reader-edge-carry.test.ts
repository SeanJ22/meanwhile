import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { publishSupervisorReaderEdge } from "../lib/civic-data/reader-edge-publication.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import { HOUR, PIMA, T1, at, countWrites, readPartition } from "./helpers/meeting-body-fixtures.ts";

const ENV = { WTP_READER_EDGE_LOCAL_OK: "1" };
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

test("shared publication composes meetings only when a meeting pass asks, carries them through an authority-only pass, and writes nothing for a quiet one", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "reader-carry-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const edge = new LocalFileArtifactStore(directory);
  const memory = new MemoryRoutineDataStore();
  await readPartition(memory, PIMA, T1, ["a", "b"]);
  const { store, reads } = meetingReads(memory);
  const publish = (selected: Parameters<typeof publishSupervisorReaderEdge>[2], now: string) =>
    publishSupervisorReaderEdge(store, now, selected, { artifactStore: edge }, ENV);

  const first = await publish(MEETINGS, at(T1, HOUR));
  assert.equal(first.readerEdge, "PUBLISHED");
  assert.ok(reads.queue > 0 && reads.partitions > 0, "a meeting pass reads what is queued and the partitions it names");
  const held = (await edge.readManifest())!.manifest;
  assert.ok(held.meetingStates?.AZ, "the meeting pass published Arizona's index");
  assert.deepEqual(await memory.readMeetingQueue(), [], "and settled what it covered");

  const before = { ...reads };
  const authorityOnly = await publish([], at(T1, 2 * HOUR));
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

test("every pointer publishes before meetings compose", () => {
  const child = readFileSync("lib/civic-data/reader-edge-publication.ts", "utf8");
  const states = child.indexOf("await dispatchStateArtifacts(");
  const promoted = child.indexOf("await publishPromotedEdgeFamilies(");
  const plan = child.indexOf("await planMeetingBodies(");
  assert.ok(states > 0 && promoted > 0 && states < plan && promoted < plan, "no pointer waits on the meeting composition");
});
