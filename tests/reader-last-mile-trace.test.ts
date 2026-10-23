import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { checkReaderTraces, missingReaderTraceFiles, readerTraceRequirements } from "../lib/holdings/reader-trace.ts";
import { ROUTINE_SOURCE_CONTRACTS } from "../lib/civic-data/contracts.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "../lib/civic-data/manual-contracts.ts";
import nextConfig from "../next.config.ts";

test("every dynamic reader contract fails if one holding is removed from deployment tracing", () => {
  const contracts = readerTraceRequirements(process.cwd());
  assert.ok(contracts.length >= 10);
  for (const contract of contracts) {
    assert.ok(contract.files.length > 0, `${contract.route}: empty trace requirements conceal a retired runtime dependency`);
    const traced = new Set(contract.files);
    assert.deepEqual(missingReaderTraceFiles(contract.files, traced), []);
    for (const file of contract.files) {
      traced.delete(file);
      assert.ok(missingReaderTraceFiles(contract.files, traced).includes(file), `${contract.route}: failed to catch removed ${file}`);
      traced.add(file);
    }
  }
});

test("Next deployment tracing includes static geography and excludes every migrated runtime first seed", () => {
  const root = process.cwd();
  const { globSync } = fs as typeof fs & { globSync(pattern: string, options: { cwd: string }): string[] };
  const includes = Object.values(nextConfig.outputFileTracingIncludes ?? {}).flat();
  for (const required of [
    "./data/derived/state-geometry.json",
    "./data/derived/resolver-geometry.json",
    "./public/geo/*.geojson",
    "./data/derived/zip-coverage-tiers-runtime.json",
    "./data/derived/zip-divisions/*.json",
    "./lib/db/migrations/meta/_journal.json",
  ]) {
    assert.ok(includes.includes(required), `static production input is no longer traced: ${required}`);
  }

  const bundled = new Set(
    includes.flatMap((pattern) =>
      globSync(pattern.replace(/^\.\//, ""), { cwd: root }).map((path) => path.replaceAll("\\", "/")),
    ),
  );
  const runtimeSeeds = [...ROUTINE_SOURCE_CONTRACTS, ...MANUAL_PRODUCTION_SOURCE_CONTRACTS]
    .flatMap((contract) => contract.bootstrapFixturePaths)
    .filter((path) => /\.json$/.test(path));
  assert.deepEqual(
    [...new Set(runtimeSeeds.filter((path) => bundled.has(path)))].sort(),
    [],
    "tracked runtime first seeds must not be forced into production by outputFileTracingIncludes",
  );
});

test("the completed Next production bundle includes every declared runtime holding", (t) => {
  if (!existsSync(".next/BUILD_ID")) return t.skip("No completed build; postbuild executes the mandatory deployed trace proof.");
  assert.deepEqual(checkReaderTraces(process.cwd()).failures, []);
});

test("postbuild checker rejects a removed dynamic holding in emitted route manifests", () => {
  const root = mkdtempSync(join(tmpdir(), "reader-trace-negative-"));
  const write = (path: string, value: unknown) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(value));
  };
  try {
    write(join(root, "data/derived/resolver-geometry.json"), { files: ["public/geo/state-outlines.geojson"] });
    write(join(root, "data/derived/zip-divisions/85.json"), {});
    const contracts = readerTraceRequirements(root);
    const routes = new Map<string, Set<string>>();
    for (const contract of contracts) {
      const files = routes.get(contract.route) ?? new Set<string>();
      for (const file of contract.files) files.add(file);
      routes.set(contract.route, files);
    }
    for (const [route, files] of routes) {
      const path = join(root, ".next/server/app", `${route}.js.nft.json`);
      write(path, { version: 1, files: [...files].map(file => relative(dirname(path), join(root, file))) });
    }
    assert.deepEqual(checkReaderTraces(root).failures, []);
    const route = "api/meetings/route";
    const path = join(root, ".next/server/app", `${route}.js.nft.json`);
    const missing = "data/derived/resolver-geometry.json";
    write(path, { version: 1, files: [...routes.get(route)!].filter(file => file !== missing).map(file => relative(dirname(path), join(root, file))) });
    const failures = checkReaderTraces(root).failures;
    assert.equal(failures.length, 1);
    assert.ok(failures[0].includes(`${route}: lib/registry/server.ts cannot read untraced ${missing}`));
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    rmSync(root, { recursive: true, force: true });
  }
});

test("no server function packs state geometry; each file is read from the reader edge store by the sha its manifest names", () => {
  const manifest = JSON.parse(fs.readFileSync("data/derived/state-geometry.json", "utf8")) as { files: Record<string, { sha256: string }> };
  const held = fs.readdirSync("data/states").flatMap(state => fs.existsSync(`data/states/${state}/geo`)
    ? fs.readdirSync(`data/states/${state}/geo`).filter(file => file.endsWith(".geojson")).map(file => `data/states/${state}/geo/${file}`) : []).sort();
  assert.deepEqual(Object.keys(manifest.files).sort(), held, "every committed state geometry file, territories included, is named");
  const toml = fs.readFileSync("netlify.toml", "utf8");
  assert.ok(!toml.includes('"data/states/*/geo/**/*.geojson"'), "a function packs state geometry");
  for (const block of toml.split(/\n(?=\[)/).filter(block => block.includes("resolver-geometry.json"))) {
    assert.ok(block.includes('"data/derived/state-geometry.json"') && block.includes('"!data/states/*/geo/**"'), block.split("\n")[0]);
  }
  assert.ok(Object.values(nextConfig.outputFileTracingExcludes ?? {}).flat().includes("./data/states/*/geo/**"));
  assert.ok(!Object.values(nextConfig.outputFileTracingIncludes ?? {}).flat().some(pattern => pattern.startsWith("./data/states/")));
});
