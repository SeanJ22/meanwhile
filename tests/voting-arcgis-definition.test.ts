import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { arcgisVotingRows } from "../lib/ballot/voting-source-readers.ts";
import { votingFetchSession } from "../lib/ballot/voting-source-fetch.ts";

test("the current official ArcGIS definition scopes both the ID universe and every complete batch", async () => {
  const directory = "tests/fixtures/voting-sources/vs-07/";
  const current = JSON.parse(readFileSync(directory + "pima-2026-vote-centers-native.json", "utf8"));
  const all = JSON.parse(readFileSync(directory + "pima-all-vote-centers-native.json", "utf8"));
  const map = JSON.parse(readFileSync(directory + "pima-vote-webmap-native.json", "utf8"));
  const layer = map.operationalLayers.find((layer: { url?: string }) => layer.url?.includes("Primary_2024_Vote_Centers"));
  assert.ok(layer?.layerDefinition.definitionExpression);
  const where = layer.layerDefinition.definitionExpression;
  assert.equal(current.features.length, 129);
  assert.ok(all.features.length > current.features.length, "the unfiltered reused layer carries rows outside the current map definition");
  const requested: URL[] = [];
  const session = votingFetchSession({ fetch: (async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /");
    requested.push(url);
    const features = url.searchParams.get("where") === where ? current.features : all.features;
    if (url.searchParams.get("returnIdsOnly") === "true") return Response.json({ objectIds: features.map((row: { attributes: { OBJECTID: number } }) => row.attributes.OBJECTID) });
    const ids = new Set(url.searchParams.get("objectIds")!.split(",").map(Number));
    return Response.json({ features: features.filter((row: { attributes: { OBJECTID: number } }) => ids.has(row.attributes.OBJECTID)) });
  }) as typeof fetch });
  const rows = await arcgisVotingRows(layer.url, session, where);
  assert.equal(rows.length, 129);
  assert.equal(rows.filter(row => row.ELECTION === "All").length, 3, "the publisher's three All-election centers are retained");
  assert.ok(rows.every(row => row.ELECTION === "2026 General" || row.ELECTION === "All"));
  assert.equal(requested.length, 2);
  assert.ok(requested.every(url => url.searchParams.get("where") === where));
});

test("Philadelphia's complete public object-ID universe is read without overlong IIS query URLs", async () => {
  const { objectIds } = JSON.parse(readFileSync("tests/fixtures/voting-sources/vs-07/phila-polling-ids-native.json", "utf8")) as { objectIds: number[] };
  assert.equal(objectIds.length, 1703);
  const layer = "https://services.arcgis.com/fLeGjb7u4uXqeF9q/ArcGIS/rest/services/POLLING_PLACES/FeatureServer/0";
  const oversized = new URL(`${layer}/query`);
  oversized.search = new URLSearchParams({ f: "json", where: "1=1", objectIds: objectIds.slice(0, 500).join(","), outFields: "*", returnGeometry: "false" }).toString();
  assert.ok(oversized.href.length > 1800);
  const requests: URL[] = [];
  const session = votingFetchSession({ fetch: (async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /");
    requests.push(url);
    if (url.href.length > 1800) return new Response("IIS query rejected", { status: 404 });
    if (url.searchParams.get("returnIdsOnly") === "true") return Response.json({ objectIds });
    // A transport-only envelope preserves real source IDs and asserts no voting-site facts.
    return Response.json({ features: url.searchParams.get("objectIds")!.split(",").map(id => ({ attributes: { objectid: Number(id) } })) });
  }) as typeof fetch });
  const rows = await arcgisVotingRows(layer, session);
  assert.deepEqual(rows.map(row => row.objectid), objectIds);
  assert.ok(requests.length > 4);
  assert.ok(requests.every(url => url.href.length <= 1800), "the first request already fits the publisher's URL limit");
});
