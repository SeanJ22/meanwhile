import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { directoryFor } from "../lib/officials/directory.ts";

test("all normalized directory entries survive exact Bioguide projection", () => {
  const held = JSON.parse(readFileSync("data/congress-legislators/directory.json", "utf8"));
  for (const [id, entry] of Object.entries(held.byMember)) assert.deepEqual(directoryFor(`congress:${id}`)?.entry, entry, id);
  assert.equal(directoryFor("statewide:az/governor"), null);
  assert.equal(directoryFor("congress:Z999999"), null);
});

test("a missing deployed directory fails instead of claiming empty committees and offices", () => {
  const prefix = join(tmpdir(), "reader-directory-missing-");
  const temporary = mkdtempSync(prefix);
  const moduleUrl = pathToFileURL(resolve("lib/officials/directory.ts")).href;
  try {
    const script = `const {directoryFor}=await import(${JSON.stringify(moduleUrl)}); let result; try {directoryFor('congress:C001133'); result='FALSE_EMPTY';} catch {result='HOLDING_UNAVAILABLE';} process.stdout.write(result);`;
    assert.equal(execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], { cwd: temporary, encoding: "utf8" }), "HOLDING_UNAVAILABLE");
  } finally {
    assert.ok(resolve(temporary).startsWith(resolve(prefix)), "cleanup stays in the test's temporary directory");
    rmSync(temporary, { recursive: true, force: true });
  }
});
