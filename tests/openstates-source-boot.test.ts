import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("the standing OpenStates command boots with the production source-child flags", () => {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    // Reach the real write-handle admission without a database or network call.
    // A test-loader preload must not conceal unsupported production imports.
    if (/^(WTP_|DATABASE_URL|NEON_|NETLIFY_|PG)/i.test(key) || key === "NODE_OPTIONS") delete env[key];
  }
  const run = spawnSync(process.execPath, [
    "--experimental-strip-types", "scripts/openstates-people-refresh.mts", "--promote", "--state=nc",
  ], { cwd: process.cwd(), env, encoding: "utf8", timeout: 30_000 });
  assert.equal(run.error, undefined, String(run.error));
  assert.equal(run.status, 1, run.stderr);
  assert.match(run.stderr, /WriteHandleRefused \[Error\]: WTP_PRODUCTION_DATABASE_URL_WRITE is not set/,
    "the entire real entrypoint must load and reach write admission before any acquisition");
  assert.doesNotMatch(run.stderr, /ERR_MODULE_NOT_FOUND|ERR_UNSUPPORTED|SyntaxError/);
  assert.equal(run.stdout, "", "boot refusal must not claim acquisition or publication");
});
