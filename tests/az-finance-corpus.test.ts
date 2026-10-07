import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const SCRIPT_PATH = join(ROOT, "scripts", "state-money-az.mts");

test("the acquisition script reads no ballot file and names no pilot ZIP", () => {
  const source = readFileSync(SCRIPT_PATH, "utf8");
  /* The check is on what the script reads, not on whether the words appear. */
  const reads = [...source.matchAll(/join\(\s*ROOT,\s*("[^"]+"(?:\s*,\s*"[^"]+")*)\s*\)/g)].map((m) =>
    m[1].replace(/"/g, "").replace(/\s*,\s*/g, "/"),
  );
  for (const path of reads) {
    assert.ok(
      !path.startsWith("data/ballot") && !/^data\/states\/[^/]+\/ballot\//.test(path),
      `the acquisition script builds a path into data/ballot: ${path}`,
    );
  }
  assert.match(
    source,
    /readAzBallotProjection\(\{\s*bypassCache:\s*true\s*\}\)/,
    "the script must read the canonical promoted ballot/identity projection",
  );
  assert.match(
    source,
    /AZ_BALLOT_IDENTITY_AUTHORITY_UNAVAILABLE/,
    "an unavailable canonical identity authority must refuse rather than fall back to a tracked file",
  );
  assert.doesNotMatch(
    source,
    /readFileSync\([^)]*data[^)]*identity/,
    "tracked identity files are bootstrap evidence, not the production acquisition authority",
  );
});

test("the acquisition script's candidate population comes from the publisher, not a page", () => {
  /* Comments are stripped first: the check reads the code. */
  const code = readFileSync(SCRIPT_PATH, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
  assert.ok(
    /statewideCandidateEntities\s*=\s*\[\.\.\.entities\.values\(\)\]/.test(code),
    "the statewide population is no longer derived from the whole cycle universe",
  );
  assert.ok(!/candidateOfInterest/.test(code), "the pilot-bound committee list is back");
  assert.ok(
    !/az-pima-2026\.json/.test(code),
    "the acquisition script loads the pilot ballot again",
  );
});
