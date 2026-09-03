import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { projectStateHoldings, geometryFiles, geometryPath, rosterPath } from "../lib/holdings/files.ts";

test("a future state's canonical geometry is discovered and served through an offline byte projection", () => {
  const root = mkdtempSync(join(tmpdir(), "holdings-projection-"));
  try {
    const source = "data/states/ca/geo/sldl-06.geojson";
    const target = "public/states/ca/geo/sldl-06.geojson";
    mkdirSync(join(root, "data/states/ca/geo"), { recursive: true });
    writeFileSync(join(root, source), '{"type":"FeatureCollection","features":[]}\n');
    assert.deepEqual(geometryFiles(root), [source]);
    assert.equal(geometryPath("sldl-06.geojson"), source);
    assert.equal(rosterPath("officeholders-06.json"), "data/states/ca/officials/officeholders-06.json");
    assert.equal(projectStateHoldings(root, true).issues.length, 1);
    assert.equal(existsSync(join(root, target)), false);
    assert.deepEqual(projectStateHoldings(root), { files: 1, issues: [] });
    assert.deepEqual(readFileSync(join(root, target)), readFileSync(join(root, source)));
    writeFileSync(join(root, target), "stale");
    assert.equal(projectStateHoldings(root, true).issues.length, 1);
    assert.equal(readFileSync(join(root, target), "utf8"), "stale");
    projectStateHoldings(root);
    assert.deepEqual(projectStateHoldings(root, true).issues, []);
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    rmSync(root, { recursive: true, force: true });
  }
});
