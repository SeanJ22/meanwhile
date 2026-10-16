import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readBallotStateFile } from "../lib/ballot/state-file.ts";

test("state JSON streams core and supplemental rows across UTF-8 chunks while retaining only metadata", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ballot-stream-")), file = join(directory, "tx.json");
  try {
    const names = ["O'Neil \\\"{[José]}\\\"", "李".repeat(30_000)];
    const ballot = { candidacies: names.map((name, index) => ({ id: index, name, nested: { positions: [1, null, false] } })),
      election: { state: "TX", id: "general" }, contests: [{ id: "governor" }], coverageNotes: ["known gap"],
      measureAnalyses: { generatedAt: "2026-10-16", analyses: [{ text: "Official { text }, with \\\"quoted\\\" wording." }] } };
    const sourceReceipt = { sources: [{ url: "https://example.gov", paths: ["/one", "/two"] }] };
    await writeFile(file, JSON.stringify({ ballots: { "TX:general": ballot }, sourceReceipt }));
    const rows = new Map<string, unknown[]>();
    const metadata = await readBallotStateFile(file, (path, row) => {
      const key = path.join("/"), values = rows.get(key) ?? [];
      values.push(row); rows.set(key, values);
    });
    assert.deepEqual(rows.get("ballots/TX:general/candidacies"), ballot.candidacies);
    assert.deepEqual(rows.get("ballots/TX:general/measureAnalyses/analyses"), ballot.measureAnalyses.analyses);
    assert.deepEqual(rows.get("ballots/TX:general/coverageNotes"), ["known gap"]);
    assert.deepEqual(metadata.ballots["TX:general"], { ...ballot, candidacies: [], contests: [], coverageNotes: [],
      measureAnalyses: { ...ballot.measureAnalyses, analyses: [] } });
    assert.deepEqual(metadata.sourceReceipt, sourceReceipt);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("truncation, missing separators, trailing commas and invalid scalar values cannot become a state input", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ballot-stream-invalid-")), file = join(directory, "tx.json");
  try {
    for (const source of ['{"ballots":', '{"ballots":{},}', '{"a":[1,]}', '{"a":01}', '{"a":"unterminated}',
      '{"a":true false}', '{"a":1 "b":2}', '{"a":[]}}', '{"a":"bad\\x"}']) {
      await writeFile(file, source);
      await assert.rejects(readBallotStateFile(file), SyntaxError, source);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
