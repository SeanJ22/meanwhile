import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { censusEdgePublication } from "../scripts/lib/census-edge-publication.ts";
import { buildCensusDistrictEdge, createCensusDistrictReaderEdge, censusDistrictEdgeVersion } from "../lib/census-geography/district-edge.ts";
import type { BuiltDataset } from "../lib/census-geography/dataset.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";

const directory = mkdtempSync(join(tmpdir(), "census-edge-publication-"));
after(() => rmSync(directory, { recursive: true, force: true }));
const artifactStore = new LocalFileArtifactStore(directory);
const servedVersion = censusDistrictEdgeVersion("prior-proved-version");
const carry = { versionId: servedVersion, carried: true };
const unread = async (): Promise<never> => { throw new Error("projection unavailable"); };

test("failed source reads retain the exact prior state-artifact version and report failure", async () => {
  for (const readVersion of [unread, async () => "new-pointer"]) {
    const failures: unknown[] = [];
    assert.deepEqual(await censusEdgePublication({ servedVersion, readVersion, readIndex: unread,
      onFailure: error => failures.push(error) }), carry);
    assert.equal(failures.length, 1);
  }
  assert.equal(await censusEdgePublication({ servedVersion: null, readVersion: unread, readIndex: unread,
    onFailure: () => {} }), undefined);
});

test("the unchanged pointer reuses its immutable state references without rereading datasets", async () => {
  assert.deepEqual(await censusEdgePublication({ servedVersion, readVersion: async () => "prior-proved-version",
    readIndex: unread, onFailure: () => assert.fail("unchanged read should not fail") }), carry);
});

test("the serving wrapper reuses canonical state artifacts with their independent content version", async () => {
  const dataset = JSON.parse(readFileSync("lib/census-geography/bootstrap-az.json", "utf8")) as BuiltDataset;
  const index = await buildCensusDistrictEdge(dataset, "original-source-acquisition", artifactStore);
  const result = await censusEdgePublication({ servedVersion, readVersion: async () => "new-database-pointer",
    readIndex: async version => { assert.equal(version, "new-database-pointer"); return index; },
    onFailure: error => assert.fail(String(error)) });
  assert.ok(result && "value" in result);
  assert.equal(result.versionId, censusDistrictEdgeVersion("new-database-pointer"));
  assert.equal(result.value, index);
  assert.notEqual(result.versionId, index.versionId);
  const slice = await createCensusDistrictReaderEdge(index, artifactStore, result.versionId).loadZip("85635");
  assert.equal(slice.kind, "HELD");
  assert.ok(slice.kind === "HELD" && slice.versionId === result.versionId && slice.value.containers.some(c => c.ref.geoid === "0406"));
});

test("an absent source or malformed index cannot replace the served index", async () => {
  const failures: unknown[] = [];
  assert.deepEqual(await censusEdgePublication({ servedVersion, readVersion: async () => null, readIndex: unread,
    onFailure: failure => failures.push(failure) }), carry);
  const dataset = JSON.parse(readFileSync("lib/census-geography/bootstrap-az.json", "utf8")) as BuiltDataset;
  const empty = { ...await buildCensusDistrictEdge(dataset, "empty-index", artifactStore), states: {} };
  assert.deepEqual(await censusEdgePublication({ servedVersion, readVersion: async () => "new-pointer", readIndex: async () => empty,
    onFailure: failure => failures.push(failure) }), carry);
  assert.equal(failures.length, 2);
});
