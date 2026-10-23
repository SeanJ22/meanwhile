import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";

test("loading the reader's calendar authority does not load source acquisition or writable vault services", () => {
  const code = `
    import { registerHooks } from "node:module";
    const loaded = new Set();
    registerHooks({ resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context); loaded.add(resolved.url); return resolved;
    } });
    await import("./lib/civic-data/state-calendars.ts");
    console.log("CALENDAR_MODULES=" + JSON.stringify([...loaded]));
  `;
  const child = spawnSync(process.execPath, ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs", "--input-type=module", "-e", code], {
    cwd: join(import.meta.dirname, ".."), env: { ...process.env, DATABASE_URL: "", WTP_DB_ROLE: "" }, encoding: "utf8", timeout: 15_000,
  });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stdout + child.stderr);
  const output = child.stdout.split(/\r?\n/).find(line => line.startsWith("CALENDAR_MODULES="));
  assert.ok(output, "the actual isolated import must report its module graph");
  const loaded = JSON.parse(output.slice("CALENDAR_MODULES=".length)) as string[];
  assert.ok(loaded.some(url => url.endsWith("/lib/sources/source-check-request.ts")));
  assert.deepEqual(loaded.filter(url => /\/(?:sources\/known-release|control-plane\/evidence\/durable-store|control-plane\/workers\/vault-object)\.ts$/.test(url)), [],
    "calendar authority is on the Reader's import path; its shared read-now key must not pull in acquisition and vault services");
});
