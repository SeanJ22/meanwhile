import assert from "node:assert/strict";
import test from "node:test";
import { portraitStamp, readPortraitSourceSnapshot, portraitSnapshotSettled, type PortraitSourceProbe } from "../lib/photos/portrait-run.ts";
import { derivedSourceContentHash } from "../lib/civic-data/derived-source-hash.ts";
import type { RoutineDataStore, SourceHead } from "../lib/civic-data/store.ts";

const at = "2026-10-26T12:00:00.000Z";
const base: SourceHead = { sourceId: "plural-openstates", recordClass: "STATE_LEGISLATOR", scope: "US-AZ:openstates-people:v1",
  versionId: "roster:one", lastKnownGoodVersionId: "roster:one", rawHash: "a".repeat(64), rawHashBasis: "SOURCE_CONTENT_V1", normalizedHash: "b".repeat(64),
  parserVersion: "people/1", promotedAt: at, candidateState: "PROMOTED", acquisitionSucceeded: true, imported: false };

test("portrait input comparison notices changed source fields for the same people without reading rosters", async () => {
  let source = base;
  const store = { async readSourceHead(_kind: string, scope: string) { return scope === base.scope ? source : null; } } as RoutineDataStore;
  const first = await portraitStamp(store, "az", null);
  source = { ...base, promotedAt: "2026-10-26T13:00:00.000Z" };
  assert.deepEqual(await portraitStamp(store, "az", null), first, "an observation clock is not new content");
  source = { ...base, rawHash: "c".repeat(64) };
  assert.notDeepEqual(await portraitStamp(store, "az", null), first, "changed profile bytes reopen the person even with the same roster IDs");
});

test("portrait source metadata retains exact photo inputs, retry deadlines and unfinished-work state", async () => {
  const evidence = { kind: "VAULTED_EVIDENCE" as const, artifactId: "photo:one", contentHash: `sha256-${"c".repeat(64)}`, tier: "RAW" as const, retrievedAt: at };
  let probe: PortraitSourceProbe | null = null;
  let output: SourceHead = { ...base, sourceId: "people-portraits", scope: "US-AZ:people:portraits:v1", versionId: "portrait:one",
    lastKnownGoodVersionId: "portrait:one", parserVersion: "people-portraits/1" };
  const store = { async readSourceHead(_kind: string, scope: string) { return scope === output.scope ? output : scope === base.scope ? base : null; },
    async readCandidatePath<T>(_id: string, path: readonly string[]) {
      assert.deepEqual(path, ["normalizedPayload", "sourceProbe"]); return probe as T;
    } } as RoutineDataStore;
  const first = await readPortraitSourceSnapshot(store, "az", null);
  const sourceContentHash = derivedSourceContentHash([...first.sourceContentInputs, evidence]);
  output = { ...output, rawHash: sourceContentHash };
  probe = { formatVersion: 1, sourceId: "people-portraits", state: "AZ", complete: true, normalizationInputHash: first.normalizationInputHash,
    dependencies: first.dependencies, discovery: first.discovery, sourceContentHash, retrievedAt: at, nextTermAt: "2026-10-27T12:00:00.000Z" };
  const settled = await readPortraitSourceSnapshot(store, "az", null);
  assert.equal(portraitSnapshotSettled(settled, at), true);
  assert.equal(portraitSnapshotSettled(settled, probe.nextTermAt!), false);
  probe = { ...probe, complete: false };
  assert.equal(portraitSnapshotSettled(await readPortraitSourceSnapshot(store, "az", null), at), false);
});
