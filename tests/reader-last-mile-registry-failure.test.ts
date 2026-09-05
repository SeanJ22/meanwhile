import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { allSeatHolders, RegistryHoldingReadError } from "../lib/registry/server.ts";
import { ROSTER_FILES } from "../lib/coverage/artifacts.ts";
import { rosterPath } from "../lib/holdings/runtime-paths.ts";

test("a removed required roster or territory cannot turn a held population into an empty registry", async () => {
  const root = process.cwd();
  const directory = mkdtempSync(join(tmpdir(), "reader-registry-missing-"));
  const copy = (path: string) => {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    copyFileSync(join(root, path), join(directory, path));
  };
  mkdirSync(join(directory, "data", "derived"), { recursive: true });
  writeFileSync(join(directory, "data", "derived", "resolver-geometry.json"), JSON.stringify({ files: [] }));
  copy("lib/registry/registry.json");
  const rosterPaths = ROSTER_FILES.map((file) => rosterPath(file));
  try {
    process.chdir(directory);
    await assert.rejects(allSeatHolders(), (error: unknown) => error instanceof RegistryHoldingReadError && error.holdingPath === "lib/registry/officeholders-us.json");
    process.chdir(root);
    for (const path of rosterPaths) copy(path);
    process.chdir(directory);
    await assert.rejects(allSeatHolders(), (error: unknown) => error instanceof RegistryHoldingReadError && error.holdingPath.endsWith("body-territories.geojson"));
  } finally {
    process.chdir(root);
    rmSync(directory, { recursive: true });
  }
  assert.ok((await allSeatHolders()).length > 1400, "failure did not poison the cache; the canonical holding can be read on the next request");
});
