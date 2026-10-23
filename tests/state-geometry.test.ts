import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store.ts";
import { publishStateGeometry, readStateGeometryText, resetStateGeometryReads, stateGeometryKey, STATE_GEOMETRY_INDEX_KEY,
  type StateGeometryIndex } from "../lib/geo/state-geometry.ts";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/** A checkout with two Arizona geometry files and their manifest. */
function checkout(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "state-geometry-"));
  mkdirSync(join(root, "data", "derived"), { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(root, "data", "states", "az", "geo"), { recursive: true });
    writeFileSync(join(root, "data", "states", "az", "geo", name), text);
  }
  writeFileSync(join(root, "data", "derived", "state-geometry.json"), JSON.stringify({ formatVersion: 1, files: Object.fromEntries(
    Object.entries(files).map(([name, text]) => [`data/states/az/geo/${name}`, { sha256: sha(text), bytes: Buffer.byteLength(text) }])) }));
  return root;
}

test("a reader gets the exact committed file from the edge store, and nothing from the checkout", async () => {
  resetStateGeometryReads();
  const territory = '{"type":"FeatureCollection","features":[{"properties":{"ocdId":"rincon"}}]}';
  const root = checkout({ "territory-04.geojson": territory });
  const store = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "edge-")));
  assert.deepEqual(await publishStateGeometry(store, root), { published: 1, current: 0, bytes: Buffer.byteLength(territory) });
  assert.deepEqual(await publishStateGeometry(store, root), { published: 0, current: 1, bytes: 0 }, "a second pass sends nothing");
  writeFileSync(join(root, "data", "states", "az", "geo", "territory-04.geojson"), "not served");
  const fetches: string[] = [];
  const read = await readStateGeometryText("az", "territory-04.geojson", { root, store, siteUrl: "https://example.test", fetchImpl: async url => { fetches.push(String(url)); return new Response("x"); } });
  assert.equal(read, territory);
  assert.deepEqual(fetches, [], "a held artifact needs no other read");
});

test("on a new deploy the reader copies the file from the deploy's static copy, checks it and files it for everyone after", async () => {
  resetStateGeometryReads();
  const place = '{"type":"FeatureCollection","features":[]}';
  const root = checkout({ "place-04.geojson": place });
  const store = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "edge-")));
  const fetches: string[] = [];
  const text = await readStateGeometryText("az", "place-04.geojson", { root, store, siteUrl: "https://example.test",
    fetchImpl: async url => { fetches.push(String(url)); return new Response(place); } });
  assert.equal(text, place);
  assert.deepEqual(fetches, ["https://example.test/states/az/geo/place-04.geojson"]);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(Buffer.from((await store.readBytes(stateGeometryKey(sha(place))))!).toString("utf8"), place);
});

test("a static copy that differs from the manifest is never used; the publisher's last copy is, then the checkout", async () => {
  resetStateGeometryReads();
  const committed = '{"type":"FeatureCollection","features":[{"v":2}]}';
  const earlier = '{"type":"FeatureCollection","features":[{"v":1}]}';
  const root = checkout({ "place-04.geojson": committed });
  const store = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "edge-")));
  const key = await store.putImmutable(Buffer.from(earlier), "json");
  await store.writeJsonPointer<StateGeometryIndex>(STATE_GEOMETRY_INDEX_KEY, { formatVersion: 1, files: { "data/states/az/geo/place-04.geojson": key } }, null);
  const fromIndex = await readStateGeometryText("az", "place-04.geojson", { root, store, siteUrl: "https://example.test", fetchImpl: async () => new Response("tampered") });
  assert.equal(fromIndex, earlier, "an earlier verified version is better than none");
  resetStateGeometryReads();
  const empty = new LocalFileArtifactStore(mkdtempSync(join(tmpdir(), "edge-")));
  assert.equal(await readStateGeometryText("az", "place-04.geojson", { root, store: empty, siteUrl: null }), committed);
  resetStateGeometryReads();
  assert.equal(await readStateGeometryText("az", "place-04.geojson", { root, store: null }), committed, "no edge store: the checkout");
});

test("the committed manifest names the sha of every state geometry file, so the publisher and readers agree", () => {
  const manifest = JSON.parse(readFileSync("data/derived/state-geometry.json", "utf8")) as { files: Record<string, { sha256: string }> };
  for (const path of ["data/states/az/geo/territory-04.geojson", "data/states/az/geo/body-territories.geojson"]) {
    assert.equal(manifest.files[path]?.sha256, createHash("sha256").update(readFileSync(path)).digest("hex"), path);
  }
});
