/**
 * **EVERY CHILD THE RUNNER STARTS CAN LOAD ITS OWN CODE.** (2026-10-06.)
 *
 * The owner snapshot (cp_owner_snapshots 'current') stopped moving at
 * 2026-10-04 13:38Z. SC-11 had made publish-owner-snapshot.mts import
 * place-owed-read.ts, whose chain reaches promoted-slices.ts and its `@/`
 * imports. The runner started that publisher with type stripping only, no
 * alias resolver, so every publish died at import with ERR_MODULE_NOT_FOUND,
 * and the runner printed the last stderr line, "Node.js v22…", as the reason.
 * Every Admin money and cost screen read the stale snapshot for two days.
 *
 * What these tests hold:
 * - every TypeScript child in pilot-runner.mts starts through the one
 *   TS_CHILD prefix, which carries the alias resolver;
 * - the owner-snapshot publisher, started exactly that way, loads and builds
 *   a snapshot (dry run, no database);
 * - a dead child's printed reason is the error, not the Node version banner.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { childStderrCause } from "../lib/ops/fatal-line.ts";

const RUNNER = readFileSync("scripts/pilot-runner.mts", "utf8");
const TS_CHILD = ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs"];

test("pilot-runner starts every TypeScript child through TS_CHILD, which carries the alias resolver", () => {
  const declared = RUNNER.match(/const TS_CHILD = (\[[^\]]*\]) as const;/);
  assert.ok(declared, "TS_CHILD is declared once in pilot-runner.mts");
  assert.deepEqual(JSON.parse(declared[1]), TS_CHILD);
  const strip = RUNNER.split("\n").filter((line) => line.includes("\"--experimental-strip-types\""));
  assert.deepEqual(strip.map((line) => line.trim()), [`const TS_CHILD = ${declared[1]} as const;`],
    "no child is launched with its own strip-types argument list");
  const launched = [...RUNNER.matchAll(/args: \[([^\]\n]*"scripts\/[\w-]+\.mts")/g)].map((m) => m[1])
    // CONSOLE_PUBLISHERS entries name only their script; they start through publisher.args below.
    .filter((args) => !/^"scripts\/[\w-]+\.mts"$/.test(args));
  assert.ok(launched.length >= 5, `runner child launches found: ${launched.length}`);
  for (const args of launched) assert.match(args, /^\.\.\.TS_CHILD, /, `launched without TS_CHILD: ${args}`);
  assert.match(RUNNER, /args: \[\.\.\.TS_CHILD, \.\.\.publisher\.args\]/, "console publishers start through TS_CHILD");
});

test("the owner-snapshot publisher, started as the runner starts it, loads and builds a snapshot", () => {
  const env = { ...process.env };
  for (const name of ["DATABASE_URL", "WTP_ASSET_STORE", "WTP_CONTROL_PLANE_DATABASE_URL"]) delete env[name];
  const run = spawnSync(process.execPath, [...TS_CHILD, "scripts/publish-owner-snapshot.mts", "--dry-run"],
    { env, encoding: "utf8", timeout: 120_000 });
  assert.equal(run.status, 0, childStderrCause(run.stderr ?? "") ?? run.stderr);
  assert.match(run.stdout, /--dry-run: nothing written/);
});

test("a dead child's printed reason names the error, not the Node version banner", () => {
  const stderr = [
    "node:internal/modules/package_json_reader:314",
    "  throw new ERR_MODULE_NOT_FOUND(packageName, fileURLToPath(base), null);",
    "        ^",
    "",
    "Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@/lib' imported from /srv/app/lib/control-plane/admin-view/promoted-slices.ts",
    "    at Object.getPackageJSONURL (node:internal/modules/package_json_reader:314:9)",
    "    at packageResolve (node:internal/modules/esm/resolve:767:81) {",
    "  code: 'ERR_MODULE_NOT_FOUND'",
    "}",
    "",
    "Node.js v22.22.0",
  ].join("\n");
  assert.match(childStderrCause(stderr) ?? "", /^Error \[ERR_MODULE_NOT_FOUND\]: Cannot find package '@\/lib'/);
  assert.equal(childStderrCause("owner-snapshot · published with incomplete inputs\n"), "owner-snapshot · published with incomplete inputs");
  assert.equal(childStderrCause("TypeError: x is not a function\n    at main (a.ts:1:1)\n\nNode.js v22.22.0\n"), "TypeError: x is not a function");
  assert.equal(childStderrCause("\n\n"), null);
});
