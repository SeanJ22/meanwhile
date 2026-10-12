import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

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
