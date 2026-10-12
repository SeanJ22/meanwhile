import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { parseCsv } from "../lib/sources/prl/index.ts";
import {
  streamCsvRecords,
  streamJsonArrayObjects,
} from "../lib/sources/prl/streaming.ts";
import {
  advanceWatermark,
  isVisibleAsOf,
  parsePrlInstant,
} from "../lib/sources/prl/future-date.ts";
import {
  PRL_DICTIONARY_CONTRACTS,
  assertDictionaryColumns,
  dictionaryColumnNames,
  type PrlDictionaryId,
} from "../lib/sources/prl/dictionaries.ts";
import { PRL_ARCHIVES, PRL_DATASETS, PRL_PROFILES } from "../lib/sources/prl/inventory.ts";

const ROOT = process.cwd();
const NOW = Date.parse("2026-09-17T00:00:00Z");

/** Feed a string to a streaming parser in fixed-size chunks to exercise boundaries. */
async function* chunked(text: string, size: number): AsyncGenerator<string> {
  for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size);
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of gen) out.push(item);
  return out;
}

test("streaming CSV survives embedded commas, newlines and escaped quotes", async () => {
  const text = 'a,b,c\n1,"x, y\nz",3\n"he said ""hi""",p,q\n';
  for (const size of [1, 3, 7, 10_000]) {
    const rows = await collect(streamCsvRecords(chunked(text, size)));
    assert.deepEqual(rows[0], ["a", "b", "c"]);
    assert.deepEqual(rows[1], ["1", "x, y\nz", "3"], `chunk size ${size}`);
    assert.deepEqual(rows[2], ['he said "hi"', "p", "q"], `chunk size ${size}`);
    assert.equal(rows.length, 3);
  }
});

test("streaming CSV flushes a final row with no trailing newline", async () => {
  const rows = await collect(streamCsvRecords(chunked("a,b\n1,", 2)));
  assert.deepEqual(rows[1], ["1", ""]);
});

test("streaming JSON yields objects despite braces/commas/newlines in strings", async () => {
  const text = '[\n{"id": 1, "t": "a},{b \\n c"},\n{"id": 2, "t": "x\\"y"}\n]';
  for (const size of [1, 4, 13, 10_000]) {
    const objs = await collect(streamJsonArrayObjects(chunked(text, size))) as { id: string; t: string }[];
    assert.equal(objs.length, 2, `chunk size ${size}`);
    assert.deepEqual(objs[0], { id: "1", t: "a},{b \n c" }, `chunk size ${size}`);
    assert.deepEqual(objs[1], { id: "2", t: 'x"y' }, `chunk size ${size}`);
  }
});

test("parsePrlInstant reads both PRL cursor widths and refuses junk", () => {
  assert.ok(parsePrlInstant("2017-06-21")! < parsePrlInstant("2025-07-20 21:48:58")!);
  assert.equal(parsePrlInstant("0"), null);
  assert.equal(parsePrlInstant(""), null);
  assert.equal(parsePrlInstant(" its understanding soil health"), null);
});

test("a single future-dated row never advances the high-water mark", () => {
  // THE HAZARD. Press Releases advertise Jul 2027. A naive max would set the
  // mark to 2027 and skip every real row that arrives between now and then.
  const advance = advanceWatermark(
    null,
    ["2026-09-01", "2027-07-01", "2026-09-10", "2027-01-15"],
    NOW,
  );
  assert.equal(advance.mark, "2026-09-10", "mark must be the newest row at or before now");
  assert.equal(advance.afterNow, 2, "both 2027 rows are counted as future");
  assert.equal(advance.atOrBeforeNow, 2);
  // And the future rows are still visible-filtered out at read time.
  assert.equal(isVisibleAsOf("2027-01-15", NOW), false);
  assert.equal(isVisibleAsOf("2026-09-10", NOW), true);
});

test("advanceWatermark holds the previous mark when every new row is future", () => {
  const advance = advanceWatermark("2026-09-10", ["2027-07-01"], NOW);
  assert.equal(advance.mark, "2026-09-10");
  assert.equal(advance.afterNow, 1);
});

test("the committed dictionaries still list every column the ingestion reads", () => {
  const files: Record<PrlDictionaryId, string> = {
    "dict-communication": "communication-meta.csv",
    "dict-profiles": "profiles-meta.csv",
    "dict-primary": "primary-meta.csv",
    "dict-state-rhetoric": "state-meta.csv",
    "dict-state-profiles": "state-profiles-meta.csv",
  };
  for (const [id, file] of Object.entries(files) as [PrlDictionaryId, string][]) {
    const csv = readFileSync(join(ROOT, "tests", "fixtures", "prl", file), "utf8");
    const names = dictionaryColumnNames(parseCsv(csv));
    // The real committed dictionary satisfies its own contract.
    assert.doesNotThrow(() => assertDictionaryColumns(id, names), `${id} (${file})`);
    // And a dictionary that lost the identity key fails loudly.
    const key = PRL_DICTIONARY_CONTRACTS[id].key;
    if (key) {
      assert.throws(
        () => assertDictionaryColumns(id, names.filter((n) => n !== key)),
        /schema moved/,
        `${id} must refuse a dictionary missing ${key}`,
      );
    }
  }
});

test("the inventory encodes the revise-vs-append finding as the cursor", () => {
  const byId = new Map(PRL_DATASETS.map((d) => [d.id, d]));
  // Datasets that carry last_updated revise, and their cursor is last_updated.
  for (const id of ["statements-current", "statements-national", "state-rhetoric"]) {
    const d = byId.get(id)!;
    assert.equal(d.revises, true, id);
    assert.equal(d.cursorField, "last_updated", id);
  }
  // Append-only datasets cursor on date.
  for (const id of ["primary-rhetoric", "newsletters", "press-releases", "floor-speeches"]) {
    const d = byId.get(id)!;
    assert.equal(d.revises, false, id);
    assert.equal(d.cursorField, "date", id);
  }
  // Press Releases is the future-dated one.
  assert.equal(byId.get("press-releases")!.declared.through, "2027-07");
});

test("the inventory keys each dataset to the identity it actually carries", () => {
  const byId = new Map(PRL_DATASETS.map((d) => [d.id, d]));
  assert.equal(byId.get("statements-national")!.key, "bioguide_id");
  assert.equal(byId.get("state-rhetoric")!.key, "openstates_id");
  assert.equal(byId.get("profiles-state")!.key, "openstates_id");
  assert.equal(byId.get("primary-rhetoric")!.key, "candidate_id");
  // Every archive goes to object storage; every profile is a small aggregate.
  for (const d of PRL_ARCHIVES) assert.equal(d.target, "archive", d.id);
  for (const d of PRL_PROFILES) assert.equal(d.target, "profile", d.id);
});
