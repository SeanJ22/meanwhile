import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { keyVotesForMember } from "../lib/votes/key-votes-reader.ts";
import { keyVotePositionKey } from "../lib/votes/key-vote-positions.ts";
import { installRegistryRuntimeFirstSeeds } from "./helpers/registry-runtime-first-seed.ts";

await installRegistryRuntimeFirstSeeds();

test("shared key-vote projection retains exact current member/chamber positions and source timestamp", async () => {
  const held = JSON.parse(readFileSync("data/votes/key-vote-positions.json", "utf8"));
  for (const [member, chamber] of [["congress:C001133", "house"], ["congress:K000377", "senate"]] as const) {
    const answer = await keyVotesForMember(member);
    assert.equal(answer.chamber, chamber);
    assert.equal(answer.positionsReadAt, held.fetchedAt);
    assert.ok(answer.rows.length > 0);
    for (const row of answer.rows) {
      assert.deepEqual(row.refs, row.entry[chamber]);
      for (const [index, ref] of row.refs.entries()) {
        const key = keyVotePositionKey(row.entry.id, chamber, ref.congress, ref.session, ref.rollNumber);
        assert.equal(row.positions[index], held.positions[key]?.[member] ?? null);
        assert.equal(row.held[index], held.positions[key] !== undefined);
      }
    }
  }
  assert.deepEqual((await keyVotesForMember("statewide:az/governor")).rows, []);
  assert.deepEqual((await keyVotesForMember("congress:Z999999")).rows, []);
});

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
