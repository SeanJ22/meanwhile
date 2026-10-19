import assert from "node:assert/strict";
import { test } from "node:test";
import { readZipPlace, readZipPlaces } from "../lib/reader/national.ts";

test("one ZIP shard returns the national reader's exact divisions, partial coverage and samples for every held ZIP and postal alias", async () => {
  const expected = await readZipPlaces();
  assert.ok(expected.size > 33_000);
  for (const [zip, value] of [...expected].sort(([left], [right]) => left.localeCompare(right))) {
    assert.deepEqual(await readZipPlace(zip), value, zip);
  }
  assert.equal(await readZipPlace("not-a-zip"), null);
  assert.equal(await readZipPlace("99999"), null);
});
