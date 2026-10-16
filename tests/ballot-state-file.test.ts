import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readBallotStateFile } from "../lib/ballot/state-file.ts";
import { readJsonFile } from "../lib/ops/json-file.ts";

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

test("the shared JSON reader preserves state units, selected rows and scalar roots", async () => {
  const directory = await mkdtemp(join(tmpdir(), "state-unit-json-")), file = join(directory, "unit.json");
  try {
    const source = JSON.stringify({ ["__proto__"]: { retained: true }, rows: [{ text: "José 李 \\\"".repeat(20_000) }], empty: [], scalar: -1.25e+3 });
    await writeFile(file, source);
    const hash = createHash("sha256");
    assert.deepEqual(await readJsonFile(file, { onChunk: chunk => hash.update(chunk) }), JSON.parse(source));
    assert.equal(hash.digest("hex"), createHash("sha256").update(source).digest("hex"));
    const streamed: unknown[] = [];
    const metadata = await readJsonFile(file, { streamArray: path => path.join("/") === "rows", onRow: (_path, row) => streamed.push(row) });
    assert.deepEqual(metadata, { ...JSON.parse(source), rows: [] });
    assert.deepEqual(streamed, JSON.parse(source).rows);
    for (const scalar of ["null", "false", "0", '"standalone"', "[]"]) {
      await writeFile(file, scalar);
      assert.deepEqual(await readJsonFile(file), JSON.parse(scalar));
    }
    await writeFile(file, Buffer.from([34, 0xff, 34]));
    await assert.rejects(readJsonFile(file), /encoded data was not valid/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("giant quoted source URLs and escaped boundaries stream without losing bytes or subsequent records", async () => {
  const directory = await mkdtemp(join(tmpdir(), "state-unit-long-string-")), file = join(directory, "unit.json");
  try {
    const prefix = '{"rows":[{"url":"', boundary = 64 * 1024;
    const first = "https://census.gov/?where=" + "x".repeat(boundary - prefix.length - "https://census.gov/?where=".length - 1);
    const rawUrl = first + '\\"' + "y".repeat(boundary - 2) + '\\\\' + "z".repeat(600_000) + '\\u674e\\nend';
    const source = prefix + rawUrl + '"},{"id":"following","url":"https://example.gov/next"}],"complete":true}';
    assert.equal(source[boundary - 1], "\\");
    assert.equal(source[2 * boundary - 1], "\\");
    await writeFile(file, source);
    const expected = JSON.parse(source), hash = createHash("sha256"), records: unknown[] = [];
    let bytes = 0, chunks = 0;
    const metadata = await readJsonFile(file, {
      onChunk: chunk => { bytes += chunk.byteLength; chunks++; hash.update(chunk); },
      streamArray: path => path.length === 1 && path[0] === "rows",
      onRow: (path, row) => { assert.deepEqual(path, ["rows"]); records.push(row); },
    });
    assert.ok(chunks > 10);
    assert.equal(bytes, Buffer.byteLength(source));
    assert.equal(hash.digest("hex"), createHash("sha256").update(source).digest("hex"));
    assert.deepEqual(metadata, { rows: [], complete: true });
    assert.deepEqual(records, expected.rows);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
