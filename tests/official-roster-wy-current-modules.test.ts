import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { resolveWyomingCurrentModules, wyomingCurrentModuleRoutes } from "../lib/sources/official-rosters/current-markers.ts";
import { officialLegislatureTarget } from "../lib/sources/official-rosters/targets.ts";

const folder = new URL("./fixtures/official-rosters/states/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("research-wy-current-modules.json", folder), "utf8")) as {
  id: string; url: string; retrievedAt: string; fixture: string; sha256: string; bytes: number;
}[];
const samples = manifest.map(row => {
  const bytes = gunzipSync(readFileSync(new URL(row.fixture, folder)));
  return { row, bytes, document: { url: row.url, body: bytes.toString("utf8") } };
});
const root = samples.find(sample => sample.row.id === "wy-current-root")!;
const declared = wyomingCurrentModuleRoutes(root.document.body);
const documents = declared.map(url => samples.find(sample => sample.document.url === url)!.document);
const target = { ...officialLegislatureTarget("WY")!, currentMarker: { url: root.row.url, parserVersion: "official-roster-current-marker/1" } };

test("the genuine current Wyoming root selects every current module and its sole declared legislative year", () => {
  assert.equal(declared.length, 4);
  const resolved = resolveWyomingCurrentModules(target, documents, root.row.retrievedAt);
  assert.deepEqual(resolved.legislatureRoutes, [
    { url: "https://wyoleg.gov/LsoService/api/Legislator/2026/H", chamber: "lower" },
    { url: "https://wyoleg.gov/LsoService/api/Legislator/2026/S", chamber: "upper" },
  ]);
  assert.equal(resolved.scope, target.scope);
  assert.equal(resolved.id, target.id);
  assert.equal(resolved.contractId, target.contractId);
  assert.equal(resolved.currentMarker?.url, "https://wyoleg.gov/");
  for (const sample of samples) {
    assert.equal(sample.bytes.length, sample.row.bytes);
    assert.equal(createHash("sha256").update(sample.bytes).digest("hex"), sample.row.sha256);
  }
});

test("a missing current module cannot fall back to the dated Wyoming catalog routes", () => {
  assert.throws(() => resolveWyomingCurrentModules(target, documents.slice(1), root.row.retrievedAt), /acquisition is incomplete/);
});

test("a module's year cannot be selected when current publisher modules declare conflicting years", () => {
  const publishedDeclaration = documents.find(document => /this\.legislativeYear=2026/.test(document.body))!;
  const substituted = documents.map(document => document === publishedDeclaration
    ? { ...document, body: `${document.body}\nthis.legislativeYear=2027;` } : document);
  assert.throws(() => resolveWyomingCurrentModules(target, substituted, root.row.retrievedAt), /one declared legislative year/);
});

test("an external module cannot enter the current official Wyoming module acquisition", () => {
  const changed = root.document.body.replace('href="chunk-B5L-zN4B.js"', 'href="https://example.com/module.js"');
  assert.throws(() => wyomingCurrentModuleRoutes(changed), /outside its declared official origin/);
});
