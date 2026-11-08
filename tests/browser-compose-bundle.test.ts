import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { builtinModules } from "node:module";
import { gzipSync } from "node:zlib";
import vm from "node:vm";
import { test } from "node:test";
import { build, type Plugin } from "esbuild";

import { stateCoverage } from "../lib/reader/coverage.ts";
import { sha256Text } from "../lib/sha256-text.ts";
import { registryFixtureForState } from "./helpers/promoted-fixtures.ts";

const ENTRY = new URL("./helpers/browser-compose-entry.ts", import.meta.url).pathname;
const SERVER_ONLY = [...builtinModules, ...builtinModules.map(name => `node:${name}`), "process", "pg", "@netlify/blobs", "@neondatabase/serverless"];
const reaches = (path: string) => SERVER_ONLY.some(name => path === name || path.startsWith(`${name}/`));

async function bundle(format: "esm" | "iife", minify: boolean) {
  const reached: string[] = [];
  const guard: Plugin = { name: "server-only", setup(b) {
    b.onResolve({ filter: /.*/ }, args => {
      if (args.kind === "entry-point" || !reaches(args.path)) return undefined;
      reached.push(`${args.path} <- ${args.importer.replace(/^.*\/meanwhile\//, "")}`);
      return { path: args.path, namespace: "server-only" };
    });
    b.onLoad({ filter: /.*/, namespace: "server-only" }, () => ({ contents: "" }));
  } };
  const result = await build({ entryPoints: [ENTRY], bundle: true, platform: "browser", format, globalName: "Compose", minify, write: false, logLevel: "silent", plugins: [guard] });
  return { reached, text: result.outputFiles[0]!.text };
}

test("the composition set bundles for a browser without reaching a database, file, Blobs store or Node module", async () => {
  const { reached, text } = await bundle("esm", true);
  assert.deepEqual(reached, [], "a pure composition module imports an I/O module");
  console.log(`browser composition bundle: ${text.length} bytes minified, ${gzipSync(text).length} bytes gzipped`);
});

test("a browser with no process or require composes the coverage the server composes", async () => {
  const { text } = await bundle("iife", false);
  const sandbox = vm.createContext({ TextEncoder, TextDecoder, URL, console, structuredClone, setTimeout, clearTimeout, queueMicrotask });
  const browser = vm.runInContext(`${text};Compose`, sandbox) as { stateCoverage: typeof stateCoverage };
  const registry = registryFixtureForState("AZ");
  const state = { state: "AZ", registry, version: "fixture" };
  const ids = registry.registry.divisions.slice(0, 12).map(division => division.ocdId);
  const server = stateCoverage(state, ids, 32.2, -110.9);
  assert.ok(server.bodies.length > 0, "the fixture state has bodies to compare");
  assert.deepEqual(JSON.parse(JSON.stringify(browser.stateCoverage(state, ids, 32.2, -110.9))), JSON.parse(JSON.stringify(server)));
});

test("the plain-JavaScript digest the browser uses equals node:crypto's", () => {
  for (const text of ["", "abc", "é漢𝒳".repeat(40), "x".repeat(55), "x".repeat(56), "x".repeat(64), "y".repeat(1000)])
    assert.equal(sha256Text(text), createHash("sha256").update(text).digest("hex"));
});
