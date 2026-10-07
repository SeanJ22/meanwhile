import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

test("missing held key-vote positions cannot become null positions or unacquired roll calls", () => {
  const prefix = join(tmpdir(), "reader-key-votes-missing-");
  const temporary = mkdtempSync(prefix);
  const moduleUrl = pathToFileURL(resolve("lib/votes/key-vote-positions.ts")).href;
  try {
    const script = `const source=await import(${JSON.stringify(moduleUrl)});let failures=0;for(const read of [()=>source.keyVotePositionFor('held-roll','congress:C001133'),()=>source.keyVoteRollCallHeld('held-roll')]) {try{read();}catch{failures++;}}process.stdout.write(String(failures));`;
    assert.equal(execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], { cwd: temporary, encoding: "utf8" }), "2");
  } finally {
    assert.ok(resolve(temporary).startsWith(resolve(prefix)), "cleanup stays in the test's temporary directory");
    rmSync(temporary, { recursive: true, force: true });
  }
});
