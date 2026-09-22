import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { proveGeneratedArtifacts } from "./helpers/generated-artifact-proof.ts";

function fixture(t: { after(fn: () => void): void }, second = "second") {
  const root = mkdtempSync(join(tmpdir(), "generated-proof-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "first"), "first");
  writeFileSync(join(root, "second"), second);
  const artifacts = ["first", "second"].map((path) => ({ path, command: "generate-both", pure: true }));
  return { root, artifacts };
}

test("generated proof runs a shared generator once and compares every output", (t) => {
  const { root, artifacts } = fixture(t);
  const calls: string[] = [];
  proveGeneratedArtifacts(root, artifacts, (command) => {
    calls.push(command);
    writeFileSync(join(root, "first"), "first");
    writeFileSync(join(root, "second"), "second");
  });
  assert.deepEqual(calls, ["generate-both"]);
});

test("generated proof fails on a stale sibling even when generation repairs it first", (t) => {
  const { root, artifacts } = fixture(t, "STALE");
  let calls = 0;
  assert.throws(() => proveGeneratedArtifacts(root, artifacts, () => {
    calls += 1;
    assert.equal(readFileSync(join(root, "second"), "utf8"), "STALE", "retry starts from original bytes");
    writeFileSync(join(root, "first"), "first");
    writeFileSync(join(root, "second"), "second");
  }), /second.*REPRODUCED/);
  assert.equal(calls, 2);
  assert.equal(readFileSync(join(root, "second"), "utf8"), "STALE");
});

test("generated proof restores outputs after a generator fails midway", (t) => {
  const { root, artifacts } = fixture(t);
  assert.throws(() => proveGeneratedArtifacts(root, artifacts, () => {
    writeFileSync(join(root, "first"), "partial");
    writeFileSync(join(root, "second"), "partial");
    throw new Error("generator failed");
  }), /generator failed/);
  assert.equal(readFileSync(join(root, "first"), "utf8"), "first");
  assert.equal(readFileSync(join(root, "second"), "utf8"), "second");
});

test("generated proof cannot hide drift by rewriting another command's output", (t) => {
  const { root, artifacts } = fixture(t, "STALE");
  artifacts[1].command = "generate-second";
  const calls: string[] = [];
  assert.throws(() => proveGeneratedArtifacts(root, artifacts, (command) => {
    calls.push(command);
    if (command === "generate-second") {
      assert.equal(readFileSync(join(root, "second"), "utf8"), "STALE");
    }
    writeFileSync(join(root, "second"), "second");
  }), /second.*REPRODUCED/);
  assert.deepEqual(calls, ["generate-both", "generate-second", "generate-second"]);
  assert.equal(readFileSync(join(root, "second"), "utf8"), "STALE");
});

test("generated proof keeps a non-reproducing mismatch red", (t) => {
  const { root, artifacts } = fixture(t);
  let calls = 0;
  assert.throws(() => proveGeneratedArtifacts(root, artifacts, () => {
    calls += 1;
    writeFileSync(join(root, "second"), calls === 1 ? "raced" : "second");
  }), /CONCURRENCY OBSERVATION/);
  assert.equal(calls, 2);
  assert.equal(readFileSync(join(root, "second"), "utf8"), "second");
});

test("generated proof deduplicates check commands without conflating distinct checks", (t) => {
  const { root, artifacts } = fixture(t);
  const calls: string[] = [];
  proveGeneratedArtifacts(root, [
    ...artifacts.map((artifact) => ({ ...artifact, checkCommand: "check-all" })),
    { ...artifacts[0], checkCommand: "check-other" },
  ], (command) => { calls.push(command); });
  assert.deepEqual(calls, ["check-all", "check-other"]);
});
